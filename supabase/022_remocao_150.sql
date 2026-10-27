-- =====================================================================
-- 022_remocao_150.sql — aplicado no Supabase em 27/10/2026
-- Pedido do Victor (logo depois da 021): a remoção de mega hair não entra no valor único,
-- volta a ser serviço próprio, a partir de R$ 150 (60 min).
-- =====================================================================

update servicos set ativo = true, preco = 150
 where id = '57d626d7-c0fb-4c1f-a583-360d2c25390b'; -- Remoção de mega hair
