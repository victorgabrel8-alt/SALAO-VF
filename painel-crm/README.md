# Painel CRM — site da agência

Site separado do app da dona, **só para a agência**, usado no computador. Lê o **mesmo
banco Supabase** (mesmas tabelas e regras do `CONTRATO.md`). É aqui que vai entrar a IA
de retorno/reativação das clientes.

| | App da dona (`/crm`) | Painel CRM (`/painel-crm`) |
|---|---|---|
| Quem usa | a dona, no iPhone | a agência, no computador |
| Telas | Início, Conversas, Agenda | lista completa de clientes, ficha, filtros, origem, Mandar alô |
| Salões | o salão dela | todos os salões ligados ao login (seletor no topo) |

## Rodar no computador

1. Copie `.env.local.example` para `.env.local` (a mesma URL e anon key do app da dona).
2. Instale e rode (porta 3001, para rodar junto com o app da dona na 3000):
   ```bash
   npm install
   npm run dev -- -p 3001
   ```
   No Windows, se o PowerShell bloquear o `npm`, use `npm.cmd`.
3. Abra http://localhost:3001 e entre com um login ligado aos salões em `usuarios_empresa`.

## Vários salões

O painel mostra os salões em que o login tem uma linha em `usuarios_empresa`. Para a
agência ver um salão novo, o guardião adiciona:

```sql
insert into usuarios_empresa (user_id, empresa_id, papel)
select id, '<ID DO SALÃO>', 'recepcao' from auth.users where email = '<e-mail da agência>';
```

(O banco só aceita os papéis `dona` e `recepcao`; um papel `agencia` próprio precisaria de
mudança no banco, pelo guardião.)

## Estrutura

```
app/
├── login/                 ← entrar
└── (painel)/
    ├── layout.tsx         ← barra do topo: salão escolhido e Sair
    ├── page.tsx           ← tabela de clientes (filtros, busca, origem, Ver mais)
    └── clientes/[id]/     ← ficha da cliente
lib/                       ← mesmas regras do app da dona (formato, status, origem, alô, excluídas)
```

O código de `lib/` e `components/` foi copiado do app da dona. Se uma regra mudar
(ex.: status da cliente), atualizar nos dois.

## Lojas (motor único)

A tela **Lojas** cria uma loja nova no motor de IA do ramo dela (Unhas ou Mega hair), mostra o QR para
conectar o WhatsApp, e deixa liberar a IA, definir o teto de conversas, o tempo por cliente e o sinal por Pix.
Plano e regras em `docs/PLANO-MOTOR-UNICO.md`.

- As ações rodam no **servidor do painel** (`app/api/lojas`, `lib/servidor`), com a chave de serviço do
  Supabase e a chave da Evolution. Essas chaves ficam só no `.env.local` (ver `.env.local.example`) e nunca
  vão para o navegador.
- Só entra quem está logado no painel **e** tem o e-mail em `AGENCIA_EMAILS`.
- A loja nova nasce com a IA em teste: só o `AGENCIA_WHATSAPP` recebe resposta até clicar em **Liberar a IA**.
- Lojas com conjunto próprio de workflows (as que não estão no motor) aparecem na lista, mas não são
  alteradas por esta tela.
- O mesmo pode ser feito pela linha de comando: `n8n/demo-agente/nova-loja.js`.
