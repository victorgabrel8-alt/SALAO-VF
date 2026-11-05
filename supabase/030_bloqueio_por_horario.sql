-- =====================================================================
-- 030_bloqueio_por_horario.sql — horas sem atender num dia (pedido do Victor, 04/11).
-- A Gleide diz à assistente "hoje não atendo das 14h às 16h": a IA, o app e a oferta de vagas param de
-- usar esse período. Dia inteiro continua em config.bloqueios; este fica numa chave separada porque
-- quem lê config.bloqueios entende qualquer item como o dia todo:
--   empresas.config.bloqueios_horario = [{ "dia": "AAAA-MM-DD", "inicio": "14:00", "fim": "16:00", "motivo": "Médico" }]
-- =====================================================================

-- O primeiro bloqueio que encosta nesse período, ou null
create or replace function bloqueio_horario_choque(p_config jsonb, p_inicio timestamptz, p_fim timestamptz)
returns jsonb language sql stable set search_path = public as $$
  select b from jsonb_array_elements(case when jsonb_typeof(p_config->'bloqueios_horario') = 'array' then p_config->'bloqueios_horario' else '[]'::jsonb end) b
   where (((b->>'dia')::date + (b->>'inicio')::time) at time zone 'America/Cuiaba') < p_fim
     and (((b->>'dia')::date + (b->>'fim')::time) at time zone 'America/Cuiaba') > p_inicio
   order by b->>'dia', b->>'inicio'
   limit 1
$$;

-- Igual à versão atual, com o bloqueio de horas conferido depois do almoço
create or replace function assistente_conferir_horario(p_empresa_id uuid, p_inicio timestamptz, p_duracao_min int, p_ignorar uuid default null)
returns text language plpgsql stable set search_path = public as $$
declare
  v_config jsonb; v_dia date := (p_inicio at time zone 'America/Cuiaba')::date;
  v_bloq jsonb; v_faixa text; v_abre int; v_fecha int; v_ini int; v_fim int;
  v_alm_ini int; v_alm_fim int; v_choques text; v_hora jsonb;
begin
  select config into v_config from empresas where id = p_empresa_id;
  select b into v_bloq from jsonb_array_elements(coalesce(v_config->'bloqueios', '[]'::jsonb)) b
   where v_dia between (b->>'de')::date and greatest((b->>'de')::date, (b->>'ate')::date) limit 1;
  if v_bloq is not null then
    return 'Esse dia está marcado como sem atender' || coalesce(' (' || nullif(v_bloq->>'motivo', '') || ')', '') || '.';
  end if;
  if v_config ? 'horario_funcionamento' then
    v_faixa := v_config->'horario_funcionamento'->>(array['dom','seg','ter','qua','qui','sex','sab'])[extract(dow from v_dia)::int + 1];
    if v_faixa is null or v_faixa = '' then return 'O salão não abre nesse dia.'; end if;
  else
    v_faixa := '09:00-18:00';
  end if;
  v_abre  := extract(epoch from split_part(v_faixa, '-', 1)::time)::int / 60;
  v_fecha := extract(epoch from split_part(v_faixa, '-', 2)::time)::int / 60;
  v_ini := extract(epoch from (p_inicio at time zone 'America/Cuiaba')::time)::int / 60;
  v_fim := v_ini + greatest(p_duracao_min, 1);
  if v_ini < v_abre or v_fim > v_fecha then
    return format('Fora do horário do salão nesse dia (%s às %s), contando a duração do serviço (%s min).',
                  split_part(v_faixa, '-', 1), split_part(v_faixa, '-', 2), p_duracao_min);
  end if;
  -- almoço: config.almoco = null desliga; sem nada salvo vale 11:00 às 13:00 (crm/lib/almoco.ts)
  if not (v_config ? 'almoco' and jsonb_typeof(v_config->'almoco') = 'null') then
    v_alm_ini := extract(epoch from coalesce(nullif(v_config->'almoco'->>'inicio', ''), '11:00')::time)::int / 60;
    v_alm_fim := extract(epoch from coalesce(nullif(v_config->'almoco'->>'fim', ''), '13:00')::time)::int / 60;
    if v_ini < v_alm_fim and v_fim > v_alm_ini then
      return format('Esse horário cai no almoço (%s às %s).',
                    coalesce(v_config->'almoco'->>'inicio', '11:00'), coalesce(v_config->'almoco'->>'fim', '13:00'));
    end if;
  end if;
  v_hora := bloqueio_horario_choque(v_config, p_inicio, p_inicio + make_interval(mins => greatest(p_duracao_min, 1)));
  if v_hora is not null then
    return format('Esse horário está bloqueado (%s às %s)', v_hora->>'inicio', v_hora->>'fim')
           || coalesce(' (' || nullif(v_hora->>'motivo', '') || ')', '') || '.';
  end if;
  select string_agg(format('%s (%s às %s)', coalesce(c.nome, 'outra cliente'),
                           to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'),
                           to_char(coalesce(a.fim, a.inicio + interval '1 hour') at time zone 'America/Cuiaba', 'HH24:MI')),
                    ', ' order by a.inicio)
    into v_choques
    from agendamentos a join clientes c on c.id = a.cliente_id
   where a.empresa_id = p_empresa_id and a.status in ('agendado', 'realizado')
     and a.id is distinct from p_ignorar
     and a.inicio < p_inicio + make_interval(mins => greatest(p_duracao_min, 1))
     and coalesce(a.fim, a.inicio + interval '1 hour') > p_inicio;
  if v_choques is not null then return 'Encavala com ' || v_choques || '.'; end if;
  return null;
