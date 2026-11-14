# Plano: motor único e cadastro simples (mega hair e unhas)

Combinado com o Victor em 13/11/2026. Complementa o `PLANO-VARIAS-LOJAS.md`: adianta a fase 9 de lá
("juntar tudo") e muda o jeito de entrar loja nova.

## Decisões

- O Victor vende só para **dois ramos**: **mega hair** e **unhas** (manicure e pedicure juntos).
  Menos ramos, mais fácil de escalar.
- **Um motor só** de IA no n8n para todas as lojas. Acabam o conjunto de 15 fluxos por loja, o prompt
  por loja e a lista de trocas de texto do `loja.json`.
- **Um modelo por ramo**, mantido pela agência: prompt, serviços padrão, textos de foto e de retomada.
- Cada loja só tem **dados**, preenchidos pela dona no app: horários, serviços com preço e duração,
  endereço, formas de pagamento, regras de sinal e atraso, número dela para avisos e um recado para a IA.
- **Um banco só** (decisão de 03/11): cada loja é uma linha em `empresas`, tudo separado por `empresa_id`.
- A IA de loja nova **só responde clientes depois que a agência aprova**.

## Custo do Gemini (decidido em 13/11)

A conta do Gemini é da agência e entra na mensalidade. O que protege a agência é um **teto por loja**:

- Cada plano inclui uma quantidade de conversas por mês (`empresas.config.ia_limite_mes`).
- O motor soma o uso de cada loja no mês a partir de `registros_ia`.
- Com 80% do teto: aviso para a agência e para a dona.
- Com 100%: a IA daquela loja para de responder sozinha e avisa a dona, até a agência liberar.
- Opção para loja grande: chave própria do Gemini na ficha da loja. Com chave própria, o motor usa a
  dela e não conta no teto. (Conferir na etapa 1 como trocar a chave por loja no n8n.)
- Antes de fechar o preço dos planos: conferir o custo por conversa (cerca de R$ 0,50 em 04/11) com a
  fatura do Google. Ligar também um alerta de orçamento na conta do Google.

**Como ficou construído (14/11, `supabase/048` e `motor.js`):**
- **Conversa** = uma cliente num dia em que a IA mandou pelo menos uma mensagem para ela (resposta,
  lembrete, retomada ou retorno). Conta o mês corrente, no fuso da loja. Só conta mensagem que saiu de
  verdade (gravada em `mensagens` com autor `ia`).
- **Teto:** `empresas.config.ia.limite_mes`. Sem a chave, a loja não tem teto.
- **No teto:** quem já falou com a IA hoje continua sendo atendida; conversa nova fica sem resposta
  automática; retomada e retorno param; lembretes de horário, avisos e a assistente da dona continuam.
- **Avisos:** de hora em hora o Rotinas confere; em 80% e em 100% manda, uma vez por nível no mês, um
  WhatsApp para a dona (pelo número da loja) e outro para a agência (`numero_agencia` no `loja.json`).
- **Para liberar:** aumentar `limite_mes`.
- Uso em 14/11, pela mesma conta: Gleide 151 conversas no mês, Caroline 19 (elas não estão no motor).

Testado na Loja Teste em 14/11 com o teto igual ao uso: cliente nova parou na entrada; a dona passou para
a assistente; quem já tinha conversa no dia foi atendida; o aviso de 100% saiu para a agência e não se
repetiu no segundo disparo. O aviso para a dona falhou só por a instância da Loja Teste não existir.

Limites conhecidos: a mensagem da cliente barrada não entra no app (a dona só fica sabendo pelo aviso de
100%); se o envio do aviso falhar, ele não é tentado de novo; a chave própria do Gemini por loja não foi
feita; o custo real por conversa ainda precisa ser conferido com a fatura do Google.

## Regra de ouro (continua valendo)

Nada muda o que a Gleide e a Caroline usam durante a obra. O motor roda ao lado, com outros nomes,
outros webhooks e só na Loja Teste, até provar que funciona. No banco, só mudança que soma.

## Como o motor funciona

