# Plano: organizar o projeto, o banco e a segurança

Escrito em 25/10/2026, depois de um dia de testes. Regra principal: **nada que mexa em nome de pasta, tabela
ou workflow antes da entrega de segunda (26/10)**. Antes da entrega, só entram as correções de segurança de
baixo risco (Fase 0). O resto vem na semana seguinte, uma fase de cada vez, com teste no WhatsApp e no app
depois de cada uma.

---

## O que está desorganizado hoje

### Pastas e nomes
| Hoje | Problema |
|---|---|
| `crm/` | É o **app da dona** (Início, Conversas, Agenda). "CRM" é outra coisa (o painel da agência). |
| `painel-crm/` | É o CRM de verdade (computador, agência). O nome mistura as duas coisas. |
| `n8n/demo-agente/` | É a **IA de produção**, não uma demo. Tudo junto: gerador, prompt, JSON gerado, scripts de servidor (`recuperar.sh`, `vigia.sh`), testes, SQL de teste, txt de prompt antigo. |
| Workflow "Demo Salão - Agente WhatsApp" | Nome de demo no n8n de produção. |
| `prompts/` | Prompts antigos para colar no Claude Code no primeiro dia; não são os prompts da IA. |
| `docs/` | Mistura plano já feito, plano futuro, checklist e cronograma passado. |
| Raiz: `README.md` e `CONTRATO.md` | Desenho ainda mostra a Google Agenda; o contrato fala de Google Agenda e de "Salão Demo". |

### Banco (Supabase)
| Hoje | Problema |
|---|---|
| `supabase/` com dois arquivos `010_` | Numeração repetida; o `010_retorno…` diz "AINDA NÃO RODADO", mas já rodou. |
| Arquivos vs. migrações no Supabase | Os nomes não batem (ex.: o `004` virou duas migrações com outros nomes); não dá para saber pelo Git o que está no banco. |
| `002_seed_dev.sql` e `manual/` | Dados falsos e scripts soltos junto com as migrações. |
| Nomes presos à Gleide | `pendencias_gleide`, `n8n_avisos_para_gleide`, `assistente_*`: quebram quando entrar o segundo salão. |
| Colunas da Google Agenda | `profissionais.google_calendar_id`, `agendamentos.google_event_id` sem uso. |
| `servicos` | Serviços repetidos e desativados (Botox, Coloração, Mechas…) misturados com os ativos. |
| `empresas.config` (JSON) | Endereço, horário, áudios, mensagens, números de alerta e chaves de teste (`so_para`, `assistente_numeros`) num campo só, sem validação. |
| 50 funções no `public` | `n8n_*`, `n8n_assistente_*`, `assistente_*`, `crm_*` tudo no mesmo lugar, sem comentário. |

### Segurança (o que já se sabe)
| Achado | Risco |
|---|---|
| **Webhook do n8n (`/webhook/whatsapp-salao`) sem senha** | Qualquer um que descubra o endereço manda uma "mensagem de cliente" falsa: a IA responde, cria cliente, marca horário. |
| Painel da Evolution anunciado em `http://` | Chave da Evolution pode trafegar sem criptografia. |
| Chaves no compose do Easypanel | Necessário hoje (a aba Ambiente não funciona), mas quem vê o compose vê a `service_role`. |
| `service_role` no n8n | Acesso total ao banco; se o n8n vazar, vaza tudo. |
| Supabase: proteção de senha vazada desligada | Senha fraca/vazada é aceita no login do app. |
| Supabase: 2 funções sem `search_path` fixo | Aviso do próprio Supabase (`assistente_normalizar`, `assistente_dia_longo`). |
| Supabase: `vagas` com RLS e nenhuma política | Ok se só o n8n usa; precisa ser decisão consciente. |
| Senhas e chaves passadas no chat em 24–25/10 | Senha do login do Victor e chave de API do n8n `claude`. |
| `.env` só num PC | Se o PC some, não dá para regerar os workflows. |

---

## Fase 0: antes de segunda (segurança, sem mexer em nome nenhum)

1. **Senha no webhook do WhatsApp.** No n8n, o nó *Webhook Evolution* passa a exigir um cabeçalho com segredo
   (Header Auth); na Evolution, o webhook da instância manda esse cabeçalho. Muda no `montar-workflow.js`
   e no `recuperar.sh` (gera o segredo e guarda no `.env`). Testar: mensagem real continua chegando; `curl`
   sem o cabeçalho recebe 403.
2. **Supabase → Authentication:** ligar *Leaked password protection*; Site URL `https://app.oistudio.com.br`.
3. **Trocar a senha do login do Victor** (passou pelo chat) e **apagar a chave de API `claude`** no n8n.
4. **Backup do `.env`** fora do PC (Drive ou pendrive) e do compose do Easypanel.
5. **Evolution:** conferir se `https://evo.oistudio.com.br/manager` abre com cadeado e se `SERVER_URL` no
   compose está com `https://`.
6. **Revisão de segurança completa** na outra sessão do Claude (RLS de cada tabela, rotas do app, segredos no
   histórico do Git), só leitura, com lista por gravidade.

