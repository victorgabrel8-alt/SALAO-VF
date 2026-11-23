---
name: venda-consultiva
description: Use sempre que for analisar uma conversa da IA de atendimento (Gleide e demais lojas) ou mudar o jeito de a IA conversar e vender pelo WhatsApp. Traz o método de venda consultiva de alto valor tirado de livros e repositórios, o jeito de falar, a lista dos erros que se repetem neste projeto e o passo a passo para corrigir o prompt sem remendo.
---

# Venda consultiva pelo WhatsApp (serviço de alto valor)

O Victor sabe dizer o que está errado numa conversa, mas não como consertar. Esta skill é o "como": ela transforma
uma reclamação ("o jeito de falar não parece venda consultiva") em defeitos com nome, cada um com o princípio que
ele fere e a forma certa de escrever.

## Quando usar

Sempre. O Victor pediu em 22/11/2026 que toda alteração na conversa da IA passe por esta skill: não mexer em
frase nenhuma do prompt por conta própria, sem antes passar o diagnóstico e a fala.

- O Victor aponta uma conversa ruim ou pede para melhorar a venda, a condução ou o tom da IA.
- Antes de mexer em `n8n/demo-agente/prompt-agente.md` ou em `n8n/demo-agente/prompt-modular/`.
- Ao escrever qualquer mensagem que a IA manda para cliente (alô, lembrete, retomada).

## O passo a passo

1. **Leia a conversa inteira**, não só a resposta reclamada. Marque em que resposta a cliente esfriou.
2. **Passe o diagnóstico** de [diagnostico.md](references/diagnostico.md) resposta por resposta. Dê nome a cada
   defeito; não escreva "ficou fria" ou "ficou vendedora" sem dizer qual frase e por quê.
3. **Ache a origem no prompt.** A IA imita os exemplos e as frases-modelo do prompt mais do que obedece às regras.
   Procure no prompt a frase parecida com a que ela disse (`grep`). Quase sempre o defeito foi ensinado por um
   exemplo. Tire ou reescreva o exemplo; não basta somar uma proibição.
4. **Reescreva a resposta do jeito certo** usando [fala.md](references/fala.md) e o princípio de
   [principios.md](references/principios.md). Essa reescrita vira o exemplo novo do prompt.
5. **Confira com o teste**: `node testes/banco/rodar.js <rótulo> --simular --novo` gera conversas inteiras;
   `conferir.js` acusa as frases de vendedor. Leia as conversas, não só a nota.
6. **Mostre ao Victor o antes e o depois** da mesma situação, lado a lado, e só publique com o ok dele.

## As três perguntas que resolvem quase tudo

Para cada resposta da IA, pergunte:

1. **Quem falou mais, a IA ou a cliente?** Na venda consultiva a cliente fala mais. Se a IA explicou, elogiou e
   ofereceu na mesma resposta, ela vendeu em vez de escutar.
2. **A IA disse o benefício ou deixou a cliente dizer?** Fato dito pela IA é informação; vantagem dita pela IA é
   propaganda ("o que ajuda muito", "é uma ótima notícia"). A vantagem tem de sair da boca da cliente.
3. **A resposta pede concordância ou pede conteúdo?** "…, né?" pede um "sim" e fecha a conversa. Pergunta aberta
   ("como", "o que") pede conteúdo e abre.

## Arquivos

- [principios.md](references/principios.md): o método, por livro, com o que cada um muda na conversa do salão.
- [fala.md](references/fala.md): o jeito de falar; o que soa vendedor e como dizer a mesma coisa como consultora.
- [diagnostico.md](references/diagnostico.md): os erros que se repetem neste projeto, com origem e conserto.
- [fontes.md](references/fontes.md): livros e repositórios usados.

## Regras deste projeto que valem acima do método

- Preço: só a mão de obra da tabela do app; valor de cabelo e total só a Gleide passa.
- Nada de escassez inventada, depoimento inventado ou garantia de resultado.
- Quem nunca usou mega não recebe pergunta técnica; o caminho dela é a avaliação.
- Simpática e gentil sempre: consultiva não é fria. O que sai é a empolgação de vendedor, não o calor.
