# Plano: corrigir os erros do PDF e a agenda "um atrás do outro" (Carol)

Situação em 20/11/2026. O Conferente já está no ar na Carol (modo observar, 13h00).

## Parte A: agenda colada ("atendimento atrás do outro")

### A regra, nas palavras da Caroline (assistente, 20/11, 12h27)
> "Você tem que colocar os atendimentos sempre um atrás do outro porque eu vou sair do estúdio 10h30 da manhã,
> como que eu vou voltar 3h30 só pra fazer um conserto."
> "Estou morando a 8 km do estúdio, tenho que ir pro estúdio fazer os atendimentos e voltar pra casa de uma vez.
> Você tem que fazer uma logística na minha agenda que seja atendimento atrás do outro."

### O problema hoje
- A conta da agenda (`agenda-calculo.js`) oferece **o primeiro horário livre da manhã e o primeiro da tarde**,
  sem olhar onde já tem cliente.
- Resultado: um dia com cliente às 8h e outra às 15h (a Caroline vai e volta), ou um dia novo aberto para uma
  cliente só, quando o dia anterior ainda tinha espaço colado.
- Caso real de 20/11 (Vanessa): conserto de 10 min marcado às 14h30 de sábado, num dia em que a Caroline ia sair do
  estúdio às 10h30.

### Como vai funcionar (só na Carol: `"agenda_colada": true` no loja.json)
1. **Dia que já tem cliente:** a IA só oferece horário **colado** no que já existe: começando quando a última
   cliente termina, ou terminando quando a primeira começa. Sem buraco no meio.
2. **Dia vazio:** só abre um dia novo se não couber nos dias que já têm cliente (dentro da semana que ela pediu).
   No dia vazio, o primeiro horário oferecido é o do começo do expediente (ou o que a cliente pediu), e as
   próximas colam nele.
3. **Serviço curto** (conserto, reposição, lixamento): vai na frente ou atrás de quem já está marcado, nunca sozinho
   num horário solto.
4. **Ordem do que a IA oferece:** 1º encaixe colado no dia que a cliente pediu → 2º encaixe colado no dia mais
   próximo com cliente → 3º começo de um dia vazio.
5. **A cliente insiste num horário que deixa buraco:** a IA oferece de novo o colado. Se ela não puder nenhum, a
   pergunta vai para a Caroline (perguntar_para_dona: "ela só pode às 15h, deixa buraco de 3h, aceita?").
6. **Assistente da Caroline:** quando a própria Caroline marca, vale o que ela mandar. Mas se o horário deixar
   buraco, o assistente avisa: "Isso deixa 3h livres entre a Ana (10h) e ela (15h). Marco mesmo assim?"
7. **Dia que ela não vai** (como sábado à tarde): o assistente já sabe bloquear (bloquear_horario). Continua igual.

### Onde muda (código, sem mexer no texto da IA)
- `agenda-colada.js` (novo, no estilo de `almoco-flexivel.js` e `bloco-minimo.js`): troca, no "Calcular" da agenda,
  a escolha dos 2 horários e o quadro do dia para usar só os encaixes colados.
- Assistente: aviso de buraco no `marcar_horario` (ferramentas da assistente).
- Teste na Loja Teste antes, com agendas montadas: dia com 1 cliente, dia com 2 e buraco, dia vazio, serviço de
  10 min, dia bloqueado à tarde.

### O que a Caroline decide (antes de ligar)
| # | Pergunta | Sugestão |
|---|---|---|
| 1 | Quanto de folga entre uma cliente e outra ainda conta como "colado"? | até 15 min |
| 2 | Cliente que só pode num horário com buraco: a IA pergunta para você ou diz que não tem? | pergunta para você |
| 3 | Dia vazio começa em que hora? A abertura do expediente ou o que a cliente pedir? | o que a cliente pedir, e as próximas colam nela |
| 4 | Tem dias fixos em que você vai ao estúdio? (ex.: só terça a sábado) | ela diz |
| 5 | Segunda: qual é o horário certo? (o app diz 8h às 18h, mas você só atende à tarde) | ela corrige em Dados do salão |

