# Demo – Agente de IA no WhatsApp (Toda Bonita Mega Hair)

Roda 100% local: **n8n + Evolution API v2 + Postgres + Redis** no Docker Desktop.

| Serviço   | Endereço no seu PC              | Endereço dentro do Docker |
|-----------|----------------------------------|---------------------------|
| n8n       | http://localhost:5678            | http://n8n:5678           |
| Evolution | http://localhost:8080 (`/manager`) | http://evolution:8080   |
| Postgres  | (não exposto)                    | postgres:5432             |
| Redis     | (não exposto)                    | redis:6379 (n8n usa db 0, Evolution db 6) |

---

## Fase 1 – Subir tudo e conectar o WhatsApp

### 0. Pré-requisito no Windows (só uma vez)
O Docker precisa do hipervisor do Windows ligado. Se o Docker Desktop disser
*"Windows hypervisor is not running"*, abra o **PowerShell como Administrador** e rode,
um por vez:

```powershell
dism /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart
dism /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart
bcdedit /set hypervisorlaunchtype auto
```
Depois **reinicie o Windows** e abra o Docker Desktop (espere "Engine running").

### 1. Configurar o `.env`
```bash
cp .env.example .env
```
Preencha as senhas/chaves com valores aleatórios longos (ex.: `openssl rand -hex 24`).
O `.env` está no `.gitignore` – nunca versione.

### 2. Subir os containers
```bash
docker compose up -d
docker compose ps
```
Teste: http://localhost:8080 deve responder `Welcome to the Evolution API`.

### 3. Criar a instância do WhatsApp (já com o webhook)
(Git Bash, dentro da pasta `agente-whatsapp`)
```bash
set -a; . ./.env; set +a
curl -s -X POST localhost:8080/instance/create \
  -H "apikey: $EVOLUTION_API_KEY" -H 'Content-Type: application/json' \
  -d "{\"instanceName\":\"$EVOLUTION_INSTANCE\",\"integration\":\"WHATSAPP-BAILEYS\",\"qrcode\":true,\"groupsIgnore\":true,
       \"webhook\":{\"url\":\"http://n8n:5678/webhook/whatsapp-salao\",\"byEvents\":false,\"base64\":true,\"events\":[\"MESSAGES_UPSERT\"]}}"
```
- `base64: true` faz o áudio já chegar embutido no webhook.
- O webhook usa `http://n8n:5678` porque a Evolution fala com o n8n pela rede Docker.

### 4. Ler o QR code
Mais fácil pelo painel: http://localhost:8080/manager
→ Server URL `http://localhost:8080` → API Key = `EVOLUTION_API_KEY` do `.env`
→ instância **salao-demo** → *Get QR Code*.
No celular: WhatsApp → **Dispositivos conectados** → **Conectar dispositivo**.

> Se o WhatsApp disser *"não é possível conectar novos dispositivos no momento"*:
> confira se já não há 4 aparelhos conectados, atualize o app, espere 1–2 h
> sem tentar, ou conecte por código de pareamento
> (`GET /instance/connect/salao-demo?number=55DDDNUMERO`).

Conferir conexão:
```bash
curl -s localhost:8080/instance/connectionState/$EVOLUTION_INSTANCE -H "apikey: $EVOLUTION_API_KEY"
# esperado: "state":"open"
```

### 5. n8n: conta e chave de API
1. http://localhost:5678 → crie a conta de dono (fica só local).
2. Ignore a janela "Connect a model" (assistente pago do n8n) – feche no X.
3. http://localhost:5678/settings/api → **Create an API key** (sem expiração).
4. No `.env`, numa **linha própria** (não numa linha que começa com `#`):
   `N8N_API_KEY=eyJ...`

### 6. Testar o webhook
Com um workflow ativo contendo um nó **Webhook** (POST, path `whatsapp-salao`),
mande uma mensagem **de outro celular** para o seu número.
Em n8n → *Executions* deve aparecer uma execução com
`event: messages.upsert`, `fromMe: false` e o texto em `message.conversation`.

---

## Fase 2 – Agente respondendo texto

### Fluxo
`Webhook` → `Extrair dados` → `Filtro` (só `messages.upsert`, sem grupo/status, sem `fromMe`,
só texto, só números de `NUMEROS_PERMITIDOS`) → **buffer Redis 10 s** (`buffer:{tel}` + `buffer_ultima:{tel}`;
só a última mensagem da rajada segue; trava `processando:{tel}` impede duas respostas em paralelo para a mesma pessoa) → `Marcar como lida` → `Agente IA` (Gemini Flash +
memória Redis `memoria:{tel}`, 12 mensagens, expira em 24 h) → `Quebrar mensagens` (até 3 balões)
→ laço `Digitando...` (sendPresence, ~45 ms/caractere, 1,5–6 s) → `Enviar mensagem`.

