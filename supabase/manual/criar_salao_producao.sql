-- =====================================================================
-- criar_salao_producao.sql — cadastra o salão REAL e dá acesso à dona
-- Rodar na integração (sexta), depois de apagar o demo.
--
-- ANTES: no painel do Supabase, Authentication → Users → Add user,
-- crie o login da dona (e-mail + senha) e copie o "User UID".
-- Troque tudo que está entre [COLCHETES].
-- =====================================================================

-- 1) Empresa
insert into empresas (nome, config) values (
  '[NOME DO SALÃO]',
  '{
    "dias_inativa": 90,
    "dias_retorno_chegando": 7,
    "endereco": "[ENDEREÇO]",
    "horario_funcionamento": {"seg": null, "ter": "09:00-19:00", "qua": "09:00-19:00", "qui": "09:00-19:00", "sex": "09:00-19:00", "sab": "08:00-17:00", "dom": null},
    "formas_pagamento": ["Pix", "Cartão", "Dinheiro"],
    "regras_ia": "[O QUE A IA NUNCA DEVE FAZER]",
    "mensagens": {
      "retorno": "Oi {nome}! Tudo bem? 😊 Já está chegando a hora do seu {servico}. Quer que eu veja um horário pra você?",
      "reativacao": "Oi {nome}! Que saudade de você aqui no salão 💛 Bora marcar um horário pra se cuidar?"
    }
  }'::jsonb
) returning id;   -- ANOTE ESTE ID: é o EMPRESA_ID usado no n8n e no CRM

-- 2) Acesso da dona ao CRM
insert into usuarios_empresa (user_id, empresa_id, papel)
values ('[USER UID DA DONA]', '[EMPRESA_ID]', 'dona');

-- 3) Profissionais
insert into profissionais (empresa_id, nome, google_calendar_id) values
  ('[EMPRESA_ID]', '[NOME PROFISSIONAL 1]', '[ID DA AGENDA GOOGLE]');

-- 4) Serviços (preço, duração em minutos, dias até o retorno; null = sem retorno)
insert into servicos (empresa_id, nome, preco, duracao_min, dias_retorno) values
  ('[EMPRESA_ID]', '[Corte feminino]', 0.00, 60, 45);
