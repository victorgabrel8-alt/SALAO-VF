-- 076: bloqueio de uma profissional só (24/11/2026, Caroline). Pedido do Victor: quando a Caroline bloqueia um dia ou umas
-- horas por motivo pessoal (prova, gravação, fazer a própria unha), a assistente pergunta se a agenda da Duda continua e
-- mostra as clientes marcadas no dia. Se a Duda continua, o bloqueio é só da Caroline.
-- Antes: todo bloqueio (config.bloqueios e config.bloqueios_horario) fechava o studio para as duas.
-- Agora cada bloqueio pode ter "profissional_id" (e "profissional", o nome, para ler). Sem ele, continua fechando todas:
-- nada muda nos bloqueios que já existem nem na Gleide (que não tem profissionais).
--   - bloqueio_horario_choque(config, ini, fim, profissional): só os bloqueios do studio ou dessa profissional;
--   - agenda_fechada: confere o dia e a hora com a profissional do horário (sem profissional = a dona, a primeira do
--     cadastro). Usada por marcar/remarcar/ajustar da assistente (072);
--   - n8n_assistente_bloquear_dias_v2 / n8n_assistente_bloquear_horario_v2: gravam com a profissional e devolvem as
--     clientes do período com "com" (quem atende) e "fica_fechado" (se o horário dela caiu na agenda fechada).

create or replace function bloqueio_horario_choque(p_config jsonb, p_inicio timestamptz, p_fim timestamptz, p_profissional_id uuid)
returns jsonb language sql stable set search_path to 'public' as $$
  select b from jsonb_array_elements(case when jsonb_typeof(p_config->'bloqueios_horario') = 'array' then p_config->'bloqueios_horario' else '[]'::jsonb end) b
   where (nullif(b->>'profissional_id', '') is null or (b->>'profissional_id')::uuid = p_profissional_id)
     and (((b->>'dia')::date + (b->>'inicio')::time) at time zone 'America/Cuiaba') < p_fim
     and (((b->>'dia')::date + (b->>'fim')::time) at time zone 'America/Cuiaba') > p_inicio
   order by b->>'dia', b->>'inicio'
   limit 1
$$;

-- a dona: a primeira profissional ativa do cadastro (a mesma regra do app e da agenda da IA)
create or replace function profissional_dona(p_empresa_id uuid)
returns uuid language sql stable set search_path to 'public' as $$
  select id from profissionais where empresa_id = p_empresa_id and ativo order by criado_em limit 1
$$;

create or replace function agenda_fechada(p_empresa_id uuid, p_agendamento_id uuid)
returns text language plpgsql stable set search_path to 'public' as $$
declare ag record; v_config jsonb; v_dia date; v_bloq jsonb; v_hora jsonb; v_fim timestamptz; v_prof uuid;
begin
  select a.inicio, a.fim, a.profissional_id into ag from agendamentos a where a.id = p_agendamento_id and a.empresa_id = p_empresa_id;
  if ag.inicio is null then return null; end if;
  v_fim := coalesce(ag.fim, ag.inicio + interval '1 hour');
  v_prof := coalesce(ag.profissional_id, profissional_dona(p_empresa_id));
  select config into v_config from empresas where id = p_empresa_id;
  for v_dia in select generate_series((ag.inicio at time zone 'America/Cuiaba')::date, ((v_fim - interval '1 second') at time zone 'America/Cuiaba')::date, interval '1 day')::date loop
    select b into v_bloq from jsonb_array_elements(case when jsonb_typeof(v_config->'bloqueios') = 'array' then v_config->'bloqueios' else '[]'::jsonb end) b
     where b->>'de' is not null and v_dia between (b->>'de')::date and greatest((b->>'de')::date, coalesce(nullif(b->>'ate', '')::date, (b->>'de')::date))
       and (nullif(b->>'profissional_id', '') is null or (b->>'profissional_id')::uuid = v_prof)
     limit 1;
    if v_bloq is not null then
      return to_char(v_dia, 'DD/MM') || ' está fechado no app' || coalesce(' para a ' || nullif(v_bloq->>'profissional', ''), '')
             || coalesce(' (' || nullif(v_bloq->>'motivo', '') || ')', '') || '.';
    end if;
  end loop;
  v_hora := bloqueio_horario_choque(v_config, ag.inicio, v_fim, v_prof);
  if v_hora is not null then
    return format('%s das %s às %s está fechado no app', to_char(ag.inicio at time zone 'America/Cuiaba', 'DD/MM'), v_hora->>'inicio', v_hora->>'fim')
           || coalesce(' para a ' || nullif(v_hora->>'profissional', ''), '')
           || coalesce(' (' || nullif(v_hora->>'motivo', '') || ')', '') || '.';
  end if;
  return null;
end $$;

-- as clientes marcadas num período, com quem atende e se o horário dela fica na agenda fechada
create or replace function bloqueio_clientes_do_periodo(p_empresa_id uuid, p_ini timestamptz, p_fim timestamptz, p_profissional_id uuid)
returns jsonb language sql stable set search_path to 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'agendamento_id', a.id, 'nome', c.nome, 'quando', assistente_quando(a.inicio),
           'com', coalesce(p.nome, d.nome),
           'fica_fechado', p_profissional_id is null or coalesce(a.profissional_id, profissional_dona(p_empresa_id)) = p_profissional_id)
         order by a.inicio), '[]'::jsonb)
    from agendamentos a join clientes c on c.id = a.cliente_id
    left join profissionais p on p.id = a.profissional_id
    left join profissionais d on d.id = profissional_dona(p_empresa_id)
   where a.empresa_id = p_empresa_id and a.status = 'agendado'
     and a.inicio < p_fim and coalesce(a.fim, a.inicio + interval '1 hour') > p_ini
