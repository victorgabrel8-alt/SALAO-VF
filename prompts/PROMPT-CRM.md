# Prompt para o Claude Code — CRM (app da dona do salão)

> Cole este texto no Claude Code, aberto na raiz do repositório `salao-ia`.
> Antes, leia o `CONTRATO.md` e confirme que o `001_schema.sql` e o `002_seed_dev.sql` já foram rodados no Supabase.

---

## Contexto

Estamos construindo, em dupla, um sistema para um salão de beleza com entrega na **segunda-feira, 26/10/2026**:
- **Parte A (Victor):** secretária de IA no WhatsApp, feita no n8n. Ela grava tudo no Supabase.
- **Parte B (eu, você está me ajudando):** o **CRM**, um app que a dona do salão usa no **iPhone** para acompanhar as clientes e as conversas da IA.

O banco já existe no Supabase. **Não altere a estrutura do banco** (tabelas, views, funções, RLS). Se precisar de algo novo, pare e me diga exatamente o SQL que precisa, que eu peço ao guardião do banco. Leia `CONTRATO.md` e `supabase/001_schema.sql` antes de começar: lá estão as tabelas, as views prontas (`clientes_status`, `retornos_por_servico`, `conversas`) e as regras de integração.

Enquanto a IA não estiver gravando dados reais, use o "Salão Demo" (dados falsos do `002_seed_dev.sql`).

## Stack

- Next.js (App Router) + TypeScript + Tailwind
- Supabase JS (`@supabase/ssr`) com **anon key** + Supabase Auth (e-mail e senha)
- Supabase Realtime nas tabelas `mensagens`, `clientes` e `agendamentos`
- PWA (manifest + ícones) para instalar na tela inicial do iPhone
- Deploy na Vercel (plano grátis)
- Todo o app em **português do Brasil**, datas e horas em `America/Cuiaba`
- Código na pasta `/crm` do repositório

## Princípios de design (importante)

- **Mobile-first, pensado para iPhone.** A dona usa com pressa, entre um atendimento e outro, às vezes com uma mão.
- **A pergunta de cada tela: "tem algo que precisa de mim agora?"**
- Botões grandes (mínimo 44px de altura), letras grandes, alto contraste.
- **Um toque para as ações comuns.** Quase nada para digitar.
- Cores com significado fixo: verde = tudo bem, amarelo = atenção, laranja = atrasado, vermelho = precisa dela.
- Respeitar a área segura do iPhone (notch e barra inferior): `viewport-fit=cover` + `env(safe-area-inset-*)`. A barra de abas não pode ficar atrás da barra do sistema.
- Nada que dependa de hover/mouse.
- Logo e cor principal do salão configuráveis (por enquanto, constantes num arquivo `config`).

## Estrutura do app: 4 abas fixas embaixo

### 1. Início ("Hoje")
De cima para baixo:
- **Precisam de você** (destaque vermelho): clientes com IA pausada por `pediu_humano`, `reclamacao` ou `fora_escopo`. Toque abre a conversa.
- **Atendimentos de hoje**: horário, cliente, serviço, profissional, com botões de um toque: **Realizado · Faltou · Cancelado**.
- **Para chamar hoje: N clientes** → leva para a aba Clientes com o filtro de retorno/atrasadas.
- **Resumo**: "Hoje a IA conversou com X clientes e marcou Y horários" (contar a partir de `mensagens` e `agendamentos` com `origem='ia'` de hoje).
- Botão flutuante **"+ Registrar atendimento"**: buscar cliente (ou criar com nome + telefone), escolher serviço, profissional, data/hora (padrão: agora). Grava em `agendamentos` com `status='realizado'`, `origem='manual'`.
- **Telefone:** o banco só aceita o formato `55` + DDD + número, só dígitos (ex.: `5566999998888`). Crie uma função única `normalizarTelefone()` que aceita o que a dona digitar (`(66) 99999-8888`, `66999998888`, `+55 66...`) e converte. Use também na busca.

### 2. Conversas
- Lista igual à do WhatsApp, usando a view `conversas`, ordenada pela última mensagem, atualizando em tempo real.
- Selo em cada uma: 🟢 IA atendendo · 🟡 Pausada · 🔴 Precisa de você.
- Dentro da conversa: balões diferentes para **cliente**, **IA** e **você (humano)**; botões grandes **"Pausar IA" / "Reativar IA"** e **"Responder no WhatsApp"**.
- **Só leitura** nesta versão: o app NÃO envia mensagem. Responder = abrir o WhatsApp Business.
- Pausar: `ia_pausada_ate = now() + 12 horas`, `motivo_pausa = 'manual'`. Reativar: `ia_pausada_ate = null`, `motivo_pausa = null`.

### 3. Agenda
- Dia atual por padrão, setas para mudar o dia.
- Cor por profissional.
- Mesmos botões de status do Início.
- Botão para criar agendamento manual (`origem='manual'`).
- Ao cancelar, mostrar o aviso: "Lembre de apagar também do Google Agenda" (o app não mexe no Google nesta versão).