1. Chega mensagem no webhook único. A instância da Evolution diz de qual número veio.
2. O motor acha a loja por `empresas.instancia_whatsapp`. Loja inativa ou não aprovada: não responde.
3. Lê do banco: ramo, nome da dona, fuso, horários, serviços e preços, endereço, pagamento, regras, recado.
4. Monta o prompt na hora: **base comum + modelo do ramo + dados da loja**.
5. Memória, pausa e filas no Redis com a loja na chave (`<empresa_id>:memoria:…`).
6. As rotinas (retomada, faltas, lembrete, retorno, pendências) percorrem todas as lojas ativas.

Preço ou horário mudado no app vale na conversa seguinte, sem gerar nem enviar fluxo.

## Entrada de loja nova

Enquanto forem poucas lojas por mês, quem cria é a agência, no painel:

1. **Nova loja**: nome, ramo, nome, e-mail e WhatsApp da dona.
2. O servidor chama `criar_loja` (loja, profissional, serviços padrão do ramo sem preço), manda o convite
   de login e cria a instância na Evolution com o webhook do motor.
3. O **QR aparece na tela**; a dona escaneia.
4. A dona preenche no app Dados do salão e Serviços e preços.
5. A IA nasce com a trava de teste (só o número da agência). A agência testa e libera por botão.

Quando o volume pedir: tela **Criar minha conta** no app (salão, dona, e-mail, senha, telefone, ramo,
cidade). Cria a mesma coisa, com a loja em "aguardando aprovação", e o QR aparece dentro do app.

## Como foi construído (13/11)

**Um motor por ramo.** Mega hair e unhas têm ferramentas e prompt diferentes, então cada ramo tem o seu
conjunto: `motor-unhas` e, depois, `motor-megahair`. São 2 conjuntos no total, com qualquer número de lojas.

- O motor é gerado pelo mesmo gerador: `node montar-workflow.js --loja motor-unhas`.
- `lojas/motor-unhas/` é uma loja modelo. O `loja.json` tem `"motor": true` e marcas (`MOTORxEMPRESA`,
  `MOTORxDONA`…) no lugar dos dados. O `motor.js` troca cada marca por uma leitura da ficha da loja.
- Levantamento: cada loja tinha cerca de 550 pontos fixos em 15 workflows (id da loja, instância, nome
  da dona, números, chaves do Redis). No motor todos viram leitura da ficha.
- Cada workflow ganha o nó **Loja** logo na entrada. No webhook, a ficha vem do banco pela instância
  (`motor_loja`, `supabase/047`). Nos subworkflows, quem chama manda a ficha junto (`loja_json`).
- As rotinas (faltas, retomada, retorno, pendências) são disparadas pelo workflow **Rotinas**, uma vez por
  loja do motor (`motor_lojas`).
- Uma loja entra no motor com `empresas.config.ia.motor = true`. Em 13/11 nenhuma loja está no motor.
- Trava de teste por loja: `empresas.config.ia.permitidos`. A IA só responde todas as clientes com
  `empresas.config.ia.liberada = true`; sem lista e sem liberação, não responde nenhuma cliente.
- Só ligar `motor = true` numa loja **sem conjunto próprio ativo** no n8n (senão as rotinas rodam em dobro).
- Teste de rotina numa loja só: `GET /webhook/motor-unhas-rotina-<faltas|retomar|retorno|assistente-pendencias>?empresa_id=<id>`.
- Um testador comparou o motor com o conjunto da Caroline, nó a nó: com a ficha dela, o motor dá o mesmo
  texto. Os 6 problemas que ele achou foram corrigidos (memória da assistente sem a loja, trava com e sem
  o 9, catálogo sem link, teste das rotinas, alerta de erro nas rotinas, loja de outro ramo).

**Primeiro teste no n8n (13/11, mensagens simuladas no webhook, sem WhatsApp).** Os 16 workflows
"[Motor Unhas]" foram criados no n8n e ficaram **desligados** depois do teste. A Loja Teste está no motor
(`instancia_whatsapp = loja-teste-motor`, instância que não existe; `permitidos` com números falsos).
- Instância desconhecida: para no nó Loja, sem erro.
- Número fora da lista: para no Filtro.
- Número liberado: a IA respondeu com o preço do app da Loja Teste (R$ 110) e consultou a agenda dela
  (a ficha chegou no subworkflow).
