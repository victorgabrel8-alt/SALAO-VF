-- =====================================================================
-- clientes-ficticias.sql — 10 clientes de salão FICTÍCIAS no "Salão Demo"
-- Só para ver o CRM funcionando (retornos por procedimento, origem, status).
-- Não muda a estrutura do banco: só insere dados no Salão Demo.
--
-- Como usar: Supabase → SQL Editor → New query → colar tudo → Run.
-- Pode rodar de novo quando quiser: ele apaga as fictícias antigas e recria
-- com as datas contadas a partir de hoje.
-- Some junto com o demo na sexta (delete from empresas where id = '...0001').
-- =====================================================================

-- Serviços de salão que ainda não existem no demo (dias_retorno = quando ela deve voltar)
insert into servicos (empresa_id, nome, preco, duracao_min, dias_retorno)
select '00000000-0000-0000-0000-000000000001', s.nome, s.preco, s.duracao, s.retorno
from (values
  ('Hidratação',             90.00,  60, 15),
  ('Mega hair (aplicação)', 1200.00, 240, 45),
  ('Manutenção mega hair',   250.00, 120, 45),
  ('Retoque de raiz',        150.00,  90, 30),
  ('Teste de mecha',           0.00,  30,  3),
  ('Mechas / luzes',         350.00, 180, 90),
  ('Botox capilar',          200.00, 120, 60)
) as s(nome, preco, duracao, retorno)
where not exists (
  select 1 from servicos x
  where x.empresa_id = '00000000-0000-0000-0000-000000000001' and x.nome = s.nome
);

-- Apaga as fictícias de uma rodada anterior (agendamentos, mensagens e contatos vão junto)
delete from clientes
where empresa_id = '00000000-0000-0000-0000-000000000001'
  and telefone like '5566988880%';

insert into clientes (empresa_id, nome, telefone, aniversario, observacoes, profissional_preferida_id, etiquetas) values
  ('00000000-0000-0000-0000-000000000001', 'Aline Martins',     '5566988880001', '1994-03-12',
   'Cabelo ressecado nas pontas. Faz cronograma capilar.',
   '00000000-0000-0000-0000-0000000000a1', array['origem:instagram']),
  ('00000000-0000-0000-0000-000000000001', 'Bianca Ribeiro',    '5566988880002', '1990-07-25',
   'Mega hair de fita adesiva, 100 g, cor 6.0, 55 cm.',
   '00000000-0000-0000-0000-0000000000a2', array['mega hair', 'vip', 'origem:indicacao']),
  ('00000000-0000-0000-0000-000000000001', 'Cláudia Nogueira',  '5566988880003', '1987-11-02',
   'Fórmula da raiz: Igora 7.1 + OX 20 vol, pausa de 35 min.',
   '00000000-0000-0000-0000-0000000000a1', array['coloração', 'origem:google']),
  ('00000000-0000-0000-0000-000000000001', 'Daniela Freitas',   '5566988880004', '1998-01-19',
   'Coloração 5.0 castanho claro (Koleston) + OX 20 vol.',
   '00000000-0000-0000-0000-0000000000a2', array['coloração', 'origem:anuncio']),
  ('00000000-0000-0000-0000-000000000001', 'Eliane Duarte',     '5566988880005', '1985-05-30',
   'Teste de mecha para progressiva: sem reação. Liberada para a química.',
   '00000000-0000-0000-0000-0000000000a1', array['química', 'origem:instagram']),
  ('00000000-0000-0000-0000-000000000001', 'Fernanda Moura',    '5566988880006', '1992-09-08',
   'Progressiva sem formol. Sumiu depois da última.',
   '00000000-0000-0000-0000-0000000000a2', array['química', 'origem:passou_na_frente']),
  ('00000000-0000-0000-0000-000000000001', 'Gabriela Teixeira', '5566988880007', '1996-12-14',
   'Mechas loiro mel. Hidratar a cada 15 dias para não quebrar.',
   '00000000-0000-0000-0000-0000000000a1', array['coloração', 'origem:instagram']),
  ('00000000-0000-0000-0000-000000000001', 'Helena Castro',     '5566988880008', '1989-04-03',
   'Prefere horário de manhã.',
   '00000000-0000-0000-0000-0000000000a2', array['vip', 'origem:instagram']),
  ('00000000-0000-0000-0000-000000000001', 'Isadora Lopes',     '5566988880009', '1993-08-21',
   'ALÉRGICA A AMÔNIA. Mega hair de queratina, 150 g.',
   '00000000-0000-0000-0000-0000000000a1', array['alergia', 'mega hair', 'origem:facebook']),
  ('00000000-0000-0000-0000-000000000001', 'Juliana Prado',     '5566988880010', null,
   null,
   null, array['origem:instagram']);

