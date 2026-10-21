-- =====================================================================
-- 004_avaliacoes_ia_RASCUNHO.sql — RASCUNHO, AINDA NÃO RODAR
-- Para o guardião revisar. Plano completo em docs/PLANO-IA-ALIMENTA-CRM.md.
-- Depois de aprovado: renomear para 004_avaliacoes_ia.sql, rodar no
-- SQL Editor, fazer commit e atualizar o CONTRATO.md (seções 3 e 5).
--
-- O que cria:
--   1) avaliacoes          — pré-avaliação (IA) + resultado (Gleide), 1 linha por oportunidade
--   2) registros_ia        — log de tudo que as IAs alteram (para conferir e desfazer)
--   3) clientes.resumo_ia  — resumo das conversas que a Gleide teve direto no WhatsApp
--   4) views funil_clientes e pendencias_gleide
--   5) funções n8n_* para o agente de atendimento e para a assistente da Gleide
--   6) servicos.categoria e servicos.regra_ia (base de informação que a IA lê)
--   7) crm_confirmar_atendimento — o ✓ da agenda ("Foi isso" / "Mudou algo" / resultado da avaliação)
--
-- Números que podem falar com a assistente ficam em
--   empresas.config.assistente_numeros = ["5566999990000", ...]
-- e as funções da assistente conferem isso no banco (além do filtro no n8n).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Avaliações
--    Ciclo: a IA preenche a parte "pre_" durante a conversa → a cliente marca
--    a avaliação (agendamento_id) → a Gleide conta o resultado à assistente.
--    resultado: pendente (ainda não avaliada) | fechou | pensando | nao_fechou
--    "Aberta" = pendente ou pensando. Só pode haver uma aberta por cliente.
-- ---------------------------------------------------------------------
create table avaliacoes (
  id                        uuid primary key default gen_random_uuid(),
  empresa_id                uuid not null references empresas(id) on delete cascade,
  cliente_id                uuid not null references clientes(id) on delete cascade,
  agendamento_id            uuid references agendamentos(id) on delete set null,  -- a avaliação marcada

  -- Pré-avaliação (agente de atendimento, pela conversa)
  pre_comprimento_atual     text,      -- texto livre: "ombro", "30 cm", "joãozinho"
  pre_comprimento_desejado  text,
  pre_cor                   text,
  pre_usa_mega              boolean,
  pre_tecnica_atual         text,
  pre_quimica_recente       text,      -- "progressiva há 2 meses", "luzes"
  pre_tecnica_interesse     text,      -- "queratina", "fita", "não sabe"
  pre_orcamento             text,      -- como ela falou: "até 2 mil"
  pre_ocasiao               text,      -- "casamento", "formatura"
  pre_data_ocasiao          date,
  pre_fotos                 text,      -- descrição das fotos que ela mandou
  pre_resumo                text,      -- 1–2 frases para a Gleide bater o olho

  -- Resultado (Gleide, pela assistente)
  resultado                 text not null default 'pendente'
                            check (resultado in ('pendente', 'fechou', 'pensando', 'nao_fechou')),
  tecnica_indicada          text,
  tipo_cabelo               text,      -- "brasileiro", "vietnamita"
  comprimento_cm            integer check (comprimento_cm > 0),
  gramas                    integer check (gramas > 0),
  valor_orcado              numeric(10,2),
  motivo_nao_fechou         text,
  proximo_passo             text,      -- "chamar sexta", "esperar o salário"
  data_proximo_passo        date,      -- usada no follow-up de quem ficou "pensando"
  agendamento_servico_id    uuid references agendamentos(id) on delete set null,  -- aplicação marcada ao fechar
  observacoes_gleide        text,

  resultado_em              timestamptz,  -- quando a Gleide informou o resultado
  criado_em                 timestamptz not null default now(),
  atualizado_em             timestamptz not null default now()
);
create index idx_aval_cliente on avaliacoes (cliente_id, criado_em desc);
create index idx_aval_empresa on avaliacoes (empresa_id, resultado);
create unique index uq_aval_aberta on avaliacoes (cliente_id)
  where resultado in ('pendente', 'pensando');
