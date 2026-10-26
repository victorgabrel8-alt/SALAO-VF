-- =====================================================================
-- 013b_assistente_complemento.sql
-- O banco de produção tinha uma versão anterior do 013_assistente_faz_tudo: faltavam
-- n8n_assistente_atrasar_agenda e n8n_assistente_excluir_horario, e o texto de
-- assistente_conferir_horario estava antigo. Aplica só essas três (o resto do 013 já estava igual).
-- =====================================================================

create or replace function assistente_conferir_horario(p_empresa_id uuid, p_inicio timestamptz, p_duracao_min int,
                                                       p_ignorar uuid default null)
returns text language plpgsql stable set search_path = public as $$
declare
  v_config jsonb; v_dia date := (p_inicio at time zone 'America/Cuiaba')::date;
  v_bloq jsonb; v_faixa text; v_abre int; v_fecha int; v_ini int; v_fim int;
  v_alm_ini int; v_alm_fim int; v_choques text;
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

create or replace function n8n_assistente_atrasar_agenda(p_empresa_id uuid, p_pedido_por text, p_minutos int,
  p_a_partir text default null, p_data date default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_dia date := coalesce(p_data, hoje_cuiaba()); v_de timestamptz; v_ids uuid[]; v_movidos jsonb; v_avisos text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_minutos is null or p_minutos = 0 or abs(p_minutos) > 240 then raise exception 'quantos minutos? (de 5 a 240)'; end if;
  v_de := case when nullif(trim(coalesce(p_a_partir, '')), '') is not null
               then (v_dia + p_a_partir::time) at time zone 'America/Cuiaba'
               else greatest(now() - interval '1 hour', v_dia::timestamp at time zone 'America/Cuiaba') end;

  select array_agg(a.id order by a.inicio) into v_ids from agendamentos a
   where a.empresa_id = p_empresa_id and a.status = 'agendado' and a.inicio >= v_de
     and (a.inicio at time zone 'America/Cuiaba')::date = v_dia;
  if v_ids is null then raise exception 'não tem horário a atender nesse dia a partir das %', to_char(v_de at time zone 'America/Cuiaba', 'HH24:MI'); end if;

  select jsonb_agg(jsonb_build_object('agendamento_id', a.id, 'nome', c.nome, 'tel_final', right(c.telefone, 4),
           'de', to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'),
           'para', to_char((a.inicio + make_interval(mins => p_minutos)) at time zone 'America/Cuiaba', 'HH24:MI')) order by a.inicio)
    into v_movidos
    from agendamentos a join clientes c on c.id = a.cliente_id where a.id = any (v_ids);

  update agendamentos a
     set inicio = a.inicio + make_interval(mins => p_minutos),
         fim = coalesce(a.fim, a.inicio + interval '1 hour') + make_interval(mins => p_minutos),
         observacoes = concat_ws(E'\n', nullif(a.observacoes, ''),
                                 'Reagendado de ' || to_char(a.inicio at time zone 'America/Cuiaba', 'DD/MM') ||
                                 ' às ' || to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'))
   where a.id = any (v_ids);
  -- o trigger do 010 abre vaga quando um horário (a mais de 3 h) sai do lugar: aqui ninguém liberou nada
  delete from vagas where agendamento_id = any (v_ids) and criado_em = now() and motivo = 'remarcado';

  select string_agg(format('%s às %s: %s', c.nome, to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'),
                           assistente_conferir_horario(p_empresa_id, a.inicio, (extract(epoch from a.fim - a.inicio) / 60)::int, a.id)), '; ')
    into v_avisos
    from agendamentos a join clientes c on c.id = a.cliente_id
   where a.id = any (v_ids)
     and assistente_conferir_horario(p_empresa_id, a.inicio, (extract(epoch from a.fim - a.inicio) / 60)::int, a.id) !~ '^Encavala';

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  select p_empresa_id, a.cliente_id, 'assistente', 'n8n_assistente_atrasar_agenda', 'agendamentos', a.id,
         jsonb_build_object('minutos', p_minutos), p_pedido_por
    from agendamentos a where a.id = any (v_ids);

  return jsonb_build_object('movidos', v_movidos, 'atencao', v_avisos);
end $$;

create or replace function n8n_assistente_excluir_horario(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_nome text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  delete from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id returning * into ag;
  if ag.id is null then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  select nome into v_nome from clientes where id = ag.cliente_id;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, ag.cliente_id, 'assistente', 'n8n_assistente_excluir_horario', 'agendamentos', ag.id, to_jsonb(ag), p_pedido_por);
  return jsonb_build_object('excluido', v_nome || ' ' || assistente_quando(ag.inicio));
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'assistente_conferir_horario(uuid, timestamptz, int, uuid)',
    'n8n_assistente_atrasar_agenda(uuid, text, int, text, date)',
    'n8n_assistente_excluir_horario(uuid, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
