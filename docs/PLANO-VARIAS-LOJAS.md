# Plano: várias lojas (mega hair, estúdio de beleza, manicure)

Combinado com o Victor em 27/10/2026, revisto em 29/10/2026 depois de fechar a primeira loja de manicure.
A Gleide (Salão Toda Bonita, mega hair) está com tráfego pago e clientes chegando: **nada do que ela usa
muda durante a obra**. A manicure entra primeiro num conjunto novo, ao lado; a Gleide só passa para o
esquema novo no fim, num horário calmo.

**Regra de ouro durante a obra**
- Banco: só mudança que **soma** (coluna nova com valor padrão, tabela nova, função nova). Nada de apagar,
  renomear ou mudar o que já existe.
- n8n: os 14 workflows da Gleide não são tocados. O que for novo roda **ao lado**, com outro nome, outro
  endereço de webhook e outra instância do WhatsApp.
- App: só ganha coisas que dependem do nicho da loja; para loja de mega hair tudo continua igual.
- Prova antes de subir: o gerador de workflows, rodado para a Gleide, tem que produzir **exatamente** os
  mesmos workflows de hoje (comparação arquivo a arquivo).

## Como fica no final

- **Um banco** (o Supabase de hoje). Cada registro tem `empresa_id` e cada dona só enxerga a própria loja.
- **Um app** para todas as donas (o `crm`): agenda, clientes, CRM, conversas e serviços da loja dela, com
  textos e categorias do nicho.
- **Painel da agência** (o `painel-crm`): lista de lojas, criar loja nova, ligar/desligar recursos, ver
  conversas e custo da IA de cada uma.
- **IA por loja**: cada loja com o próprio número de WhatsApp, o próprio prompt (base comum + parte do
  nicho + dados da loja), a própria memória e as próprias regras (retomada, faltas, vagas, catálogo).

## Onde estamos (conferido em 29/10)

| Parte | Situação |
|---|---|
| Banco | **Pronto para várias lojas.** As 15 tabelas têm `empresa_id` (menos `empresas` e `servicos_modelo`) e RLS por loja. `criar_loja()` cria loja, profissional e serviços modelo de uma vez. |
| App (`crm`) | **Já separa por loja**: carrega a loja de quem está logado (`usuarios_empresa`) e filtra tudo por `empresa_id`. Falta adaptar textos e categorias ao nicho e o fuso. |
| IA (n8n) | **Presa à Gleide.** 15 usos de `$env.EMPRESA_ID`, 15 de `$env.EVOLUTION_INSTANCE`, chaves do Redis sem a loja (`memoria:`, `pausa:`…), fuso "America/Cuiaba" fixo em 26 pontos e o nome "Gleide" em ~170 textos. |
| Prompt | Um só, de mega hair, com o nome e os dados da Gleide dentro. |

## Caminho escolhido para a IA

**Um conjunto de workflows por loja, gerado pelo mesmo código.** O `montar-workflow.js` passa a receber a
loja (`--loja manicure-x`) e gera um conjunto com o nome, o webhook, a instância, o prompt e as regras
daquela loja. A Gleide continua sendo gerada como hoje (sem `--loja`), sem nenhuma mudança.

- Por quê: é o caminho mais rápido e mais seguro. A manicure não espera a migração da Gleide, e um erro na
  manicure não derruba a Gleide.
- Limite: aguenta bem umas 10–20 lojas. Passando disso, vale juntar tudo num conjunto único que descobre a
  loja pela instância do WhatsApp (fase 7).

## Fases

### Fase 1 — Banco (Victor) — feita
- [x] `empresas` ganha `nicho`, `fuso`, `ativo`, `instancia_whatsapp` (supabase/024)
- [x] Categorias de serviço para manicure e estúdio de beleza (supabase/024)
- [x] Serviços modelo por nicho, sem preço (`servicos_modelo`, supabase/024)
- [x] Função `criar_loja(...)` (supabase/024)
- [ ] Funções com "America/Cuiaba" fixo passam a usar `empresas.fuso` (só se alguma loja for fora de MT)

### Fase 2 — Dados da loja de manicure (a própria dona, no app) — 1 dia
A dona preenche no app, sem depender da gente (feito em 29/10, vale para qualquer nicho):
- **Configurações → Dados do salão**: nome, endereço, referência, Instagram, horário de funcionamento por
  dia, formas de pagamento, parcelamento, tolerância de atraso, cancelamento, sinal e um recado para a IA
  (`empresas.config`: `horario_funcionamento`, `endereco`, `formas_pagamento`, `loja`).
- **Configurações → Serviços e preços**: os serviços modelo do nicho já vêm criados sem preço; ela põe o
  valor, a duração e liga o "a partir de". As categorias seguem o nicho (`crm/lib/nicho.ts`).
- Almoço e WhatsApp para alertas já existiam em Configurações.

Combinar com ela fora do app:
- [ ] Nome da loja, endereço, horário de funcionamento e almoço, formas de pagamento (ela mesma preenche)
- [ ] Serviços com preço e duração (ela mesma preenche)
- [ ] Quem atende (uma ou mais manicures) e se a IA marca para qualquer uma ou para uma específica
- [ ] Número de WhatsApp que a IA vai usar (de preferência WhatsApp Business só para isso)
- [ ] Número da dona para avisos e para a assistente (igual à Gleide hoje)
- [ ] Regras dela: sinal/antecedência, atraso tolerado, cancelamento, se faz atendimento a domicílio
- [ ] Fotos de trabalhos, se quiser catálogo (pode ser o link do catálogo do WhatsApp Business)

