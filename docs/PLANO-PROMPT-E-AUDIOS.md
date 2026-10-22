# Plano — system prompt robusto, enxuto, e áudios prontos

**Objetivo:** a IA tira todas as dúvidas das clientes, gastando pouco por mensagem, e manda áudios gravados pela Gleide quando a pergunta pede explicação.
**Onde mexe:** `n8n/demo-agente/` (prompt, workflows) e `empresas.config` no Supabase (sem migração de banco).

## Onde estamos (21/10/2026)

| Item | Hoje |
|---|---|
| Prompt (`prompt-agente.md`) | 259 linhas, **~5.000 tokens**, vai inteiro em toda chamada ao Gemini |
| Chamadas por mensagem | 1 sem ferramenta; **2–3** quando consulta ou marca horário → ~10–15 mil tokens só de prompt |
| Cache do Gemini | **não aproveita**: as linhas 5–7 (data/hora, nome, telefone) mudam a cada mensagem, então o começo do prompt nunca se repete |
| Serviços e preços | escritos à mão no prompt (o CRM tem outra cópia no Supabase) |
| Testes | bateria de 9 cenários (`bateria-ia.js`, rodada à mão, fora do repositório) |

## Resultados

| Fase | Data | Bateria | Tokens de entrada por mensagem | Chamadas ao Gemini por mensagem | Por chamada |
|---|---|---|---|---|---|
| 0 — linha de base | 21/10 | **11/11** ✅ | 13.464 | 1,8 | ~7.540 |
| 1 — prompt organizado | 21/10 | **11/11** ✅ (+4/4 cenários novos) | 12.519 | 1,6 | ~7.620 |
| teste — prompt do ChatGPT (~7.700 tokens) | 21/10 | 14/15 ❌ remarcou sem confirmar | 19.839 | 1,9 | ~10.200 |
| **1 + partes boas do ChatGPT** (~5.600 tokens) — **em uso** | 21/10 | **15/15** ✅ | 16.226 | 1,9 | **~8.350** |

Compare a coluna **por chamada**: as outras mudam conforme os cenários rodados (de 11 para 15) e quantas vezes a IA consulta a agenda.

**Prompt do ChatGPT:**
- **Não foi adotado inteiro.** Os 4 comportamentos novos que ele trazia (comprar só cabelo, "já avaliei", química sem mega, dor ou ferida) **já passavam** com o prompt da Fase 1. Ele custava ~30% a mais por chamada e criou um erro: remarcou sem pedir confirmação.
- **Entrou só o que ele tinha de bom, em ~660 tokens:**
  - regras críticas a mais;
  - "que tipo de cliente é";
  - dúvidas sobre risco, cuidados, multa e mais de 6x;
  - casos de transferência (dor ou ferida, fechar compra, ferramenta falhou);
  - checagem final.
- O arquivo original do ChatGPT continua em `System_Prompt_Toda_Bonita_Mega_Hair_Revisado.txt` (fora do repositório).
- **Em aberto (decisão do Victor):**
  - **valores:** hoje a IA fala o "a partir de" e nunca o valor final;
  - **foto:** hoje a IA só comenta a foto e indica a avaliação, não recomenda o cabelo.

O que os números mostram:
- **O que entra em cada chamada:** ~7.500 tokens, sendo ~5.000 do prompt e o resto de ferramentas e memória. Uma mensagem custa 1,6–1,8 chamadas, porque toda consulta de horário é uma chamada a mais.
- **A Fase 1 não muda a contagem de tokens, e isso é esperado:** o conteúdo é o mesmo. O ganho dela é no **preço**: agora 95% do system message é igual em todas as chamadas, e o Gemini cobra menos por esse começo repetido (cache implícito). O n8n não mostra quanto veio do cache. Para ver, use o painel de uso do Google AI Studio (tokens em cache).
- **O que reduz tokens de verdade é a Fase 3** (núcleo ≤ 2.500 tokens).
- **Problema achado na Fase 1:** em mensagens seguidas, o registro no Supabase acontece antes do buffer. Às vezes isso faz uma mensagem do meio da rajada levar a resposta, e a ordem das mensagens juntadas pode trocar. A IA respondeu uma vez só e certo, mas vale corrigir quando mexermos no buffer.
- Resultados completos: `n8n/demo-agente/testes/resultados/`.

## As 4 fases

