# Demo – Agente de IA no WhatsApp (Toda Bonita Mega Hair)

Roda 100% local: **n8n + Evolution API v2 + Postgres + Redis** no Docker Desktop.

> **Computador novo / perdeu os volumes do Docker?** Siga [`RECUPERACAO.md`](RECUPERACAO.md) e rode `bash recuperar.sh`.

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
só texto, só números de `NUMEROS_PERMITIDOS`) → **buffer Redis 20 s** (`buffer:{tel}` + `buffer_ultima:{tel}`;
só a última mensagem da rajada segue; trava `processando:{tel}` impede duas respostas em paralelo para a mesma pessoa) → `Marcar como lida` → `Agente IA` (Gemini Flash +
memória Redis `memoria:{tel}`, últimas 20 trocas, expira em 7 dias) → `Quebrar mensagens` (uma mensagem só)
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

## Fase 3 – Agenda (a do app, sem Google)

A agenda é a tabela `agendamentos` do Supabase, a mesma que o app/CRM mostra. Não usa Google Agenda
(foi retirado em 23/10/2026): nada de credencial OAuth nem login que expira.

### Como funciona
- Subworkflow **Agenda Salão (ferramentas do agente)** (`workflow-agenda-salao.json`), chamado pelas tools
  `consultar_horarios_livres`, `criar_agendamento`, `ver_agendamentos`, `remarcar_agendamento` e
  `cancelar_agendamento` do Agente IA. **Precisa estar ativo (publicado).**
- Lê do Supabase: horários ocupados (agendado/realizado; falta libera o horário), horário de funcionamento e
  almoço do salão (`empresas.config`) e os horários futuros da cliente (pelo telefone).
- criar = grava em `agendamentos` com `origem = 'ia'` (o motivo vai em observações); remarcar = o MESMO
  agendamento muda de horário (com "Reagendado de …" nas observações); cancelar = `status = 'cancelado'`.
- A IA só ouve "AGENDADO / REMARCADO / CANCELADO" se o Supabase gravou; senão pede desculpas e transfere.
- Regras de horário em `agenda-calculo.js` (grade de 30 min, 1 h de antecedência, 7 dias de busca).

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
| `crm-schema.sql`, `crm-workflows.js` | CRM local: tabela e workflow da tool anotar_no_crm |
| `workflow-crm-salao.json` | Subworkflow do CRM |
| `layout-n8n.js` | Posições dos nós e notas coloridas no n8n |
| `vigia.sh` | Vigia: reabre Docker/containers/WhatsApp se caírem |
| `recuperar.sh`, `RECUPERACAO.md` | Reconstrói o ambiente num PC novo (containers, banco, instância, credenciais e workflows) |

Importando à mão (sem a API): importe primeiro os dois subworkflows, ative-os, depois importe o
principal e, nos nós `consultar_horarios_livres`, `criar_agendamento` e `transferir_para_humano`,
selecione o subworkflow correspondente. Selecione também as credenciais (Redis, Gemini).

---

## Fase 5 – Cenários de teste (resultado)

| Cenário | Resultado |
|---|---|
| Preço de serviço que existe (queratina) | ✅ R$ 650 de mão de obra, cabelo à parte, oferece avaliação |
| Serviço que não existe (unha em gel) | ✅ "Trabalhamos só com cabelo" + oferece os serviços |
| 3 mensagens seguidas rápidas | ✅ Uma resposta só (buffer 20 s + trava por conversa) |
| Amanhã à tarde + confirmar | ✅ Oferece as faixas livres; confirma nome e horário; grava o agendamento no app |
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
3. **Quem pode conversar com a IA**: coloque o número da Gleide (e o seu de teste) em
   `NUMEROS_PERMITIDOS` no `.env`, separados por vírgula, e rode `docker compose up -d n8n`.
   Evite deixar vazio no seu número pessoal, senão todos os seus contatos recebem resposta da IA.
4. Limpe a memória/pausa de quem vai testar (começa a conversa do zero):
   `docker exec demo-salao-redis-1 redis-cli DEL memoria:55DDDNUMERO pausa:55DDDNUMERO`
5. Apague no app os agendamentos de teste antigos.

Roteiro sugerido para mostrar à Gleide: perguntar preço → pedir horário para amanhã → mandar um
áudio → pedir para falar com a dona → você responde pelo celular → `#ia`.

---

## CRM

> O CRM de verdade é o app em `crm/` (Next.js + Supabase): http://localhost:3000.
> O painel web antigo do n8n (`/webhook/crm`) foi **removido** para não confundir.
>
> **Alô de retorno (CRM do José Paulo, tabela `contatos`):** quando a Gleide envia o alô pelo WhatsApp do salão,
> o n8n reconhece o texto (alô gravado nas últimas 2 h) e **não pausa a IA**. Quando a cliente responde, a ficha
> "Sobre esta cliente" traz o alô (últimos 14 dias) e a IA já oferece horários da manutenção. Teste: cenário `resposta-ao-alo`.

Ficha automática por cliente no Postgres local (banco `crm`, tabela `clientes` – ver `crm-schema.sql`),
que ainda recebe as anotações da IA:

- A IA preenche **interesse** e **resumo** com a tool `anotar_no_crm` (em silêncio).
- Workflow: `CRM (anotações do agente)` (subworkflow da tool). Nós `CRM: …` no principal, na agenda e na pausa.
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
  (sozinho, roda de 1 em 1 h das 8h às 20h; a mesma pendência é cobrada por no máximo 2 h: na hora, +1 h e +2 h).
- **Recomeçar a conversa:** `docker exec demo-salao-redis-1 redis-cli DEL assistente:<número>` e
  `delete from registros_ia where acao = 'perguntou'` no `salao_teste`.
