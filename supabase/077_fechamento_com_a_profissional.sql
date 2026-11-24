-- 077: o fechamento (agenda_fechada) é conferido com a profissional que VAI atender (24/11/2026, junto da 076).
-- n8n_assistente_marcar_horario_prof confere o fechamento logo depois de gravar e ANTES de pôr a profissional no horário;
-- n8n_assistente_reagendar_prof confere antes de trocar a profissional. Com o bloqueio por profissional (076), isso fazia
-- o horário da Duda contar como da dona: bloqueio só da Caroline recusava a Duda, e bloqueio só da Duda deixava passar.
-- Agora agenda_fechada aceita a profissional (terceiro parâmetro) e as duas funções passam quem vai atender.
-- Só a Caroline usa essas funções (_prof); para quem não tem bloqueio por profissional nada muda.

create or replace function agenda_fechada(p_empresa_id uuid, p_agendamento_id uuid, p_profissional_id uuid)
returns text language plpgsql stable set search_path to 'public' as $$
declare ag record; v_config jsonb; v_dia date; v_bloq jsonb; v_hora jsonb; v_fim timestamptz; v_prof uuid;
begin
  select a.inicio, a.fim, a.profissional_id into ag from agendamentos a where a.id = p_agendamento_id and a.empresa_id = p_empresa_id;
  if ag.inicio is null then return null; end if;
  v_fim := coalesce(ag.fim, ag.inicio + interval '1 hour');
  v_prof := coalesce(p_profissional_id, ag.profissional_id, profissional_dona(p_empresa_id));
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

-- a de dois parâmetros passa a ser a de três, com a profissional gravada no horário (como antes da 076)
create or replace function agenda_fechada(p_empresa_id uuid, p_agendamento_id uuid)
returns text language sql stable set search_path to 'public' as $$
  select agenda_fechada(p_empresa_id, p_agendamento_id, null::uuid)
$$;

revoke all on function agenda_fechada(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function agenda_fechada(uuid, uuid, uuid) to service_role;

-- marcar e reagendar da assistente (equipe): troca só a chamada, conferindo que o trecho existe uma vez
do $$
declare d text; n int;
begin
  d := pg_get_functiondef('n8n_assistente_marcar_horario_prof(uuid,text,uuid,text,text,text,timestamptz,text,boolean,integer,integer,uuid)'::regprocedure);
  n := (length(d) - length(replace(d, 'v_motivo := agenda_fechada(p_empresa_id, v_id);', ''))) / length('v_motivo := agenda_fechada(p_empresa_id, v_id);');
  if n <> 1 then raise exception 'marcar_horario_prof mudou (% ocorrências)', n; end if;
  execute replace(d, 'v_motivo := agenda_fechada(p_empresa_id, v_id);',
                     'v_motivo := agenda_fechada(p_empresa_id, v_id, coalesce(p_profissional_id, profissional_dona(p_empresa_id)));');

  d := pg_get_functiondef('n8n_assistente_reagendar_prof(uuid,text,uuid,timestamptz,text,boolean,uuid)'::regprocedure);
  n := (length(d) - length(replace(d, 'agenda_fechada(p_empresa_id, p_agendamento_id);', ''))) / length('agenda_fechada(p_empresa_id, p_agendamento_id);');
  if n <> 2 then raise exception 'reagendar_prof mudou (% ocorrências)', n; end if;
  -- a primeira (antes) fica com a profissional atual; a segunda (depois) com a nova, se veio uma
  d := regexp_replace(d, 'v_motivo := agenda_fechada\(p_empresa_id, p_agendamento_id\);',
                      'v_motivo := agenda_fechada(p_empresa_id, p_agendamento_id, p_profissional_id);');
  execute d;
end $$;
