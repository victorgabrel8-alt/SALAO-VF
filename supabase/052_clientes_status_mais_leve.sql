-- =====================================================================
-- 052: clientes_status mais leve (mesmas colunas, mesmos valores)
--
-- A view calculava por cliente, em subconsultas soltas, a última visita, o próximo horário e
-- o retorno previsto. Como o `status` usa essas colunas várias vezes, o Postgres repetia cada
-- subconsulta a cada uso: uma leitura virava 39 a 57 subconsultas (o retorno previsto, que abre
-- retornos_pendentes -> servicos_feitos, era calculado até 5 vezes por cliente).
--
-- Agora cada coisa é calculada UMA vez por cliente (left join lateral):
--   ag = última visita, total de visitas e próximo horário, numa passada só em agendamentos
--   rp = o retorno pendente mais próximo (data e serviço), numa leitura só
-- ultimo_contato e ultima_mensagem continuam subconsultas soltas: são usadas uma vez só e o
-- Postgres nem as roda quando a leitura não pede essas colunas.
--
-- Nada muda para quem lê: mesmas 21 colunas, na mesma ordem, com os mesmos tipos e valores.
-- Conferido em 14/11/2026 comparando linha a linha com a view antiga (230 clientes, 0 diferença).
-- Aplicada em produção em 14/11/2026, com o ok do Victor (resultado conferido igual antes e depois).
-- Para voltar atrás: rodar de novo o `create or replace view clientes_status` do arquivo 010.
-- =====================================================================

create or replace view clientes_status with (security_invoker = true) as
select
  c.id, c.empresa_id, c.nome, c.telefone, c.aniversario, c.observacoes,
  c.profissional_preferida_id, c.etiquetas, c.ia_pausada_ate, c.motivo_pausa,
  (c.ia_pausada_ate is not null and c.ia_pausada_ate > now())              as ia_pausada,
  c.criado_em,
  ag.ultima_visita,
  ag.total_visitas,
  (hoje_cuiaba() - (ag.ultima_visita at time zone 'America/Cuiaba')::date) as dias_sem_visita,
  ag.proximo_agendamento,
  rp.retorno_previsto,
  (select max(ct.criado_em) from contatos ct
     where ct.cliente_id = c.id)                                           as ultimo_contato,
  (select max(m.criado_em) from mensagens m
     where m.cliente_id = c.id)                                            as ultima_mensagem,
  case
    when ag.proximo_agendamento is not null                                  then 'em_dia'
    when ag.ultima_visita is null                                            then 'sem_visita'
    when hoje_cuiaba() - (ag.ultima_visita at time zone 'America/Cuiaba')::date
         > coalesce((e.config->>'dias_inativa')::int, 90)                    then 'inativa'
    when rp.retorno_previsto is not null and rp.retorno_previsto < hoje_cuiaba()
                                                                             then 'retorno_atrasado'
    when rp.retorno_previsto is not null
         and rp.retorno_previsto <= hoje_cuiaba()
             + coalesce((e.config->>'dias_retorno_chegando')::int, 7)        then 'retorno_chegando'
    else 'em_dia'
  end as status,
  rp.servico_nome as retorno_servico
from clientes c
join empresas e on e.id = c.empresa_id
left join lateral (
  select max(a.inicio) filter (where a.status = 'realizado')                       as ultima_visita,
         count(*)      filter (where a.status = 'realizado')                       as total_visitas,
         min(a.inicio) filter (where a.status = 'agendado' and a.inicio > now())   as proximo_agendamento
    from agendamentos a
   where a.cliente_id = c.id
) ag on true
-- O retorno mais próximo entre as linhas de serviço que ainda estão pendentes
left join lateral (
  select p.retorno_previsto, p.servico_nome
    from retornos_pendentes p
   where p.cliente_id = c.id
   order by p.retorno_previsto, p.servico_nome
   limit 1
) rp on true;
