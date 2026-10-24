# Recuperação num computador novo (sem o `docker_data.vhdx` antigo)

Os volumes do Docker do PC antigo se perderam. Este guia reconstrói tudo a partir do GitHub.
O script `recuperar.sh` faz a parte automática; o resto é o que só dá para fazer à mão
(contas, QR code, login no Google).

## O que se perdeu e o que NÃO se perdeu

| Onde ficava | Situação | O que fazer |
|---|---|---|
| Código, prompts, workflows (GitHub) | ✅ intacto | nada |
| **Supabase** (CRM: clientes, conversas, agenda, avaliações, áudios prontos no Storage) | ✅ intacto — fica na nuvem, não no PC | só pegar a URL e a chave de novo |
| **Google Agenda** (eventos marcados pela IA) | ✅ intacto — fica no Google | só refazer o login OAuth no n8n |
| Áudios prontos da Gleide | ✅ intactos — bucket `audios` do Supabase + `empresas.config.audios_prontos` | conferir (seção 7) |
| Credenciais do n8n (Gemini, Google, Redis, Postgres) | ❌ perdidas | o script recria (precisa das chaves) |
| Histórico de execuções do n8n | ❌ perdido | não tem volta (não afeta o funcionamento) |
| Redis: memória das conversas (`memoria:*`, expirava em 24 h) e pausas (`pausa:*`) | ❌ perdido | nada: a IA recomeça as conversas; o histórico de verdade está no Supabase |
| Sessão do WhatsApp na Evolution | ❌ perdida | ler o QR code de novo |
| Banco `crm` local (tabela `clientes`, legado) | ❌ perdido | o script recria vazio; o CRM real é o Supabase |
| ElevenLabs | ⚠️ não há nada dele no repositório | ver seção 8 |

## 1. Pré-requisitos no PC novo

- Docker Desktop rodando ("Engine running"). Se der *"Windows hypervisor is not running"*, ver Fase 1 do `README.md`.
- **Git Bash** e **Node.js 18+** (`node -v`).
- Clonar o repositório e abrir o Git Bash na pasta `n8n/demo-agente`.

## 2. Primeira rodada do script

```bash
bash recuperar.sh
```
Ele cria o `.env` (a partir do `.env.example`) com senhas novas e para pedindo os dados abaixo.
Rode de novo a cada vez que preencher algo: cada passo só faz o que ainda falta.

> **Guarde uma cópia do `.env` fora do PC** (gerenciador de senhas, pendrive). Foi a falta dele
> que tornou esta recuperação necessária. A `N8N_ENCRYPTION_KEY` não pode mudar depois de criada.

## 3. Preencher o `.env`

| Variável | De onde tirar |
|---|---|
| `MEU_NUMERO` | número que vai ler o QR code (55+DDD+número) |
| `NUMEROS_PERMITIDOS` | números que podem falar com a IA (vazio = todos — cuidado) |
| `ASSISTENTE_NUMEROS` | número da Gleide para a assistente (opcional) |
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SERVICE_KEY` | Supabase → Project Settings → API Keys → `service_role` / secret |
| `EMPRESA_ID` | Supabase → SQL Editor: `select id, nome from empresas;` |
| `GOOGLE_CALENDAR_ID` | `primary` ou o ID da agenda dedicada (Configurações da agenda → Integrar agenda) |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey (a antiga continua valendo se você tiver; senão crie outra) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ver abaixo |

**Google OAuth:** o projeto no Google Cloud Console continua existindo. Em
**APIs e serviços → Credenciais → (seu cliente Web)**:
- confira que a URI de redirecionamento é `http://localhost:5678/rest/oauth2-credential/callback`;
- copie o **ID do cliente**; se não tiver mais a **chave secreta**, clique em *Adicionar chave secreta*
  (o Google não mostra a antiga de novo).

Se o projeto não existir mais, refaça a Fase 3 do `README.md`.

## 4. Conta e API key do n8n

O script para e pede isso quando os containers estiverem no ar:
1. http://localhost:5678 → crie a conta de dono.
2. http://localhost:5678/settings/api → **Create an API key** (sem expiração).
3. No `.env`: `N8N_API_KEY=eyJ...` (numa linha própria).

## 5. Rodar até o fim