### 4. Clientes
- Busca por nome ou telefone no topo.
- **Filtros rápidos com contador**, usando `clientes_status.status`:
  `Retorno chegando (N) · Atrasadas (N) · Inativas (N) · Todas`
- Cada item: nome, status com cor, última visita ("há 47 dias"), retorno previsto.
- Botão **"Mandar alô"** em cada cliente das listas de retorno/atrasadas/inativas:
  1. monta a mensagem a partir de `empresas.config.mensagens.retorno` (ou `.reativacao` para inativas), trocando `{nome}` pelo primeiro nome e `{servico}` pelo último serviço;
  2. grava em `contatos` (`tipo='retorno'` ou `'reativacao'`, `canal='manual'`, `mensagem`, `criado_por = usuário logado`);
  3. abre o WhatsApp com a mensagem pronta.
- Se a cliente teve contato nos últimos 7 dias, mostrar "Chamada há X dias" e pedir confirmação antes de chamar de novo.

### Ficha da cliente (ao tocar numa cliente)
- Cabeçalho: nome, telefone, status com cor, botão WhatsApp, botão Pausar/Reativar IA.
- Dados editáveis: nome, aniversário, profissional preferida, **observações** (alergias, preferências), etiquetas.
- **Próximos retornos por serviço** (view `retornos_por_servico`).
- **Linha do tempo** em ordem de data, juntando: atendimentos (com status), contatos ("Alô enviado — respondeu/agendou") e mensagens (agrupadas por dia, com "ver conversa").

### Configurações (ícone no topo do Início, não é aba)
- Serviços: nome, preço, duração, **dias de retorno**, ativo.
- Profissionais: nome, ativo.
- Mensagens do "Mandar alô" (editar os textos de `config.mensagens`).
- Sair.

## Atenção: WhatsApp no iPhone

A dona tem **dois WhatsApp no iPhone**: o pessoal e o **Business** (o do salão). Os links comuns (`https://wa.me/...`) podem abrir o **pessoal**. Faça os botões de WhatsApp usarem uma função única `abrirWhatsApp(telefone, texto)` num só arquivo, para podermos trocar o tipo de link depois de testar no iPhone dela. Pesquise e documente no README qual link abre o WhatsApp Business no iOS e deixe as duas opções prontas para teste.

## Ordem de trabalho (pare ao fim de cada fase para eu testar no celular)

- **Fase 1 (ter):** projeto Next.js em `/crm`, login, layout com as 4 abas, PWA instalável, conexão com o Supabase lendo o Salão Demo. Deploy na Vercel.
- **Fase 2 (qua):** Clientes (lista, filtros, busca) + Ficha da cliente.
- **Fase 3 (qui–sex):** Início + Agenda + Registrar atendimento + botões de status.
- **Fase 4 (sex):** Conversas com Realtime + Pausar/Reativar IA + Mandar alô.
- **Fase 5 (sáb):** Configurações + acabamento visual + teste completo no tamanho de tela do iPhone.

**Prioridade se faltar tempo:** Clientes + Ficha + Início vêm antes de Configurações (serviços podem ser cadastrados direto no Supabase no começo).

## Fora do escopo (não fazer, mesmo que pareça fácil)

Enviar mensagem pelo app, notificações push, relatórios, aniversários, financeiro, comissão, estoque, painel multi-salão, integração com Google Agenda pelo app. Se achar algo necessário, me pergunte.

## Cenários de teste

1. Logar no iPhone, adicionar à tela inicial, abrir em tela cheia sem a barra de abas escondida.
2. Filtro "Atrasadas" mostra o mesmo número do contador.
3. Marcar um atendimento como **realizado** → a cliente sai de "Atrasadas" e o retorno previsto aparece na ficha.
4. "Registrar atendimento" de uma cliente nova → ela aparece com status em dia.
5. "Mandar alô" → grava o contato e abre o WhatsApp com a mensagem certa, com o nome da cliente.
6. Pausar IA na conversa → selo muda para pausada; reativar → volta.
7. Inserir uma mensagem nova no Supabase → aparece na aba Conversas sem recarregar.
8. Criar um segundo usuário sem vínculo com o salão → ele não vê nenhuma cliente.

## Regras para você (Claude Code)

- Explique o que eu preciso fazer manualmente (Supabase, Vercel, variáveis de ambiente).
- Segredos só em `.env.local` (nunca no código ou no Git).
- Use os tipos gerados do Supabase (`supabase gen types`) para não errar nomes de colunas.
- Componentes simples e reutilizáveis; nada de bibliotecas pesadas sem necessidade.
- Ao fim de cada fase: commit com mensagem clara e push.
- Prefira o simples. Se travar, proponha um atalho que mantenha o prazo.
