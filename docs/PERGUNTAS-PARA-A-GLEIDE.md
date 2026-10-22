# O que só a Gleide sabe (para a IA atender sem inventar)

Hoje a IA usa **valores e explicações provisórios**: preços de média de mercado e uma base técnica
escrita por nós. Antes de atender clientes de verdade, a Gleide precisa **confirmar ou corrigir**
tudo abaixo.

**Como fazer com ela (cerca de 30–40 min):** ir parte por parte. Ela pode responder por **áudio**,
que a gente transcreve. Onde aparece "hoje a IA diz", ela só precisa responder "tá certo" ou dar o
valor certo.

**Prioridade:** 🔴 bloqueia o uso real · 🟡 importante · 🟢 pode esperar.

Quando cada resposta chegar, anote ao lado e marque `[x]`. Na tabela, a coluna "Onde entra"
é para nós (equipe), não para ela.

---

## 1. Decisões que só ela pode tomar 🔴

- [ ] **Valores no WhatsApp.** A IA pode falar preço?
  - **A)** nunca fala valor ("a Gleide te passa na avaliação");
  - **B)** fala só o "a partir de" e diz que o valor final é com ela (**como está hoje**).
- [ ] **Pré-avaliação por foto.** A IA pode pedir foto do cabelo e sugerir opções (ex.: "o brasileiro
  costuma combinar com o que você quer"), sempre dizendo que quem decide técnica e gramas é a Gleide?
  (**Hoje está ligado.**)
- [ ] **Quando ela quer ser chamada** (a IA para e passa para ela). Hoje: a cliente pede para falar
  com ela, reclamação, dor/ferida/reação, fechar compra de cabelo agora, ferramenta com erro. Falta ou
  sobra algum caso?
- [ ] **Como quer ser avisada** quando a IA passar uma cliente para ela (hoje só aparece no CRM, em
  "Precisam de você").

## 2. Preços, duração e retorno de cada serviço 🔴

"Retorno" = de quanto em quanto tempo a cliente volta para esse serviço. É o que o CRM usa para
saber quando chamar a cliente.

| Serviço | Hoje a IA diz (preço · duração · retorno) | Certo |
|---|---|---|
| Avaliação | grátis · 30 min · — | |
| Visita para escolher cabelo | grátis · 30 min · — | |
| Aplicação – queratina | R$ 650 · 4h · volta em 75 dias | |
| Aplicação – tela adesiva | R$ 450 · 2h · 45 dias | |
| Aplicação – tela costurada | R$ 500 · 3h · 60 dias | |
| Aplicação – ponto americano | R$ 550 · 3h · 60 dias | |
| Manutenção – queratina | R$ 450 · 3h · 75 dias | |
| Manutenção – tela adesiva | R$ 300 · 1h30 · 45 dias | |
| Manutenção – tela costurada / ponto americano | R$ 350 · 2h · 60 dias | |
| Remoção de mega hair | R$ 150 · 1h · — | |
| Escova progressiva | a partir de R$ 180 · 3h · 90 dias | |
| Botox capilar | a partir de R$ 150 · 2h | |
| Selagem | a partir de R$ 160 · 2h | |
| Coloração | a partir de R$ 150 · 2h · 45 dias | |
| Mechas / luzes | a partir de R$ 350 · 4h · 90 dias | |
| Hidratação / reconstrução | a partir de R$ 90 · 1h | |

- [ ] Falta algum serviço que ela faz? Algum da lista ela **não** faz?
- [ ] Nos "a partir de": o que faz o preço subir (comprimento, volume)? Tem faixas (curto/médio/longo)?

*Onde entra: tabela `servicos` no Supabase + seção de preços do prompt
(`n8n/demo-agente/prompt-agente.md`) + `supabase/manual/servicos_toda_bonita_RASCUNHO.sql`.*

## 3. Cabelo para vender 🔴

| Pergunta | Hoje a IA diz | Certo |
|---|---|---|
| Brasileiro: preço | a partir de R$ 1.300 (100 g, 50 cm) | |
| Indiano: preço | a partir de R$ 1.100 (100 g, 50 cm) | |
| Vietnamita: preço | a partir de R$ 950 (100 g, 50 cm) | |
| Como muda o preço com o comprimento (40, 60, 70 cm…)? | "aumenta um pouco" | |
| Quantas gramas uma cliente costuma precisar? | não fala (só a Gleide) | |
| Cores e comprimentos que costuma ter | não fala | |

- [ ] Vende **só o cabelo**, sem aplicar? Para quem não é cliente?
- [ ] Faz **entrega** ou vende para outra cidade? Reserva cabelo? Pede sinal?
- [ ] O cabelo é **reaproveitado** nas manutenções? Por quanto tempo dura um cabelo bem cuidado?
- [ ] Ela quer que a IA diga se tem cor/comprimento **em estoque**? (Hoje a IA não fala de estoque.)

## 4. Base técnica: o que a IA explica 🟡

A IA está explicando isto para as clientes. Ela precisa ler e corrigir **cada linha**.

**Técnicas**
- [ ] **Queratina:** mechas presas fio a fio com queratina aquecida. Fica natural, dá para prender o
  cabelo e dura bastante. A aplicação é a mais demorada.
- [ ] **Tela adesiva:** faixas finas coladas rente à raiz. Discreta, leve e a aplicação mais rápida.
  Pede cuidado com óleo e condicionador perto da raiz.
- [ ] **Tela costurada:** a tela é costurada numa trancinha feita no cabelo natural. Muito volume e
  comprimento, firme.
- [ ] **Ponto americano:** a tela é presa com pontos (sem trança). Firme e leve.
- [ ] Manutenção de **2 a 3 meses** para todas, ou cada técnica tem o seu prazo?
- [ ] Para quem cada técnica é mais indicada, e para quem **não** é (cabelo fino, ralo, curto, couro
  sensível)?
- [ ] Qual é o **cabelo mais curto** em que ela consegue aplicar?

**Cabelos**
- [ ] Brasileiro = mais fino e leve, cai natural · Indiano = meio-termo, macio, aceita bem química ·
  Vietnamita = mais grosso, liso, muito volume, o mais em conta. Está certo?

**Cuidados depois de colocar** (a IA responde isso sem chamar a Gleide)
- [ ] Desembaraçar todo dia com escova própria, segurando na raiz, das pontas para cima.
- [ ] Depois de lavar, secar bem a raiz e não dormir com o cabelo molhado.
- [ ] Dormir com trança ou rabo frouxo.
- [ ] Condicionador e óleo do meio para as pontas, nunca na raiz/fixação.
- [ ] Chapinha e secador podem, sem encostar o calor na fixação.
- [ ] Piscina e mar: prender o cabelo e lavar depois.
- [ ] Produtos que ela indica ou proíbe (shampoo, óleo…)? A IA pode citar marca?

**Dúvidas sensíveis**
- [ ] "Mega estraga o cabelo?" Hoje: bem aplicado e com a manutenção em dia, o cabelo natural fica
  protegido; a Gleide confere antes.
- [ ] "Dói?" "Coça?" "Quantos dias para acostumar?"
- [ ] Química (progressiva, coloração, mechas) em quem tem mega: o que pode e o que não pode?
- [ ] Química antes de colocar mega: quanto tempo antes?

*Onde entra: seção BASE TÉCNICA do prompt e, na Fase 3, a base de conhecimento.*

## 5. Agenda e avaliação 🟡

- [ ] Hoje a IA marca **avaliação antes** para: aplicação de mega sem avaliação feita, e química ou
  selagem em quem tem mega. Compra de cabelo, manutenção, remoção e química em quem não usa mega são
  marcadas **direto**. Está certo?
- [ ] A avaliação de **30 min** é suficiente?
- [ ] Atende **homens**? Faz prótese capilar masculina?
- [ ] Horário: seg a sex 9h–18h (almoço 12h–13h); sáb e dom 8h–14h. Fim de semana também tem almoço?
- [ ] Tem dia ou horário que ela **não quer** que a IA marque (ex.: aplicação longa só de manhã)?
- [ ] Quantos atendimentos longos (4h) cabem num dia?

## 6. Pagamento e regras 🟡

- [ ] Pix, dinheiro, débito, crédito em **até 6x sem juros**. Mais parcelas, com juros?
- [ ] Pede **sinal** para aplicação ou compra de cabelo? Quanto?
- [ ] Cancelamento e **atraso**: tem prazo? Tolerância de quantos minutos?
- [ ] **Falta** sem avisar: tem alguma regra?
- [ ] **Garantia:** se soltar uma mecha ou a tela nos primeiros dias, ela arruma sem custo?

## 7. Áudios dela 🟢

Já gravados: "mega hair prejudica o cabelo?" e "de quanto em quanto tempo fazer a manutenção?".

- [ ] Regravar os dois sem "Flor" ou outro apelido (a IA manda para todo mundo). O de "prejudica?"
  precisa responder de fato a pergunta.
- [ ] Novos temas sugeridos: diferença entre as técnicas · cuidados depois de colocar · dói? · quanto
  dura o cabelo · como funciona a avaliação · química com mega.
- [ ] Dica para gravar: até ~30 s, responder a pergunta logo no começo e terminar sem pergunta (a
  IA já pergunta por escrito).

*Onde entra: `node cadastrar-audio.js <arquivo> "<tema>" "<quando usar>"`.*

## 8. Mensagens que saem em nome dela 🟢

- [ ] Texto do **alô de retorno** (CRM). Hoje: "Oi {nome}! Tudo bem? Já está chegando a hora do seu
  {servico}. Quer que eu veja um horário pra você?"
- [ ] Texto do **alô de reativação** (cliente sumida). Hoje: "Oi {nome}! Que saudade de você aqui no
  salão 💛 Bora marcar um horário pra se cuidar?"
- [ ] Como ela quer que a IA se apresente: "assistente da Gleide"? Outro nome?

*Onde entra: `empresas.config.mensagens` (CRM) e "QUEM VOCÊ É" no prompt.*

## 9. As dúvidas reais das clientes 🟡

As **30 a 50 perguntas** que as clientes mais fazem e **como ela responde**. É a principal fonte para
a IA ficar boa (Fase 2 do `docs/PLANO-PROMPT-E-AUDIOS.md`).

- [ ] Ela lista de cabeça ou manda prints/áudios de conversas antigas do WhatsApp.
- [ ] Para cada uma: a resposta dela, e se prefere que a IA responda em **texto** ou com **áudio**.

| Pergunta da cliente | Resposta da Gleide | Texto ou áudio |
|---|---|---|
| | | |

---

**Depois de respondido:** atualizar o prompt e a tabela `servicos`, tirar os avisos de "fictício"
e "rascunho" do `prompt-agente.md`, transformar cada dúvida nova em cenário da bateria
(`n8n/demo-agente/testes/cenarios.json`) e rodar a bateria.

Relacionados: `docs/DADOS-DO-SALAO.md` (dados gerais do salão e acessos).