## Parte B: corrigir os erros do PDF (IA-CAROL-1-ERROS)

Em lotes. Cada lote: código, testes, testador, Loja Teste quando der, e só sobe para a Carol com o ok do Victor.

### Lote 1: rápidos, só código, sem mexer no texto da IA
| Erro do PDF | Conserto |
|---|---|
| Comprovante sempre "suspeito" (sistema) | Troca o pedido de leitura da foto: print de banco é normal; "suspeito" só com sinal claro de edição (sinal-pix.js) |
| 4. Sinal pago que some quando a Caroline marca | Quando a assistente marca o horário, procura o comprovante que a cliente mandou (e ainda não usado) e grava o sinal no horário |
| 6. Mês trocado (assistente) | Data sem mês = a próxima vez que esse dia acontece; antes de gravar, confere a data dita com a gravada e mostra para a Caroline |
| Novo, 20/11 (Vanessa). Assistente manda 2 mensagens iguais para a mesma cliente | 1) Junta as mensagens seguidas da Caroline (espera ~20 s) antes de responder; 2) mandar de novo para a mesma cliente em menos de 10 min pede confirmação à Caroline |

### Lote 2: confirmação e "uma voz"
| Erro do PDF | Conserto |
|---|---|
| 3. "Confirmo" não vai para a agenda (9 de 9) | Coluna nova `confirmado_em` em agendamentos (só soma); o "sim" ao lembrete grava e o app mostra o selo ✓ confirmou (Porteiro, fase B do orquestrador) |
| 2. Duas IAs falando com a mesma cliente | O que a assistente fez entra como aviso para o atendimento, e o atendimento espera se a Caroline falou há menos de 10 min |
| Duas confirmações na véspera | O assistente não manda "confirmando seu horário" quando o lembrete automático já foi |

### Lote 3: Conferente de verdade (depois de 1 ou 2 dias observando)
| Erro do PDF | Conserto |
|---|---|
| 5. "Reservei" sem reservar | Conferente ligado: barra e o Gemini reescreve, no mesmo tom |
| 8. Coisas inventadas (curso, "Pix copia e cola") | Conferente: preço fora da lista e endereço; o resto entra na lista dele conforme o observar mostrar |
| 9. Muitas ofertas, cliente perdida | Conferente: horário que não veio da última consulta |
| 1. Chave Pix confusa (o que sobrou depois de 19/11) | Conferente barra a chave repetida; depois, Pix pelo sistema (3 mensagens fixas: precisa de uma seção nova no prompt, só acrescenta) |

### Lote 4: o que precisa de decisão ou de cadastro
| Erro | O que fazer |
|---|---|
| 7. Ficou de responder e esqueceu | Ponte numerada (fase C): pedido aberto lembra a Caroline e entra no resumo das 18h |
| Cliente com dois cadastros (com e sem o 9) | Lista para a Caroline conferir e juntar uma a uma (dado de cliente: não junta sozinho) |
| Agenda do Google e app não conversam | Decisão de ler e escrever na Google (plano das duas agendas, junto com a Duda) |
| Restos da Gleide | Renomear perguntar_para_gleide para perguntar_para_dona na Carol |
| 12. Tom da assistente (✨, "fase de teste") | Prompt da assistente: mesmo jeito da Caroline (seção 25) também para ela |

### Para a Caroline resolver no app (não é código)
- Cliente final 7931 acha que tem horário em 03/12 e não existe: marcar ou avisar.
- 4 sinais pagos sem registro (finais 6657, 8392, 1868, 2188): descontar no dia.
- Horário de segunda em Dados do salão.

## Ordem sugerida
1. Hoje: Lote 1 + agenda colada (depois das respostas da Caroline às 5 perguntas).
2. Amanhã: relatório do Conferente (observar) e Lote 2.
3. Depois: Lote 3 (Conferente ligado, Pix pelo sistema) e Lote 4.
