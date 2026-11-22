-- 068: regra dos dias. O que a dona manda a IA de atendimento NÃO marcar (ou só marcar) em cada dia da semana
-- vira regra do sistema, gravada pela assistente e conferida pela agenda no código (n8n/demo-agente/agenda-calculo.js).
--
-- 22/11/2026, Gleide: "não marque mais nada no domingo" e "na segunda só avaliação online" foram ditos à assistente
-- em 15/11, 16/11 e 22/11. A assistente guardava com n8n_assistente_guardar_regra (config.assistente_regras), que é
-- a lista de regras do jeito de a própria assistente trabalhar: a IA de atendimento e a agenda nunca leram essa lista.
--
-- Só soma: quatro funções novas, uma chave nova no config e uma conferência a mais no n8n_mudar_modalidade (033),
--   empresas.config.ia_dias = { "dom": { "nao": "tudo", "em": "22/11/2026", "fala": "..." },
--                               "seg": { "so": ["avaliacao_online", "manutencao", "aplicacao"], ... },
--                               "qua": { "nao": ["avaliacao_presencial"], ... } }
-- Sem a chave (todas as outras lojas), nada muda.

-- Texto das regras, uma por linha: "domingo: a IA não marca nada (desde 22/11/2026)"
create or replace function ia_dias_texto(p_dias jsonb)
returns text language sql immutable set search_path = public as $$
  with dias(chave, nome, ordem) as (values ('dom', 'domingo', 1), ('seg', 'segunda-feira', 2), ('ter', 'terça-feira', 3),
      ('qua', 'quarta-feira', 4), ('qui', 'quinta-feira', 5), ('sex', 'sexta-feira', 6), ('sab', 'sábado', 7)),
  nomes(tipo, nome) as (values ('avaliacao_presencial', 'avaliação presencial'), ('avaliacao_online', 'avaliação online'),
      ('manutencao', 'manutenção'), ('aplicacao', 'aplicação (colocação) de mega hair'), ('visita', 'visita para escolher cabelo'),
      ('outro', 'outros serviços (química, tratamento)')),
  linhas as (
    select d.ordem, d.nome || ': ' ||
      case when r->>'nao' = 'tudo' then 'a IA não marca nada'
           when jsonb_typeof(r->'so') = 'array' then 'a IA só marca ' ||
             coalesce((select string_agg(coalesce(n.nome, t.tipo), ', ' order by t.i) from jsonb_array_elements_text(r->'so') with ordinality t(tipo, i) left join nomes n on n.tipo = t.tipo), '(nada)')
           when jsonb_typeof(r->'nao') = 'array' then 'a IA não marca ' ||
             coalesce((select string_agg(coalesce(n.nome, t.tipo), ', ' order by t.i) from jsonb_array_elements_text(r->'nao') with ordinality t(tipo, i) left join nomes n on n.tipo = t.tipo), '(nada)')
      end || coalesce(' (desde ' || (r->>'em') || ')', '') as linha
    from dias d, lateral (select case when jsonb_typeof(p_dias) = 'object' then p_dias->d.chave end as r) x
    where jsonb_typeof(r) = 'object' and (r->>'nao' = 'tudo' or jsonb_typeof(r->'so') = 'array' or jsonb_typeof(r->'nao') = 'array'))
  select string_agg(linha, E'\n' order by ordem) from linhas
$$;

-- Para o prompt da assistente
create or replace function n8n_assistente_regra_dias_texto(p_empresa_id uuid)
returns text language sql stable set search_path = public as $$
  select coalesce(ia_dias_texto(e.config->'ia_dias'), '(nenhuma regra: a IA marca em todos os dias de funcionamento)')
    from empresas e where e.id = p_empresa_id
$$;