### Montar / atualizar o workflow
O workflow é gerado por script a partir do `prompt-agente.md`:
```bash
node montar-workflow.js                     # só gera workflow-demo-salao.json
node montar-workflow.js --enviar --ativar   # gera e cria/atualiza no n8n via API
```
Sem API? Importe `workflow-demo-salao.json` em n8n → *Workflows → Import from file* e
selecione as credenciais nos nós Redis e Gemini.

### Credenciais no n8n
- **Redis local**: host `redis`, porta `6379`, db `0`, sem senha.
- **Gemini**: crie a chave em https://aistudio.google.com/apikey → no nó *Gemini Flash* →
  *Create new credential* → cole a API Key → Save. Anote o ID em `N8N_GEMINI_CRED_ID` no `.env`.

### Trava de segurança
`NUMEROS_PERMITIDOS` no `.env` (separados por vírgula). Só esses números recebem resposta.
Deixe vazio para responder a todos. Depois de mudar: `docker compose up -d n8n`.

---

## Fase 3 – Google Agenda

### Google Cloud Console (feito à mão, uma vez)
1. https://console.cloud.google.com → crie/selecione um projeto (ex.: `SALAO`).
2. **APIs e serviços → Biblioteca → Google Calendar API → Ativar.**
   (Sem isso o erro é `Google Calendar API has not been used in project ...`.)
3. **APIs e serviços → Tela de permissão OAuth → Começar**: nome do app, e-mail, público **Externo**,
   contato, concordar → Criar.
4. **Público-alvo → Usuários de teste → Add users** → seu Gmail.
   (Sem isso o erro é `403 access_denied – não concluiu o processo de verificação`.)
5. **Clientes → Criar cliente → Aplicativo da Web** → URI de redirecionamento:
   `http://localhost:5678/rest/oauth2-credential/callback` → Criar → copie ID e chave secreta.

### n8n
1. http://localhost:5678/home/credentials → **Create credential → Google Calendar OAuth2 API**.
2. Cole Client ID e Client Secret → **Sign in with Google** → Continuar (app não verificado) →
   permitir → deve aparecer **Account connected** → Save.
3. Rode `node montar-workflow.js --enviar --ativar` (ele pega o ID da credencial em `N8N_GCAL_CRED_ID`).

> App em modo teste: o Google expira o login a cada 7 dias. Se a agenda parar de responder,
> abra a credencial e clique em *Sign in with Google* de novo.

### Como funciona
- Subworkflow **Agenda Salão (ferramentas do agente)** (`workflow-agenda-salao.json`), chamado pelas tools
  `consultar_horarios_livres`, `criar_agendamento`, `ver_agendamentos`, `remarcar_agendamento` e
  `cancelar_agendamento` do Agente IA. **Precisa estar ativo (publicado).**
- Remarcar = o MESMO evento muda de horário (PATCH); cancelar = DELETE. Os eventos da cliente são achados
  pelo telefone dela, que fica na descrição de todo evento criado pela IA.
- Usa a API do Google (freeBusy + events.insert) com a credencial OAuth.
- O evento leva no título `Serviço - Nome | motivo` e na descrição nome, telefone, serviço e
  "O que a cliente quer" (ex.: "comprar cabelo vietnamita 60 cm", "selagem - cabelo ressecado"),
  resumido pela IA a partir da conversa.
- Regras de horário em `agenda-calculo.js` (manter igual ao prompt):
  todos os dias: seg–sex 09–12 e 13–18, sáb e dom 08–14, grade de 30 min, 1 h de antecedência.
- `GOOGLE_CALENDAR_ID` no `.env`: `primary` (agenda principal) ou o ID de uma agenda dedicada
  (Configurações da agenda → Integrar agenda → ID da agenda).

---

## Fase 4 – Áudio e transferência para humano

