# Plano: quando a cliente precisa da Gleide

Ideia do Victor (25/10/2026), organizada. Objetivo: a Gleide **não precisa ler conversa nenhuma** para decidir.
A IA de atendimento resolve sozinha o que está cadastrado; o que depende da Gleide chega para ela já resumido,
pela **assistente da Gleide** (o workflow "Assistente da Gleide", que já conversa com ela pelo WhatsApp).

---

## Os dois caminhos

| | **A. Pergunta rápida** (a Gleide só autoriza) | **B. Precisa da Gleide** (ela mesma conversa) |
|---|---|---|
| Exemplos | "Posso levar meu cachorro?", "Posso levar acompanhante?", "Dá pra pagar metade no Pix e metade no cartão?", "Tem estacionamento?" (enquanto não estiver cadastrado) | Avaliação à distância ("moro longe, dá pra avaliar por foto?"), reclamação, dor ou reação depois de procedimento, negociação de preço, cliente pediu para falar com ela |
| A IA para de atender? | **Não.** Continua respondendo o resto da conversa | **Sim**, pausa 12 h para essa cliente |
| O que a IA diz à cliente | "Vou confirmar com a Gleide e já te falo 😊" | "Vou passar sua conversa pra Gleide, ela te chama por aqui 😊" |
| O que a Gleide recebe no WhatsApp | A pergunta pronta para responder com uma palavra | Um resumo curto e o link do app |
| Como a Gleide responde | **No WhatsApp, para a assistente:** "pode" / "não" / um texto | **Ela mesma**, falando direto com a cliente (WhatsApp Business ou botão do app) |
| Quem dá a resposta à cliente | A IA, com as palavras dela | A Gleide |

**Regra para a IA escolher:** se a resposta for "sim/não" ou uma informação curta que só a Gleide sabe → **A**.
Se envolver avaliar o cabelo, dinheiro fora da tabela, saúde, reclamação ou a cliente pedir a Gleide → **B**.
Na dúvida → **B**.

---

## Caminho A: pergunta rápida

### Passo a passo
1. **Cliente:** "Posso levar minha cachorrinha? Não tenho onde deixar."
2. **IA (para a cliente):** "Vou confirmar com a Gleide e já te falo 😊" e segue a conversa normalmente.
3. **IA → banco:** cria um pedido (`tipo = pergunta`) com a pergunta pronta.
4. **Assistente → WhatsApp da Gleide:**
   ```
   ❓ Pergunta da Maria (66 99999-0000)
   Pode trazer a cachorrinha no dia da avaliação? Não tem onde deixar.
   Quinta, 29/10, às 9h.

   Responda: pode / não pode / ou escreva o que quer que eu diga
   ```
5. **Gleide (para a assistente):** "pode, só deixar na coleira"
6. **Assistente:** grava a resposta no pedido, e a **IA manda para a cliente**:
   "A Gleide respondeu: pode trazer sim, só deixar na coleira 😊"
7. **Assistente → Gleide:** "Avisei a Maria ✓"

### Detalhes que fazem funcionar
- **Várias perguntas abertas ao mesmo tempo:** a assistente numera ("❓ 1 · Maria …", "❓ 2 · Ana …").
  A Gleide responde "1 pode" ou responde **citando** a mensagem da pergunta (o "responder" do WhatsApp).
  Sem número nem citação e com mais de uma aberta, a assistente pergunta "É sobre a Maria ou a Ana?".
- **Gleide demorou:** depois de 30 min a assistente lembra uma vez. Se a cliente perguntar de novo, a IA diz
  "Ainda estou esperando a Gleide, assim que ela responder eu te aviso", sem inventar resposta.
- **Fora do horário (depois das 20h):** a pergunta fica guardada e vai às 8h.
- **Resposta que vira regra:** se a Gleide responder algo que vale para todas ("pet pode sempre"), a assistente
  pergunta "Quer que eu responda isso sozinha das próximas vezes?". Se sim, a regra entra no cadastro do salão e
  a IA para de perguntar.

---

## Caminho B: precisa da Gleide