create trigger trg_aval_atualizado before update on avaliacoes
  for each row execute function set_atualizado_em();

-- ---------------------------------------------------------------------
-- 2) Log das IAs
-- ---------------------------------------------------------------------
create table registros_ia (
  id           uuid primary key default gen_random_uuid(),
  empresa_id   uuid not null references empresas(id) on delete cascade,
  cliente_id   uuid references clientes(id) on delete set null,
  agente       text not null check (agente in ('atendimento', 'assistente', 'resumo')),
  acao         text not null,          -- nome da função que gravou
  tabela       text not null,
  registro_id  uuid,
  dados        jsonb not null default '{}'::jsonb,  -- o que foi gravado
  pedido_por   text,                   -- telefone de quem pediu (assistente)
  criado_em    timestamptz not null default now()
);
create index idx_reg_ia_empresa on registros_ia (empresa_id, criado_em desc);
create index idx_reg_ia_cliente on registros_ia (cliente_id, criado_em desc);

-- ---------------------------------------------------------------------
-- 3) Resumo das conversas que a Gleide teve direto (Camada 3)
-- ---------------------------------------------------------------------
alter table clientes add column resumo_ia    text;
alter table clientes add column resumo_ia_em timestamptz;

-- ---------------------------------------------------------------------
-- 3b) Base de informação dos serviços
--   categoria -> o CRM sabe quando mostrar "Fechou · Pensando · Não fechou" (avaliacao)
--                e a IA sabe o que é manutenção, química etc.
--   regra_ia  -> regra que a IA segue ao agendar (ex.: "se tem mega hair, marcar avaliação antes")
--   dias_retorno (já existia) -> tempo até o retorno de CADA serviço
-- ---------------------------------------------------------------------
alter table servicos add column categoria text not null default 'outro'
  check (categoria in ('avaliacao', 'aplicacao', 'manutencao', 'quimica', 'tratamento', 'venda', 'outro'));
alter table servicos add column regra_ia text;

-- ---------------------------------------------------------------------
-- 4) Views
-- ---------------------------------------------------------------------

-- Etapa do funil, calculada (nada para manter sincronizado):
--   novo               -> só conversou, sem avaliação
--   interessada        -> tem pré-avaliação, ainda não marcou
--   avaliacao_marcada  -> avaliação futura na agenda
--   aguardando_gleide  -> a avaliação já passou e a Gleide ainda não contou o resultado
--   pensando / fechou / nao_fechou -> resultado da última avaliação
create view funil_clientes with (security_invoker = true) as
select
  c.id as cliente_id, c.empresa_id, c.nome, c.telefone,
  a.id as avaliacao_id, a.resultado, a.pre_resumo, a.pre_tecnica_interesse,
  a.valor_orcado, a.data_proximo_passo, ag.inicio as avaliacao_inicio,
  case
    when a.id is null                                         then 'novo'
    when a.resultado <> 'pendente'                            then a.resultado
    when ag.id is null or ag.status = 'cancelado'             then 'interessada'
    when ag.status = 'faltou'                                 then 'interessada'
    when coalesce(ag.fim, ag.inicio) > now()                  then 'avaliacao_marcada'
    else                                                           'aguardando_gleide'
  end as etapa
from clientes c
left join lateral (
  select * from avaliacoes av where av.cliente_id = c.id
  order by av.criado_em desc limit 1
) a on true
left join agendamentos ag on ag.id = a.agendamento_id;

-- O que a assistente precisa perguntar à Gleide (gatilho e resumo das 19h):
--   avaliacao_sem_resultado -> avaliação terminou há 30+ min e não tem resultado
--   atendimento_sem_status  -> horário de hoje já passou e continua 'agendado'
--   pensando_vencido        -> cliente "pensando" com data de próximo passo vencida
-- pendencia_id = id usado para marcar "já perguntei" (n8n_assistente_marcar_perguntado);
-- perguntado_em = última vez que a assistente perguntou sobre ela (vem do log).
create view pendencias_gleide with (security_invoker = true) as
select p.*,
       (select max(r.criado_em) from registros_ia r
         where r.acao = 'perguntou' and r.registro_id = p.pendencia_id) as perguntado_em