### Fase 3 — Loja no banco e login no app (Victor) — meio dia
- [ ] `criar_loja('Nome', 'manicure', 'Profissional', ...)` e ajuste de preços e horários
- [ ] Convite de login da dona (Supabase → Authentication → Invite user) e ligação em `usuarios_empresa`
- [ ] Conferir no app, logado como ela, que não aparece nada da Gleide (e, logado como a Gleide, nada dela)

### Fase 4 — App por nicho (José Paulo) — 2 a 4 dias
- [x] Categorias de serviço vindas do nicho da loja (`crm/lib/nicho.ts`, 29/10)
- [x] Tela "Dados do salão" para a dona preencher a loja (29/10)
- [ ] Publicar o app (branch `deploy-cloudflare`) — a Gleide também vê a tela nova
- [ ] Textos de mega hair só para loja de mega hair (etiqueta "mega hair", ficha de pré-avaliação, placeholders)
- [ ] Nome da dona/profissional vindo do banco onde hoje está "Gleide" em textos da tela
- [ ] Fuso da loja em vez de `FUSO = "America/Cuiaba"` (`crm/lib/config.ts`) — pode ficar para depois se for MT
- [ ] Teste: Gleide abre o app e tudo está igual

### Fase 5 — IA da manicure (Victor) — 3 a 5 dias
- [ ] `montar-workflow.js --loja <nome>`: lê os dados da loja de um arquivo `lojas/<nome>.json`
  (empresa_id, instância, números, prefixo, nicho, prompt) em vez do `.env`
- [ ] Prefixo da loja nas chaves do Redis só no conjunto novo (`<loja>:memoria:…`); a Gleide fica sem prefixo
- [ ] Nome dos workflows com a loja ("[Manicure X] Agente WhatsApp") e webhook próprio
- [ ] Textos fixos com "Gleide" (avisos, assistente, alerta) passam a usar o nome da dona da loja
- [ ] O prompt da loja nova monta "dados do salão" a partir de `empresas.config` (endereço, horários,
  pagamento, regras, recado) e liga `config.ia_usa_dados_loja = true` (a tela passa a dizer que a IA usa)
- [ ] Catálogo de cabelos e avaliação online só existem no conjunto de mega hair
- [ ] Prova de que a Gleide não mudou: gerar sem `--loja` e comparar com os workflows atuais
- [ ] Instância nova na Evolution com o número da manicure (QR ou código de pareamento)

### Fase 6 — Prompt de manicure (Victor) — 2 dias, junto com a fase 5
- [ ] Separar o prompt de hoje em **base comum** (jeito de escrever, segurança, agenda, preços do app)
  + **parte mega hair** + **dados da loja**. A Gleide continua com o mesmo texto final.
- [ ] Escrever a parte de manicure (serviços, duração, manutenção do gel/alongamento, cuidados, dúvidas comuns)
- [ ] Bateria de conversas de teste: preço, marcar, remarcar, cancelar, atraso, "faz pé e mão juntos?",
  áudio, foto de unha de referência

### Fase 7 — Testes e piloto da manicure — 1 a 2 semanas
- [ ] Teste obrigatório: o **mesmo número de cliente** falando com as duas lojas — nada vaza (memória,
  pausa, CRM, agenda)
- [ ] Travas de teste ligadas no começo (só o número do Victor), como foi com a Gleide
- [ ] Piloto acompanhando as conversas todo dia; ajustes no prompt
- [ ] Liberar para todas as clientes da manicure

### Fase 8 — Painel da agência (José Paulo + Victor) — depois do piloto
- [ ] Lista de lojas com status (WhatsApp conectado, IA ligada, mensagens do dia, custo da IA)
- [ ] "Nova loja": chama `criar_loja`, mostra o QR code da Evolution, gera o arquivo da loja
- [ ] Ligar/desligar recursos por loja (`empresas.config`)

### Fase 9 — Juntar tudo (quando passar de ~10 lojas)
- [ ] Um conjunto único de workflows que descobre a loja pela instância (`empresas.instancia_whatsapp`)
- [ ] Retomada, faltas, atrasos e vagas percorrendo todas as lojas ativas
- [ ] Gleide migra por último, num horário calmo, com volta rápida para o conjunto antigo se der problema

## Ordem e prazo

Fases 2 e 3 já (dados e loja no banco). Em paralelo: José na fase 4, Victor nas fases 5 e 6.
Estimativa até o piloto da manicure começar: **cerca de 1 a 2 semanas** de trabalho, sem parar a Gleide.

## Riscos

1. **Misturar dados entre lojas** — o pior erro. Prefixo no Redis, todo acesso filtrado por loja e o teste
   com o mesmo número nas duas lojas antes de abrir.
2. **Quebrar a Gleide durante a obra** — regra de ouro, comparação dos workflows gerados e nada de deploy
   da Gleide sem necessidade enquanto o tráfego roda.
3. **Banimento de número** — cada loja com o próprio número; leitura humanizada, pausas e limite de
   conversas simultâneas valem para todas.
4. **Custo da IA** — cada loja soma o próprio gasto no Gemini; `registros_ia` já guarda por loja, o painel
   mostra o custo de cada uma.
