-- =====================================================================
-- 071 - Regras da agenda e fechamento que ninguém fura (pedido do Victor, 24/11/2026, Studio Caroline)
--
-- 1. REGRAS DA AGENDA. O que a dona manda sobre QUANDO a IA de atendimento pode marcar ("segunda nada antes das 11h",
--    "dezembro nada às 9h", "sábado primeiro a manhã") era guardado pela assistente em config.assistente_regras, a
--    lista do jeito de a PRÓPRIA assistente trabalhar. A IA de atendimento nunca leu essa lista (23/11: ofereceu à
--    Kelly "segunda dia 21 às 8h"). Agora vira regra do sistema, conferida pela agenda no código
--    (n8n/demo-agente/agenda-calculo.js):
--      config.ia_horas   = [{ "dias": ["seg"], "de": "00:00", "ate": "11:00", "de_dia": null, "ate_dia": null,
--                             "em": "24/11/2026", "fala": "..." }]
--          a IA não COMEÇA horário com início de "de" até antes de "ate" nesses dias da semana (vazio = todos)
--          e entre de_dia e ate_dia (vazio = sempre);
--      config.ia_periodo = { "sab": { "primeiro": "manha", "estrito": true, ... }, "seg": { "primeiro": "tarde" } }
--          a IA oferece primeiro esse período; estrito = o outro período só abre quando o primeiro lota.
--    A assistente grava e tira pela ferramenta regra_da_agenda (n8n_assistente_regra_agenda) e lê junto com as
--    regras dela (n8n_assistente_regras_texto_agenda).
--
-- 2. FECHAMENTO. Dia ou hora fechados no app (config.bloqueios e config.bloqueios_horario: casamento, prova,
--    gravação...) não recebem horário de jeito nenhum, nem quando a dona dita a cliente e a hora (forcar = sim).
--    19/11: a assistente marcou a Katia no dia do casamento da Caroline. Para marcar ali, primeiro tira o fechamento.
--    Vale para marcar, remarcar e mudar a duração pela assistente (as funções _prof, usadas só pela Caroline).
--
-- Só soma, fora as três funções _prof (que só a assistente da Caroline usa): chaves novas no config, funções novas.
-- Sem as chaves (Gleide e as outras lojas), nada muda.
-- =====================================================================

-- ---------- 1. regras da agenda ----------

-- "seg", "segunda", "segunda-feira" -> "seg"; null se não entendeu
create or replace function dia_semana_chave(p text)
returns text language sql immutable set search_path = public as $$
  select chave from (values ('dom', 'domingo'), ('seg', 'segunda'), ('ter', 'terca'), ('qua', 'quarta'),
                            ('qui', 'quinta'), ('sex', 'sexta'), ('sab', 'sabado')) d(chave, falado)
   where translate(lower(btrim(coalesce(p, ''))), 'áàãâéêíóôõúç', 'aaaaeeiooouc') in (chave, falado, falado || '-feira', falado || ' feira')
$$;

-- Texto das regras, uma por linha, com o código para tirar: "H1. segunda: a IA não começa horário antes das 11:00"
create or replace function ia_regras_agenda_texto(p_config jsonb)
returns text language sql immutable set search_path = public as $$
  with nomes(chave, nome, ordem) as (values ('seg', 'segunda', 1), ('ter', 'terça', 2), ('qua', 'quarta', 3),
         ('qui', 'quinta', 4), ('sex', 'sexta', 5), ('sab', 'sábado', 6), ('dom', 'domingo', 7)),
  horas as (
    select 'H' || n as cod, n as ordem,
      coalesce((select string_agg(nm.nome, ', ' order by nm.ordem) from jsonb_array_elements_text(r->'dias') d(k) join nomes nm on nm.chave = d.k), 'todos os dias')
      || case when r->>'de_dia' is not null or r->>'ate_dia' is not null
              then ' (de ' || coalesce(to_char((r->>'de_dia')::date, 'DD/MM/YYYY'), 'hoje') || ' até ' || coalesce(to_char((r->>'ate_dia')::date, 'DD/MM/YYYY'), 'sempre') || ')'
              else '' end
      || ': a IA não começa horário '
      || case when coalesce(r->>'de', '00:00') = '00:00' then 'antes das ' || (r->>'ate')
              when coalesce(r->>'ate', '24:00') = '24:00' then 'a partir das ' || (r->>'de')
              else 'das ' || (r->>'de') || ' até antes das ' || (r->>'ate') end
      || coalesce(' (desde ' || (r->>'em') || ')', '') as linha
      from jsonb_array_elements(case when jsonb_typeof(p_config->'ia_horas') = 'array' then p_config->'ia_horas' else '[]'::jsonb end) with ordinality t(r, n)),
  periodos as (
    select 'P' || row_number() over (order by nm.ordem) as cod, 100 + nm.ordem as ordem,
      nm.nome || ': a IA oferece primeiro a ' || case when r->>'primeiro' = 'manha' then 'manhã' else 'tarde' end
      || case when (r->>'estrito')::boolean then '; a ' || case when r->>'primeiro' = 'manha' then 'tarde' else 'manhã' end || ' só abre quando a '
                  || case when r->>'primeiro' = 'manha' then 'manhã' else 'tarde' end || ' lota'
              else '; a outra só se a cliente pedir ou não puder' end
      || coalesce(' (desde ' || (r->>'em') || ')', '') as linha
      from nomes nm, lateral (select case when jsonb_typeof(p_config->'ia_periodo') = 'object' then p_config->'ia_periodo'->nm.chave end as r) x
     where jsonb_typeof(r) = 'object' and r->>'primeiro' in ('manha', 'tarde'))
  select string_agg(cod || '. ' || linha, E'\n' order by ordem) from (select * from horas union all select * from periodos) t