-- p_dia: dom, seg, ter, qua, qui, sex, sab (aceita "domingo", "segunda-feira", "sábado")
-- p_regra: nada (a IA não marca nada no dia) | so (só os serviços de p_servicos) | nao (tudo menos os de p_servicos) | liberar (tira a regra)
-- p_servicos: avaliacao_presencial, avaliacao_online, manutencao, aplicacao, visita, outro (separados por vírgula)
create or replace function n8n_assistente_regra_dia(p_empresa_id uuid, p_pedido_por text, p_dia text, p_regra text,
                                                    p_servicos text default null, p_fala text default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_dia text := translate(lower(btrim(coalesce(p_dia, ''))), 'áàãâéêíóôõúç', 'aaaaeeiooouc');
  v_regra text := translate(lower(btrim(coalesce(p_regra, ''))), 'áàãâéêíóôõúç', 'aaaaeeiooouc');
  v_validos text[] := array['avaliacao_presencial', 'avaliacao_online', 'manutencao', 'aplicacao', 'visita', 'outro'];
  v_tipos text[]; v_ruins text[]; v_dias jsonb; v_nova jsonb; v_marcados jsonb := '[]'::jsonb; v_nome text; v_dow int;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  -- só o nome de UM dia ("dom", "domingo", "segunda", "segunda-feira"): "domingo e segunda" ou "quinze" são recusados
  select chave, nome, dow into v_dia, v_nome, v_dow from (values ('dom', 'domingo', 0, 'domingo'), ('seg', 'segunda-feira', 1, 'segunda'), ('ter', 'terça-feira', 2, 'terca'),
    ('qua', 'quarta-feira', 3, 'quarta'), ('qui', 'quinta-feira', 4, 'quinta'), ('sex', 'sexta-feira', 5, 'sexta'), ('sab', 'sábado', 6, 'sabado')) d(chave, nome, dow, falado)
   where v_dia in (chave, falado, falado || '-feira', falado || ' feira');
  if v_nome is null then raise exception 'dia da semana "%" não entendido: use um dia por chamada, dom, seg, ter, qua, qui, sex ou sab', p_dia; end if;
  v_regra := case when v_regra in ('nada', 'fechado', 'tudo') then 'nada' when v_regra in ('so', 'somente', 'apenas') then 'so'
                  when v_regra in ('nao', 'menos') then 'nao' when v_regra in ('liberar', 'tirar', 'normal') then 'liberar' end;
  if v_regra is null then raise exception 'regra "%" não entendida: use nada, so, nao ou liberar', p_regra; end if;

  if v_regra in ('so', 'nao') then
    select array_agg(t order by i) into v_tipos from (
      select min(i) as i, t from (select i, translate(lower(btrim(x)), 'áàãâéêíóôõúç ', 'aaaaeeiooouc_') as t
                                    from unnest(string_to_array(coalesce(p_servicos, ''), ',')) with ordinality u(x, i)) a
       where t <> '' group by t) b;
    if v_tipos is null then raise exception 'faltou dizer os serviços: %', array_to_string(v_validos, ', '); end if;
    select array_agg(t) into v_ruins from unnest(v_tipos) t where t <> all (v_validos);
    if v_ruins is not null then raise exception 'serviço não entendido: %. Use só: %', array_to_string(v_ruins, ', '), array_to_string(v_validos, ', '); end if;
  end if;

  select case when jsonb_typeof(config->'ia_dias') = 'object' then config->'ia_dias' else '{}'::jsonb end into v_dias
    from empresas where id = p_empresa_id for update;
  if v_dias is null then raise exception 'empresa % não encontrada', p_empresa_id; end if;

  if v_regra = 'liberar' then
    v_dias := v_dias - v_dia;
  else
    v_nova := case v_regra when 'nada' then jsonb_build_object('nao', 'tudo')
                           when 'so' then jsonb_build_object('so', to_jsonb(v_tipos))
                           else jsonb_build_object('nao', to_jsonb(v_tipos)) end
      || jsonb_build_object('em', to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY'))
      || case when nullif(btrim(coalesce(p_fala, '')), '') is null then '{}'::jsonb else jsonb_build_object('fala', left(btrim(p_fala), 300)) end;
    v_dias := v_dias || jsonb_build_object(v_dia, v_nova);
    -- o que já está marcado nesse dia da semana (60 dias): a assistente só conta para a dona, não mexe
    select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'quando', quando, 'servico', servico, 'agendamento_id', id) order by inicio), '[]'::jsonb)
      into v_marcados
      from (select a.id, a.inicio, c.nome, coalesce(s.nome, 'serviço não informado') as servico,
                   to_char(a.inicio at time zone 'America/Cuiaba', 'DD/MM "às" HH24:MI') as quando
              from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
             where a.empresa_id = p_empresa_id and a.status = 'agendado' and a.inicio > now() and a.inicio < now() + interval '60 days'
               and extract(dow from a.inicio at time zone 'America/Cuiaba') = v_dow
             order by a.inicio limit 15) m;
  end if;

  update empresas set config = jsonb_set(coalesce(config, '{}'::jsonb), '{ia_dias}', v_dias) where id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_regra_dia', 'empresas', p_empresa_id,
          jsonb_build_object('dia', v_dia, 'regra', v_regra, 'servicos', to_jsonb(v_tipos), 'fala', p_fala), p_pedido_por);

  return jsonb_build_object(
    'dia', v_nome,
    'ficou', case when v_regra = 'liberar' then v_nome || ': sem regra, a IA volta a marcar normalmente' else ia_dias_texto(jsonb_build_object(v_dia, v_nova)) end,
    'valendo_agora', coalesce(ia_dias_texto(v_dias), 'nenhuma regra: a IA marca em todos os dias de funcionamento'),
    'horarios_ja_marcados_nesse_dia_da_semana', v_marcados);
end $$;