- Dona falando com a assistente: a assistente respondeu com a agenda da Loja Teste.
- Nenhum alerta de erro disparou.

**Teste das rotinas (13/11, noite).** Com o Rotinas ligado por alguns minutos e a Loja Teste no motor:
- Os gatilhos de horário (1 min, 5 min, 10 min) e os quatro disparos manuais chamaram cada rotina com a
  ficha da Loja Teste.
- Disparo manual sem `empresa_id`: para em "Tem loja?", não roda rotina nenhuma.
- Faltas: fora do horário do salão parou em "Horário do salão?"; pelo disparo manual passou pelas 8 buscas.
- Retomada e retorno: rodaram a busca; não havia ninguém para chamar.
- Pendências: montou a mensagem, passou pela trava e falhou só no envio, porque a instância da Loja Teste
  não existe (de propósito).
- Depois do teste os 16 workflows ficaram desligados de novo.
- `"guardar_execucoes": true` no `loja.json` do motor guarda no n8n também as execuções que deram certo.
  Serve para a fase de teste; tirar antes de pôr várias lojas (a retomada roda a cada minuto por loja).

**Ainda não provado:** uma rotina mandando mensagem de verdade (lembrete, retomada, retorno com cliente
para chamar), o envio real da resposta pelo WhatsApp, duas lojas ao mesmo tempo com o mesmo número de
cliente, e o tempo e a memória por atendimento.

**Limites conhecidos do motor hoje:** o alerta de erro não diz de qual loja foi; "Sinop", "MT" e o fuso de
Cuiabá continuam fixos; cada mensagem faz uma consulta a mais ao banco.
- Os conjuntos da Gleide e da Caroline, gerados depois da mudança, saíram byte a byte iguais aos de antes.

## Etapas

### Etapa 1 — Motor único na Loja Teste
- [x] Levantar tudo que hoje é fixo por loja no gerador (`lojas.js`, `montar-workflow.js`, `trocas`)
- [x] Webhook único que descobre a loja pela instância e carrega os dados dela (gerado, não enviado)
- [x] Redis com a loja na chave; nada sem prefixo (gerado, não enviado)
- [x] Ferramentas da IA (agenda, CRM, pausa, pergunta para a dona, catálogo) recebendo a loja (gerado, não enviado)
- [x] Rotinas percorrendo as lojas ativas (gerado, não enviado; o fuso continua fixo em Cuiabá)
- [x] Trava `permitidos` por loja, guardada no banco
- [x] Funções do banco `motor_ficha`, `motor_loja`, `motor_lojas` (no ar; só leitura)
- [ ] `instancia_alerta` no `loja.json` do motor: qual WhatsApp manda o alerta de erro (sem isso o envio é recusado)
- [ ] Enviar o motor ao n8n desligado e ligar só para a Loja Teste (precisa de uma instância de WhatsApp de teste
  com o webhook apontando para `motor-unhas-whatsapp-salao`)
- [x] Medir o tempo por atendimento (63 s; ver acima). A memória do servidor não foi medida
- [x] Teto de conversas por loja (`config.ia.limite_mes`), com avisos de 80% e 100%
- [ ] Chave própria do Gemini por loja: ainda não construído
- [ ] Teste: o mesmo número de cliente falando com duas lojas; nada vaza

**Modelo de Unhas sem o que era só da Caroline (13/11, noite):**
- Bloco por cliente: vem da ficha (`empresas.config.ia.bloco_min`, 30 a 480 min). Sem a chave vale o tempo
  de cada serviço. Testado na Loja Teste: sem bloco a agenda usou 90 min; com `bloco_min = 120` passou a
  usar 120 min na mensagem seguinte, sem gerar nem enviar nada.
- Prompts (atendimento e assistente): o diferencial da loja é o que a dona escreveu no "Recado da dona"
  (tela Dados do salão). Saíram o "método próprio", o "contorno das cutículas" e a "manicure russa" fixos.
  Sem recado, a IA fala só do capricho no acabamento e não inventa técnica.
