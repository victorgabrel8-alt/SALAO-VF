# Instruções para o Claude neste projeto

## A Gleide está no ar
O Salão Toda Bonita (Gleide, empresa `00000000-0000-0000-0000-000000000001`) atende clientes reais com
anúncio rodando. Nada do que ela usa pode quebrar.
- Deploy no n8n (`node montar-workflow.js --enviar`) só quando o Victor pedir uma mudança na IA dela.
- Banco: só mudança que soma (coluna nova com valor padrão, tabela nova, função nova).
- O app (`crm`) só chega no celular quando alguém publica a branch `deploy-cloudflare`.
- Plano de várias lojas: `docs/PLANO-VARIAS-LOJAS.md`.

## Loja Teste
Empresa só para testes: **Loja Teste (não apagar)**, id `ff4b7937-1abb-4803-83c8-e0896d94fc9f`,
nicho manicure, `config.teste = true`, sem WhatsApp.
- A automação da Gleide não enxerga esta loja: todos os workflows filtram pelo `EMPRESA_ID` dela.
- Login de teste: um usuário criado pelo Victor no Supabase (Authentication), ligado **só** a esta loja em
  `usuarios_empresa`. Nunca ligar esse login à empresa da Gleide.
- Dados criados em teste podem ser apagados; a loja em si fica.
- Quando o conjunto de IA por loja existir (plano, fase 5), a IA de teste usa esta loja e um número de
  WhatsApp de teste, nunca o número do salão.

## Construir e testar
Trabalhar parte por parte. Depois de cada parte pronta, chamar um **subagente testador** antes de seguir:
- O testador **não edita código do app, do n8n nem do banco**. Ele só testa e devolve a lista do que
  achou (o que quebrou, como reproduzir). Quem corrige é o agente principal.
- O testador usa a Loja Teste: app rodando local (`.claude/launch.json`, "crm" na porta 3000) com o login de
  teste, consultas de leitura no banco e mudanças de teste dentro de transação desfeita no fim.
- O testador nunca manda mensagem de WhatsApp, nunca faz deploy no n8n e nunca mexe em dados da Gleide.
- Só seguir para a próxima parte (e só fazer deploy) com o teste passando. O que não deu para testar é
  dito ao Victor com todas as letras.

## Jeito de trabalhar
- Os workflows do n8n são gerados pelo código em `n8n/demo-agente` (`montar-workflow.js` e os
  `*-workflows.js`); nunca editar pela tela do n8n.
- `n8n/demo-agente/.env` tem as chaves: nunca mostrar nem commitar.
- Preços: a fonte é a tabela `servicos` do app; o prompt nunca pode ter valor diferente do app.
- Mensagens de commit e PR em português simples. Merge na main é autorizado pelo Victor.