from (
  select 'avaliacao_sem_resultado' as tipo, av.id as pendencia_id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id as avaliacao_id, ag.id as agendamento_id, ag.inicio,
         s.nome as servico, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join agendamentos ag on ag.id = av.agendamento_id
    join clientes c on c.id = av.cliente_id
    left join servicos s on s.id = ag.servico_id
   where av.resultado = 'pendente'
     and ag.status in ('agendado', 'realizado')
     and coalesce(ag.fim, ag.inicio) < now() - interval '30 minutes'
  union all
  select 'atendimento_sem_status', ag.id, ag.empresa_id, ag.cliente_id,
         c.nome, c.telefone, null, ag.id, ag.inicio,
         s.nome, null, null
    from agendamentos ag
    join clientes c on c.id = ag.cliente_id
    left join servicos s on s.id = ag.servico_id
   where ag.status = 'agendado'
     and coalesce(ag.fim, ag.inicio) < now()
     and (ag.inicio at time zone 'America/Cuiaba')::date = hoje_cuiaba()
     -- avaliação já entra no primeiro bloco (e vira 'realizado' quando a Gleide conta o resultado)
     and not exists (select 1 from avaliacoes av where av.agendamento_id = ag.id)
  union all
  select 'pensando_vencido', av.id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id, null, null,
         av.tecnica_indicada, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join clientes c on c.id = av.cliente_id
   where av.resultado = 'pensando'
     and av.data_proximo_passo <= hoje_cuiaba()
) p;

-- ---------------------------------------------------------------------
-- 5) Funções para o n8n (só service_role)
-- ---------------------------------------------------------------------

-- O telefone pode usar a assistente?
create or replace function assistente_autorizado(p_empresa_id uuid, p_telefone text)
returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1 from empresas e
     where e.id = p_empresa_id
       and coalesce(e.config->'assistente_numeros', '[]'::jsonb) ? p_telefone
  )
$$;

-- AGENTE DE ATENDIMENTO: grava a pré-avaliação da cliente com quem está falando.
-- Só aceita os campos pre_* (chaves sem o prefixo: {"cor": "...", "orcamento": "..."}).
-- Campo ausente ou vazio NÃO apaga o que já estava salvo.
-- Cria a avaliação aberta se ainda não existir.
create or replace function n8n_salvar_pre_avaliacao(
  p_empresa_id uuid,
  p_telefone   text,
  p_dados      jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_cliente_id uuid;
  v_id         uuid;
  d            jsonb := coalesce(p_dados, '{}'::jsonb);
begin
  select id into v_cliente_id from clientes
   where empresa_id = p_empresa_id and telefone = p_telefone;
  if v_cliente_id is null then
    raise exception 'cliente % não encontrada', p_telefone;
  end if;

  select id into v_id from avaliacoes
   where cliente_id = v_cliente_id and resultado in ('pendente', 'pensando');
  if v_id is null then
    insert into avaliacoes (empresa_id, cliente_id) values (p_empresa_id, v_cliente_id)
    returning id into v_id;
  end if;

  update avaliacoes set
    pre_comprimento_atual    = coalesce(nullif(d->>'comprimento_atual', ''),    pre_comprimento_atual),
    pre_comprimento_desejado = coalesce(nullif(d->>'comprimento_desejado', ''), pre_comprimento_desejado),
    pre_cor                  = coalesce(nullif(d->>'cor', ''),                  pre_cor),
    pre_usa_mega             = coalesce((nullif(d->>'usa_mega', ''))::boolean,  pre_usa_mega),
    pre_tecnica_atual        = coalesce(nullif(d->>'tecnica_atual', ''),        pre_tecnica_atual),
    pre_quimica_recente      = coalesce(nullif(d->>'quimica_recente', ''),      pre_quimica_recente),
    pre_tecnica_interesse    = coalesce(nullif(d->>'tecnica_interesse', ''),    pre_tecnica_interesse),
    pre_orcamento            = coalesce(nullif(d->>'orcamento', ''),            pre_orcamento),
    pre_ocasiao              = coalesce(nullif(d->>'ocasiao', ''),              pre_ocasiao),
    pre_data_ocasiao         = coalesce((nullif(d->>'data_ocasiao', ''))::date, pre_data_ocasiao),
    pre_fotos                = coalesce(nullif(d->>'fotos', ''),                pre_fotos),
    pre_resumo               = coalesce(nullif(d->>'resumo', ''),               pre_resumo)
  where id = v_id;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, v_cliente_id, 'atendimento', 'n8n_salvar_pre_avaliacao', 'avaliacoes', v_id, d);

  return jsonb_build_object('avaliacao_id', v_id, 'cliente_id', v_cliente_id);
