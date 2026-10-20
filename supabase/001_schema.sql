-- =====================================================================
-- 001_schema.sql — Banco do Salão IA (Supabase / Postgres)
-- Rodar UMA VEZ no SQL Editor do Supabase, num projeto novo.
-- Quem altera o banco depois disso: só o guardião (ver CONTRATO.md),
-- sempre com um novo arquivo numerado (002_..., 003_...).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Funções utilitárias
-- ---------------------------------------------------------------------

-- "Hoje" no fuso do salão
create or replace function hoje_cuiaba() returns date
language sql stable set search_path = public as $$
  select (now() at time zone 'America/Cuiaba')::date
$$;

-- Atualiza o campo atualizado_em automaticamente
create or replace function set_atualizado_em() returns trigger
language plpgsql set search_path = public as $$
begin
  new.atualizado_em := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Empresas e usuários
-- ---------------------------------------------------------------------

create table empresas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  -- Configurações do salão (o CRM e o n8n leem daqui):
  --   dias_inativa            (padrão 90)
  --   dias_retorno_chegando   (padrão 7)
  --   horario_funcionamento   (ex.: {"seg":"09:00-19:00", "dom":null})
  --   endereco, formas_pagamento, regras_ia
  --   mensagens.retorno / mensagens.reativacao  (textos do botão "Mandar alô",
  --     com {nome} e {servico} como variáveis)
  config      jsonb not null default '{}'::jsonb,
  criado_em   timestamptz not null default now()
);

-- Quem pode entrar no CRM de cada empresa (liga o login do Supabase Auth à empresa)
create table usuarios_empresa (
  user_id     uuid not null references auth.users(id) on delete cascade,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  papel       text not null default 'dona' check (papel in ('dona', 'recepcao')),
  criado_em   timestamptz not null default now(),
  primary key (user_id, empresa_id)
);

-- Empresas do usuário logado (usada pelas regras de RLS)
create or replace function minhas_empresas() returns setof uuid
language sql stable security definer set search_path = public as $$
  select empresa_id from usuarios_empresa where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------
-- Cadastros do salão
-- ---------------------------------------------------------------------

create table profissionais (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  nome                text not null,
  google_calendar_id  text,            -- agenda Google desta profissional
  ativo               boolean not null default true,
  criado_em           timestamptz not null default now()
);

create table servicos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  nome          text not null,
  preco         numeric(10,2),
  duracao_min   integer not null check (duracao_min > 0),
  dias_retorno  integer check (dias_retorno > 0),  -- null = serviço sem retorno (ex.: noiva)
  ativo         boolean not null default true,
  criado_em     timestamptz not null default now()
);

create table clientes (
  id                         uuid primary key default gen_random_uuid(),
  empresa_id                 uuid not null references empresas(id) on delete cascade,
  nome                       text,
  -- Formato ÚNICO: só números, com DDI 55 + DDD. Ex.: 5566999998888
  telefone                   text not null check (telefone ~ '^55[0-9]{10,11}$'),
  aniversario                date,
  observacoes                text,       -- preferências, alergias, etc.
  profissional_preferida_id  uuid references profissionais(id) on delete set null,
  etiquetas                  text[] not null default '{}',
  ia_pausada_ate             timestamptz,  -- se > now(), a IA NÃO responde esta cliente
  motivo_pausa               text,         -- 'pediu_humano' | 'reclamacao' | 'fora_escopo' | 'dona_respondeu' | 'manual'
  criado_em                  timestamptz not null default now(),
  atualizado_em              timestamptz not null default now(),
  unique (empresa_id, telefone)
);
create trigger trg_clientes_atualizado before update on clientes
  for each row execute function set_atualizado_em();

-- ---------------------------------------------------------------------
-- Agendamentos (= atendimentos)
-- ---------------------------------------------------------------------