- Cidade sem estado fixo (a cidade vem da ficha).

O que o modelo ainda tem igual para todas as lojas (decidir por loja quando precisar): memória da conversa
de 12 h, resumo da noite às 19h, almoço flexível, e sinal por Pix e Google Agenda (estes dois só agem se a
loja tiver os dados cadastrados). O restante do texto do prompt (tom, roteiro de venda) continua sendo o
que foi escrito para a Caroline: serve de modelo de Unhas até uma segunda manicure mostrar o que ajustar.

**Comando Nova loja (14/11): `n8n/demo-agente/nova-loja.js`.** É a sequência que o botão do painel vai chamar.
- `node nova-loja.js --ramo unhas --nome "Studio da Ana" --dona Ana --whatsapp-dona 5566…` (opcionais:
  `--cidade`, `--limite`, `--bloco`, `--email`) cria a instância na Evolution já apontada para o motor,
  a loja no banco (profissional e serviços padrão sem preço) e salva o QR em `qr-<instancia>.png`.
- `--qr <instancia>` gera QR novo (vale menos de 1 minuto); `--status` mostra conexão, trava, uso do mês e
  o que falta preencher; `--liberar` e `--travar` mudam quem a IA responde.
- A loja nasce com a trava de teste: só o número da agência recebe resposta até o `--liberar`.
- Testado com uma loja descartável: instância criada com o webhook do motor, QR gerado, ficha achada pelo
  motor (dona, cidade e teto certos). Sem preço nem horário cadastrados, a IA passou a conversa para a dona:
  a loja só atende de verdade depois que a dona preenche o app. Loja e instância foram apagadas no fim.
- Não testado: `--email` (convite de login) e a leitura do QR por um celular.
- Achado no teste: chamada à Evolution sem limite de tempo prende a execução quando o WhatsApp da loja
  está desconectado. No motor todas as chamadas passaram a ter 30 s. Os conjuntos da Gleide e da Caroline
  continuam sem esse limite (não foram tocados).

**Motor de Mega Hair, primeira versão (14/11): `lojas/motor-megahair/`.** Gera com
`node montar-workflow.js --loja motor-megahair`; 17 workflows "[Motor Mega Hair]" no n8n, desligados.
- Modelo copiado do conjunto da Gleide. Endereço, mapa, Instagram, site e catálogo saíram do texto e vêm
  dos dados de cada loja (DADOS DO SALÃO e `config.loja.catalogo_link`).
- Testado com uma loja descartável de mega hair (preço e endereço diferentes dos da Gleide, apagada depois):
  a IA usou o preço do app da loja (R$ 400) e o endereço dela.
- **Regras comerciais por loja (14/11, decisão do Victor: cada loja define).** Saíram do modelo o "R$ 150 por tela",
  a "avaliação gratuita", o sinal de R$ 20, os 60 dias, o "atende sozinha", as origens, as técnicas e o "Pix e cartão
  com juros". Agora: preço e duração vêm da lista de serviços do app; a avaliação só é dita gratuita se a lista
  mostrar; pagamento e expediente vêm dos Dados do salão; técnicas, cabelos, jeito de atender e intervalo de
  manutenção vêm do Recado da dona; o sinal vem de `config.loja.sinal_pix` (valor, chave, `so_para_quem_faltou`),
  lido no prompt em "SINAL DA LOJA". O filtro de preço da Gleide e o "por tela" automático não entram no motor.
- Testado com loja descartável de regras diferentes (aplicação R$ 600, avaliação paga R$ 50, só fita e microlink,
  sinal de R$ 30 para todo horário): a IA disse os valores da loja, disse que não faz queratina e, ao marcar,
  pediu o sinal de R$ 30 com a chave da loja. Loja apagada no fim.