end $$;

-- AGENTE DE ATENDIMENTO: depois de criar_agendamento de uma "Avaliação",
-- liga o agendamento à avaliação aberta da cliente (cria se não houver).
create or replace function n8n_vincular_avaliacao(
  p_empresa_id     uuid,
  p_agendamento_id uuid
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_cliente_id uuid;
  v_id         uuid;
begin
  select cliente_id into v_cliente_id from agendamentos
   where id = p_agendamento_id and empresa_id = p_empresa_id;
  if v_cliente_id is null then
    raise exception 'agendamento % não encontrado', p_agendamento_id;
  end if;

  select id into v_id from avaliacoes
   where cliente_id = v_cliente_id and resultado in ('pendente', 'pensando');
  if v_id is null then
    insert into avaliacoes (empresa_id, cliente_id, agendamento_id)
    values (p_empresa_id, v_cliente_id, p_agendamento_id)
    returning id into v_id;
  else
    update avaliacoes set agendamento_id = p_agendamento_id where id = v_id;
  end if;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, v_cliente_id, 'atendimento', 'n8n_vincular_avaliacao', 'avaliacoes', v_id,
          jsonb_build_object('agendamento_id', p_agendamento_id));

  return jsonb_build_object('avaliacao_id', v_id);
end $$;

-- ASSISTENTE DA GLEIDE: grava o resultado da avaliação (só depois que a Gleide confirmou).
-- p_dados: {"resultado","tecnica_indicada","tipo_cabelo","comprimento_cm","gramas",
--           "valor_orcado","motivo_nao_fechou","proximo_passo","data_proximo_passo",
--           "agendamento_servico_id","observacoes"}
-- Também marca a avaliação na agenda como 'realizado' se ainda estava 'agendado'.
create or replace function n8n_assistente_resultado_avaliacao(
  p_empresa_id uuid,
  p_pedido_por text,
  p_cliente_id uuid,
  p_dados      jsonb
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_id     uuid;
  v_agend  uuid;
  d        jsonb := coalesce(p_dados, '{}'::jsonb);
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then
    raise exception 'número % não autorizado', p_pedido_por;
  end if;
  if coalesce(d->>'resultado', '') not in ('fechou', 'pensando', 'nao_fechou') then
    raise exception 'resultado deve ser fechou, pensando ou nao_fechou';
  end if;
  if not exists (select 1 from clientes where id = p_cliente_id and empresa_id = p_empresa_id) then
    raise exception 'cliente % não encontrada', p_cliente_id;
  end if;

  select id, agendamento_id into v_id, v_agend from avaliacoes
   where cliente_id = p_cliente_id and empresa_id = p_empresa_id
     and resultado in ('pendente', 'pensando');
  if v_id is null then
    -- avaliação que não passou pela IA (cliente marcou direto com a Gleide)
    insert into avaliacoes (empresa_id, cliente_id) values (p_empresa_id, p_cliente_id)
    returning id into v_id;
  end if;

  update avaliacoes set
    resultado              = d->>'resultado',
    tecnica_indicada       = coalesce(nullif(d->>'tecnica_indicada', ''),  tecnica_indicada),
    tipo_cabelo            = coalesce(nullif(d->>'tipo_cabelo', ''),       tipo_cabelo),
    comprimento_cm         = coalesce((nullif(d->>'comprimento_cm', ''))::int, comprimento_cm),
    gramas                 = coalesce((nullif(d->>'gramas', ''))::int,     gramas),
    valor_orcado           = coalesce((nullif(d->>'valor_orcado', ''))::numeric, valor_orcado),
    motivo_nao_fechou      = coalesce(nullif(d->>'motivo_nao_fechou', ''), motivo_nao_fechou),
    proximo_passo          = coalesce(nullif(d->>'proximo_passo', ''),     proximo_passo),
    data_proximo_passo     = coalesce((nullif(d->>'data_proximo_passo', ''))::date, data_proximo_passo),
    agendamento_servico_id = coalesce((nullif(d->>'agendamento_servico_id', ''))::uuid, agendamento_servico_id),
    observacoes_gleide     = coalesce(nullif(d->>'observacoes', ''),       observacoes_gleide),
    resultado_em           = now()
  where id = v_id;

  if v_agend is not null then
    update agendamentos set status = 'realizado'
     where id = v_agend and status = 'agendado';
  end if;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, p_cliente_id, 'assistente', 'n8n_assistente_resultado_avaliacao',
          'avaliacoes', v_id, d, p_pedido_por);

  return jsonb_build_object('avaliacao_id', v_id);