create table agendamentos (
  id                uuid primary key default gen_random_uuid(),
  empresa_id        uuid not null references empresas(id) on delete cascade,
  cliente_id        uuid not null references clientes(id) on delete cascade,
  servico_id        uuid references servicos(id) on delete set null,
  profissional_id   uuid references profissionais(id) on delete set null,
  inicio            timestamptz not null,
  fim               timestamptz,            -- se vazio, calculado pela duração do serviço
  status            text not null default 'agendado'
                    check (status in ('agendado', 'realizado', 'cancelado', 'faltou')),
  origem            text not null default 'manual'
                    check (origem in ('ia', 'manual')),
  google_event_id   text,
  valor             numeric(10,2),
  retorno_previsto  date,                   -- calculado quando vira 'realizado'
  observacoes       text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);
create index idx_agend_cliente on agendamentos (cliente_id, inicio desc);
create index idx_agend_empresa_inicio on agendamentos (empresa_id, inicio);

create trigger trg_agend_atualizado before update on agendamentos
  for each row execute function set_atualizado_em();

-- Regras automáticas do agendamento:
--  1) fim vazio -> inicio + duração do serviço
--  2) virou 'realizado' -> retorno_previsto = data do atendimento + dias_retorno do serviço
--  3) saiu de 'realizado' -> limpa retorno_previsto
create or replace function agendamento_regras() returns trigger
language plpgsql set search_path = public as $$
declare
  v_duracao int;
  v_dias    int;
begin
  if new.servico_id is not null then
    select duracao_min, dias_retorno into v_duracao, v_dias
      from servicos where id = new.servico_id;
  end if;

  if new.fim is null and v_duracao is not null then
    new.fim := new.inicio + make_interval(mins => v_duracao);
  end if;

  if new.status = 'realizado' then
    if v_dias is not null then
      new.retorno_previsto := (new.inicio at time zone 'America/Cuiaba')::date + v_dias;
    else
      new.retorno_previsto := null;
    end if;
  else
    new.retorno_previsto := null;
  end if;

  return new;
end $$;
create trigger trg_agend_regras before insert or update on agendamentos
  for each row execute function agendamento_regras();

-- ---------------------------------------------------------------------
-- Mensagens do WhatsApp (gravadas pelo n8n)
-- ---------------------------------------------------------------------

create table mensagens (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  cliente_id     uuid not null references clientes(id) on delete cascade,
  direcao        text not null check (direcao in ('entrada', 'saida')),
  autor          text not null check (autor in ('cliente', 'ia', 'humano')),
  tipo           text not null default 'texto' check (tipo in ('texto', 'audio', 'imagem', 'outro')),
  conteudo       text,               -- para áudio: a transcrição
  wa_message_id  text unique,        -- id da mensagem no WhatsApp (evita duplicar)
  criado_em      timestamptz not null default now()
);
create index idx_msg_cliente on mensagens (cliente_id, criado_em desc);
create index idx_msg_empresa on mensagens (empresa_id, criado_em desc);

-- ---------------------------------------------------------------------
-- Contatos ("Mandar alô") — registro de cada tentativa de chamar a cliente
-- ---------------------------------------------------------------------

create table contatos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  cliente_id  uuid not null references clientes(id) on delete cascade,
  tipo        text not null check (tipo in ('retorno', 'reativacao', 'aniversario', 'outro')),
  canal       text not null default 'manual' check (canal in ('manual', 'ia')),
  resultado   text not null default 'pendente'
              check (resultado in ('pendente', 'sem_resposta', 'respondeu', 'agendou')),
  mensagem    text,
  criado_por  uuid references auth.users(id) on delete set null,
  criado_em   timestamptz not null default now()
);
create index idx_contatos_cliente on contatos (cliente_id, criado_em desc);

-- Quando a cliente agenda (ou é registrada como atendida) até 14 dias depois
-- de um contato pendente, o contato vira 'agendou' sozinho (é assim que medimos reativação).
create or replace function contato_marca_agendou() returns trigger
language plpgsql set search_path = public as $$
begin
  update contatos
     set resultado = 'agendou'
   where cliente_id = new.cliente_id
     and resultado in ('pendente', 'respondeu')
     and criado_em >= now() - interval '14 days';
  return new;