- O tom e a ordem da venda consultiva (acolher, entender, mostrar valor, convidar, facilitar) continuam os do prompt 8.0.
- Segunda rodada de testes (14/11), com loja descartável (avaliação gratuita na lista, sinal de R$ 30 só para quem faltou):
  a assistente da dona respondeu a agenda da loja; o pedido de cabelo avulso chamou `pedir_orcamento_cabelo` (a ferramenta
  devolveu "não consegui mandar" porque o WhatsApp da loja de teste não existe, e a IA não disse que pediu); cliente que
  nunca faltou marcou a avaliação sem sinal; as rotinas rodaram por loja, pelo horário e pelo disparo manual.
- Dois ajustes no texto depois do teste: a IA tinha inventado um link de mapa (agora só manda link que estiver em Dados do
  salão) e não citava no combinado a regra do sinal de quem falta (agora cita, com o valor da loja).
- Não testado no motor de mega hair: conferência do comprovante de quem faltou, avaliação por ligação (a loja precisa ter
  o serviço online ativo) e o orçamento chegando de verdade à dona.
- O sinal conferido pelo sistema (comprovante) da Gleide entra só no conjunto dela; no motor depende de `sinal_pix`.
- Em 14/11 a branch foi atualizada com a `main` (conflito em `sinal-pix.js` resolvido com a versão da main); a Gleide
  gerada desta branch saiu byte a byte igual à gerada da `main` pura.

**Tela Lojas no painel (14/11): `painel-crm/app/(painel)/lojas`, rotas em `painel-crm/app/api/lojas`.**
- Lista as lojas com o estado de cada uma (WhatsApp, IA em teste ou liberada, conversas do mês, o que falta a dona
  preencher), cria loja nova com o QR na tela, libera ou trava a IA e ajusta teto, tempo por cliente e sinal por Pix.
- Roda no servidor do painel com as chaves de serviço (`.env.local`, ver `.env.local.example`). Só entra quem está
  logado e tem o e-mail em `AGENCIA_EMAILS`. Lojas com conjunto próprio aparecem, mas não são alteradas.
- Os ajustes são gravados pela função `motor_configurar` (`supabase/049`), que troca só `config.ia` e
  `config.loja.sinal_pix`: o que a dona salvar no app ao mesmo tempo não é sobrescrito.
- Testado no navegador com o login do Victor: loja descartável criada pelo formulário, QR na tela, sinal salvo, IA
  liberada; número escrito errado é recusado; a Gleide é recusada. Um testador revisou segurança e código; os 10
  problemas achados foram corrigidos (checagem de origem atrás de proxy, sessão vencida, avisos que sumiam, "1.000"
  virando 1, instância órfã se a Evolution demora, gravação por cima da config, erro do banco indo para a tela).
- Não testado: convite por e-mail, o aviso "conectado" depois de ler o QR (depende do chip), login de quem não é da
  agência, e o painel publicado atrás de proxy (hoje ele roda no computador).
- Pendências conhecidas: a lista faz duas consultas por loja (rever com dezenas de lojas); o diálogo de confirmação
  não fecha com Esc; não há trava no servidor contra criar duas lojas iguais.

**Cadastro pela própria dona (14/11, etapa 5): `crm/app/cadastro`, `supabase/050` e `051`.**
- Página pública do app, "Cadastrar minha loja" (ramo, loja, dona, WhatsApp, cidade, e-mail opcional), no endereço
  `/cadastro` (sem link no login, por decisão do Victor: a agência manda o endereço). O pedido só grava uma linha em `motor_cadastros` (função `pedir_cadastro`): não cria loja,
  WhatsApp nem IA. Assim um formulário público não consegue criar instância nem gastar Gemini.
- A agência vê os pedidos na tela Lojas do painel, do mais antigo para o mais novo, e aprova (cria a loja, o
  WhatsApp e abre o QR) ou recusa. Na aprovação o e-mail do convite aparece para ser conferido com a dona, porque
  quem recebe o convite entra como dona da loja.
- Travas do formulário: 3 pedidos por dia por endereço de internet, 3 pendentes por WhatsApp e por e-mail, 200 por
  dia no total, uma chamada de cada vez; só algarismos comuns no WhatsApp; sem quebra de linha, caractere de
  controle ou invisível nos textos (eles vão para o prompt da IA). "Recusar todos" limpa pedidos falsos.