end $$;

-- Igual à versão atual, sem oferecer vaga dentro de um período bloqueado
create or replace function n8n_vagas_para_oferecer(p_empresa_id uuid)
returns table (vaga_id uuid, vaga_inicio timestamptz, vaga_fim timestamptz, agendamento_id uuid, cliente_id uuid,
               nome text, telefone text, inicio_atual timestamptz, servico text)
language plpgsql set search_path = public as $$
begin
  update vagas v set status = 'preenchida'
   where v.empresa_id = p_empresa_id and v.status = 'aberta'
     and exists (select 1 from agendamentos a
                  where a.empresa_id = v.empresa_id and a.status in ('agendado', 'realizado')
                    and a.id is distinct from v.agendamento_id
                    and a.inicio < v.fim and coalesce(a.fim, a.inicio + interval '1 hour') > v.inicio);
  update vagas v set status = 'expirada'
   where v.empresa_id = p_empresa_id and v.status = 'aberta'
     and (case when v.motivo = 'atraso' then v.inicio < now() + interval '30 minutes'
               else v.inicio < now() + interval '3 hours' end
          -- a cliente atrasada apareceu (a Gleide corrigiu o status): o horário não está livre
          or (v.motivo = 'atraso' and exists (select 1 from agendamentos x where x.id = v.agendamento_id and x.status <> 'faltou')));

  return query
  select distinct on (v.id)
         v.id, v.inicio, v.fim, a.id, c.id, c.nome, c.telefone, a.inicio, s.nome
    from vagas v
    join empresas e on e.id = v.empresa_id
    join agendamentos a on a.empresa_id = v.empresa_id and a.status = 'agendado'
                       and a.inicio >= v.fim and a.inicio <= v.inicio + interval '14 days'
                       and (v.inicio + (coalesce(a.fim, a.inicio + interval '1 hour') - a.inicio) <= v.fim or a.inicio = v.fim)
    join clientes c on c.id = a.cliente_id
    left join servicos s on s.id = a.servico_id
   where v.empresa_id = p_empresa_id
     and v.status = 'aberta'
     and coalesce((e.config->'vagas'->>'oferecer')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'vagas'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'vagas'->'so_para') ? c.telefone)
     -- vaga de atraso: só para quem tem horário no mesmo dia
     and (v.motivo <> 'atraso' or (a.inicio at time zone 'America/Cuiaba')::date = (v.inicio at time zone 'America/Cuiaba')::date)
     and not exists (select 1 from jsonb_array_elements(coalesce(e.config->'bloqueios', '[]'::jsonb)) b
                      where (v.inicio at time zone 'America/Cuiaba')::date between (b->>'de')::date and (b->>'ate')::date)
     -- período bloqueado pela Gleide: não oferece
     and bloqueio_horario_choque(e.config, v.inicio, v.fim) is null
     and a.cliente_id is distinct from (select x.cliente_id from agendamentos x where x.id = v.agendamento_id)
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < now())
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.vaga_id = v.id)
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.resultado in ('pendente', 'respondeu')
                      and ct.criado_em > now() - interval '24 hours')
     -- uma oferta por vez para cada vaga (atraso: a próxima depois de 10 min; as outras: 2 h / 30 min)
     and not exists (select 1 from contatos ct where ct.vaga_id = v.id
                      and (ct.resultado = 'agendou'
                           or (ct.resultado = 'pendente' and ct.criado_em > now() -
                               case when v.motivo = 'atraso' then interval '10 minutes' else interval '2 hours' end)
                           or (ct.resultado = 'respondeu' and ct.criado_em > now() -
                               case when v.motivo = 'atraso' then interval '10 minutes' else interval '30 minutes' end)))
   order by v.id, a.inicio;