### Áudio e fotos
`Filtro` aceita `audioMessage` e `imageMessage` → `Baixar mídia (Evolution)` (`POST /chat/getBase64FromMediaMessage`)
→ `Entender mídia (Gemini)` (API `generateContent` com a mesma credencial do Gemini): transcreve áudio
ou descreve a foto (cor, comprimento, tipo de fio, estilo). A legenda da foto também entra.
→ o texto entra no buffer como `[áudio] ...` ou `[foto da cliente] ...`. Se falhar, vira `[áudio que não consegui ouvir]` ou
`[foto da cliente que não consegui ver]` e o
agente pede para a cliente repetir ou escrever.

### Pausa (Redis `pausa:{telefone}`, 12 h)
A IA não responde enquanto a chave existir. Ela é checada na entrada **e** de novo depois do buffer
de 8 s (para não atropelar uma resposta sua feita nesse intervalo).

| Quem pausa | Como |
|---|---|
| A cliente pede humano / reclama / sai do escopo | O agente chama a tool `transferir_para_humano` (subworkflow **Pausar IA**) e responde "Vou chamar alguém da equipe pra te ajudar 😊" |
| Você responde pelo celular | Todo `messages.upsert` com `fromMe` é sua resposta manual (as mensagens enviadas pela IA via API não geram esse evento) |

**Devolver para a IA:** envie `#ia` na conversa (do seu celular). A cliente também vê o `#ia`.
Ou pelo terminal:
```bash
docker exec demo-salao-redis-1 redis-cli DEL pausa:5566XXXXXXXXX
```
Ver quem está pausado:
```bash
docker exec demo-salao-redis-1 redis-cli --scan --pattern 'pausa:*'
```

---

## Arquivos

| Arquivo | O que é |
|---|---|
| `docker-compose.yml` | n8n + Evolution + Postgres + Redis |
| `.env.example` | Modelo das variáveis (o `.env` real não é versionado) |
| `prompt-agente.md` | Prompt de sistema do agente (fonte da verdade) |
| `agenda-calculo.js` | Regras de horário de funcionamento e cálculo de vagas |
| `montar-workflow.js` | Gera os JSONs e publica tudo no n8n (`--enviar --ativar`) |
| `workflow-demo-salao.json` | Workflow principal (importável) |
| `workflow-agenda-salao.json` | Subworkflow das tools de agenda |
| `workflow-pausa-salao.json` | Subworkflow da transferência para humano |
| `crm-schema.sql`, `crm-workflows.js` | CRM: tabela e workflows (tool anotar_no_crm + painel) |
| `workflow-crm-salao.json`, `workflow-crm-painel.json` | Subworkflow do CRM e painel web |
| `layout-n8n.js` | Posições dos nós e notas coloridas no n8n |
| `vigia.sh` | Vigia: reabre Docker/containers/WhatsApp se caírem |

Importando à mão (sem a API): importe primeiro os dois subworkflows, ative-os, depois importe o
principal e, nos nós `consultar_horarios_livres`, `criar_agendamento` e `transferir_para_humano`,
selecione o subworkflow correspondente. Selecione também as credenciais (Redis, Gemini, Google).

---

## Fase 5 – Cenários de teste (resultado)

| Cenário | Resultado |
|---|---|
| Preço de serviço que existe (queratina) | ✅ R$ 650 de mão de obra, cabelo à parte, oferece avaliação |
| Serviço que não existe (unha em gel) | ✅ "Trabalhamos só com cabelo" + oferece os serviços |
| 3 mensagens seguidas rápidas | ✅ Uma resposta só (buffer 10 s + trava por conversa) |
| Amanhã à tarde + confirmar | ✅ Oferece as faixas livres; confirma nome e horário; cria evento |
| Hora fora do expediente (sábado 16h, 12h almoço, 18h) | ✅ Explica e oferece o horário possível mais próximo |
| Áudio pedindo horário | ✅ Transcreve e consulta a agenda |
| "Quero falar com a dona" / reclamação / fora do escopo | ✅ Transfere e pausa 12 h (reclamação com acolhimento) |
| Eu respondo manualmente pelo celular | ✅ Pausa 12 h; `#ia` devolve |

---

## Checklist do dia da demo

1. Abra o **Docker Desktop** e espere "Engine running". Os containers sobem sozinhos
   (`restart: unless-stopped`). Se não subirem: `docker compose up -d`.
2. Confira o WhatsApp conectado:
   `curl -s localhost:8080/instance/connectionState/salao-demo -H "apikey: $EVOLUTION_API_KEY"` → `"state":"open"`.
3. Confira o Google: abra a credencial do Google Calendar no n8n. Se pedir, clique em
   *Sign in with Google* (em modo teste o login expira a cada 7 dias).
