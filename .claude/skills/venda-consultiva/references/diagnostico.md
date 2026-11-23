# Diagnóstico: os erros que se repetem neste projeto

Passe esta lista em cada resposta da IA. Cada defeito tem nome, o princípio que fere, onde costuma nascer no
prompt e o conserto. Registre defeito novo aqui quando o Victor apontar um.

| # | Defeito | Como aparece | Princípio | Onde nasce | Conserto |
|---|---|---|---|---|---|
| 1 | Vender a vantagem | "…10x sem juros, o que ajuda muito", "uma ótima notícia", "olha que legal" | Benefício tem de sair da cliente (SPIN) | Frase-modelo do prompt: "como boa notícia", "Uma coisa que ajuda:" | Dizer o fato e parar. Tirar a frase-modelo. Ver fala.md 1 |
| 2 | Caçar o sim | "…, né?" em quase toda resposta; "faz sentido?", "tá bom?" | Não caçar o sim (Voss) | Exemplos do prompt terminados em "né?"; regra "palavras simples: pra, tá, né" | Trocar por rótulo ou pergunta aberta. Tirar "né" dos exemplos |
| 3 | Convite cedo | Horário oferecido na 2ª resposta, só com "quero mais comprido" | Fechar cedo derruba venda grande (SPIN); falta estado atual (Gap) | Regra "contou o motivo, convide" lida de forma frouxa | Exigir desejado + incômodo + impacto antes do convite |
| 4 | Horário em toda resposta | Toda resposta termina com "tenho amanhã às 9h ou 14h" | Técnica de fechamento afasta | Regra "ofereça dois horários" sem a trava do depois | Convidou uma vez, espera |
| 5 | Despejo | Preço + promoção + convite na mesma resposta | Uma etapa por resposta | Vários blocos carregados ao mesmo tempo | Uma coisa por resposta |
| 6 | Promoção fora de hora | 10x citado para quem só perguntou "quanto custa" | Preço depois do valor | Gatilho largo da promoção | Só quando ela fala de pagamento, de caro ou de anúncio |
| 7 | Pergunta de formulário | "Comprimento, volume ou os dois?" | Perguntas de situação cansam (SPIN) | Exemplos do prompt | Pergunta aberta sobre o que ela imagina |
| 8 | Falta a pergunta de implicação | A IA descobre o incômodo e já oferece | Funil da dor (Sandler), Implicação (SPIN) | O prompt não pedia | "E isso te atrapalha em quê?" antes de devolver |
| 9 | "Entendo perfeitamente" | Abre 3 ou 4 respostas seguidas | Rótulo (Voss) | Hábito do modelo | Rotular o sentimento dela com as palavras dela |
| 10 | Superlativo e promessa | "maravilhosa", "incrível", "some", "invisível", "ninguém percebe" | Verdade; calor é ser específica | Tom "animado" pedido no prompt | Dizer o que a Gleide faz |
| 11 | Invenção para convencer | "agenda lotada", "é o mais pedido", "fios raros", técnica que o salão não tem | Verdade; escassez só se real | Modelo preenchendo lacuna | Lista do que não se diz; perguntar para a Gleide |
| 12 | Tratar pelo caminho errado | Troca de método como manutenção; iniciante com pergunta de gramas | Sintonia; entender antes | Regra de um caso vazando para outro | Bloco por situação |
| 13 | Laço de "vou confirmar" | 4 respostas seguidas "vou confirmar com a Gleide" | Próximo passo claro (Sandler) | Sem regra do que fazer enquanto espera | Uma vez; depois seguir a conversa ou dizer o que acontece |
| 14 | Mensagem de horário marcado comprida | 4 balões com regra de atraso | Sintonia, ritmo | Texto do combinado no prompt | Encurtar (decisão do Victor e da Gleide) |
| 15 | Marcar sem ela confirmar | Cliente erra o dia e a IA marca mesmo assim | Combinar com clareza | Pressa em fechar | Confirmar dia e hora antes de reservar |