## Fase 1: semana de 26/10 (organizar o repositório)

Uma PR por item, cada uma testada antes da próxima.

| De | Para | Cuidado |
|---|---|---|
| `crm/` | `app/` | Easypanel → oistudio-app → Fonte: caminho `/crm` vira `/app`. Trocar no mesmo minuto da PR. |
| `painel-crm/` | `painel/` | Ver onde está publicado (Cloudflare?) e trocar o caminho lá. |
| `n8n/demo-agente/` | `ia/` com subpastas: `ia/gerador/` (os `*.js` e o `prompt-agente.md`), `ia/workflows/` (JSON gerado), `ia/servidor/` (`recuperar.sh`, `vigia.sh`, compose), `ia/testes/` | O `.env` e os arquivos `.workflow-*-id` vão junto; o `recuperar.sh` e o `RECUPERACAO.md` mudam os caminhos. |
| Workflow "Demo Salão - Agente WhatsApp" | "IA WhatsApp - Atendimento" | Só o nome; o id no n8n continua o mesmo, nada quebra. |
| Prompts antigos (`.txt` em `demo-agente/`, pasta `prompts/`) | `docs/arquivo/` | Não apagar: histórico. |
| `docs/` | `docs/` (vale agora: ESTADO-ATUAL, RECUPERACAO, CHECKLIST) e `docs/arquivo/` (planos já feitos, cronograma) | |
| `README.md`, `CONTRATO.md` | Reescritos: desenho sem Google Agenda, nomes novos, um parágrafo por parte | |

## Fase 2: semana de 02/11 (organizar o banco)

1. **Uma fonte da verdade para migrações:** `supabase/migrations/` com o mesmo nome e data das migrações do
   Supabase (Supabase CLI: `supabase db pull`). Os arquivos atuais vão para `supabase/arquivo/`. Daí em
   diante, toda mudança é `supabase migration new …` + commit, nunca SQL solto.
2. **Separar o que é dado do que é estrutura:** `supabase/seed/` (dados de teste) e `supabase/scripts/`
   (cadastro de salão novo), fora das migrações.
3. **Schemas:** tabelas do salão continuam no `public`; funções da IA vão para um schema `ia` (`ia.registrar_entrada`
   no lugar de `public.n8n_registrar_entrada`), as da assistente para `assistente`. Cada função ganha
   `comment on function` dizendo quem chama. **Precisa mudar o n8n junto** (as URLs `/rpc/…`): fazer numa PR só,
   com os workflows regerados, num horário sem cliente.
4. **Tirar o nome da Gleide do banco:** `pendencias_gleide` → `pendencias_dona`, `n8n_avisos_para_gleide` →
   `ia.avisos_para_dona`. O nome dela fica só em `empresas`.
5. **Limpar:** apagar `google_calendar_id` e `google_event_id`; apagar os serviços desativados que não têm
   agendamento ligado (os que têm, ficam desativados).
6. **`empresas.config` com forma fixa:** documentar cada chave no `CONTRATO.md` e validar com um `check`
   (ou separar em colunas: `endereco`, `horario_funcionamento`, `whatsapp_alerta`). Chaves de teste
   (`so_para`, `assistente_numeros`) saem do banco de produção.

## Fase 3: semana de 09/11 (segurança a fundo)

1. **Tirar a `service_role` do n8n:** criar um papel no Postgres só para a IA (`ia_n8n`), com permissão de
   executar as funções do schema `ia` e nada mais; o n8n usa essa chave. Se o n8n vazar, o estrago fica
   limitado.
2. **RLS revisado tabela por tabela,** com teste automático: um usuário de outro salão não lê nem altera nada
   (script em `supabase/testes/`).
3. **Segredos fora do compose:** quando o Easypanel resolver a aba Ambiente, ou usando arquivo de segredos do
   Docker; até lá, compose só visível para Victor e José Paulo.
4. **Contas:** 2FA no GitHub, Supabase, Easypanel, Hostinger e n8n; repositório privado; só os dois como
   administradores.
5. **Backup semanal do banco** (workflow no n8n exportando as tabelas, ou plano Pro do Supabase) e **monitor de
   disponibilidade** (UptimeRobot no app, no n8n e na Evolution), com alerta no WhatsApp.
6. **API oficial da Meta** no lugar da Evolution, como já combinado (tira a dependência do WhatsApp Web).

---

## Ordem e responsáveis (proposta)

| Quando | O quê | Quem |
|---|---|---|
| Até domingo 25/10 | Fase 0, itens 1 a 5 | Victor (Supabase, senha, backup) + Claude (webhook com senha) |
| Até domingo 25/10 | Fase 0, item 6 (revisão de segurança) | Sessão de segurança do Claude |
| Semana de 26/10 | Fase 1 | José Paulo (app e painel) + Victor (IA) |
| Semana de 02/11 | Fase 2 | Victor (guardião do banco) |
| Semana de 09/11 | Fase 3 | Os dois |

Antes de cada fase: `git pull origin main`, avisar o outro no grupo, e ninguém roda o `montar-workflow.js`
nem mexe no Easypanel enquanto a fase não terminar.