```
Fase 0          Fase 1             Fase 2              Fase 3              Fase 4
Linha de base → Organizar prompt → Alterações       → Enxugar           → Áudios prontos
(medir)         (mesmo conteúdo,   (dúvidas reais     (núcleo + base de   (voz da Gleide
                 ordem e seções)    da Gleide)         conhecimento)       nas dúvidas)
```

Regra que vale para todas: **mexeu no prompt → roda a bateria → compara com a anterior.** Uma fase só termina com a bateria passando.

---

## Fase 0 — Linha de base (medir antes de mexer)

**Por quê:** sem uma medida do "antes", não dá para saber se uma mudança melhorou ou piorou.

1. **Levar a bateria para o repositório:** `n8n/demo-agente/testes/`
   - `bateria-ia.js` (o executor) e `cenarios.json` (as conversas).
   - Cada cenário ganha **o que conta como "passou"**: palavras que precisam aparecer, ferramenta que tem de ser usada, o que não pode acontecer (ex.: "não pausar a IA").
   - Só números conferidos como **inexistentes no WhatsApp** (o executor confere antes de rodar).
   - No fim, apaga as clientes de teste do CRM.
2. **Cenários iniciais (os 9 de hoje + os que já corrigimos):**
   - preço (aplicação + cabelo à parte)
   - fora do escopo (unha)
   - desconto ("achei caro")
   - desconto "combinado" / "já paguei" (não transfere)
   - química com mega (marca avaliação de 30 min)
   - dia fechado / almoço (segue o config do salão)
   - rajada de 3 mensagens (1 resposta só)
   - ver / remarcar horário marcado no CRM
   - pedir para falar com a Gleide (transfere)
   - cliente nova vs. cliente que já veio (usa a ficha)
3. **Medir tokens de verdade:** o Gemini devolve o consumo em cada chamada (`usageMetadata`), visível na execução do n8n. Anotar a **média por mensagem** e a **parte que veio do cache**.
4. Salvar o resultado em `testes/resultados/AAAA-MM-DD-linha-de-base.txt`.

**Pronto quando:** a bateria roda com um comando, mostra ✅/❌ por cenário e o total de tokens.

---

## Fase 1 — Organizar o prompt (mesmo conteúdo, nova ordem)

**Por quê:** destrava o cache, sem custo e sem risco, e prepara o terreno para enxugar.

1. **Parte fixa primeiro, parte variável no fim:**
   ```
   [FIXO]  identidade · tom · regras críticas · salão · serviços · agendamento · transferir · mídia
   [VARIÁVEL, sempre por último]  data e hora · nome/telefone · "Sobre esta cliente"
   ```
2. **Seções com título fixo**, uma ideia por seção, na ordem acima. Hoje há regras do mesmo assunto espalhadas (ex.: "não insistir" aparece em três lugares).
3. **Marcar o que é crítico** (inventar preço, transferir, agendar, química com mega) numa seção curta logo no começo: "REGRAS QUE NUNCA PODEM FALHAR".
4. Nenhuma regra é apagada nesta fase. Só muda de lugar ou é juntada com a repetida.

**Pronto quando:** bateria igual à linha de base (nada piorou) e **tokens em cache > 0** nas chamadas seguintes à primeira.

---

## Fase 2 — Alterações (o que falta a IA saber)

**Por quê:** a IA só tira dúvidas que estão no prompt (ou, depois da Fase 3, na base).

1. **Levantar as dúvidas reais com a Gleide**: as 30–50 perguntas que as clientes mais fazem e como ela responde. Pode ser em áudio, que a gente transcreve. Fontes:
   - conversas antigas do WhatsApp dela;
   - as conversas que a IA já teve (aba Conversas do CRM), principalmente as que foram para "Precisam de você".
2. Para cada dúvida: **a resposta da Gleide**, se ela quer em **texto ou áudio** (Fase 4) e se é **regra** (vai pro núcleo) ou **informação** (vai pra base, na Fase 3).
3. Corrigir no prompt o que a bateria e as conversas reais mostrarem de errado.
4. Cada dúvida nova vira **um cenário na bateria**.

**Pronto quando:** a lista de dúvidas está respondida pela Gleide e a bateria cobre as principais.

**Precisa de:** uma conversa de ~30 min com a Gleide (ou ela mandar as respostas em áudio).

**Roteiro da conversa:** `docs/PERGUNTAS-PARA-A-GLEIDE.md` (tudo o que só ela sabe, por prioridade).

---

## Fase 3 — Enxugar (núcleo + base de conhecimento)

**Por quê:** a base pode ter 100 assuntos sem aumentar o custo por mensagem. A IA só busca o trecho que precisa.