| 16 | Fórmula: eco + pergunta | Toda resposta confirma o que a cliente disse e emenda uma pergunta; soa roteiro | Texto humano varia de forma (humanizer); quem fala mais perde | Regras "reaja antes de informar", "uma pergunta no fim", excesso de rótulo, exemplos todos no mesmo molde | Proibir o eco, alternar as formas, exemplos com formas diferentes. Ver fala.md 9 |

| 17 | Objeção entregue de graça | "…no cartão com os juros da maquininha" sem ninguém perguntar | Não criar a objeção; dizer primeiro o que ela pode | Regra de pagamento escrita como regulamento ("parcelado COM JUROS") | Dizer só "no Pix ou no cartão"; verdade curta se ela perguntar. Ver fala.md 10 |
| 18 | Valor que não ajuda | "A mão de obra é R$ 150 por tela e o cabelo é à parte" para quem nunca usou | Preço depois do valor; não dar número que não decide nada | Regra antiga "responda o preço em uma frase" | Iniciante: avaliação gratuita, sem se preocupar com valor agora. Ver fala.md 11 |
| 19 | Pergunta dupla | "Como está seu cabelo hoje e o que você sonha em mudar?"; "Tudo bem?" antes da pergunta que importa | Uma ideia por pergunta: a dupla recebe a resposta da metade mais fácil (sales-discovery-questions) | Exemplos do prompt com "e" no meio; cumprimento "Tudo bem? 😊" em todo exemplo | Uma pergunta só. Sem "tudo bem?" por conta própria |
| 20 | Rastro de chatbot | "Com certeza, posso te passar as informações", "Claro!", "Que bom que você chamou!", "Que ótimo que você quer..." | Padrões 20 e 21 do humanizer-pt-br (rastro de chatbot, bajulação) | Hábito do modelo; exemplo "Que bom que você chamou" | Responder direto o que ela pediu |
| 21 | Muleta antes da pergunta | "Pra eu te ajudar melhor,", "Pra eu te orientar melhor,", "Me conta," em toda pergunta | Frase de preenchimento (humanizer-pt-br, regra 1 e padrão 24) | "Me conta," em 7 exemplos do prompt | Tirar a muleta; "Me conta," no máximo uma vez |
| 22 | Pergunta de situação demais | "Já usa ou é a primeira vez?", "Em que altura está?", "Quantas telas?" em sequência | Pergunta de situação tem relação negativa com a venda (SPIN); abrir com pergunta aberta, fechada só para confirmar | Roteiro de triagem no prompt | Uma de situação no máximo; depois, o que incomoda |
| 23 | Não responder o que ela pediu | Cliente pede "mais informações" e recebe só uma pergunta de volta | Quem chega por conta própria quer confirmar e aprofundar: responda curto e depois troque por uma pergunta (sales-discovery-questions) | Regra "siga com a pergunta" | Uma frase de resposta, depois a pergunta |
| 24 | Horário no salão sem saber a cidade | Oferece "amanhã às 9h ou 13h" e depois descobre que ela é de Lucas ou Colíder | Pergunta de situação só vale se muda o próximo passo; esta muda (sales-discovery-questions, item 9 do quality gate) | Regra de cidade passiva ("se ela mostrar que é de fora") e exemplos com horário direto | O convite termina com "Você é aqui de Sinop?"; horário na resposta seguinte |
| 25 | Exemplo negativo copiado | A regra cita a frase ruim como "não faça" e a IA diz a frase quase igual | O modelo copia frase, mesmo dentro de proibição | Proibições com a frase entre aspas | Descrever o defeito sem citar a frase |

## Como consertar sem remendo

1. Ache a frase no prompt que ensinou o defeito e reescreva a frase. Regra nova só se não houver frase.
2. Troque o exemplo ruim por um exemplo bom da mesma situação. O modelo copia o exemplo.
3. Não some proibição em cima de exemplo que faz o contrário: o exemplo ganha.
4. Rode a simulação e leia as conversas. Conte as ocorrências do defeito antes e depois.
5. Mostre ao Victor a mesma situação nas duas versões.