end $$;

-- Igual à versão atual, dizendo que o dia tem bloqueio de horas quando nada sobra (antes dizia "cai no almoço")
create or replace function n8n_assistente_horarios_livres(p_empresa_id uuid, p_pedido_por text, p_data date default null, p_servico text default null, p_ignorar uuid default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare v_dia date := coalesce(p_data, hoje_cuiaba()); v_serv uuid; v_dur int := 60; v_nome text; v_livres text[]; v_motivo text; v_hora jsonb;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if nullif(trim(coalesce(p_servico, '')), '') is not null then
    v_serv := assistente_achar_servico(p_empresa_id, p_servico);
    select coalesce(duracao_min, 60), nome into v_dur, v_nome from servicos where id = v_serv;
  elsif p_ignorar is not null then
    select coalesce(s.duracao_min, extract(epoch from a.fim - a.inicio)::int / 60, 60), s.nome into v_dur, v_nome
      from agendamentos a left join servicos s on s.id = a.servico_id where a.id = p_ignorar and a.empresa_id = p_empresa_id;
  end if;
  select array_agg(to_char(t at time zone 'America/Cuiaba', 'HH24:MI') order by t) into v_livres
    from generate_series((v_dia + time '06:00') at time zone 'America/Cuiaba',
                         (v_dia + time '22:00') at time zone 'America/Cuiaba', interval '30 minutes') g(t)
   where t > now() and assistente_conferir_horario(p_empresa_id, t, v_dur, p_ignorar) is null;
  if v_livres is null then
    v_motivo := assistente_conferir_horario(p_empresa_id, (v_dia + time '12:00') at time zone 'America/Cuiaba', 1, p_ignorar);
    select bloqueio_horario_choque(config, v_dia::timestamp at time zone 'America/Cuiaba', (v_dia + 1)::timestamp at time zone 'America/Cuiaba') into v_hora
      from empresas where id = p_empresa_id;
    if v_hora is not null and (v_motivo is null or v_motivo like 'Esse horário cai no almoço%') then v_motivo := format('nenhum horário livre; tem bloqueio nesse dia (%s às %s)', v_hora->>'inicio', v_hora->>'fim'); end if;
  end if;
  return jsonb_build_object('dia', assistente_dia_longo(v_dia), 'servico', v_nome, 'duracao_min', v_dur,
                            'livres', coalesce(to_jsonb(v_livres), '[]'::jsonb),
                            'obs', case when v_livres is null then coalesce(v_motivo, 'nenhum horário livre nesse dia') end);
end $$;

-- Bloqueia um período do dia e devolve quem já está marcado nele (a assistente pergunta se pede para remarcar)
create or replace function n8n_assistente_bloquear_horario(p_empresa_id uuid, p_pedido_por text, p_dia date, p_inicio time, p_fim time, p_motivo text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_marcados jsonb; v_ini timestamptz; v_fim timestamptz; v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_dia is null then raise exception 'qual dia?'; end if;
  if p_inicio is null or p_fim is null then raise exception 'de que horas a que horas?'; end if;
  if p_fim <= p_inicio then raise exception 'a hora final precisa ser depois da inicial'; end if;
  if p_dia < hoje_cuiaba() then raise exception 'esse dia já passou'; end if;
  v_ini := (p_dia + p_inicio) at time zone 'America/Cuiaba';
  v_fim := (p_dia + p_fim) at time zone 'America/Cuiaba';
  update empresas
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{bloqueios_horario}',
                            coalesce((select jsonb_agg(b) from jsonb_array_elements(case when jsonb_typeof(config->'bloqueios_horario') = 'array' then config->'bloqueios_horario' else '[]'::jsonb end) b
                                       where (b->>'dia')::date >= hoje_cuiaba()
                                         and not ((b->>'dia')::date = p_dia and (b->>'inicio')::time = p_inicio and (b->>'fim')::time = p_fim)), '[]'::jsonb) ||
                            jsonb_build_array(jsonb_build_object('dia', p_dia, 'inicio', to_char(p_inicio, 'HH24:MI'),
                                                                 'fim', to_char(p_fim, 'HH24:MI'), 'motivo', v_motivo)))
   where id = p_empresa_id;
  select jsonb_agg(jsonb_build_object('agendamento_id', a.id, 'nome', c.nome, 'quando', assistente_quando(a.inicio)) order by a.inicio)
    into v_marcados
    from agendamentos a join clientes c on c.id = a.cliente_id
   where a.empresa_id = p_empresa_id and a.status = 'agendado'
     and a.inicio < v_fim and coalesce(a.fim, a.inicio + interval '1 hour') > v_ini;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_bloquear_horario', 'empresas', p_empresa_id,
          jsonb_build_object('dia', p_dia, 'inicio', p_inicio, 'fim', p_fim, 'motivo', v_motivo), p_pedido_por);
  return jsonb_build_object('bloqueado', assistente_dia_longo(p_dia) || ', das ' || to_char(p_inicio, 'HH24:MI') || ' às ' || to_char(p_fim, 'HH24:MI'),
                            'horarios_marcados_nesse_periodo', coalesce(v_marcados, '[]'::jsonb));
