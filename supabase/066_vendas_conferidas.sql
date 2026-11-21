-- Fase 2 do portão (21/11/2026): conferência semanal de vendas com a Gleide.
-- Em 20/11 o relatório da negociação contou como "mega hair" a recolocação do cabelo da própria cliente (Renata, Dienne):
-- só a Vitoria fez mega hair novo. Agora, uma vez por semana, a assistente manda à Gleide, em linguagem natural, os
-- atendimentos realizados das clientes que chegaram pelo WhatsApp (conversaram com a IA) e o que ficou anotado
-- (cabelo novo x manutenção). O que ela confirmar ou corrigir fica aqui, e os relatórios contam só venda confirmada.
-- Só soma: tabela nova, funções novas, visão nova. A agenda (agendamentos) não muda: a correção da Gleide fica aqui.

create table if not exists vendas_conferidas (
  id              bigint generated always as identity primary key,
  empresa_id      uuid not null references empresas(id) on delete cascade,
  agendamento_id  uuid not null unique references agendamentos(id) on delete cascade,
  cliente_id      uuid references clientes(id) on delete set null,
  servico_agenda  text,                                  -- o serviço que estava na agenda quando foi perguntado/conferido
  sugerido        text,                                  -- o que a lista mostrou à Gleide: mega_novo | manutencao | outro
  tipo            text check (tipo in ('mega_novo', 'manutencao', 'outro', 'nao_fez')), -- o que ELA disse; vazio = sem resposta
  valor           numeric,                               -- valor que ela disse (vazio = não disse)
  fala            text,                                  -- o que ela respondeu
  perguntado_em   timestamptz,                           -- quando entrou na lista da semana
  conferido_em    timestamptz,                           -- quando ela confirmou ou corrigiu
  pedido_por      text,
  criado_em       timestamptz not null default now()
);
create index if not exists vendas_conferidas_empresa on vendas_conferidas (empresa_id, criado_em desc);
alter table vendas_conferidas enable row level security;   -- sem política: só o servidor (chave de serviço) lê e grava

-- o que a lista mostra para um serviço da agenda (só a Gleide usa: "aplicação de mega hair" = cabelo novo)
create or replace function venda_sugerido(p_servico text)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_servico, '') ~* 'manuten|recoloc|reposi|repor' then 'manutencao'
    when coalesce(p_servico, '') ~* 'aplica' and coalesce(p_servico, '') ~* 'mega|cabelo' then 'mega_novo'
    else 'outro' end
$$;

-- atendimento que conta como venda da IA: realizado, não é avaliação, cliente conversou com a IA no WhatsApp
-- (e, se p_clientes_desde vier, cadastrada desde essa data: cliente nova, do anúncio)
create or replace function venda_da_ia(p_agendamento_id uuid, p_clientes_desde date)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
     where a.id = p_agendamento_id and a.status = 'realizado' and coalesce(s.nome, '') !~* '^\s*avalia'
       and (p_clientes_desde is null or (c.criado_em at time zone 'America/Cuiaba')::date >= p_clientes_desde)
       and exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor = 'cliente'))
$$;

-- Lista da semana: o que ainda não entrou em nenhuma lista. Só lê; quem marca como perguntado é a função de baixo,
-- depois que a mensagem saiu (se o envio falhar, entra na próxima).
create or replace function n8n_conferencia_vendas_lista(p_empresa_id uuid, p_dias integer default 30,
  p_clientes_desde date default null, p_limite integer default 12)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(x order by x.inicio), '[]'::jsonb) from (
    select a.id as agendamento_id, c.nome, a.inicio, s.nome as servico, a.valor, venda_sugerido(s.nome) as sugerido
      from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
     where a.empresa_id = p_empresa_id
       and a.inicio >= now() - make_interval(days => greatest(1, least(p_dias, 90))) and a.inicio < now()
       and venda_da_ia(a.id, p_clientes_desde)
       and not exists (select 1 from vendas_conferidas v where v.agendamento_id = a.id)
     order by a.inicio
     limit greatest(1, least(p_limite, 30))) x
$$;

