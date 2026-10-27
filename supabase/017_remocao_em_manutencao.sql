-- 017_remocao_em_manutencao.sql (27/10, pedido do Victor)
-- "Remoção de mega hair" passa a aparecer na categoria Manutenção do app (antes: Outros).
-- O nome não muda: a IA continua achando o serviço quando marca uma remoção.
update public.servicos set categoria = 'manutencao'
 where empresa_id = '00000000-0000-0000-0000-000000000001' and nome = 'Remoção de mega hair' and categoria <> 'manutencao';