end $$;

-- ASSISTENTE DA GLEIDE: marca realizado / faltou / cancelado.
create or replace function n8n_assistente_status_agendamento(
  p_empresa_id     uuid,
  p_pedido_por     text,
  p_agendamento_id uuid,
  p_status         text,
  p_valor          numeric default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_cliente_id uuid;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then
    raise exception 'número % não autorizado', p_pedido_por;
  end if;
  if p_status not in ('realizado', 'faltou', 'cancelado') then
    raise exception 'status deve ser realizado, faltou ou cancelado';
  end if;

  update agendamentos
     set status = p_status, valor = coalesce(p_valor, valor)
   where id = p_agendamento_id and empresa_id = p_empresa_id
  returning cliente_id into v_cliente_id;
  if v_cliente_id is null then
    raise exception 'agendamento % não encontrado', p_agendamento_id;
  end if;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, v_cliente_id, 'assistente', 'n8n_assistente_status_agendamento', 'agendamentos',
          p_agendamento_id, jsonb_build_object('status', p_status, 'valor', p_valor), p_pedido_por);

  return jsonb_build_object('agendamento_id', p_agendamento_id, 'status', p_status);
end $$;

-- ASSISTENTE DA GLEIDE: "atendi a Carla agora, fiz manutenção" (cliente que veio sem agendar).
-- Cria a cliente se não existir. Grava agendamento 'realizado', origem 'manual'.
create or replace function n8n_assistente_registrar_atendimento(
  p_empresa_id      uuid,
  p_pedido_por      text,
  p_telefone        text,
  p_nome            text,
  p_servico_id      uuid,
  p_inicio          timestamptz default now(),
  p_valor           numeric default null,
  p_observacoes     text default null,
  p_profissional_id uuid default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_cliente_id uuid;
  v_agend_id   uuid;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then
    raise exception 'número % não autorizado', p_pedido_por;
  end if;

  insert into clientes (empresa_id, telefone, nome)
  values (p_empresa_id, p_telefone, nullif(p_nome, ''))
  on conflict (empresa_id, telefone)
    do update set nome = coalesce(clientes.nome, excluded.nome)
  returning id into v_cliente_id;

  insert into agendamentos (empresa_id, cliente_id, servico_id, profissional_id, inicio,
                            status, origem, valor, observacoes)
  values (p_empresa_id, v_cliente_id, p_servico_id, p_profissional_id, coalesce(p_inicio, now()),
          'realizado', 'manual', p_valor, p_observacoes)
  returning id into v_agend_id;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, v_cliente_id, 'assistente', 'n8n_assistente_registrar_atendimento', 'agendamentos',
          v_agend_id, jsonb_build_object('servico_id', p_servico_id, 'inicio', p_inicio, 'valor', p_valor,
                                         'observacoes', p_observacoes), p_pedido_por);

  return jsonb_build_object('cliente_id', v_cliente_id, 'agendamento_id', v_agend_id);
