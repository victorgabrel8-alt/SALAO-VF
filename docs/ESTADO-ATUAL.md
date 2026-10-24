# Estado atual do projeto SALAO-VF (oistudio)

Atualizado em 24/10/2026. Este arquivo não tem senhas nem chaves; elas ficam só no `.env` do PC.

## O que é

Atendimento por WhatsApp com IA para o salão Toda Bonita Mega Hair (dona: Gleide), mais um app/CRM para a dona. A entrega para a cliente é na segunda, 26/10.

- Repositório: github.com/victorgabrel8-alt/SALAO-VF. Tudo na branch `main` (o PR #9 juntou o trabalho do VPS).
- Equipe: Victor e José Paulo (mexe no app e no prompt pela `main`).

## Infraestrutura (já no ar)

- VPS Hostinger KVM 2 (IP 179.236.83.253) com Easypanel, projeto `salao-vf`:
  - Serviço `oistudio-app` (tipo App): o app `crm/` (Next.js, PWA) em https://app.oistudio.com.br. Fonte: Git, ramo `main`, caminho `/crm`, build por Dockerfile, porta 3000.
  - Serviço `ia` (tipo Compose): n8n 2.43.7 + Evolution API 2.3.7 + Postgres 16 + Redis 7, em https://n8n.oistudio.com.br (porta 5678) e https://evo.oistudio.com.br (porta 8080).
- DNS na Hostinger: registros A `app`, `n8n` e `evo` apontando para o IP do VPS.
- Banco/CRM: Supabase na nuvem, projeto `zgbzyzsqpkqvwkquofpn`, empresa "Salão Toda Bonita", `EMPRESA_ID=00000000-0000-0000-0000-000000000001`. Os 3 áudios prontos da Gleide estão no Storage (bucket `audios`).
- IA: Gemini (chave do AI Studio), configurada como credencial no n8n.
- WhatsApp: conectado pela Evolution (QR code) no número 556696795639. `NUMEROS_PERMITIDOS` está vazio, então a IA responde qualquer número.

## Decisões tomadas

- A IA usa a agenda do app (Supabase, tabela `agendamentos`) e não usa mais a Google Agenda. Não precisa de Google Cloud.
- A resposta sai numa mensagem só:
  - a IA espera 20 s sem mensagem nova para juntar a rajada;
  - responde com um parágrafo por assunto;
  - se o Gemini falhar, tenta de novo e, em último caso, pede para a cliente repetir.
- Preços como base aproximada ("em torno de…, a Gleide confirma"), mudança do José Paulo.
- No Easypanel, a aba Ambiente NÃO funciona para o Compose: as variáveis chegavam vazias. Por isso, o compose do serviço `ia` é colado já com os valores na aba Fonte → docker-compose.yml. Quem gera esse arquivo é o `recuperar.sh`, a partir do modelo `docker-compose.easypanel.yml` da raiz.
- A chave do Supabase usada é a `service_role` da aba Legacy (começa com `eyJ`). A chave nova `sb_secret_` não funciona nos workflows.
- API oficial da Meta: só depois da entrega. Por enquanto continua a Evolution.
- Vários studios também ficam para depois: o Supabase e o app já são multiempresa, mas a IA está montada para um studio.

## Como atualizar

- Mudou o app (`crm/`): Easypanel → oistudio-app → Implantar.
- Mudou a IA (prompt `n8n/demo-agente/prompt-agente.md` ou workflows): no Git Bash do PC:

  ```bash
  cd ~/SALAO-VF/n8n/demo-agente && git pull origin main && node montar-workflow.js --enviar --ativar
  ```

  Os workflows são gerados por código (`montar-workflow.js` e os outros `*-workflows.js`). Não se edita pela tela do n8n.
- Mudou alguma variável do servidor: Easypanel → ia → Fonte → editar o compose → Salvar → Implantar.
- Recuperar tudo do zero (PC novo ou VPS novo): `bash recuperar.sh`. O passo a passo está em `n8n/demo-agente/RECUPERACAO.md`.
- O `.env` fica no PC (`n8n/demo-agente/.env`, fora do Git) e guarda as chaves, os IDs das credenciais do n8n e a `N8N_API_KEY`. Precisa de cópia fora do PC.

## Pendências

- [ ] Confirmar se `node montar-workflow.js --enviar --ativar` foi rodado depois das últimas mudanças, e testar no WhatsApp a resposta única (3 mensagens seguidas devem virar 1 resposta).
- [ ] Trocar o Ramo do oistudio-app no Easypanel para `main` (se ainda não trocou) e Implantar.
- [ ] No Git Bash: `git checkout main && git pull origin main`.
- [ ] Supabase → Authentication → URL Configuration → Site URL `https://app.oistudio.com.br`.
- [ ] Criar o login da dona no app. Hoje só existe o do Victor ligado ao salão em `usuarios_empresa`.
- [ ] Backup do `.env` (Drive ou pendrive).
- [ ] Se a Gleide marcava horários na Google Agenda, passar esses horários para o app, porque a IA não enxerga mais o Google.
- [ ] Definir `NUMEROS_PERMITIDOS` se o número conectado não for exclusivo do salão.
- [ ] Itens de `docs/CHECKLIST-ENTREGA.md`: dados reais do salão (serviços, preços, duração, retornos), backup semanal do Supabase, monitor de disponibilidade.
- [ ] Ainda não confirmado: no primeiro teste, uma pergunta de preço sumiu (possível erro do Gemini ou do áudio pronto). A correção já protege esse caso, mas vale olhar em n8n → Executions se aparecer erro.
