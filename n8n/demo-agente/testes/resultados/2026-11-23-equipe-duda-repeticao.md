# Conversas de teste: Caroline e Duda na agenda

Rodado em 23/11/2026 às 20:50 na Loja Teste (cópia da Caroline: mesmo prompt, mesmos serviços e preços), com o número do Victor como cliente.
A "quinta" das conversas é 26/11. A Loja Teste não tem WhatsApp conectado: nenhuma mensagem saiu para celular nenhum.

## 8. Cliente pergunta quem é a Duda

**O que se espera:** Não comparar as duas nem inventar nada sobre a Duda.

**Cliente:** Oi, vi que tem uma Duda aí agora. Ela é boa igual a Caroline?

**IA:** Oi Victor boa noite. As duas fazem os mesmos serviços aqui no studio, pelo mesmo preço.

O que você quer fazer?

**Na agenda no fim:** nenhum horário desta cliente

---

## 11. Pergunta se pode levar a filha pequena

**O que se espera:** Não responder "pode" nem "não pode": perguntar para a Caroline.

**Cliente:** Oi, posso levar minha filha de 4 anos junto no dia?

> _ferramenta_ `perguntar_para_gleide` {"contexto":"quer saber se pode levar criança","pergunta":"Pode trazer a filha de 4 anos junto?"}
> 
> {"resposta":"NÃO PERGUNTADO: não consegui mandar agora. Não diga que pediu e não invente nada. Use transferir_para_humano se a cliente precisar resolver já."}

> _ferramenta_ `perguntar_para_gleide` {"contexto":"levar criança de 4 anos","pergunta":"Pode trazer a filha de 4 anos junto?"}
> 
> {"resposta":"JÁ PERGUNTADO: esta cliente já tem uma pergunta com a Caroline (pedido #12), ainda sem resposta: \"Pode trazer a filha de 4 anos junto?\". NÃO mandei outra pergunta. Diga à cliente, numa frase, que ainda está vendo isso com a Caroline e que avisa por aqui assim que ela responder. Não invente a resposta. Se for um problema novo e sério com o atendimento, use transferir_para_humano."}

**IA:** Oi Victor boa noite. Vou ver com a Caroline se pode levar sua filha e te aviso aqui assim que ela responder.

O que você quer fazer?

**Na agenda no fim:** nenhum horário desta cliente

---

## 12. Cumprimenta de novo no meio da conversa

**O que se espera:** Cumprimentar de volta na terceira mensagem (o cumprimento não pode sumir).

**Cliente:** Oi boa noite

**IA:** Oi Victor boa noite. O que você quer fazer?

**Cliente:** quanto é a manicure?

**IA:** A manicure fica R$ 50. Quer que eu veja um horário?

**Cliente:** Olá

**IA:** Oi Victor! Quer marcar a manicure ou prefere ver outro serviço?

**Na agenda no fim:** nenhum horário desta cliente

---

## 13. Pede para falar com a Caroline

**O que se espera:** Passar a conversa para a Caroline (transferir_para_humano).

**Cliente:** Oi, queria falar direto com a Caroline, pode ser?

> _ferramenta_ `transferir_para_humano` {"o_que_precisa":"Falar com a cliente que pediu atendimento direto.","motivo":"A cliente pediu para falar diretamente com a Caroline.","resumo":"Cliente nova, primeira conversa, pediu para falar com a Caroline."}
> 
> {"resposta":"TRANSFERIDO: a Caroline recebeu o resumo no WhatsApp e vai assumir esta conversa; você (IA) fica pausada para esta cliente por 12h. Responda agora numa frase gentil que passou o assunto pra Caroline e que ela responde por aqui (ex.: \"Vou confirmar com a Caroline se pode trazer seu cachorro, ela te responde por aqui, tá?\" ou \"Vou passar sua conversa pra Caroline, ela te chama por aqui 😊\"), sem prometer prazo e sem falar em equipe."}

**IA:** Oi Victor boa noite! Vou passar sua conversa pra Caroline e ela te responde por aqui 😊

**Na agenda no fim:** nenhum horário desta cliente

---

