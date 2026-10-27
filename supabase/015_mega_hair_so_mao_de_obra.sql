-- =====================================================================
-- 015_mega_hair_so_mao_de_obra.sql (27/10, pedido do Victor)
-- Igual ao prompt da IA: no mega hair só existe a MÃO DE OBRA, a partir de
-- R$ 450 em qualquer técnica (o cabelo a Gleide passa pessoalmente).
-- - cria "Aplicação de mega hair – mão de obra" (no app aparece como "Mão de obra";
--   o "aplicação" no nome faz a IA achar o serviço quando marca uma aplicação).
--   240 min: a técnica mais longa (queratina), para a agenda não encavalar.
-- - desativa as 4 aplicações por técnica (não apaga: atendimentos antigos apontam para elas).
-- Manutenção, químicas, tratamentos, remoção e avaliações continuam como estavam.
-- =====================================================================
insert into public.servicos (empresa_id, nome, categoria, preco, duracao_min, dias_retorno, ativo, a_partir_de)
select '00000000-0000-0000-0000-000000000001', 'Aplicação de mega hair – mão de obra', 'aplicacao', 450, 240, 60, true, true
where not exists (select 1 from public.servicos where empresa_id = '00000000-0000-0000-0000-000000000001' and nome = 'Aplicação de mega hair – mão de obra');
update public.servicos set ativo = false
 where empresa_id = '00000000-0000-0000-0000-000000000001' and categoria = 'aplicacao'
   and nome <> 'Aplicação de mega hair – mão de obra' and ativo;