end $$;
create trigger trg_contato_agendou after insert on agendamentos
  for each row when (new.status in ('agendado', 'realizado'))
  execute function contato_marca_agendou();

-- Quando a cliente manda mensagem depois de um contato pendente, vira 'respondeu'
create or replace function contato_marca_respondeu() returns trigger
language plpgsql set search_path = public as $$
begin
  update contatos
     set resultado = 'respondeu'
   where cliente_id = new.cliente_id
     and resultado = 'pendente'
     and criado_em >= now() - interval '14 days';
  return new;
end $$;
create trigger trg_contato_respondeu after insert on mensagens
  for each row when (new.autor = 'cliente')
  execute function contato_marca_respondeu();

-- ---------------------------------------------------------------------
-- Views para o CRM
-- ---------------------------------------------------------------------

-- Último atendimento realizado de cada cliente, por serviço, com o retorno previsto
create view retornos_por_servico with (security_invoker = true) as
select distinct on (a.cliente_id, a.servico_id)
  a.empresa_id,
  a.cliente_id,
  a.servico_id,
  s.nome            as servico_nome,
  a.inicio          as ultima_vez,
  a.retorno_previsto
from agendamentos a
join servicos s on s.id = a.servico_id
where a.status = 'realizado'
order by a.cliente_id, a.servico_id, a.inicio desc;

-- Resumo de cada cliente com o STATUS (a base das listas do CRM)
--   em_dia            -> tem horário futuro marcado, ou o retorno ainda está longe
--   retorno_chegando  -> retorno previsto nos próximos X dias (config, padrão 7)
--   retorno_atrasado  -> passou da data de retorno e não marcou
--   inativa           -> mais de X dias sem vir (config, padrão 90) e sem horário marcado
--   sem_visita        -> nunca teve atendimento realizado (só conversou)
create view clientes_status with (security_invoker = true) as
with base as (
  select
    c.*,
    coalesce((e.config->>'dias_inativa')::int, 90)          as cfg_dias_inativa,
    coalesce((e.config->>'dias_retorno_chegando')::int, 7)  as cfg_dias_chegando,
    (select max(a.inicio) from agendamentos a
       where a.cliente_id = c.id and a.status = 'realizado')              as ultima_visita,
    (select count(*) from agendamentos a
       where a.cliente_id = c.id and a.status = 'realizado')              as total_visitas,
    (select min(a.inicio) from agendamentos a
       where a.cliente_id = c.id and a.status = 'agendado'
         and a.inicio > now())                                            as proximo_agendamento,
    (select min(r.retorno_previsto) from retornos_por_servico r
       where r.cliente_id = c.id)                                         as retorno_previsto,
    (select max(ct.criado_em) from contatos ct
       where ct.cliente_id = c.id)                                        as ultimo_contato,
    (select max(m.criado_em) from mensagens m
       where m.cliente_id = c.id)                                         as ultima_mensagem
  from clientes c
  join empresas e on e.id = c.empresa_id
)
select
  b.id, b.empresa_id, b.nome, b.telefone, b.aniversario, b.observacoes,
  b.profissional_preferida_id, b.etiquetas, b.ia_pausada_ate, b.motivo_pausa,
  (b.ia_pausada_ate is not null and b.ia_pausada_ate > now())             as ia_pausada,
  b.criado_em,
  b.ultima_visita,
  b.total_visitas,
  (hoje_cuiaba() - (b.ultima_visita at time zone 'America/Cuiaba')::date) as dias_sem_visita,
  b.proximo_agendamento,
  b.retorno_previsto,
  b.ultimo_contato,
  b.ultima_mensagem,
  case
    when b.proximo_agendamento is not null                                  then 'em_dia'
    when b.ultima_visita is null                                            then 'sem_visita'
    when hoje_cuiaba() - (b.ultima_visita at time zone 'America/Cuiaba')::date
         > b.cfg_dias_inativa                                               then 'inativa'
    when b.retorno_previsto is not null and b.retorno_previsto < hoje_cuiaba()
                                                                            then 'retorno_atrasado'
    when b.retorno_previsto is not null
         and b.retorno_previsto <= hoje_cuiaba() + b.cfg_dias_chegando      then 'retorno_chegando'
    else 'em_dia'
  end as status