4. **Quem pode conversar com a IA**: coloque o número da Gleide (e o seu de teste) em
   `NUMEROS_PERMITIDOS` no `.env`, separados por vírgula, e rode `docker compose up -d n8n`.
   Evite deixar vazio no seu número pessoal, senão todos os seus contatos recebem resposta da IA.
5. Limpe a memória/pausa de quem vai testar (começa a conversa do zero):
   `docker exec demo-salao-redis-1 redis-cli DEL memoria:55DDDNUMERO pausa:55DDDNUMERO`
6. Apague da agenda os eventos de teste antigos.

Roteiro sugerido para mostrar à Gleide: perguntar preço → pedir horário para amanhã → mandar um
áudio → pedir para falar com a dona → você responde pelo celular → `#ia`.

---

## CRM

Ficha automática por cliente no Postgres (banco `crm`, tabela `clientes` – ver `crm-schema.sql`)
e um painel web em colunas.

**Painel:** http://localhost:5678/webhook/crm
(no celular, na mesma rede Wi-Fi do PC: `http://IP-DO-PC:5678/webhook/crm`, ex. `http://192.168.0.111:5678/webhook/crm`
– se não abrir, o Firewall do Windows está bloqueando a porta 5678.)

| Etapa | Quem muda |
|---|---|
| **Novo** | 1ª mensagem da cliente (automático) |
| **Em conversa** | 2ª mensagem em diante; também ao cancelar um horário |
| **Agendado** | IA criou/remarcou na agenda e o Google confirmou |
| **Com humano** | IA transferiu (motivo vai pro resumo) |
| **Atendido / Perdido** | Gleide, no painel |

- A IA preenche **interesse** e **resumo** com a tool `anotar_no_crm` (em silêncio).
- No painel a Gleide muda a etapa e escreve **anotações** (botão Salvar).
- Workflows: `CRM (anotações do agente)` (subworkflow da tool) e `CRM - Painel` (GET `/webhook/crm`,
  POST `/webhook/crm-salvar`). Nós `CRM: …` foram adicionados no principal, na agenda e na pausa.
- Código em `crm-workflows.js`; publicado junto pelo `node montar-workflow.js --enviar --ativar`.
- Credencial no n8n: **CRM Postgres** (host `postgres`, banco `crm`) → ID em `N8N_CRM_CRED_ID`.

Consultar direto no banco:
```bash
docker exec demo-salao-postgres-1 psql -U evolution -d crm -c "SELECT nome, telefone, etapa, interesse, agendamento FROM clientes ORDER BY ultimo_contato DESC"
```

---

## Assistente da Gleide (teste local)

Plano: `docs/PLANO-IA-ALIMENTA-CRM.md` (Camada 2). Banco: `supabase/004_avaliacoes_ia_RASCUNHO.sql`.

- **Banco de teste:** `./recriar-banco-teste.sh` recria o banco `salao_teste` no Postgres do docker
  (001 + 003 + 002 + 004), carrega o cenário (`teste-assistente.sql`: Juliana com avaliação sem resultado,
  Ana e Joana com atendimento sem status, Carla "pensando") e roda os testes do 004 (`teste-004-funcoes.sql`).
- **No `.env`:** `ASSISTENTE_NUMEROS` (número que faz o papel da Gleide) e `N8N_ASSISTENTE_PG_CRED_ID`
  (credencial Postgres "Salão teste (004)" no n8n, apontando para `salao_teste`). Depois: `docker compose up -d n8n`.
- **Montar:** `node montar-workflow.js --enviar --ativar` cria `Assistente da Gleide`, `Assistente - Ferramentas`
  e `Assistente - Pendências`, e coloca no principal o desvio "É a Gleide (assistente)?": mensagens desses
  números vão para a assistente, não para o atendimento.
- **Disparar as perguntas agora:** `curl localhost:5678/webhook/assistente-pendencias`
  (sozinho, roda a cada 15 min das 8h às 20h; não repete a mesma pendência por 3h).
- **Recomeçar a conversa:** `docker exec demo-salao-redis-1 redis-cli DEL assistente:<número>` e
  `delete from registros_ia where acao = 'perguntou'` no `salao_teste`.
- **Desligar:** deixe `ASSISTENTE_NUMEROS` vazio e `docker compose up -d n8n`: o número volta para o atendimento.

> No teste a assistente fala pelo **mesmo número da IA de atendimento**. Na produção ela precisa de um número
> próprio, porque a Gleide usa o WhatsApp Business do salão (ver o plano).
