-- =====================================================================
-- 002_seed_dev.sql — DADOS FALSOS para desenvolver o CRM
-- Cria o "Salão Demo" com profissionais, serviços, 30 clientes,
-- atendimentos em várias datas e conversas. Assim dá pra construir as
-- telas antes da IA gravar dados reais.
--
-- Para APAGAR tudo do demo (sexta, na integração), rode só:
--   delete from empresas where id = '00000000-0000-0000-0000-000000000001';
-- (apaga em cascata clientes, agendamentos, mensagens e contatos do demo)
-- =====================================================================

insert into empresas (id, nome, config) values (
  '00000000-0000-0000-0000-000000000001',
  'Salão Demo',
  '{
    "dias_inativa": 90,
    "dias_retorno_chegando": 7,
    "endereco": "Rua Exemplo, 123 - Sinop/MT",
    "horario_funcionamento": {"seg": null, "ter": "09:00-19:00", "qua": "09:00-19:00", "qui": "09:00-19:00", "sex": "09:00-19:00", "sab": "08:00-17:00", "dom": null},
    "formas_pagamento": ["Pix", "Cartão", "Dinheiro"],
    "mensagens": {
      "retorno": "Oi {nome}! Tudo bem? 😊 Já está chegando a hora do seu {servico}. Quer que eu veja um horário pra você?",
      "reativacao": "Oi {nome}! Que saudade de você aqui no salão 💛 Bora marcar um horário pra se cuidar?"
    }
  }'::jsonb
);

insert into profissionais (id, empresa_id, nome) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000001', 'Camila'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000001', 'Juliana');

insert into servicos (id, empresa_id, nome, preco, duracao_min, dias_retorno) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000001', 'Corte feminino',  80.00,  60,  45),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000001', 'Coloração',      180.00, 120,  30),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000001', 'Progressiva',    250.00, 180,  90),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-000000000001', 'Manicure',        35.00,  45,  15),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-000000000001', 'Escova',          50.00,  45,  null);

-- 30 clientes
insert into clientes (empresa_id, nome, telefone, aniversario, observacoes, profissional_preferida_id, etiquetas)
select
  '00000000-0000-0000-0000-000000000001',
  (array['Ana','Bruna','Carla','Daniela','Eduarda','Fernanda','Gabriela','Helena','Isabela','Joana',
         'Karina','Larissa','Mariana','Natália','Olívia','Patrícia','Rafaela','Sabrina','Tatiane','Vanessa',
         'Yasmin','Amanda','Beatriz','Camila','Débora','Elaine','Flávia','Giovana','Heloísa','Ingrid'])[i]
    || ' ' || (array['Silva','Souza','Oliveira','Santos','Lima','Pereira','Costa','Almeida','Rocha','Ferreira'])[1 + (i % 10)],
  '55669' || lpad((90000000 + i * 1371)::text, 8, '0'),
  make_date(1985 + (i % 20), 1 + (i % 12), 1 + (i % 27)),
  case when i % 7 = 0 then 'Alérgica a amônia' when i % 5 = 0 then 'Prefere horário de manhã' end,
  case when i % 2 = 0 then '00000000-0000-0000-0000-0000000000a1'::uuid else '00000000-0000-0000-0000-0000000000a2'::uuid end,
  case when i % 6 = 0 then array['vip'] else '{}' end
from generate_series(1, 30) as i;

-- 2 clientes que só conversaram com a IA (status "sem_visita")
insert into clientes (empresa_id, nome, telefone) values
  ('00000000-0000-0000-0000-000000000001', 'Priscila Nunes', '5566981110001'),
  ('00000000-0000-0000-0000-000000000001', null,             '5566981110002');

-- Atendimentos REALIZADOS no passado, em datas variadas
-- (gera clientes em todos os status: em dia, retorno chegando, atrasado, inativa)
insert into agendamentos (empresa_id, cliente_id, servico_id, profissional_id, inicio, status, origem, valor)
select
  c.empresa_id,
  c.id,
  s.id,
  c.profissional_preferida_id,
  date_trunc('day', now() at time zone 'America/Cuiaba') at time zone 'America/Cuiaba'
    - make_interval(days => d.dias_atras) + interval '10 hours',
  'realizado',
  'manual',
  s.preco