from base b;

-- Conversas para a aba "Conversas": última mensagem de cada cliente
create view conversas with (security_invoker = true) as
select distinct on (m.cliente_id)
  m.empresa_id,
  m.cliente_id,
  c.nome,
  c.telefone,
  (c.ia_pausada_ate is not null and c.ia_pausada_ate > now()) as ia_pausada,
  c.motivo_pausa,
  m.autor     as ultimo_autor,
  m.conteudo  as ultima_mensagem,
  m.criado_em as ultima_mensagem_em
from mensagens m
join clientes c on c.id = m.cliente_id
order by m.cliente_id, m.criado_em desc;

-- ---------------------------------------------------------------------
-- Função para o n8n: registra mensagem recebida e diz se a IA pode responder
-- (cria a cliente se for a primeira vez). Só o n8n (service_role) usa.
-- ---------------------------------------------------------------------
create or replace function n8n_registrar_entrada(
  p_empresa_id    uuid,
  p_telefone      text,
  p_nome          text,
  p_conteudo      text,
  p_tipo          text default 'texto',
  p_wa_message_id text default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_id     uuid;
  v_nome   text;
  v_pausa  timestamptz;
  v_nova   boolean;
begin
  insert into clientes (empresa_id, telefone, nome)
  values (p_empresa_id, p_telefone, nullif(p_nome, ''))
  on conflict (empresa_id, telefone)
    do update set nome = coalesce(clientes.nome, excluded.nome)
  returning id, nome, ia_pausada_ate, (xmax = 0)
    into v_id, v_nome, v_pausa, v_nova;

  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
  values (p_empresa_id, v_id, 'entrada', 'cliente', p_tipo, p_conteudo, p_wa_message_id)
  on conflict (wa_message_id) do nothing;

  return jsonb_build_object(
    'cliente_id',   v_id,
    'nome',         v_nome,
    'ia_pausada',   (v_pausa is not null and v_pausa > now()),
    'nova_cliente', v_nova
  );
end $$;

-- ---------------------------------------------------------------------
-- Função para o n8n: registra mensagem ENVIADA (pela IA ou pela dona)
--   p_autor = 'ia'      -> resposta da IA
--   p_autor = 'humano'  -> dona respondeu pelo WhatsApp Business (eco/fromMe)
--   p_pausar_horas > 0  -> pausa a IA para esta cliente (ex.: 12)
-- Se o wa_message_id já existe (ex.: eco de uma mensagem que a própria IA
-- enviou), NÃO grava de novo e NÃO pausa: devolve duplicada = true.
-- Cria a cliente se não existir (ex.: a dona chamou alguém primeiro).
-- ---------------------------------------------------------------------
create or replace function n8n_registrar_saida(
  p_empresa_id    uuid,
  p_telefone      text,
  p_conteudo      text,
  p_autor         text,
  p_tipo          text default 'texto',
  p_wa_message_id text default null,
  p_pausar_horas  integer default 0,
  p_motivo_pausa  text default null
) returns jsonb
language plpgsql set search_path = public as $$
declare
  v_cliente_id uuid;
  v_msg_id     uuid;
begin
  if p_autor not in ('ia', 'humano') then
    raise exception 'p_autor deve ser ia ou humano';
  end if;

  if p_wa_message_id is not null
     and exists (select 1 from mensagens where wa_message_id = p_wa_message_id) then
    return jsonb_build_object('duplicada', true);
  end if;

  insert into clientes (empresa_id, telefone)
  values (p_empresa_id, p_telefone)
  on conflict (empresa_id, telefone) do update set telefone = excluded.telefone
  returning id into v_cliente_id;

  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
  values (p_empresa_id, v_cliente_id, 'saida', p_autor, p_tipo, p_conteudo, p_wa_message_id)
  on conflict (wa_message_id) do nothing
  returning id into v_msg_id;

  if v_msg_id is null then
    return jsonb_build_object('duplicada', true);
  end if;

  if coalesce(p_pausar_horas, 0) > 0 then
    update clientes
       set ia_pausada_ate = now() + make_interval(hours => p_pausar_horas),
           motivo_pausa   = coalesce(p_motivo_pausa,
                              case when p_autor = 'humano' then 'dona_respondeu' else 'manual' end)
     where id = v_cliente_id;
  end if;

  return jsonb_build_object('duplicada', false, 'cliente_id', v_cliente_id, 'mensagem_id', v_msg_id);
end $$;

-- ---------------------------------------------------------------------
-- Segurança (RLS): cada usuário só vê os dados da(s) própria(s) empresa(s).
-- O n8n usa a service_role key, que ignora o RLS.
-- ---------------------------------------------------------------------
alter table empresas          enable row level security;
alter table usuarios_empresa  enable row level security;
alter table profissionais     enable row level security;
alter table servicos          enable row level security;
alter table clientes          enable row level security;
alter table agendamentos      enable row level security;
alter table mensagens         enable row level security;
alter table contatos          enable row level security;

create policy empresas_select on empresas for select to authenticated
  using (id in (select minhas_empresas()));
create policy empresas_update on empresas for update to authenticated
  using (id in (select minhas_empresas()))
  with check (id in (select minhas_empresas()));

create policy usuarios_select on usuarios_empresa for select to authenticated
  using (user_id = auth.uid());

create policy profissionais_all on profissionais for all to authenticated
  using (empresa_id in (select minhas_empresas()))
  with check (empresa_id in (select minhas_empresas()));
create policy servicos_all on servicos for all to authenticated
  using (empresa_id in (select minhas_empresas()))
  with check (empresa_id in (select minhas_empresas()));
create policy clientes_all on clientes for all to authenticated
  using (empresa_id in (select minhas_empresas()))
  with check (empresa_id in (select minhas_empresas()));
create policy agendamentos_all on agendamentos for all to authenticated
  using (empresa_id in (select minhas_empresas()))
  with check (empresa_id in (select minhas_empresas()));
create policy mensagens_select on mensagens for select to authenticated
  using (empresa_id in (select minhas_empresas()));
create policy contatos_all on contatos for all to authenticated
  using (empresa_id in (select minhas_empresas()))
  with check (empresa_id in (select minhas_empresas()));

-- Permissões explícitas (o Supabase costuma dar por padrão; aqui garantimos)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant usage on schema public to authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant all on all tables in schema public to service_role;
  end if;
end $$;

-- As funções do n8n não podem ser chamadas pelo CRM (só pela service_role)
revoke execute on function n8n_registrar_entrada(uuid, text, text, text, text, text) from public;
revoke execute on function n8n_registrar_saida(uuid, text, text, text, text, text, integer, text) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke execute on function n8n_registrar_entrada(uuid, text, text, text, text, text) from anon, authenticated';
    execute 'revoke execute on function n8n_registrar_saida(uuid, text, text, text, text, text, integer, text) from anon, authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function n8n_registrar_entrada(uuid, text, text, text, text, text) to service_role';
    execute 'grant execute on function n8n_registrar_saida(uuid, text, text, text, text, text, integer, text) to service_role';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Tempo real: o CRM recebe mensagens e mudanças na hora
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table mensagens, clientes, agendamentos;
  end if;
end $$;
