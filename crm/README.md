# CRM — app da dona do salão

Responsável: [nome do amigo]

Next.js (App Router) + TypeScript + Tailwind + Supabase. Instalável no iPhone (PWA).

## Rodar no computador

1. Copie `.env.local.example` para `.env.local` e preencha com os dados do Supabase
   (**Project Settings → API**: a URL e a `anon key`). O `.env.local` nunca vai para o Git.
2. Instale e rode:
   ```bash
   npm install
   npm run dev
   ```
   No Windows, se o PowerShell bloquear o `npm`, use `npm.cmd install` e `npm.cmd run dev`.
3. Abra http://localhost:3000 e entre com o usuário de teste do Supabase
   (precisa estar ligado ao Salão Demo em `usuarios_empresa`, ver o README da raiz).

## Estrutura

```
app/
├── login/            ← tela de login (e-mail e senha)
├── (app)/            ← telas de quem já entrou, com a barra de 4 abas
│   ├── page.tsx      ← Início
│   ├── conversas/
│   ├── agenda/
│   ├── clientes/
│   └── configuracoes/  (ícone no topo do Início)
├── manifest.ts       ← PWA (nome, ícones, tela cheia)
└── layout.tsx        ← pt-BR, viewport-fit=cover (área segura do iPhone)
components/           ← BarraAbas, Cabecalho
lib/
├── config.ts         ← nome, cor principal e ícone do salão; fuso America/Cuiaba
├── empresa.tsx       ← carrega o salão do usuário logado (useEmpresa)
└── supabase/         ← cliente do navegador e renovação da sessão
proxy.ts              ← manda para /login quem não entrou
```

## Deploy na Vercel

1. Em vercel.com, **Add New → Project** → importe o repositório do GitHub.
2. **Root Directory:** `crm`.
3. **Environment Variables:** `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. **Deploy.** No iPhone, abra o link no Safari → Compartilhar → **Adicionar à Tela de Início**.

## Fases

- [x] Fase 1: login, 4 abas, PWA, leitura do Salão Demo
- [ ] Fase 2: Clientes + Ficha
- [ ] Fase 3: Início + Agenda + Registrar atendimento
- [ ] Fase 4: Conversas (tempo real) + Pausar IA + Mandar alô
- [ ] Fase 5: Configurações + acabamento