- Pedido que ficou aprovado sem loja (queda no meio) aparece como preso, com Reabrir.
- Testado no navegador: pedido pelo app em tela de celular, aprovação e recusa no painel, recusa em lote, dados
  inválidos. Um testador revisou a segurança; os 9 problemas achados foram corrigidos.
- Para as donas verem a página, o app precisa ser publicado (merge e Implantar). A função já está no banco.
- Não testado: convite por e-mail; o limite por endereço de internet com muitos pedidos de verdade; chamadas ao
  mesmo tempo. Pendências: o painel não avisa quando o WhatsApp do pedido já é de outra loja; não há aviso
  automático para a agência quando chega pedido novo (é preciso abrir a tela).

**Alerta de erro com a loja (14/11).** Cada execução do motor anota no Redis de qual loja é (chave
`motor:exec:<id da execução>`, 1 hora). O workflow Alerta de erro lê essa chave e põe "Loja: …" na mensagem; o
limite de 1 alerta a cada 10 minutos passou a ser por workflow e por loja, para o erro de uma não esconder o de
outra. O aviso "a IA falhou" também leva o nome da loja. Conferido no n8n: a anotação roda e grava a loja certa.
Não foi visto um alerta de verdade chegando com a loja: a mensagem malformada usada para provocar erro foi
tolerada pelo fluxo. O texto do alerta foi conferido rodando o código gerado com dados de exemplo.

**Quanto tempo leva um atendimento (medido em 14/11).**
- 93 atendimentos reais (Gleide e Caroline): mediana de **63 segundos** do recebimento até a resposta sair
  (menor 36 s, maior 159 s). Nos testes do motor, 16 atendimentos: mediana de 75 s (o WhatsApp de teste é falso e
  as chamadas demoram mais para falhar).
- Desses 63 s, cerca de 40 s são espera de propósito (juntar mensagens seguidas e leitura humanizada), 14 s são
  chamadas ao WhatsApp (ficar online, marcar como lida, digitando, enviar), 2 s a IA e 2 s o banco.
- Mensagem que não vira atendimento (barrada, eco, fora da lista) custa 0,3 s.
- Pico da Gleide em novembro: 20 respostas numa hora, 15 em 10 minutos. Isso dá, no pior momento, cerca de
  **1 atendimento em andamento ao mesmo tempo por loja** do tamanho dela; na média do dia, bem menos.
- Conta para o servidor: com N lojas parecidas com a Gleide, o pior caso é perto de N atendimentos abertos ao
  mesmo tempo, quase todos parados na espera (não gastam processador). O que cresce é memória: cada execução
  guarda cerca de 190 KB de dados, mais o que o n8n usa por execução aberta.
- **Não medido: a memória do servidor.** Não há acesso ao VPS por aqui. Antes de passar de umas 20 lojas, olhar no
  Easypanel a memória do n8n num horário cheio.
- Espaço em disco: com `guardar_execucoes` ligado, cada loja do tamanho da Gleide grava perto de 80 MB por mês de
  histórico de execuções. Com dezenas de lojas é preciso desligar essa opção ou ligar a limpeza automática do n8n.

**Painel: WhatsApp repetido (14/11).** O pedido de cadastro avisa quando o WhatsApp informado já é o número da
dona de outra loja. Conferido na tela com um pedido de teste.

**Painel com a identidade Oi Studio (15/11).** Pedido do Victor: mais simples, intuitivo e com cores melhores.
- Base de design: a especificação `oi-studio-design-handoff.md`, a mesma do app da dona (Ônix e Porcelana, fonte
  Manrope, cartão branco com borda e sem sombra, ouro só no pingo da logo e na etiqueta IA). Os nomes antigos de
  cor do painel continuam valendo e apontam para as cores novas (`painel-crm/app/globals.css`).