end $$;

-- ASSISTENTE DA GLEIDE: acrescenta uma anotação às observações da cliente (não apaga as antigas).
create or replace function n8n_assistente_anotar_cliente(
  p_empresa_id uuid,
  p_pedido_por text,
  p_cliente_id uuid,
  p_texto      text
) returns jsonb
language plpgsql set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then
    raise exception 'número % não autorizado', p_pedido_por;
  end if;

  update clientes
     set observacoes = concat_ws(E'\n', nullif(observacoes, ''),
                                 to_char(now() at time zone 'America/Cuiaba', 'DD/MM') || ': ' || p_texto)
   where id = p_cliente_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'cliente % não encontrada', p_cliente_id;
  end if;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, p_cliente_id, 'assistente', 'n8n_assistente_anotar_cliente', 'clientes',
          p_cliente_id, jsonb_build_object('texto', p_texto), p_pedido_por);

  return jsonb_build_object('cliente_id', p_cliente_id);
end $$;

-- ASSISTENTE: registra no log que perguntou sobre estas pendências (pendencia_id da view),
-- para não perguntar de novo tão cedo. Vale para avaliação e para atendimento.
create or replace function n8n_assistente_marcar_perguntado(
  p_empresa_id uuid,
  p_pedido_a   text,       -- para quem a assistente perguntou
  p_ids        uuid[]
) returns void
language sql set search_path = public as $$
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, pedido_por)
  select p.empresa_id, p.cliente_id, 'assistente', 'perguntou', 'pendencias_gleide', p.pendencia_id, p_pedido_a
    from pendencias_gleide p
   where p.empresa_id = p_empresa_id and p.pendencia_id = any(p_ids)
$$;

-- RESUMO (Camada 3): resumo do que a Gleide conversou direto com a cliente.
create or replace function n8n_salvar_resumo_conversa(
  p_empresa_id uuid,
  p_cliente_id uuid,
  p_resumo     text
) returns jsonb
language plpgsql set search_path = public as $$
begin
  update clientes set resumo_ia = p_resumo, resumo_ia_em = now()
   where id = p_cliente_id and empresa_id = p_empresa_id;
  if not found then
    raise exception 'cliente % não encontrada', p_cliente_id;
  end if;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, p_cliente_id, 'resumo', 'n8n_salvar_resumo_conversa', 'clientes',
          p_cliente_id, jsonb_build_object('resumo', p_resumo));

  return jsonb_build_object('cliente_id', p_cliente_id);
end $$;

-- ---------------------------------------------------------------------
-- 6) Função do CRM: o ✓ do atendimento (a dona logada chama; respeita o RLS)
--   p_servicos vazio/null -> "Foi isso": só marca realizado
--   p_servicos preenchido -> "Mudou algo": o 1º serviço substitui o agendado e cada um dos
--                            outros vira um atendimento realizado no mesmo horário
--                            (cada serviço ganha o próprio retorno_previsto)
--   p_resultado           -> só para avaliação: fechou | pensando | nao_fechou
-- ---------------------------------------------------------------------
create or replace function crm_confirmar_atendimento(
  p_agendamento_id uuid,
  p_servicos       uuid[]  default null,
  p_resultado      text    default null,
  p_valor          numeric default null
) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare
  ag      agendamentos%rowtype;
  v_extra uuid;
  v_novo  uuid;
  v_ids   uuid[] := '{}';
  v_aval  uuid;