-- Atendimentos. "dias" = quantos dias atrás (negativo = no futuro).
-- Quando o status é 'realizado', o banco calcula sozinho o retorno previsto.
insert into agendamentos (empresa_id, cliente_id, servico_id, profissional_id, inicio, status, origem, valor)
select c.empresa_id, c.id, s.id, c.profissional_preferida_id,
       ((hoje_cuiaba() - a.dias) + time '10:00') at time zone 'America/Cuiaba',
       a.status, a.origem, case when a.status = 'realizado' then s.preco end
from (values
  -- Aline: hidratação há 10 dias -> volta em 5 dias (retorno chegando)
  ('5566988880001', 'Hidratação',             10, 'realizado', 'manual'),
  ('5566988880001', 'Hidratação',             25, 'realizado', 'manual'),
  -- Bianca: aplicou mega hair há 50 dias -> manutenção atrasada
  ('5566988880002', 'Mega hair (aplicação)',  50, 'realizado', 'manual'),
  -- Cláudia: fez retoque de raiz há 25 dias -> volta para o retoque em 5 dias
  ('5566988880003', 'Retoque de raiz',        25, 'realizado', 'manual'),
  ('5566988880003', 'Retoque de raiz',        55, 'realizado', 'manual'),
  -- Daniela: pintou o cabelo há 12 dias -> retoque daqui a 18 dias (em dia)
  ('5566988880004', 'Coloração',              12, 'realizado', 'ia'),
  -- Eliane: teste de mecha ontem -> volta em 2 dias para a progressiva
  ('5566988880005', 'Teste de mecha',          1, 'realizado', 'manual'),
  -- Fernanda: progressiva há 100 dias e nunca mais veio (inativa)
  ('5566988880006', 'Progressiva',           100, 'realizado', 'manual'),
  -- Gabriela: mechas há 30 dias (ok) + hidratação há 20 dias (atrasada)
  ('5566988880007', 'Mechas / luzes',         30, 'realizado', 'manual'),
  ('5566988880007', 'Hidratação',             20, 'realizado', 'manual'),
  -- Helena: corte e botox recentes + hidratação marcada pela IA daqui a 2 dias
  ('5566988880008', 'Corte feminino',         20, 'realizado', 'manual'),
  ('5566988880008', 'Botox capilar',          15, 'realizado', 'manual'),
  ('5566988880008', 'Hidratação',             -2, 'agendado',  'ia'),
  -- Isadora: manutenção do mega hair há 44 dias -> próxima manutenção amanhã
  -- (a aplicação não entra aqui: o retorno dela ficaria "atrasado" mesmo com a manutenção feita)
  ('5566988880009', 'Manutenção mega hair',   89, 'realizado', 'manual'),
  ('5566988880009', 'Manutenção mega hair',   44, 'realizado', 'manual')
) as a(telefone, servico, dias, status, origem)
join clientes c on c.empresa_id = '00000000-0000-0000-0000-000000000001' and c.telefone = a.telefone
join servicos s on s.empresa_id = c.empresa_id and s.nome = a.servico;

-- Juliana só conversou com a IA (ainda não veio: "sem visita")
insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, criado_em)
select c.empresa_id, c.id, m.direcao, m.autor, 'texto', m.conteudo, now() - interval '3 hours' + make_interval(mins => m.ordem)
from clientes c
cross join (values
  (1, 'entrada', 'cliente', 'Oi! Quanto custa o mega hair?'),
  (2, 'saida',   'ia',      'Oi, Juliana! 😊 A aplicação de mega hair começa em R$ 1.200. Quer agendar uma avaliação gratuita?')
) as m(ordem, direcao, autor, conteudo)
where c.empresa_id = '00000000-0000-0000-0000-000000000001' and c.telefone = '5566988880010';

-- A dona já mandou um "alô" para a Bianca (manutenção atrasada) e para a Fernanda (sumida)
insert into contatos (empresa_id, cliente_id, tipo, canal, resultado, mensagem, criado_em)
select c.empresa_id, c.id, x.tipo, 'manual', x.resultado, x.mensagem, now() - make_interval(days => x.dias)
from (values
  ('5566988880002', 'retorno',    'pendente',     'Oi Bianca! Já está na hora da manutenção do seu mega hair 💛', 1),
  ('5566988880006', 'reativacao', 'sem_resposta', 'Oi Fernanda! Que saudade de você aqui no salão 💛',           6)
) as x(telefone, tipo, resultado, mensagem, dias)
join clientes c on c.empresa_id = '00000000-0000-0000-0000-000000000001' and c.telefone = x.telefone;

-- Confere o resultado: as 10 fictícias com o status calculado pelo banco
select nome, status, retorno_previsto, proximo_agendamento
from clientes_status
where empresa_id = '00000000-0000-0000-0000-000000000001' and telefone like '5566988880%'
order by nome;
