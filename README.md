# Salão IA

Secretária de IA no WhatsApp + CRM para salão de beleza.
**Entrega do primeiro cliente: segunda, 26/10/2026.**

```
WhatsApp da dona ──► n8n (IA) ──► Supabase ◄── CRM (app no iPhone da dona)
                      │
                      └──► Google Agenda
```

O **Supabase é a única ligação** entre as duas partes. Quem trabalha no n8n grava; quem trabalha no CRM lê. As regras estão no **[CONTRATO.md](CONTRATO.md)** — leia antes de começar.

## Estrutura

```
salao-ia/
├── README.md                  ← você está aqui
├── CONTRATO.md                ← acordo entre atendimento e CRM (tabelas, regras, integração)
├── crm/                       ← app da dona no iPhone (Next.js): Início, Conversas, Agenda — José Paulo
├── painel-crm/                ← site da agência no computador (Next.js): CRM completo — José Paulo
├── n8n/                       ← workflows exportados em JSON — Victor
├── supabase/
│   ├── 001_schema.sql         ← cria o banco inteiro (rodar 1 vez)
│   ├── 002_seed_dev.sql       ← dados falsos ("Salão Demo") para desenvolver
│   └── manual/
│       └── criar_salao_producao.sql  ← cadastra o salão real (sexta)
├── prompts/
│   ├── PROMPT-ATENDIMENTO.md  ← colar no Claude Code do Victor
│   └── PROMPT-CRM.md          ← colar no Claude Code do amigo
└── docs/
    ├── CRONOGRAMA.md          ← quem faz o quê, dia a dia
    ├── CHECKLIST-ENTREGA.md   ← o que conferir antes e durante a entrega
    └── DADOS-DO-SALAO.md      ← lista do que pedir para a dona
```

## Primeiro dia (terça, juntos, ~1 hora)

### 1. GitHub
1. Os dois criam conta em github.com.
2. Um cria o repositório **privado** `salao-ia` e sobe estes arquivos (ver "Subindo pela primeira vez" abaixo).
3. **Settings → Collaborators → Add people** → convida o outro.
4. O outro aceita o convite (chega por e-mail) e faz `git clone`.

### 2. Supabase
1. Um cria o projeto em supabase.com (região **South America (São Paulo)**).
2. **Organization → Team → Invite** → convida o outro.
3. **SQL Editor → New query** → cola e roda `supabase/001_schema.sql`.
4. Depois cola e roda `supabase/002_seed_dev.sql` (dados falsos).
5. **Authentication → Users → Add user** → cria um login de teste e vincula ao Salão Demo:
   ```sql
   insert into usuarios_empresa (user_id, empresa_id, papel)
   values ('[USER UID]', '00000000-0000-0000-0000-000000000001', 'dona');
   ```
6. **Project Settings → API**: copiar a URL, a `anon key` (para o CRM) e a `service_role key` (para o n8n, nunca no navegador).

### 3. Definir
- Quem é o **guardião do banco** (anotar no `CONTRATO.md`).
- O grupo do projeto (WhatsApp ou Discord) e o horário da conversa diária (sugestão: 21h).

### 4. Cada um abre o Claude Code na pasta do repositório
- Victor: cola `prompts/PROMPT-ATENDIMENTO.md`
- Amigo: cola `prompts/PROMPT-CRM.md`

## Subindo pela primeira vez

Na pasta `salao-ia` (ou peça ao Claude Code: "inicializa o git e sobe para o meu repositório salao-ia"):

```bash
git init
git add .
git commit -m "estrutura inicial do projeto"
git branch -M main
git remote add origin https://github.com/[SEU-USUARIO]/salao-ia.git
git push -u origin main
```

## Rotina do dia a dia

```bash
git pull                          # ao começar: pega o que o outro fez
# ... trabalha ...
git add .
git commit -m "o que eu fiz"
git push                          # ao terminar: envia
```

Cada um trabalha na própria pasta (`/crm` ou `/n8n`), então quase não há conflito. Os únicos arquivos compartilhados são o `CONTRATO.md` e a pasta `supabase/`.

## Regras de ouro
1. **Banco só muda pelo guardião**, com arquivo novo numerado (`003_...sql`). Nunca editar um `.sql` já rodado.
2. **Segredos nunca no GitHub** (`.env` está no `.gitignore`).
3. **Ideia nova vai para a lista "Depois de segunda"** no `CONTRATO.md`.
4. **Nada vai para o número da dona sem os dois testarem juntos.**
