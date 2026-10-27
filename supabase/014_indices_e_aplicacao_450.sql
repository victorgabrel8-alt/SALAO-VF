-- =====================================================================
-- 014_indices_e_aplicacao_450.sql (27/10)
-- 1) Índices nas duas chaves estrangeiras de atendimento_servicos que o
--    Supabase apontou sem índice (aviso de desempenho).
-- 2) Desde o PR #55 a IA fala "mão de obra a partir de R$ 450,00 em qualquer
--    técnica". O app ainda mostrava 450/500/550/650 por técnica: as aplicações
--    ativas passam a R$ 450 com "a partir de", igual ao que a IA fala.
--    A Gleide pode mudar depois em Configurações › Serviços e preços.
-- =====================================================================
create index if not exists idx_atend_serv_empresa on public.atendimento_servicos (empresa_id);
create index if not exists idx_atend_serv_servico on public.atendimento_servicos (servico_id);
update public.servicos set preco = 450, a_partir_de = true
 where empresa_id = '00000000-0000-0000-0000-000000000001' and categoria = 'aplicacao' and ativo and preco is distinct from 450;