```bash
bash recuperar.sh
```
Com tudo preenchido ele:
1. sobe os 4 containers;
2. cria o banco `crm` local com `crm-schema.sql`;
3. cria a instância `EVOLUTION_INSTANCE` na Evolution já com o webhook `http://n8n:5678/webhook/whatsapp-salao`;
4. cria no n8n as credenciais **Redis local**, **CRM Postgres**, **Google Gemini(PaLM) Api account** e
   **Google Calendar account 2**, e grava os IDs novos em `N8N_*_CRED_ID` no `.env`;
5. roda `node montar-workflow.js --enviar --ativar`, que cria e ativa os 10 workflows já ligados às
   credenciais novas (os IDs antigos que estão nos JSONs do repositório não são usados).

> Não importe os `workflow-*.json` à mão: eles apontam para os IDs de credencial do PC antigo.
> O `montar-workflow.js` gera tudo com os IDs do `.env`.

## 6. Passos manuais finais

1. **Google Agenda:** n8n → *Credentials* → **Google Calendar account 2** → *Sign in with Google* →
   permitir → "Account connected" → Save.
   (App em modo teste expira o login a cada 7 dias; para a entrega, deixe o app OAuth **Em produção** —
   ver `docs/CHECKLIST-ENTREGA.md`.)
2. **WhatsApp:** no celular, em *Dispositivos conectados*, **desconecte o aparelho antigo** ("Toda Bonita").
   Depois http://localhost:8080/manager → Server URL `http://localhost:8080` → API Key = `EVOLUTION_API_KEY`
   do `.env` → instância → *Get QR Code* → ler no celular.
3. **App do CRM** (`crm/` e `painel-crm/`): copie `.env.local.example` para `.env.local` em cada um e preencha
   com a URL e a `anon key` do Supabase (Project Settings → API). `npm install` e `npm run dev`.

## 7. Conferir se voltou tudo

```bash
set -a; . ./.env; set +a
docker compose ps                                                     # 4 serviços "Up"
curl -s localhost:8080/instance/connectionState/$EVOLUTION_INSTANCE -H "apikey: $EVOLUTION_API_KEY"   # "state":"open"
curl -s "$SUPABASE_URL/rest/v1/empresas?id=eq.$EMPRESA_ID&select=nome,config->audios_prontos" \
  -H "apikey: $SUPABASE_SERVICE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_KEY"   # salão + lista de áudios prontos
```
- n8n → *Workflows*: 10 workflows, todos ativos.
- Mande uma mensagem de um número de `NUMEROS_PERMITIDOS` → n8n → *Executions* deve mostrar a execução e a IA responder.
- Peça um horário → o evento aparece na Google Agenda e no CRM.
- Mande um áudio → a IA transcreve e responde.
- Bateria completa: `node testes/bateria-ia.js recuperacao` (ver "Bateria de testes" no `README.md`).

## 8. ElevenLabs

Não há referência ao ElevenLabs em nenhum arquivo do repositório: os "áudios prontos" que a IA envia são
gravações da Gleide guardadas no Supabase Storage (ver "Áudios prontos" no `README.md`), e isso continua
funcionando. Se havia um workflow ou nó do ElevenLabs montado só pela tela do n8n (sem commit), ele se perdeu
com o volume. Nesse caso: os áudios gerados continuam na sua conta do ElevenLabs (*History*); baixe os que
quiser reaproveitar e cadastre com `node cadastrar-audio.js arquivo.mp3 "tema" "quando usar"`.

## 9. Sobre o prompt

O `montar-workflow.js` usa o prompt do bloco ```` ```text ```` de `prompt-agente.md` (versão **ENXUTA**
de 2026-10-22 — "mesmas regras da versão SPIN + áudios + dúvidas múltiplas, sem repetições"). É o mesmo que
estava rodando no workflow exportado. A versão completa está em
`System_Prompt_Toda_Bonita_SPIN_Audios_Duvidas_Multiplasvvvv_N8N.txt`; para usá-la, cole o texto dela no
bloco `text` do `prompt-agente.md` e rode `node montar-workflow.js --enviar --ativar`.

## Para não acontecer de novo

- Cópia do `.env` fora do PC (é o único arquivo importante que não vai para o Git).
- Depois de mexer em algo pela tela do n8n, exporte o workflow para esta pasta e faça commit.
- Opcional: backup do volume do n8n de vez em quando:
  `docker run --rm -v demo-salao_n8n_data:/d -v "$PWD":/b alpine tar czf /b/n8n_data.tgz -C /d .`
  (guarde o `.tgz` junto com o `.env`; sem a mesma `N8N_ENCRYPTION_KEY` as credenciais dele não abrem).