- Cores de dados (etapas do quadro de clientes): quatro cores em ordem fixa, conferidas para daltonismo.
- Menu lateral em dois níveis: AGÊNCIA (Lojas) e SALÃO (o salão escolhido, com Clientes e Serviços).
- Tela Lojas lida de cima para baixo: resumo com quatro números (lojas no ar, em implantação, pedidos de cadastro,
  conversas do mês com custo estimado de IA); pedidos de cadastro; lojas em implantação, cada uma com os três
  passos (conectar o WhatsApp, dona preenche o app, testar e liberar) e o próximo passo em destaque; lojas no ar em
  linhas, com o uso do mês contra o teto. Nova loja, QR e ajustes abrem numa folha por cima e fecham com Esc.
- Conferido no navegador: Lojas, Clientes, Serviços, folha Nova loja e folha de ajustes (salvar funcionou).
- Clientes, ficha da cliente e manutenção reorganizadas no mesmo padrão (só aparência; as peças comuns, como
  folha, chip, aviso e botões, foram para `painel-crm/components/Pecas.tsx`): Clientes abre com quatro números do
  dia (para chamar, responderam, atrasadas, agendadas), depois a vista e a busca, e os filtros em dois grupos com
  nome (status da cliente e etapa do quadro); o quadro não corta texto e rola para o lado em tela estreita; a
  manutenção mostra as faixas como escala, da mais urgente à menos urgente, com número e rótulo escritos; a ficha
  é lida na ordem quem é, o que está combinado, o que a IA sabe, histórico e, por último, editar e excluir.
  Para o resumo, o quadro é lido uma vez ao abrir Clientes em qualquer vista; fora da vista Quadro ele não é
  relido a cada mudança (só ao voltar para o Quadro), para não pesar no banco.
  Testado só em leitura no Salão Toda Bonita (o login da agência não enxerga a Loja Teste): arrastar card,
  enviar mensagem, salvar ficha, pausar IA e excluir foram conferidos pelo código, não por clique.

### Etapa 2 — Modelos por ramo
- [ ] Base comum: jeito de escrever, segurança, agenda, preços sempre do app
- [ ] Modelo **Unhas**, a partir do prompt da Caroline, sem o que é só dela
- [ ] Modelo **Mega hair**, a partir do prompt da Gleide, sem o que é só dela (catálogo de cabelo e
  avaliação online entram como recursos do ramo)
- [ ] Dados da loja lidos de `empresas.config` e `servicos`; recado da dona no fim do prompt
- [ ] Textos por ramo (foto, retomada, exemplos das ferramentas) no modelo, não em trocas
- [ ] Bateria de conversas de teste por ramo

### Etapa 3 — Painel da agência
- [ ] Banco: `agencias`, `agencia_usuarios`, `empresas.agencia_id`, `minhas_empresas()` com as lojas da agência
- [ ] Lista de lojas: WhatsApp conectado, IA ligada, mensagens do dia, custo
- [ ] Nova loja + convite + instância e QR (no servidor, com as chaves de serviço)
- [ ] Botões: liberar a IA, ligar e desligar, trava de teste

### Etapa 4 — Caroline no motor
- [ ] Rodar a loja dela no motor com a trava de teste e comparar com as respostas de hoje
- [ ] Trocar o webhook da instância num horário calmo, com volta rápida para o conjunto antigo
- [ ] A 3ª cliente já entra direto pelo motor

### Etapa 5 — Cadastro pela dona
- [x] Página Cadastrar minha loja no app e aprovação no painel (o QR aparece no painel, na aprovação)

### Etapa 6 — Gleide por último
- [ ] O que é só dela vira recurso do ramo ou configuração da loja
- [ ] Troca num horário calmo, com volta rápida

## Riscos

1. **Misturar dados entre lojas.** Toda consulta filtrada pela loja, Redis com prefixo e o teste do mesmo
   número em duas lojas antes de abrir.
2. **Qualidade menor que a de hoje.** O modelo de ramo não nasce com os ajustes finos da Gleide. Comparar
   com conversas reais antes de migrar cada loja.
3. **Um erro derruba todas.** Com um motor só, deploy errado afeta todas as lojas. Testar sempre na Loja
   Teste antes e manter o alerta.
4. **Custo.** Loja sem aprovação não gasta Gemini; custo por loja no painel.
