-- =====================================================================
-- 004_status_manual.sql — AINDA NÃO APLICADO (rodar 1 vez no SQL Editor)
-- Status escolhido à mão no Painel CRM (arrastar a cliente para outra aba).
-- Vale até a cliente voltar ao salão ou marcar horário; depois disso o
-- banco volta a calcular sozinho, como antes.
-- =====================================================================
alter table clientes
  add column status_manual    text check (status_manual in ('em_dia', 'inativa')),
  add column status_manual_em timestamptz;

-- Mesma view do 001, com o status manual na frente do automático
-- (as colunas novas vão no fim para o "create or replace" aceitar)
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
    (select min(r.retorno_previsto) from retornos_por_servico r
       where r.cliente_id = c.id)                                         as retorno_previsto,
    (select max(ct.criado_em) from contatos ct
       where ct.cliente_id = c.id)                                        as ultimo_contato,
    (select max(m.criado_em) from mensagens m
       where m.cliente_id = c.id)                                         as ultima_mensagem
  from clientes c
  join empresas e on e.id = c.empresa_id
),
manual as (
  select
    b.*,
    -- O manual só vale enquanto ela não marcou horário nem voltou depois da mudança
    b.status_manual is not null
      and b.proximo_agendamento is null
      and (b.ultima_visita is null or b.ultima_visita < b.status_manual_em) as manual_valido
  from base b
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
    when b.manual_valido                                                    then b.status_manual
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
  b.manual_valido as status_e_manual
from manual b;