$$;

-- As regras da assistente (config.assistente_regras) e, embaixo, as da agenda (para o prompt da assistente)
create or replace function n8n_assistente_regras_texto_agenda(p_empresa_id uuid)
returns text language sql stable set search_path = public as $$
  select n8n_assistente_regras_texto(p_empresa_id) || E'\n\nREGRAS DA AGENDA (a IA de atendimento segue; mude só com regra_da_agenda):\n'
         || coalesce((select ia_regras_agenda_texto(e.config) from empresas e where e.id = p_empresa_id), '(nenhuma: a IA marca em todo o horário de funcionamento)')
$$;

-- A dona manda uma regra de quando a IA marca.
-- p_tipo: nao_comeca (dias, de, ate, de_dia, ate_dia) | primeiro (dias, periodo, estrito) | tirar (qual: H1, P2) | ver
-- p_dias: "seg" ou "seg,ter,qua" ou vazio/"todos" (todos os dias)
create or replace function n8n_assistente_regra_agenda(p_empresa_id uuid, p_pedido_por text, p_tipo text,
    p_dias text default null, p_de text default null, p_ate text default null, p_de_dia date default null, p_ate_dia date default null,
    p_periodo text default null, p_estrito boolean default false, p_qual text default null, p_fala text default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_tipo text := translate(lower(btrim(coalesce(p_tipo, ''))), 'áàãâéêíóôõúç', 'aaaaeeiooouc');
  v_config jsonb; v_horas jsonb; v_per jsonb; v_dias text[] := '{}'; v_ruins text[]; v_x text; v_k text;
  v_de text; v_ate text; v_per_k text; v_qual text := upper(btrim(coalesce(p_qual, ''))); v_n int; v_tirou text;
  v_marcados jsonb := '[]'::jsonb; v_nova jsonb;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  select config into v_config from empresas where id = p_empresa_id for update;
  if v_config is null then raise exception 'empresa % não encontrada', p_empresa_id; end if;
  v_horas := case when jsonb_typeof(v_config->'ia_horas') = 'array' then v_config->'ia_horas' else '[]'::jsonb end;
  v_per := case when jsonb_typeof(v_config->'ia_periodo') = 'object' then v_config->'ia_periodo' else '{}'::jsonb end;

  if v_tipo = 'ver' then
    return jsonb_build_object('regras', coalesce(ia_regras_agenda_texto(v_config), 'nenhuma: a IA marca em todo o horário de funcionamento'));
  end if;

  -- dias da semana
  if v_tipo in ('nao_comeca', 'primeiro') and translate(lower(btrim(coalesce(p_dias, ''))), 'áàãâéêíóôõúç', 'aaaaeeiooouc') not in ('', 'todos', 'todos os dias') then
    foreach v_x in array string_to_array(replace(replace(p_dias, ' e ', ','), ';', ','), ',') loop
      continue when btrim(v_x) = '';
      v_k := dia_semana_chave(v_x);
      if v_k is null then v_ruins := array_append(v_ruins, btrim(v_x)); elsif not v_k = any (v_dias) then v_dias := array_append(v_dias, v_k); end if;
    end loop;
    if v_ruins is not null then raise exception 'dia da semana não entendido: %. Use seg, ter, qua, qui, sex, sab, dom', array_to_string(v_ruins, ', '); end if;
  end if;

  if v_tipo = 'nao_comeca' then
    v_de := coalesce(nullif(btrim(coalesce(p_de, '')), ''), '00:00');
    v_ate := coalesce(nullif(btrim(coalesce(p_ate, '')), ''), '24:00');
    if v_de !~ '^\d{1,2}:\d{2}$' or v_ate !~ '^\d{1,2}:\d{2}$' then raise exception 'hora não entendida (use HH:MM): de % até %', v_de, v_ate; end if;
    v_de := lpad(v_de, 5, '0'); v_ate := lpad(v_ate, 5, '0');
    if v_de >= v_ate then raise exception 'a faixa precisa ter começo antes do fim (de % até %)', v_de, v_ate; end if;
    if p_de_dia is not null and p_ate_dia is not null and p_de_dia > p_ate_dia then raise exception 'a data de começo vem depois da de fim'; end if;
    if v_de = '00:00' and v_ate = '24:00' and cardinality(v_dias) = 0 and p_de_dia is null then
      raise exception 'isso fecharia a agenda inteira para sempre: para fechar dias use bloquear_dias';
    end if;
    if jsonb_array_length(v_horas) >= 20 then raise exception 'já são 20 regras de horário: peça para tirar alguma antes'; end if;
    v_nova := jsonb_build_object('dias', to_jsonb(v_dias), 'de', v_de, 'ate', v_ate,
                                 'de_dia', p_de_dia, 'ate_dia', p_ate_dia,
                                 'em', to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY'))
              || case when nullif(btrim(coalesce(p_fala, '')), '') is null then '{}'::jsonb else jsonb_build_object('fala', left(btrim(p_fala), 300)) end;
    v_horas := v_horas || jsonb_build_array(v_nova);
    -- o que já está marcado e bate com a regra (60 dias): a assistente só conta, não mexe
    select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'quando', quando) order by inicio), '[]'::jsonb) into v_marcados
      from (select a.inicio, c.nome, to_char(a.inicio at time zone 'America/Cuiaba', 'DD/MM "às" HH24:MI') as quando
              from agendamentos a join clientes c on c.id = a.cliente_id
             where a.empresa_id = p_empresa_id and a.status = 'agendado' and a.inicio > now() and a.inicio < now() + interval '60 days'
               and (cardinality(v_dias) = 0 or (array['dom','seg','ter','qua','qui','sex','sab'])[extract(dow from a.inicio at time zone 'America/Cuiaba')::int + 1] = any (v_dias))
               and (p_de_dia is null or (a.inicio at time zone 'America/Cuiaba')::date >= p_de_dia)
               and (p_ate_dia is null or (a.inicio at time zone 'America/Cuiaba')::date <= p_ate_dia)
               and to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI') >= v_de
               and to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI') < v_ate
             order by a.inicio limit 15) m;

  elsif v_tipo = 'primeiro' then
    v_per_k := case when translate(lower(btrim(coalesce(p_periodo, ''))), 'ãâáà', 'aaaa') like 'manh%' then 'manha'
                    when lower(btrim(coalesce(p_periodo, ''))) like 'tard%' then 'tarde' end;
    if v_per_k is null then raise exception 'período não entendido: use manha ou tarde'; end if;
    if cardinality(v_dias) = 0 then v_dias := array['seg','ter','qua','qui','sex','sab','dom']; end if;
    foreach v_k in array v_dias loop
      v_per := v_per || jsonb_build_object(v_k, jsonb_build_object('primeiro', v_per_k, 'estrito', coalesce(p_estrito, false),
                 'em', to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY'))
                 || case when nullif(btrim(coalesce(p_fala, '')), '') is null then '{}'::jsonb else jsonb_build_object('fala', left(btrim(p_fala), 300)) end);
    end loop;

  elsif v_tipo = 'tirar' then
    if v_qual ~ '^H\d+$' then
      v_n := substr(v_qual, 2)::int;
      if v_n < 1 or v_n > jsonb_array_length(v_horas) then raise exception 'não achei a regra %', v_qual; end if;
      v_tirou := split_part(ia_regras_agenda_texto(jsonb_build_object('ia_horas', jsonb_build_array(v_horas->(v_n - 1)))), '. ', 2);
      v_horas := v_horas - (v_n - 1);
    elsif v_qual ~ '^P\d+$' then
      v_n := substr(v_qual, 2)::int;
      select k into v_k from (select k, row_number() over (order by array_position(array['seg','ter','qua','qui','sex','sab','dom'], k)) as n
                                from jsonb_object_keys(v_per) k where v_per->k->>'primeiro' in ('manha', 'tarde')) t where n = v_n;
      if v_k is null then raise exception 'não achei a regra %', v_qual; end if;
      v_tirou := split_part(ia_regras_agenda_texto(jsonb_build_object('ia_periodo', jsonb_build_object(v_k, v_per->v_k))), '. ', 2);
      v_per := v_per - v_k;
    else
      raise exception 'diga qual regra tirar pelo código (H1, P2...): %', coalesce(ia_regras_agenda_texto(v_config), 'não há regras');
    end if;
  else
    raise exception 'tipo "%" não entendido: use nao_comeca, primeiro, tirar ou ver', p_tipo;
  end if;

  v_config := jsonb_set(jsonb_set(v_config, '{ia_horas}', v_horas), '{ia_periodo}', v_per);
  update empresas set config = v_config where id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_regra_agenda', 'empresas', p_empresa_id,
          jsonb_build_object('tipo', v_tipo, 'dias', to_jsonb(v_dias), 'de', v_de, 'ate', v_ate, 'de_dia', p_de_dia, 'ate_dia', p_ate_dia,
                             'periodo', v_per_k, 'estrito', p_estrito, 'qual', v_qual, 'tirou', v_tirou, 'fala', p_fala), p_pedido_por);
  return jsonb_build_object('ficou', case when v_tipo = 'tirar' then 'tirei: ' || v_tirou else 'gravado' end,
    'valendo_agora', coalesce(ia_regras_agenda_texto(v_config), 'nenhuma regra: a IA marca em todo o horário de funcionamento'),
    'horarios_ja_marcados_que_batem', v_marcados);