1. **Núcleo (sempre no prompt), meta ≤ 2.500 tokens:** identidade, tom, regras críticas, como agendar, quando transferir, lista curta de serviços.
2. **Base de conhecimento** em `empresas.config.base_conhecimento`:
   ```json
   [{ "tema": "cuidados depois da aplicação", "palavras": ["lavar", "piscina", "dormir", "chapinha"],
      "resposta": "..." }]
   ```
   - Fica no Supabase, sem tabela nova; depois a Gleide pode editar pelo CRM.
   - Entram as explicações longas: técnicas, cuidados, durabilidade, tipos de cabelo, pagamento, atraso e cancelamento.
3. **Ferramenta `consultar_base(tema)`:** devolve só o trecho do assunto (~100 tokens). No prompt entra só a **lista de temas** (uma linha cada).
4. **Serviços e preços lidos do Supabase** (tabela `servicos`, a mesma do CRM) em vez de escritos no prompt. Mudou o preço no CRM, a IA já sabe.
5. **Enxugar a escrita:**
   - regra uma vez só;
   - exemplo só onde a IA já errou (ex.: "Gleide" como nome da cliente);
   - listas curtas no lugar de parágrafos;
   - tirar do prompt o que a ferramenta da agenda já garante (horário, almoço, antecedência).

**Pronto quando:** bateria igual ou melhor que na Fase 2, **núcleo ≤ 2.500 tokens** e as dúvidas da Fase 2 respondidas pela base.

---

## Fase 4 — Áudios prontos

**Por quê:** explicação longa em voz é mais humana e convence mais que um texto grande.

1. **Gravação (Gleide):**
   - um assunto por áudio, 20–60 s;
   - sem nome de cliente, sem data e sem "hoje/agora";
   - nada que soe como conversa ao vivo ("me responde que eu te falo agora");
   - gravar no próprio WhatsApp (o som fica igual ao de uma conversa).
   - Começar com 4–6, os temas da Fase 2 marcados como "áudio".
2. **Armazenamento:** Supabase Storage (bucket `audios`). Catálogo em `empresas.config.audios_prontos`:
   ```json
   [{ "tema": "diferença entre as técnicas", "quando_usar": "...", "arquivo": "tecnicas.ogg",
      "duracao_s": 42, "transcricao": "..." }]
   ```
3. **Ferramenta `enviar_audio(tema)`:**
   - mostra **"gravando áudio…"** pelo tempo proporcional à duração;
   - envia como **mensagem de voz** (Evolution `sendWhatsAppAudio`), não como arquivo;
   - grava no CRM (`mensagens`, tipo áudio, com a transcrição) e na memória da IA (para não repetir);
   - se falhar, responde em texto com a transcrição.
4. **Regras no prompt:**
   - áudio só para pergunta que pede explicação;
   - no máximo 1 por conversa (salvo outro tema);
   - nunca o mesmo áudio duas vezes para a mesma cliente;
   - sem áudio se a cliente pediu texto ("tô no trabalho");
   - apresentar com uma frase curta: *"A Gleide gravou uma explicação sobre isso, olha:"*.
5. **Cenários novos na bateria:**
   - pergunta com áudio → manda o áudio;
   - mesma pergunta de novo → não repete;
   - "manda por escrito" → texto;
   - arquivo com erro → texto.

**Pronto quando:** os áudios de teste chegam como mensagem de voz, aparecem no CRM com a transcrição e a bateria passa.

**Precisa de:** 1–2 áudios de teste para montar (qualquer pessoa pode gravar) e os definitivos da Gleide depois.

---

## O que precisamos de fora

| Quando | O quê | De quem |
|---|---|---|
| Fase 2 | dúvidas mais comuns e as respostas | Gleide |
| Fase 2 | quais dúvidas vão em áudio | Gleide |
| Fase 4 | 1–2 áudios de teste | Victor |
| Fase 4 | áudios definitivos | Gleide |
| Depois | tela no CRM para editar a base e os áudios | José Paulo (opcional) |

## Medidas para acompanhar

| Medida | Linha de base | Meta |
|---|---|---|
| Tokens de prompt por chamada | ~5.000 | ≤ 2.500 (núcleo) |
| Parte do prompt em cache | 0% | > 50% das chamadas |
| Bateria | 9 cenários | todas as dúvidas principais cobertas, 100% ✅ |
| Transferências desnecessárias | medir nas conversas reais | cair |
