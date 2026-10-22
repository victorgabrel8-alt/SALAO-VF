-- =====================================================================
-- 010_retorno_por_linha_e_varios_servicos.sql — AINDA NÃO RODADO (guardião: rodar uma vez)
-- Um horário por visita, com quantos serviços a cliente fizer, e o retorno certo de cada um.
--
-- Antes: no ✓ "Fez outro serviço", cada serviço a mais virava um horário novo
--   (agendamentos) no mesmo horário. 16 procedimentos = 16 cartões com o nome dela
--   na agenda, 16 "visitas" na contagem e 16 linhas no histórico que a IA lê.
-- Agora: o horário continua um só. Os serviços a mais ficam em atendimento_servicos,
--   ligados a ele. Cada serviço continua com o PRÓPRIO retorno (data + dias_retorno).
--
-- Também:
--   - view servicos_feitos: todos os serviços realizados (o principal do horário + os a mais)
--   - servicos.linha: serviços da mesma linha se substituem no retorno (aplicação e manutenção
--     da mesma técnica de mega hair; "Hidratação" e "Hidratação ou reconstrução"...)
--   - view retornos_pendentes: o retorno que ainda vale de CADA linha de serviço
--   - clientes_status: o retorno da cliente é o MAIS PRÓXIMO entre as linhas pendentes
--     (mega hair 75 dias + pintura 45 -> chama pela pintura; depois da pintura, a manutenção do
--     mega continua valendo e é a próxima). Antes valia o MENOR retorno de todos os serviços
--     que ela já fez: quem tinha acabado de fazer a manutenção aparecia como Atrasada.
--     Ganha a coluna retorno_servico (qual serviço vence).
--   - converte o que já existe: os horários "Feito junto no atendimento das ..." viram
--     serviços do horário principal e somem da agenda
--   - crm_confirmar_atendimento (do 004): "Mudou algo" passa a gravar os serviços a mais no
--     mesmo horário, e não mais um horário novo para cada um
--
-- Quando um retorno deixa de valer:
--   - a cliente refez um serviço da mesma linha depois; ou
--   - ela veio ao salão NA data ou depois e não refez: a Gleide viu e decidiu não fazer
--     (ex.: hidratação que ficou para trás). Visita antes da data não apaga nada.
--
-- Depende do 004 (crm_confirmar_atendimento). Testado com 001 a 009 num Postgres local.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Serviços a mais de um horário
-- ---------------------------------------------------------------------
create table atendimento_servicos (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  agendamento_id  uuid not null references agendamentos(id) on delete cascade,
  servico_id      uuid not null references servicos(id) on delete cascade,
  criado_em       timestamptz not null default now(),
  unique (agendamento_id, servico_id)
);
create index idx_atend_serv_agendamento on atendimento_servicos (agendamento_id);

alter table atendimento_servicos enable row level security;
create policy atendimento_servicos_all on atendimento_servicos for all to authenticated
  using (empresa_id in (select private.minhas_empresas()))
  with check (empresa_id in (select private.minhas_empresas()));

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select, insert, update, delete on atendimento_servicos to authenticated;
    grant all on atendimento_servicos to service_role;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 1b) Linha do serviço: serviços da mesma linha cumprem o retorno um do outro.
--     Vazio = a linha é o próprio nome do serviço. Editável no Painel CRM > Serviços.
-- ---------------------------------------------------------------------
alter table servicos add column linha text;

update servicos set linha = 'Mega hair queratina'
 where nome in ('Aplicação de mega hair – queratina', 'Manutenção – queratina');
update servicos set linha = 'Mega hair tela adesiva'
 where nome in ('Aplicação de mega hair – tela adesiva', 'Manutenção – tela adesiva');
update servicos set linha = 'Mega hair tela costurada / ponto americano'
 where nome in ('Aplicação de mega hair – tela costurada', 'Aplicação de mega hair – ponto americano',
                'Manutenção – tela costurada / ponto americano');
update servicos set linha = 'Mega hair'
 where nome in ('Mega hair (aplicação)', 'Manutenção mega hair');
update servicos set linha = 'Hidratação'  where nome in ('Hidratação', 'Hidratação ou reconstrução');
update servicos set linha = 'Progressiva' where nome in ('Progressiva', 'Escova progressiva');
update servicos set linha = 'Coloração'   where nome in ('Coloração', 'Retoque de raiz');

-- ---------------------------------------------------------------------
-- 2) Converte o que já existe
-- ---------------------------------------------------------------------
-- 2a) Horários "Feito junto no atendimento das HH:MM" -> serviço a mais do horário principal
--     (mesma cliente, mesmo início, o que não é "feito junto")
with extras as (
  select x.id as extra_id, x.empresa_id, x.servico_id,
         (select p.id from agendamentos p
           where p.cliente_id = x.cliente_id and p.inicio = x.inicio and p.id <> x.id
             and coalesce(p.observacoes, '') not ilike 'feito junto no atendimento das %'
           order by p.criado_em limit 1) as principal_id
    from agendamentos x
   where x.observacoes ilike 'feito junto no atendimento das %'
),
movidos as (
  insert into atendimento_servicos (empresa_id, agendamento_id, servico_id)
  select empresa_id, principal_id, servico_id from extras
   where principal_id is not null and servico_id is not null
  on conflict (agendamento_id, servico_id) do nothing
  returning 1
)
delete from agendamentos a
 using extras e
 where a.id = e.extra_id and e.principal_id is not null;