end $$;

-- ---------- 2. fechamento que ninguém fura ----------

-- Dia ou hora fechados no app (config.bloqueios / config.bloqueios_horario) no horário de um agendamento: devolve o
-- motivo, ou null. É a mesma conta do app (crm/lib/horarios.ts) e da IA de atendimento (agenda-calculo.js).
create or replace function agenda_fechada(p_empresa_id uuid, p_agendamento_id uuid)
returns text language plpgsql stable set search_path = public as $$
declare ag record; v_config jsonb; v_dia date; v_bloq jsonb; v_hora jsonb; v_fim timestamptz;
begin
  select a.inicio, a.fim into ag from agendamentos a where a.id = p_agendamento_id and a.empresa_id = p_empresa_id;
  if ag.inicio is null then return null; end if;
  v_fim := coalesce(ag.fim, ag.inicio + interval '1 hour');
  select config into v_config from empresas where id = p_empresa_id;
  -- dias que o horário toca (um horário que passa da meia-noite toca dois)
  for v_dia in select generate_series((ag.inicio at time zone 'America/Cuiaba')::date, ((v_fim - interval '1 second') at time zone 'America/Cuiaba')::date, interval '1 day')::date loop
    select b into v_bloq from jsonb_array_elements(case when jsonb_typeof(v_config->'bloqueios') = 'array' then v_config->'bloqueios' else '[]'::jsonb end) b
     where b->>'de' is not null and v_dia between (b->>'de')::date and greatest((b->>'de')::date, coalesce(nullif(b->>'ate', '')::date, (b->>'de')::date)) limit 1;
    if v_bloq is not null then
      return to_char(v_dia, 'DD/MM') || ' está fechado no app' || coalesce(' (' || nullif(v_bloq->>'motivo', '') || ')', '') || '.';
    end if;
  end loop;
  v_hora := bloqueio_horario_choque(v_config, ag.inicio, v_fim);
  if v_hora is not null then
    return format('%s das %s às %s está fechado no app', to_char(ag.inicio at time zone 'America/Cuiaba', 'DD/MM'), v_hora->>'inicio', v_hora->>'fim')
           || coalesce(' (' || nullif(v_hora->>'motivo', '') || ')', '') || '.';
  end if;
  return null;
