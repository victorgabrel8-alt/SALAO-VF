-- Cenário de teste da assistente da Gleide (banco local "salao_teste", NUNCA no Supabase de produção).
-- Rodar depois de 001, 003, 002 e 004. Pode rodar de novo: apaga e recria só as clientes de teste.
-- Uso: ./recriar-banco-teste.sh (recria o banco inteiro, carrega este cenário e roda os testes)

\set empresa '00000000-0000-0000-0000-000000000001'
-- :gleide = número da Gleide, passado pelo recriar-banco-teste.sh (primeiro de ASSISTENTE_NUMEROS do .env)

update empresas
   set nome = 'Toda Bonita Mega Hair (teste)',
       config = config || jsonb_build_object('assistente_numeros', jsonb_build_array(:'gleide'))
 where id = :'empresa';

insert into profissionais (id, empresa_id, nome) values
  ('00000000-0000-0000-0000-0000000000e1', :'empresa', 'Gleide')
on conflict (id) do nothing;

-- serviços: os do supabase/manual/servicos_toda_bonita_RASCUNHO.sql (o recriar-banco-teste.sh carrega antes)

delete from clientes where empresa_id = :'empresa'
   and telefone in ('5566911112222', '5566933334444', '5566955556666', '5566977778888');

insert into clientes (empresa_id, nome, telefone) values
  (:'empresa', 'Juliana Souza', '5566911112222'),
  (:'empresa', 'Carla Mendes',  '5566933334444'),
  (:'empresa', 'Ana Lima',      '5566955556666'),
  (:'empresa', 'Juliana Prado', '5566977778888');

-- Juliana Souza: conversou com a IA (pré-avaliação) e fez a avaliação hoje, terminou há ~1h
select n8n_salvar_pre_avaliacao(:'empresa', '5566911112222', '{
  "comprimento_atual": "ombro", "comprimento_desejado": "cintura", "cor": "castanho escuro",
  "usa_mega": "false", "tecnica_interesse": "queratina", "orcamento": "até 3 mil",
  "ocasiao": "casamento da irmã", "resumo": "Quer chegar na cintura para o casamento da irmã, nunca usou mega."
}'::jsonb);
with ag as (
  insert into agendamentos (empresa_id, cliente_id, servico_id, profissional_id, inicio, status, origem)
  select :'empresa', id, (select id from servicos where empresa_id = :'empresa' and nome = 'Avaliação'), '00000000-0000-0000-0000-0000000000e1',
         now() - interval '90 minutes', 'agendado', 'ia'
    from clientes where telefone = '5566911112222'
  returning id
)
select n8n_vincular_avaliacao(:'empresa', id) from ag;

-- Carla Mendes: avaliou semana passada, ficou "pensando", combinou de chamar hoje
insert into avaliacoes (empresa_id, cliente_id, resultado, tecnica_indicada, gramas, valor_orcado,
                        proximo_passo, data_proximo_passo, resultado_em)
select :'empresa', id, 'pensando', 'queratina', 100, 2400, 'chamar depois do pagamento',
       hoje_cuiaba(), now() - interval '6 days'
  from clientes where telefone = '5566933334444';

-- Ana Lima: manutenção hoje, já terminou e continua "agendado"
insert into agendamentos (empresa_id, cliente_id, servico_id, profissional_id, inicio, status, origem)
select :'empresa', id, (select id from servicos where empresa_id = :'empresa' and nome = 'Manutenção – tela adesiva'), '00000000-0000-0000-0000-0000000000e1',
       now() - interval '3 hours', 'agendado', 'manual'
  from clientes where telefone = '5566955556666';

select tipo, nome, inicio from pendencias_gleide order by tipo;