-- 2b) O app, antes deste arquivo, anotava os serviços a mais nas observações do horário
--     ("Também fez: Hidratação + Selagem"). Passa para a tabela e tira a linha.
insert into atendimento_servicos (empresa_id, agendamento_id, servico_id)
select a.empresa_id, a.id, s.id
  from agendamentos a
  cross join lateral regexp_split_to_table(substring(a.observacoes from 'Também fez: ([^\n]*)'), ' \+ ') as feito(nome_servico)
  join servicos s on s.empresa_id = a.empresa_id and s.nome = trim(feito.nome_servico)
 where a.observacoes like '%Também fez: %'
on conflict (agendamento_id, servico_id) do nothing;

update agendamentos
   set observacoes = nullif(trim(both E'\n' from regexp_replace(observacoes, 'Também fez: [^\n]*\n?', '', 'g')), '')
 where observacoes like '%Também fez: %';

-- ---------------------------------------------------------------------
-- 3) Views
-- ---------------------------------------------------------------------

-- Todos os serviços realizados: o principal de cada horário + os a mais.
-- retorno_previsto de cada um = dia do atendimento + dias_retorno do serviço.
create view servicos_feitos with (security_invoker = true) as
select a.empresa_id, a.cliente_id, a.id as agendamento_id, a.inicio,
       a.servico_id, s.nome as servico_nome, a.retorno_previsto, false as a_mais,
       coalesce(nullif(trim(s.linha), ''), s.nome) as linha
  from agendamentos a
  left join servicos s on s.id = a.servico_id
 where a.status = 'realizado'
union all
select a.empresa_id, a.cliente_id, a.id, a.inicio,
       x.servico_id, s.nome,
       case when s.dias_retorno is not null
            then (a.inicio at time zone 'America/Cuiaba')::date + s.dias_retorno end,
       true,
       coalesce(nullif(trim(s.linha), ''), s.nome)
  from atendimento_servicos x
  join agendamentos a on a.id = x.agendamento_id
  join servicos s on s.id = x.servico_id
 where a.status = 'realizado';

-- O retorno que ainda vale de cada linha de serviço da cliente: o da última vez que ela fez
-- algo daquela linha, se ela não voltou ao salão na data ou depois dela.
create view retornos_pendentes with (security_invoker = true) as
select u.empresa_id, u.cliente_id, u.agendamento_id, u.inicio as ultima_vez,
       u.servico_id, u.servico_nome, u.linha, u.retorno_previsto
  from (
    select distinct on (f.cliente_id, f.linha) f.*
      from servicos_feitos f
     where f.linha is not null
     order by f.cliente_id, f.linha, f.inicio desc, f.retorno_previsto nulls last
  ) u
 where u.retorno_previsto is not null
   and not exists (
     select 1 from agendamentos v
      where v.cliente_id = u.cliente_id and v.status = 'realizado' and v.inicio > u.inicio
        and (v.inicio at time zone 'America/Cuiaba')::date >= u.retorno_previsto);

-- Mesmas colunas de antes: o CRM e o n8n continuam lendo igual
create or replace view retornos_por_servico with (security_invoker = true) as
select distinct on (f.cliente_id, f.servico_id)
  f.empresa_id,
  f.cliente_id,
  f.servico_id,
  f.servico_nome,
  f.inicio            as ultima_vez,
  f.retorno_previsto
from servicos_feitos f
where f.servico_id is not null
order by f.cliente_id, f.servico_id, f.inicio desc;

-- Mesmas colunas de antes. total_visitas continua contando HORÁRIOS (visitas), não serviços.
create or replace view clientes_status with (security_invoker = true) as
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
    -- O retorno mais próximo entre as linhas de serviço que ainda estão pendentes
    (select p.retorno_previsto from retornos_pendentes p
       where p.cliente_id = c.id
       order by p.retorno_previsto, p.servico_nome limit 1)              as retorno_previsto,
    (select p.servico_nome from retornos_pendentes p
       where p.cliente_id = c.id
       order by p.retorno_previsto, p.servico_nome limit 1)              as retorno_servico,
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
  end as status,
  b.retorno_servico   -- coluna nova (no fim, para não mudar as que já existem)
from base b;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on servicos_feitos, retornos_pendentes to authenticated;
    grant select on servicos_feitos, retornos_pendentes to service_role;
  end if;
end $$;

-- Tempo real: a agenda atualiza quando um serviço é acrescentado ao horário
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table atendimento_servicos;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4) O ✓ do CRM (crm_confirmar_atendimento, do 004): "Mudou algo" com vários serviços
--    grava os serviços a mais NO MESMO horário (atendimento_servicos), nunca um horário novo
--    por serviço. O resto da função é igual ao do 004 (mesmos parâmetros e permissões).
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
      insert into atendimento_servicos (empresa_id, agendamento_id, servico_id)
      values (ag.empresa_id, ag.id, v_extra)
      on conflict (agendamento_id, servico_id) do nothing
      returning id into v_novo;
      if v_novo is not null then v_ids := v_ids || v_novo; end if;
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