create or replace function n8n_conferencia_vendas_marcar(p_empresa_id uuid, p_ids uuid[])
returns integer language plpgsql set search_path = public as $$
declare v_n integer;
begin
  insert into vendas_conferidas (empresa_id, agendamento_id, cliente_id, servico_agenda, sugerido, perguntado_em)
  select a.empresa_id, a.id, a.cliente_id, s.nome, venda_sugerido(s.nome), now()
    from agendamentos a left join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id and a.id = any (coalesce(p_ids, '{}'))
  on conflict (agendamento_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- A Gleide respondeu: grava o que ela disse para UMA cliente (primeiro nome + dia do atendimento).
-- Acha o atendimento realizado (não avaliação) dos últimos 60 dias com esse nome; com mais de um, prefere o do dia dito e
-- o que está esperando resposta. Sem achar, ou com dúvida, devolve erro para a assistente perguntar ou registrar antes.
create or replace function n8n_assistente_conferir_venda(p_empresa_id uuid, p_pedido_por text, p_nome text,
  p_data date default null, p_tipo text default null, p_valor numeric default null, p_fala text default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_tipo text := assistente_normalizar(coalesce(p_tipo, ''));
  v_t text := split_part(trim(assistente_normalizar(coalesce(p_nome, ''))), ' ', 1);
  v_ids uuid[]; v_escolha uuid; v_ag record; v_lista text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  v_tipo := case
    when v_tipo in ('mega_novo', 'mega novo', 'mega', 'aplicacao', 'cabelo_novo', 'cabelo novo') then 'mega_novo'
    when v_tipo in ('manutencao', 'recolocacao') then 'manutencao'
    when v_tipo = 'outro' then 'outro'
    when v_tipo in ('nao_fez', 'nao fez', 'nao_veio', 'nao veio') then 'nao_fez'
    else null end;
  if v_tipo is null then
    raise exception 'tipo precisa ser mega_novo (cabelo novo), manutencao (cabelo que ela já tem), outro ou nao_fez';
  end if;
  if length(v_t) < 2 then raise exception 'qual o nome da cliente?'; end if;
  if p_valor is not null and p_valor <= 0 then p_valor := null; end if;

  -- candidatos: mesmo nome (começo da palavra ou som parecido), realizado, não avaliação, últimos 60 dias
  select array_agg(a.id order by
           ((a.inicio at time zone 'America/Cuiaba')::date = p_data) desc nulls last,
           (v.perguntado_em is not null and v.tipo is null) desc,
           a.inicio desc)
    into v_ids
    from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
    left join vendas_conferidas v on v.agendamento_id = a.id
   where a.empresa_id = p_empresa_id and a.status = 'realizado' and coalesce(s.nome, '') !~* '^\s*avalia'
     and a.inicio >= now() - interval '60 days' and a.inicio < now() + interval '1 day'
     and (p_data is null or abs((a.inicio at time zone 'America/Cuiaba')::date - p_data) <= 1)
     and exists (select 1 from unnest(regexp_split_to_array(assistente_normalizar(c.nome), '[^a-z0-9]+')) w
                  where length(w) >= 2 and (w like v_t || '%' or assistente_som(w) like assistente_som(v_t) || '%'));

  if v_ids is null then
    raise exception 'não achei atendimento realizado de %. Se ela veio e o horário está sem baixa, use concluir; se não estava na agenda, registrar_atendimento; depois conferir_venda de novo',
      p_nome || coalesce(' em ' || to_char(p_data, 'DD/MM'), ' nas últimas semanas');
  end if;

  -- mais de um: só segue sozinho se o primeiro é claramente o certo (dia dito, ou o único esperando resposta)
  if cardinality(v_ids) > 1 then
    select string_agg(c.nome || ' ' || to_char(a.inicio at time zone 'America/Cuiaba', 'DD/MM') || ' (' || coalesce(s.nome, 'sem serviço') || ')', '; ')
      into v_lista
      from unnest(v_ids) i join agendamentos a on a.id = i join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id;
    if (select count(*) from unnest(v_ids) i join agendamentos a on a.id = i
          where p_data is not null and (a.inicio at time zone 'America/Cuiaba')::date = p_data) = 1
       or (p_data is null and (select count(*) from unnest(v_ids) i join vendas_conferidas v on v.agendamento_id = i
                                where v.perguntado_em is not null and v.tipo is null) = 1) then
      v_escolha := v_ids[1];
    else
      raise exception 'achei mais de um atendimento: %. Use o dia (data AAAA-MM-DD) do que ela falou; se não der para saber, pergunte a ela qual foi, de um jeito natural', v_lista;
    end if;
  else
    v_escolha := v_ids[1];
  end if;

  select a.id, a.cliente_id, a.inicio, c.nome, s.nome as servico into v_ag
    from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id where a.id = v_escolha;

  insert into vendas_conferidas (empresa_id, agendamento_id, cliente_id, servico_agenda, sugerido, tipo, valor, fala, conferido_em, pedido_por)
  values (p_empresa_id, v_ag.id, v_ag.cliente_id, v_ag.servico, venda_sugerido(v_ag.servico), v_tipo, p_valor,
          nullif(left(trim(coalesce(p_fala, '')), 1000), ''), now(), p_pedido_por)
  on conflict (agendamento_id) do update
     set tipo = excluded.tipo, valor = coalesce(excluded.valor, vendas_conferidas.valor),
         fala = coalesce(excluded.fala, vendas_conferidas.fala), servico_agenda = excluded.servico_agenda,
         conferido_em = now(), pedido_por = excluded.pedido_por
  returning valor into p_valor;   -- valor que ficou (o que ela disse antes continua, se agora não disse)

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, v_ag.cliente_id, 'assistente', 'n8n_assistente_conferir_venda', 'vendas_conferidas', v_ag.id,
          jsonb_build_object('tipo', v_tipo, 'valor', p_valor, 'nome_dito', p_nome, 'data_dita', p_data), p_pedido_por);

  return jsonb_build_object('ok', true, 'nome', v_ag.nome, 'dia', to_char(v_ag.inicio at time zone 'America/Cuiaba', 'DD/MM'),
    'servico_na_agenda', v_ag.servico, 'tipo', v_tipo, 'valor', p_valor);
end $$;

-- Visão para os relatórios: só o que a Gleide confirmou como venda (nao_fez e sem resposta ficam de fora).
create or replace view vendas_confirmadas with (security_invoker = on) as
  select v.empresa_id, v.agendamento_id, v.cliente_id, c.nome, a.inicio, (a.inicio at time zone 'America/Cuiaba')::date as dia,
         v.tipo, coalesce(v.valor, a.valor) as valor, v.valor is not null as valor_dito_pela_dona, v.servico_agenda, v.conferido_em
    from vendas_conferidas v join agendamentos a on a.id = v.agendamento_id left join clientes c on c.id = v.cliente_id
   where v.tipo in ('mega_novo', 'manutencao', 'outro');

-- Relatório do período: o que foi confirmado e o que ainda falta conferir (para o número nunca sair de chute).
create or replace function relatorio_vendas_confirmadas(p_empresa_id uuid, p_de date, p_ate date, p_clientes_desde date default null)
returns jsonb language sql stable set search_path = public as $$
  with periodo as (
    select a.id, c.nome, a.inicio, s.nome as servico
      from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
     where a.empresa_id = p_empresa_id
       and (a.inicio at time zone 'America/Cuiaba')::date between p_de and p_ate
       and (venda_da_ia(a.id, p_clientes_desde) or exists (select 1 from vendas_conferidas v where v.agendamento_id = a.id and v.tipo is not null))
  ), itens as (
    select p.nome, to_char(p.inicio at time zone 'America/Cuiaba', 'DD/MM') as dia, p.inicio, p.servico as servico_na_agenda,
           v.tipo, case when v.tipo in ('mega_novo', 'manutencao', 'outro') then coalesce(v.valor, a.valor) end as valor,
           v.perguntado_em is not null as perguntado
      from periodo p join agendamentos a on a.id = p.id left join vendas_conferidas v on v.agendamento_id = p.id
  )
  select jsonb_build_object(
    'de', p_de, 'ate', p_ate,
    'mega_novo', (select count(*) from itens where tipo = 'mega_novo'),
    'manutencao', (select count(*) from itens where tipo = 'manutencao'),
    'outro', (select count(*) from itens where tipo = 'outro'),
    'nao_fez', (select count(*) from itens where tipo = 'nao_fez'),
    'valor_confirmado', (select coalesce(sum(valor), 0) from itens),
    'sem_valor', (select count(*) from itens where tipo in ('mega_novo', 'manutencao', 'outro') and valor is null),
    'sem_conferir', (select count(*) from itens where tipo is null),
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome', nome, 'dia', dia, 'servico_na_agenda', servico_na_agenda,
                'tipo', coalesce(tipo, case when perguntado then 'sem_resposta' else 'nao_perguntado' end), 'valor', valor) order by inicio), '[]'::jsonb) from itens))
$$;

revoke all on function venda_da_ia(uuid, date) from public, anon, authenticated;
revoke all on function n8n_conferencia_vendas_lista(uuid, integer, date, integer) from public, anon, authenticated;
revoke all on function n8n_conferencia_vendas_marcar(uuid, uuid[]) from public, anon, authenticated;
revoke all on function n8n_assistente_conferir_venda(uuid, text, text, date, text, numeric, text) from public, anon, authenticated;
revoke all on function relatorio_vendas_confirmadas(uuid, date, date, date) from public, anon, authenticated;
grant execute on function venda_da_ia(uuid, date) to service_role;
grant execute on function n8n_conferencia_vendas_lista(uuid, integer, date, integer) to service_role;
grant execute on function n8n_conferencia_vendas_marcar(uuid, uuid[]) to service_role;
grant execute on function n8n_assistente_conferir_venda(uuid, text, text, date, text, numeric, text) to service_role;
grant execute on function relatorio_vendas_confirmadas(uuid, date, date, date) to service_role;
revoke all on vendas_confirmadas from anon, authenticated;
grant select on vendas_confirmadas to service_role;
