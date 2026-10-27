-- 016_sem_escova_progressiva.sql (27/10, pedido do Victor)
-- "Escova progressiva" é o mesmo serviço que "Selagem": desativa (não apaga; atendimentos antigos apontam para ela).
update public.servicos set ativo = false
 where empresa_id = '00000000-0000-0000-0000-000000000001' and nome = 'Escova progressiva' and ativo;