begin
  select * into ag from agendamentos where id = p_agendamento_id;
  if not found then
    raise exception 'agendamento % não encontrado', p_agendamento_id;
  end if;
  if p_resultado is not null and p_resultado not in ('fechou', 'pensando', 'nao_fechou') then
    raise exception 'resultado deve ser fechou, pensando ou nao_fechou';
  end if;

  update agendamentos
     set status     = 'realizado',
         servico_id = coalesce(p_servicos[1], servico_id),
         valor      = coalesce(p_valor, valor)
   where id = ag.id;

  if coalesce(array_length(p_servicos, 1), 0) > 1 then
    foreach v_extra in array p_servicos[2:] loop
      insert into agendamentos (empresa_id, cliente_id, servico_id, profissional_id, inicio,
                                status, origem, observacoes)
      values (ag.empresa_id, ag.cliente_id, v_extra, ag.profissional_id, ag.inicio,
              'realizado', 'manual', 'feito junto no atendimento das ' ||
              to_char(ag.inicio at time zone 'America/Cuiaba', 'HH24:MI'))
      returning id into v_novo;
      v_ids := v_ids || v_novo;
    end loop;
  end if;

  if p_resultado is not null then
    select id into v_aval from avaliacoes
     where cliente_id = ag.cliente_id and resultado in ('pendente', 'pensando');
    if v_aval is null then
      insert into avaliacoes (empresa_id, cliente_id, agendamento_id)
      values (ag.empresa_id, ag.cliente_id, ag.id) returning id into v_aval;
    end if;
    update avaliacoes
       set resultado = p_resultado, resultado_em = now(),
           agendamento_id = coalesce(agendamento_id, ag.id)
     where id = v_aval;
  end if;

  return jsonb_build_object('agendamento_id', ag.id, 'extras', to_jsonb(v_ids), 'avaliacao_id', v_aval);
end $$;

-- ---------------------------------------------------------------------
-- Segurança
--   avaliacoes:   o CRM lê e edita (a Gleide pode corrigir pelo app)
--   registros_ia: o CRM só lê
--   funções n8n_*: só service_role
-- (minhas_empresas() está no schema private desde o 003)
-- ---------------------------------------------------------------------
alter table avaliacoes   enable row level security;
alter table registros_ia enable row level security;

create policy avaliacoes_all on avaliacoes for all to authenticated
  using (empresa_id in (select private.minhas_empresas()))
  with check (empresa_id in (select private.minhas_empresas()));
create policy registros_ia_select on registros_ia for select to authenticated
  using (empresa_id in (select private.minhas_empresas()));

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on avaliacoes to authenticated;
    grant select on registros_ia to authenticated;
    grant select on funil_clientes, pendencias_gleide to authenticated;
    grant all on avaliacoes, registros_ia to service_role;
    grant select on funil_clientes, pendencias_gleide to service_role;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'assistente_autorizado(uuid, text)',
    'n8n_salvar_pre_avaliacao(uuid, text, jsonb)',
    'n8n_vincular_avaliacao(uuid, uuid)',
    'n8n_assistente_resultado_avaliacao(uuid, text, uuid, jsonb)',
    'n8n_assistente_status_agendamento(uuid, text, uuid, text, numeric)',
    'n8n_assistente_registrar_atendimento(uuid, text, text, text, uuid, timestamptz, numeric, text, uuid)',
    'n8n_assistente_anotar_cliente(uuid, text, uuid, text)',
    'n8n_assistente_marcar_perguntado(uuid, text, uuid[])',
    'n8n_salvar_resumo_conversa(uuid, uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public', f);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon, authenticated', f);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;

-- O ✓ do CRM: só quem está logado (o RLS garante que é do próprio salão)
revoke execute on function crm_confirmar_atendimento(uuid, uuid[], text, numeric) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function crm_confirmar_atendimento(uuid, uuid[], text, numeric) from anon';
    execute 'grant execute on function crm_confirmar_atendimento(uuid, uuid[], text, numeric) to authenticated, service_role';
  end if;
end $$;

-- Tempo real: a ficha da cliente atualiza quando a IA grava
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table avaliacoes;
  end if;
end $$;
