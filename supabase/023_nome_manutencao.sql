-- =====================================================================
-- 023_nome_manutencao.sql — aplicado no Supabase em 27/10/2026
-- No app, a lista de serviços tira o nome da seção do começo ("Manutenção – queratina"
-- aparece como "Queratina"). "Manutenção de mega hair – mão de obra" aparecia como
-- "de mega hair — mão de obra". Novo nome: "Manutenção – mão de obra" (aparece "Mão de obra",
-- igual à aplicação).
-- =====================================================================

update servicos set nome = 'Manutenção – mão de obra'
 where empresa_id = '00000000-0000-0000-0000-000000000001' and nome = 'Manutenção de mega hair – mão de obra';
