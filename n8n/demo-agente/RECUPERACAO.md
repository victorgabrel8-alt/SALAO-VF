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

## 1. O que você faz (o script pede na hora e abre as páginas certas)

1. **Instalar Git e Node.js** (uma vez). No PowerShell:
   `winget install Git.Git OpenJS.NodeJS.LTS` — depois feche e abra o terminal.
2. **Abrir o Docker Desktop** e esperar "Engine running".
3. **Baixar o projeto e rodar o script** (no Git Bash):
   ```bash
   cd ~ && git clone -b claude/gracious-ptolemy-2w5gr1 https://github.com/victorgabrel8-alt/SALAO-VF.git
   cd SALAO-VF/n8n/demo-agente && bash recuperar.sh
   ```
4. **Responder o que ele perguntar:**
   - seu número do WhatsApp e quem pode falar com a IA;
   - a chave `service_role` do Supabase (ele abre a página; clique em *Reveal* e copie);
   - a API key do Gemini (ele abre o AI Studio; use a que já existe ou crie outra);
   - o ID e uma chave secreta nova do cliente OAuth no Google Cloud (ele abre a página; confira a URI
     `http://localhost:5678/rest/oauth2-credential/callback` e clique em *Adicionar chave secreta*);
   - um e-mail e uma senha para o n8n (pode ser o mesmo login de antes).
5. **Google Agenda:** na página do n8n que ele abre, *Sign in with Google* → permitir → Save → Enter no terminal.
6. **WhatsApp:** no celular, desconecte o aparelho antigo em *Dispositivos conectados* e leia o QR code que ele abre.
7. **Guardar uma cópia do `.env`** fora do PC.

## 2. O que o script faz sozinho

- cria o `.env` com senhas novas e já preenche a URL do Supabase e o `EMPRESA_ID` do Salão Toda Bonita;
- confere se as chaves do Supabase e do Gemini funcionam antes de seguir;
- sobe os 4 containers e cria o banco `crm` local;
- cria a conta de dono do n8n e a API key;
- cria as credenciais **Redis local**, **CRM Postgres**, **Google Gemini(PaLM) Api account** e
  **Google Calendar account 2** e grava os IDs no `.env`;
- roda `node montar-workflow.js --enviar --ativar`: cria e ativa os 10 workflows com as credenciais novas;
- cria o `.env.local` do `crm/` e do `painel-crm/` (URL + anon key do Supabase);
- cria a instância do WhatsApp com o webhook do n8n e mostra o QR code.

Pode rodar quantas vezes quiser: o que já foi feito é pulado, e só pergunta o que ainda falta.
Se der erro, ele diz o que corrigir.

> Não importe os `workflow-*.json` à mão: eles apontam para os IDs de credencial do PC antigo.

App do CRM no PC (opcional): `cd ../../crm && npm install && npm run dev` → http://localhost:3000.

## 3. Conferir se voltou tudo

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

## 4. ElevenLabs

Não há referência ao ElevenLabs em nenhum arquivo do repositório: os "áudios prontos" que a IA envia são
gravações da Gleide guardadas no Supabase Storage (ver "Áudios prontos" no `README.md`), e isso continua
funcionando. Se havia um workflow ou nó do ElevenLabs montado só pela tela do n8n (sem commit), ele se perdeu
com o volume. Nesse caso: os áudios gerados continuam na sua conta do ElevenLabs (*History*); baixe os que
quiser reaproveitar e cadastre com `node cadastrar-audio.js arquivo.mp3 "tema" "quando usar"`.

## 5. Sobre o prompt

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