-- A regra vale para um serviço neste dia? (mesma conta do nó "Calcular" da agenda)
create or replace function ia_dia_permite(p_empresa_id uuid, p_inicio timestamptz, p_tipo text)
returns boolean language sql stable set search_path = public as $$
  select coalesce((
    select case when jsonb_typeof(r) <> 'object' then true
                when r->>'nao' = 'tudo' then false
                when jsonb_typeof(r->'so') = 'array' then r->'so' ? p_tipo
                when jsonb_typeof(r->'nao') = 'array' then not (r->'nao' ? p_tipo)
                else true end
      from (select e.config->'ia_dias'->((array['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'])[extract(dow from p_inicio at time zone 'America/Cuiaba')::int + 1]) as r
              from empresas e where e.id = p_empresa_id) x), true)
$$;

-- mudar_modalidade (supabase/033) trocava a avaliação online por presencial no mesmo dia e hora, sem passar pela agenda:
-- era um jeito de marcar avaliação presencial num dia em que a dona só aceita online. Igual ao 033, mais a conferência da regra.
create or replace function n8n_mudar_modalidade(p_empresa_id uuid, p_telefone text, p_para text, p_inicio timestamptz default null, p_avisar boolean default true)
returns jsonb language plpgsql set search_path = public as $$
declare v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'); v_com9 text; v_sem9 text;
        v_para text := lower(trim(coalesce(p_para, ''))); v_online boolean; v_qtd int; ag agendamentos%rowtype;
        v_atual text; v_novo uuid; v_dur int; v_de text;
begin
  if v_para not in ('online', 'presencial') then raise exception 'diga online ou presencial'; end if;
  v_online := v_para = 'online';
  v_com9 := regexp_replace(v_tel, '^(55[0-9]{2})([6-9][0-9]{7})$', '\19\2');
  v_sem9 := regexp_replace(v_com9, '^(55[0-9]{2})9([0-9]{8})$', '\1\2');

  select count(*), (array_agg(a.id order by a.inicio))[1] into v_qtd, ag.id
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id and c.telefone in (v_com9, v_sem9)
     and a.status = 'agendado' and a.inicio > now() and s.categoria = 'avaliacao'
     and (p_inicio is null or a.inicio = p_inicio);
  if v_qtd = 0 then raise exception 'ela não tem avaliação marcada para mudar'; end if;
  if v_qtd > 1 then raise exception 'ela tem mais de uma avaliação marcada: diga qual, com data_hora_inicio'; end if;

  select * into ag from agendamentos where id = ag.id;
  select s.nome into v_atual from servicos s where s.id = ag.servico_id;
  v_de := assistente_quando(ag.inicio);
  if (v_atual ilike '%online%') = v_online then
    return jsonb_build_object('ja', true, 'quando', v_de, 'para', v_para);
  end if;
  -- regra dos dias (068): a dona não aceita esse tipo de avaliação nesse dia da semana
  if not ia_dia_permite(p_empresa_id, ag.inicio, case when v_online then 'avaliacao_online' else 'avaliacao_presencial' end) then
    raise exception 'REGRA DA GLEIDE: nesse dia da semana ela não atende avaliação %. A avaliação continua como está (%). Se a cliente quer %, ofereça outro dia com remarcar_agendamento',
      v_para, v_de, v_para;
  end if;

  select s.id, coalesce(s.duracao_min, 30) into v_novo, v_dur
    from servicos s
   where s.empresa_id = p_empresa_id and s.ativo and s.categoria = 'avaliacao' and (s.nome ilike '%online%') = v_online
   order by s.nome limit 1;
  if v_novo is null then raise exception 'o salão não tem avaliação % ativa', v_para; end if;

  update agendamentos set servico_id = v_novo, fim = inicio + make_interval(mins => v_dur) where id = ag.id;
  if p_avisar then
    insert into ia_mudancas_agenda (empresa_id, agendamento_id, cliente_id, tipo, de_texto, para_texto)
    values (p_empresa_id, ag.id, ag.cliente_id, 'mudou_modalidade', v_de, v_para);
  end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, ag.cliente_id, 'atendimento', 'n8n_mudar_modalidade', 'agendamentos', ag.id, jsonb_build_object('de', v_atual, 'para', v_para));
  return jsonb_build_object('ja', false, 'quando', v_de, 'para', v_para);
end $$;

revoke all on function ia_dia_permite(uuid, timestamptz, text) from public, anon, authenticated;
revoke all on function n8n_mudar_modalidade(uuid, text, text, timestamptz, boolean) from public, anon, authenticated;
revoke all on function ia_dias_texto(jsonb) from public, anon, authenticated;
revoke all on function n8n_assistente_regra_dias_texto(uuid) from public, anon, authenticated;
revoke all on function n8n_assistente_regra_dia(uuid, text, text, text, text, text) from public, anon, authenticated;