### Passo a passo
1. **Cliente:** "Moro longe, preciso de uma avaliação breve à distância."
2. **IA (para a cliente):** "Vou passar sua conversa pra Gleide, ela te chama por aqui 😊" e **pausa** por 12 h.
3. **IA → banco:** cria um pedido (`tipo = atendimento`) com o **resumo**.
4. **Assistente → WhatsApp da Gleide:**
   ```
   🔔 Cliente precisa de você
   Victor · (66) 99927-0860
   Quer uma avaliação à distância por foto: mora longe. Cabelo curto e escuro, quer comprimento
   no meio das costas (mandou 2 fotos).

   Ver resumo e falar com ele: app.oistudio.com.br/conversas/…
   ```
5. **App (link abre direto na conversa):** no topo, o cartão **Resumo da IA**:
   - **Quem é:** cliente nova, primeira conversa hoje.
   - **O que quer:** avaliação à distância antes de vir; mora longe.
   - **O que a IA já explicou:** avaliação presencial gratuita; mandou o áudio de preço.
   - **Fotos:** as duas, em miniatura.
   - **O que precisa de você:** dizer se dá para orientar por foto ou por vídeo.
   - Botões: **Responder no WhatsApp** · **Resolvido**
6. **Gleide** fala direto com a cliente. **Resolvido** tira a cliente de "Precisam de você" e reativa a IA.

---

## No app

- **Início → "Precisam de você":** os dois tipos. Pergunta (A) com os botões **Pode** / **Não pode** /
  **Responder** ali mesmo (a IA avisa a cliente). Atendimento (B) com a 1ª linha do resumo, há quanto tempo
  está esperando e o botão de WhatsApp.
- **Conversa:** cartão de resumo no topo enquanto o pedido estiver aberto.
- Responder pelo app ou pelo WhatsApp dá no mesmo: o pedido fecha nos dois lugares.

---

## Banco

Tabela nova `pedidos_dona` (um pedido por vez que a IA precisa da dona):

| Coluna | Para quê |
|---|---|
| `id`, `empresa_id`, `cliente_id` | |
| `tipo` | `pergunta` (A) ou `atendimento` (B) |
| `pergunta` | A: a pergunta pronta para a Gleide |
| `resumo` | B: o resumo da conversa |
| `status` | `aberto` → `respondido` (A) ou `resolvido` (B) |
| `resposta` | A: o que a Gleide respondeu |
| `wa_message_id` | id da mensagem que a assistente mandou para a Gleide (para a citação) |
| `criado_em`, `lembrado_em`, `respondido_em` | lembrete de 30 min e tempo de resposta |

Funções novas: `n8n_criar_pedido` (IA), `n8n_responder_pedido` (assistente ou app), `crm_resolver_pedido` (app).

---

## Na IA (n8n)

- **Atendimento:** a ferramenta `transferir_para_humano` vira duas:
  - `perguntar_para_gleide` (A): `pergunta`; **não** pausa.
  - `passar_para_gleide` (B): `motivo`, `resumo`, `o_que_precisa`; pausa 12 h.
  - Prompt: a regra de escolha acima, e as frases para a cliente ("vou confirmar…" / "vou passar…", nunca "equipe").
- **Assistente da Gleide:** entende "pode / não / 1 pode / citação" como resposta a um pedido aberto, grava e
  manda a resposta para a cliente pela IA. Lembrete de 30 min no workflow de pendências que já roda a cada 15 min.

---

## O que precisa antes de ligar

1. **Número pessoal da Gleide**, diferente do número do salão (o WhatsApp não manda mensagem para ele mesmo).
   Ele entra em `ASSISTENTE_NUMEROS` (compose do Easypanel) e em `empresas.config.assistente_numeros`.
   Se ela só tiver um número: o caminho B funciona por notificação do próprio app (depois), e o A espera.
2. **Teste sem a Gleide:** o número de teste da "Gleide" não pode ser o mesmo que testa como cliente (um número
   só faz um papel). Usar o do José Paulo como "Gleide" e o do Victor como cliente, por exemplo.

## Ordem sugerida

| Quando | O quê |
|---|---|
| Antes de segunda | **Só o B, simples:** resumo + aviso no WhatsApp com o link (vai para o número do Victor por enquanto) e frase "vou passar pra Gleide". |
| Semana de 26/10 | Cartão de resumo e botão **Resolvido** no app (José Paulo). Tabela `pedidos_dona`. |
| Com o número da Gleide | Caminho **A** completo pela assistente, lembrete de 30 min, botões Pode/Não pode no app. |
| Depois | Resposta que vira regra; notificação no celular pelo app. |