$$;

create or replace function n8n_assistente_bloquear_dias_v2(p_empresa_id uuid, p_pedido_por text, p_de date, p_ate date default null,
  p_motivo text default null, p_profissional_id uuid default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_ate date := greatest(p_de, coalesce(p_ate, p_de)); v_nome text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_de is null then raise exception 'qual dia?'; end if;
  if p_profissional_id is not null then
    select nome into v_nome from profissionais where id = p_profissional_id and empresa_id = p_empresa_id;
    if v_nome is null then raise exception 'profissional % não é desta loja', p_profissional_id; end if;
  end if;
  update empresas
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{bloqueios}',
                            coalesce(config->'bloqueios', '[]'::jsonb) ||
                            jsonb_strip_nulls(jsonb_build_array(jsonb_build_object('de', p_de, 'ate', v_ate, 'motivo', nullif(trim(coalesce(p_motivo, '')), ''),
                                                                                   'profissional_id', p_profissional_id, 'profissional', v_nome))))
   where id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_bloquear_dias_v2', 'empresas', p_empresa_id,
          jsonb_build_object('de', p_de, 'ate', v_ate, 'motivo', p_motivo, 'profissional', coalesce(v_nome, 'todas')), p_pedido_por);
  return jsonb_build_object('bloqueado', case when v_ate = p_de then assistente_dia_longo(p_de)
                                              else 'de ' || assistente_dia_longo(p_de) || ' a ' || assistente_dia_longo(v_ate) end,
                            'para', coalesce('só a ' || v_nome, 'o studio todo (todas as profissionais)'),
                            'horarios_marcados_nesses_dias', bloqueio_clientes_do_periodo(p_empresa_id, p_de::timestamp at time zone 'America/Cuiaba',
                                                                                          (v_ate + 1)::timestamp at time zone 'America/Cuiaba', p_profissional_id));
end $$;

create or replace function n8n_assistente_bloquear_horario_v2(p_empresa_id uuid, p_pedido_por text, p_dia date, p_inicio time, p_fim time,
  p_motivo text default null, p_profissional_id uuid default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_ini timestamptz; v_fim timestamptz; v_motivo text := nullif(trim(coalesce(p_motivo, '')), ''); v_nome text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if p_dia is null then raise exception 'qual dia?'; end if;
  if p_inicio is null or p_fim is null then raise exception 'de que horas a que horas?'; end if;
  if p_fim <= p_inicio then raise exception 'a hora final precisa ser depois da inicial'; end if;
  if p_dia < hoje_cuiaba() then raise exception 'esse dia já passou'; end if;
  if p_profissional_id is not null then
    select nome into v_nome from profissionais where id = p_profissional_id and empresa_id = p_empresa_id;
    if v_nome is null then raise exception 'profissional % não é desta loja', p_profissional_id; end if;
  end if;
  v_ini := (p_dia + p_inicio) at time zone 'America/Cuiaba';
  v_fim := (p_dia + p_fim) at time zone 'America/Cuiaba';
  update empresas
     set config = jsonb_set(coalesce(config, '{}'::jsonb), '{bloqueios_horario}',
                            coalesce((select jsonb_agg(b) from jsonb_array_elements(case when jsonb_typeof(config->'bloqueios_horario') = 'array' then config->'bloqueios_horario' else '[]'::jsonb end) b
                                       where (b->>'dia')::date >= hoje_cuiaba()
                                         and not ((b->>'dia')::date = p_dia and (b->>'inicio')::time = p_inicio and (b->>'fim')::time = p_fim
                                                  and nullif(b->>'profissional_id', '') is not distinct from p_profissional_id::text)), '[]'::jsonb) ||
                            jsonb_strip_nulls(jsonb_build_array(jsonb_build_object('dia', p_dia, 'inicio', to_char(p_inicio, 'HH24:MI'),
                                                                 'fim', to_char(p_fim, 'HH24:MI'), 'motivo', v_motivo,
                                                                 'profissional_id', p_profissional_id, 'profissional', v_nome))))
   where id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_bloquear_horario_v2', 'empresas', p_empresa_id,
          jsonb_build_object('dia', p_dia, 'inicio', p_inicio, 'fim', p_fim, 'motivo', v_motivo, 'profissional', coalesce(v_nome, 'todas')), p_pedido_por);
  return jsonb_build_object('bloqueado', assistente_dia_longo(p_dia) || ', das ' || to_char(p_inicio, 'HH24:MI') || ' às ' || to_char(p_fim, 'HH24:MI'),
                            'para', coalesce('só a ' || v_nome, 'o studio todo (todas as profissionais)'),
                            'horarios_marcados_nesse_periodo', bloqueio_clientes_do_periodo(p_empresa_id, v_ini, v_fim, p_profissional_id));
end $$;

revoke all on function bloqueio_horario_choque(jsonb, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function profissional_dona(uuid) from public, anon, authenticated;
revoke all on function bloqueio_clientes_do_periodo(uuid, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function n8n_assistente_bloquear_dias_v2(uuid, text, date, date, text, uuid) from public, anon, authenticated;
revoke all on function n8n_assistente_bloquear_horario_v2(uuid, text, date, time, time, text, uuid) from public, anon, authenticated;
grant execute on function bloqueio_horario_choque(jsonb, timestamptz, timestamptz, uuid) to service_role;
grant execute on function profissional_dona(uuid) to service_role;
grant execute on function bloqueio_clientes_do_periodo(uuid, timestamptz, timestamptz, uuid) to service_role;
grant execute on function n8n_assistente_bloquear_dias_v2(uuid, text, date, date, text, uuid) to service_role;
grant execute on function n8n_assistente_bloquear_horario_v2(uuid, text, date, time, time, text, uuid) to service_role;