end $$;

-- As três funções da assistente com profissional (supabase/061 e 064; só a Caroline usa): o fechamento vale mesmo com
-- forcar = sim. O resto fica igual. O raise desfaz o que a função de dentro gravou (é tudo uma chamada só).
create or replace function n8n_assistente_marcar_horario_prof(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid, p_telefone text,
    p_nome text, p_servico text, p_inicio timestamp with time zone, p_observacoes text default null, p_forcar boolean default false,
    p_duracao_min integer default null, p_bloco_min integer default 150, p_profissional_id uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v           jsonb;
  v_id        uuid;
  v_principal uuid;
  v_motivo    text;
begin
  if p_profissional_id is not null and not exists (
    select 1 from profissionais where id = p_profissional_id and empresa_id = p_empresa_id and ativo) then
    raise exception 'profissional % não é desta loja', p_profissional_id;
  end if;
  v := n8n_assistente_marcar_horario_c(p_empresa_id, p_pedido_por, p_cliente_id, p_telefone, p_nome, p_servico,
                                       p_inicio, p_observacoes, true, p_duracao_min, p_bloco_min);
  v_id := nullif(v->>'agendamento_id', '')::uuid;
  if v_id is null then return v; end if;
  -- 071: fechamento do app não é furado nem com forcar
  v_motivo := agenda_fechada(p_empresa_id, v_id);
  if v_motivo is not null then
    raise exception 'NÃO MARQUEI: % Nesse fechamento ninguém marca, nem com forcar. Diga isso a quem pediu; se for para atender mesmo assim, primeiro tire o fechamento (desbloquear) e depois marque.', v_motivo;
  end if;
  select p.id into v_principal from profissionais p
   where p.empresa_id = p_empresa_id and p.ativo order by p.criado_em limit 1;
  update agendamentos set profissional_id = coalesce(p_profissional_id, v_principal)
   where id = v_id and empresa_id = p_empresa_id;
  if not p_forcar then
    v_motivo := assistente_conferir_horario_prof(p_empresa_id, v_id);
    if v_motivo is not null then
      raise exception 'NÃO MARQUEI: % Conte a quem pediu; se quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;
  return v;
end $$;

create or replace function n8n_assistente_reagendar_prof(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
    p_inicio timestamp with time zone, p_servico text, p_forcar boolean, p_profissional_id uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v        jsonb;
  v_motivo text;
begin
  if p_profissional_id is not null and not exists (
    select 1 from profissionais where id = p_profissional_id and empresa_id = p_empresa_id and ativo) then
    raise exception 'profissional % não é desta loja', p_profissional_id;
  end if;
  v := n8n_assistente_reagendar_confirma(p_empresa_id, p_pedido_por, p_agendamento_id, p_inicio, p_servico, true);
  -- 071: fechamento do app não é furado nem com forcar
  v_motivo := agenda_fechada(p_empresa_id, p_agendamento_id);
  if v_motivo is not null then
    raise exception 'NÃO REAGENDEI: % Nesse fechamento ninguém marca, nem com forcar. Diga isso a quem pediu; se for para atender mesmo assim, primeiro tire o fechamento (desbloquear) e depois reagende.', v_motivo;
  end if;
  if p_profissional_id is not null then
    update agendamentos set profissional_id = p_profissional_id
     where id = p_agendamento_id and empresa_id = p_empresa_id;
  end if;
  if not p_forcar then
    v_motivo := assistente_conferir_horario_prof(p_empresa_id, p_agendamento_id);
    if v_motivo is not null then
      raise exception 'NÃO REAGENDEI: % Conte a quem pediu; se quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;
  return v;
end $$;

create or replace function n8n_assistente_ajustar_duracao_prof(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
    p_minutos integer, p_forcar boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  v        jsonb;
  v_motivo text;
begin
  v := n8n_assistente_ajustar_duracao(p_empresa_id, p_pedido_por, p_agendamento_id, p_minutos, true);
  -- 071: fechamento do app não é furado nem com forcar
  v_motivo := agenda_fechada(p_empresa_id, p_agendamento_id);
  if v_motivo is not null then
    raise exception 'NÃO MUDEI: com esse tempo o horário entra num fechamento: % Nesse fechamento ninguém marca, nem com forcar. Diga isso a quem pediu.', v_motivo;
  end if;
  if not p_forcar then
    v_motivo := assistente_conferir_horario_prof(p_empresa_id, p_agendamento_id);
    if v_motivo is not null then
      raise exception 'NÃO MUDEI: % Conte a quem pediu; se quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;
  return v;
end $$;