- **Desligar:** deixe `ASSISTENTE_NUMEROS` vazio e `docker compose up -d n8n`: o número volta para o atendimento.

> No teste a assistente fala pelo **mesmo número da IA de atendimento**. Na produção ela precisa de um número
> próprio, porque a Gleide usa o WhatsApp Business do salão (ver o plano).

### O que a Gleide faz pelo WhatsApp (supabase/013)

Tudo o que ela faz no app, conversando com a assistente (texto ou áudio). Mesmas regras de horário do app
(expediente, almoço, dias sem atender, sem encavalar); se der problema, a assistente conta o motivo e só passa por
cima (`forcar`) se a Gleide mandar.

| Ela diz | Ferramenta |
|---|---|
| "passa a das 14:00 pra 14:40, atrasei" | `reagendar` (direto, sem pedir confirmação) → "Aviso ela?" → `avisar_cliente` |
| "atrasei 30 min, empurra todo mundo" | `atrasar_agenda` (mostra a lista antes) → "Aviso elas?" |
| "marca a Carla sexta 9h pra selagem" / "tem horário amanhã à tarde?" | `marcar_horario` / `horarios_livres` |
| "cancela a Ana" / "apaga esse horário, lancei errado" | `status_atendimento` cancelado / `excluir_horario` |
| "a Ana chegou" / "terminei a Ana, fez selagem também, 250" | `chegou` / `concluir` (serviço a mais no mesmo horário) |
| "não vou atender a Bia amanhã, pede pra remarcar" | `avisar_cliente` tipo remarcacao (a IA de atendimento remarca quando ela responder) |
| "dia 10 a 15 não atendo, viagem" | `bloquear_dias` (avisa quem já está marcada nesses dias) / `desbloquear_dias` |
| "pausa a IA da Joana" / "aniversário da Joana é 20/05" | `pausar_ia` / `editar_cliente` |

`avisar_cliente` grava o contato (`aviso` ou `remarcacao`) **antes** de enviar pela Evolution: o eco da mensagem bate
com ele em "É o alô do CRM?" e não pausa a IA da cliente; se ela responder, a IA de atendimento lê o aviso na ficha.
Testes: `teste-013-assistente.sql` (o `recriar-banco-teste.sh` já roda).

---

## Bateria de testes da IA (`testes/`)

Plano: `docs/PLANO-PROMPT-E-AUDIOS.md` (Fase 0). **Rodar sempre que mexer no prompt ou nos workflows.**

```bash
node testes/bateria-ia.js linha-de-base          # todos os cenários
node testes/bateria-ia.js rapido preco,rajada    # só alguns (ids de cenarios.json)
```

- `cenarios.json`: cada cenário tem as mensagens da "cliente" e o que conta como **passou**:
  - `deve` / `nao_deve`: expressão que a resposta precisa ter (ou não pode ter). `"em": "ultima"` olha só a última resposta.
  - `ferramenta` / `sem_ferramenta`: ação da agenda que tem (ou não pode) ser usada (`consultar`, `criar`, `listar`, `remarcar`, `cancelar`).
  - `duracao_max`: a consulta de horário não pode ser para um serviço mais longo que isso (ex.: avaliação = 30).
  - `transferiu`: `true`/`false` (se pausou a IA e chamou a equipe).
  - `respostas`: quantas respostas (rajada = 1).
  - `banco_horario` / `banco_obs`: horário que tem de existir no CRM depois da conversa (ex.: `"+8d 09:00"`).
  - `preparar`: cliente e horários que já existem no CRM antes da conversa (ex.: um horário marcado pela Gleide).
  - Datas relativas: `"+7d 09:00"`; nas mensagens e nos textos esperados, `{data:+8d 09:00}` vira `dd/mm`.
- **Segurança:** só roda com números que **não existem no WhatsApp** (confere antes e para se algum existir). No fim apaga as clientes de teste do CRM e limpa a memória da IA delas.
- **Resultado:** `testes/resultados/AAAA-MM-DD-<rótulo>.txt`, com ✅/❌ por cenário e os tokens do Gemini
  (chamadas por mensagem e tokens de entrada/saída). O n8n não mostra quanto veio do cache.
- Ao criar um cenário novo: use um número `55669000013x` novo e confira que ele não existe.

---

## Áudios prontos da Gleide

Plano: `docs/PLANO-PROMPT-E-AUDIOS.md` (Fase 4).

- **Cadastrar ou trocar um áudio** (MP3 ou OGG, 10–60 s, sem nome de cliente nem data):
  ```bash
  node cadastrar-audio.js manutencao.mp3 "de quanto em quanto tempo fazer a manutenção" "quando perguntar de quanto em quanto tempo faz a manutenção"
  ```
  O script sobe o arquivo no Supabase Storage (bucket **privado** `audios`), mede a duração, transcreve pelo
  n8n (workflow "Áudios prontos - Transcrever") e grava em `empresas.config.audios_prontos`.
  Mesmo tema de novo = troca o áudio.
- **Na conversa:** a IA vê a lista de temas no fim do prompt ("ÁUDIOS PRONTOS") e usa a ferramenta
  `enviar_audio`. O workflow "Áudios prontos - Enviar" mostra "gravando…", manda como **mensagem de voz**
  e grava no CRM como `🎤 Áudio da Gleide [áudio pronto: tema]: transcrição`. Por essa marca a IA
  sabe que a cliente já recebeu o áudio e não manda de novo.
- **Se o envio falhar,** a IA responde em texto com base na transcrição.
- **Regras** (no prompt, seção "ÁUDIOS DA GLEIDE"):
  - só quando a pergunta é sobre o tema;
  - nunca repete um áudio para a mesma cliente;
  - não manda se a cliente pediu texto;
  - no máximo 1 áudio por resposta.