from (select c.*, row_number() over (order by c.telefone) as n from clientes c
      where c.empresa_id = '00000000-0000-0000-0000-000000000001'
        and c.telefone not like '55669811100%') c
join lateral (
  -- cada cliente tem 1 a 3 atendimentos passados
  select unnest(array[
    (c.n * 7) % 150 + 5,
    (c.n * 7) % 150 + 50,
    (c.n * 7) % 150 + 100
  ])::int as dias_atras,
  generate_series(1, 3) as k
) d on d.k <= 1 + (c.n % 3)
join servicos s on s.empresa_id = c.empresa_id
  and s.nome = (array['Corte feminino','Coloração','Progressiva','Manicure','Escova'])[1 + ((c.n + d.k) % 5)];

-- Agendamentos FUTUROS (uns marcados pela IA, outros manuais)
insert into agendamentos (empresa_id, cliente_id, servico_id, profissional_id, inicio, status, origem)
select
  c.empresa_id, c.id,
  '00000000-0000-0000-0000-0000000000b1',
  c.profissional_preferida_id,
  date_trunc('day', now() at time zone 'America/Cuiaba') at time zone 'America/Cuiaba'
    + make_interval(days => (c.n % 6)::int, hours => (9 + c.n % 8)::int),
  'agendado',
  case when c.n % 2 = 0 then 'ia' else 'manual' end
from (select c.*, row_number() over (order by c.telefone) as n from clientes c
      where c.empresa_id = '00000000-0000-0000-0000-000000000001') c
where c.n % 4 = 0;

-- Uma falta e um cancelamento, para testar os status
update agendamentos set status = 'faltou'
 where id = (select id from agendamentos where status = 'realizado'
              and empresa_id = '00000000-0000-0000-0000-000000000001' order by inicio desc limit 1);
update agendamentos set status = 'cancelado'
 where id = (select id from agendamentos where status = 'agendado'
              and empresa_id = '00000000-0000-0000-0000-000000000001' order by inicio limit 1);

-- Conversas com a IA (3 a 4 mensagens para 12 clientes)
insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, criado_em)
select c.empresa_id, c.id, m.direcao, m.autor, 'texto', m.conteudo,
       now() - make_interval(hours => (c.n * 3)::int) + make_interval(mins => m.ordem)
from (select c.*, row_number() over (order by c.telefone) as n from clientes c
      where c.empresa_id = '00000000-0000-0000-0000-000000000001') c
cross join (values
  (1, 'entrada', 'cliente', 'Oi, boa tarde! Quanto está o corte?'),
  (2, 'saida',   'ia',      'Oi! Boa tarde 😊 O corte feminino está R$ 80 e leva cerca de 1 hora. Quer que eu veja um horário pra você?'),
  (3, 'entrada', 'cliente', 'Quero sim, pode ser sábado de manhã?'),
  (4, 'saida',   'ia',      'Tenho sábado às 9h ou às 10h30 com a Camila. Qual fica melhor?')
) as m(ordem, direcao, autor, conteudo)
where c.n <= 12;

-- Duas clientes pediram atendimento humano (IA pausada) -> aparecem em "Precisam de você"
update clientes
   set ia_pausada_ate = now() + interval '10 hours', motivo_pausa = 'pediu_humano'
 where id in (select cliente_id from mensagens
               where empresa_id = '00000000-0000-0000-0000-000000000001'
               group by cliente_id order by min(criado_em) limit 2);

insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo)
select empresa_id, id, 'entrada', 'cliente', 'texto', 'Queria falar com a dona, por favor'
from clientes where motivo_pausa = 'pediu_humano'
  and empresa_id = '00000000-0000-0000-0000-000000000001';

-- Alguns contatos já feitos (botão "Mandar alô")
insert into contatos (empresa_id, cliente_id, tipo, canal, resultado, mensagem, criado_em)
select cs.empresa_id, cs.id,
       case when cs.status = 'inativa' then 'reativacao' else 'retorno' end,
       'manual',
       (array['sem_resposta', 'respondeu', 'pendente'])[1 + (row_number() over () % 3)::int],
       'Mensagem de exemplo',
       now() - interval '3 days'
from clientes_status cs
where cs.empresa_id = '00000000-0000-0000-0000-000000000001'
  and cs.status in ('inativa', 'retorno_atrasado')
limit 4;