end $$;

-- Tira os bloqueios de horas do dia; com p_inicio, só o que cobre essa hora
create or replace function n8n_assistente_desbloquear_horario(p_empresa_id uuid, p_pedido_por text, p_dia date, p_inicio time default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_tirados jsonb;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_dia is null then raise exception 'qual dia?'; end if;
  select jsonb_agg(b) into v_tirados from empresas e, jsonb_array_elements(coalesce(e.config->'bloqueios_horario', '[]'::jsonb)) b
   where e.id = p_empresa_id and (b->>'dia')::date = p_dia
     and (p_inicio is null or (p_inicio >= (b->>'inicio')::time and p_inicio < (b->>'fim')::time));
  if v_tirados is null then raise exception 'não tem bloqueio de horário nesse dia'; end if;
  update empresas e
     set config = jsonb_set(e.config, '{bloqueios_horario}', coalesce((
           select jsonb_agg(b) from jsonb_array_elements(e.config->'bloqueios_horario') b
            where not ((b->>'dia')::date = p_dia
                       and (p_inicio is null or (p_inicio >= (b->>'inicio')::time and p_inicio < (b->>'fim')::time)))), '[]'::jsonb))
   where e.id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_desbloquear_horario', 'empresas', p_empresa_id,
          jsonb_build_object('tirados', v_tirados), p_pedido_por);
  return jsonb_build_object('desbloqueado', v_tirados);
end $$;

-- Os bloqueios de horas de um dia ou, sem data, de hoje em diante
create or replace function n8n_assistente_ver_bloqueios_horario(p_empresa_id uuid, p_pedido_por text, p_dia date default null)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  return (select coalesce(jsonb_agg(b order by b->>'dia', b->>'inicio'), '[]'::jsonb)
            from empresas e, jsonb_array_elements(coalesce(e.config->'bloqueios_horario', '[]'::jsonb)) b
           where e.id = p_empresa_id
             and (case when p_dia is null then (b->>'dia')::date >= hoje_cuiaba() else (b->>'dia')::date = p_dia end));
end $$;

revoke all on function bloqueio_horario_choque(jsonb, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function n8n_assistente_bloquear_horario(uuid, text, date, time, time, text) from public, anon, authenticated;
revoke all on function n8n_assistente_desbloquear_horario(uuid, text, date, time) from public, anon, authenticated;
revoke all on function n8n_assistente_ver_bloqueios_horario(uuid, text, date) from public, anon, authenticated;
