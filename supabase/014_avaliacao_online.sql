-- 014: Avaliação online (pedido do Victor, 26/10).
-- Quem não consegue ir ao salão marca a avaliação online: no horário marcado a Gleide liga para a cliente
-- no número do WhatsApp e passa o orçamento. Ocupa a agenda como a avaliação presencial (30 min, gratuita).
-- A IA marca pelo nome do serviço ("Avaliação online"); o app mostra o serviço no agendamento.
insert into servicos (empresa_id, nome, categoria, preco, a_partir_de, duracao_min, ativo, regra_ia)
select e.id, 'Avaliação online', 'avaliacao', 0, true, 30, true,
       'Para quem não consegue ir ao salão: a Gleide liga para a cliente no horário marcado e passa o orçamento.'
from empresas e
where not exists (select 1 from servicos s where s.empresa_id = e.id and s.nome = 'Avaliação online');
