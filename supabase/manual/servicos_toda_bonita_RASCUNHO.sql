-- =====================================================================
-- servicos_toda_bonita_RASCUNHO.sql — base de informação dos serviços (Toda Bonita Mega Hair)
-- RASCUNHO: nomes, preços e durações vêm do prompt-agente.md; os DIAS DE RETORNO são PROVISÓRIOS
-- (chutados para testar). Revisar com a Gleide antes de usar de verdade.
-- Precisa do 004 (colunas categoria e regra_ia).
-- Rodar no SQL Editor trocando [EMPRESA_ID], ou no psql com:  -v empresa_id=<uuid>
-- =====================================================================

insert into servicos (empresa_id, nome, preco, duracao_min, dias_retorno, categoria, regra_ia) values
  -- Avaliação e venda: sem retorno
  (:'empresa_id', 'Avaliação',                                0,   30, null, 'avaliacao',
   'Gratuita. Marcar sempre que a cliente não souber a técnica, o preço do cabelo ou quiser química tendo mega hair.'),
  (:'empresa_id', 'Visita para escolher cabelo',              0,   30, null, 'venda',
   'Para quem só quer ver ou comprar cabelo.'),

  -- Mega hair: aplicação (retorno = quando volta para a manutenção)
  (:'empresa_id', 'Aplicação de mega hair – queratina',       650, 240, 75, 'aplicacao',
   'Só marcar depois de uma avaliação (o valor do cabelo é definido nela).'),
  (:'empresa_id', 'Aplicação de mega hair – tela adesiva',    450, 120, 45, 'aplicacao',
   'Só marcar depois de uma avaliação.'),
  (:'empresa_id', 'Aplicação de mega hair – tela costurada',  500, 180, 60, 'aplicacao',
   'Só marcar depois de uma avaliação.'),
  (:'empresa_id', 'Aplicação de mega hair – ponto americano', 550, 180, 60, 'aplicacao',
   'Só marcar depois de uma avaliação.'),

  -- Mega hair: manutenção
  (:'empresa_id', 'Manutenção – queratina',                   450, 180, 75, 'manutencao', null),
  (:'empresa_id', 'Manutenção – tela adesiva',                300,  90, 45, 'manutencao', null),
  (:'empresa_id', 'Manutenção – tela costurada / ponto americano', 350, 120, 60, 'manutencao', null),
  (:'empresa_id', 'Remoção de mega hair',                     150,  60, null, 'manutencao', null),

  -- Químicas (se a cliente tem mega hair, a Gleide avalia antes)
  (:'empresa_id', 'Escova progressiva', 180, 180, 90, 'quimica',
   'Se a cliente tem mega hair: marcar avaliação antes. Se vai colocar mega hair: a química vem antes da aplicação.'),
  (:'empresa_id', 'Coloração',          150, 120, 45, 'quimica',
   'Se a cliente tem mega hair: marcar avaliação antes. Se vai colocar mega hair: a química vem antes da aplicação.'),
  (:'empresa_id', 'Mechas / luzes',     350, 240, 90, 'quimica',
   'Se a cliente tem mega hair: marcar avaliação antes. Se vai colocar mega hair: a química vem antes da aplicação.'),

  -- Tratamentos
  (:'empresa_id', 'Selagem',                    160, 120, 25, 'tratamento',
   'Se a cliente tem mega hair: a Gleide avalia antes.'),
  (:'empresa_id', 'Botox capilar',              150, 120, 60, 'tratamento', null),
  (:'empresa_id', 'Hidratação ou reconstrução',  90,  60, 30, 'tratamento', null);
