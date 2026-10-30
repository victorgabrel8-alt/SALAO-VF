// Gera workflow-demo-salao.json a partir do prompt-agente.md e (opcional) envia ao n8n via API.
// Uso:  node montar-workflow.js            -> só gera o JSON
//       node montar-workflow.js --enviar   -> gera e cria/atualiza no n8n (usa N8N_API_KEY do .env)
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const env = Object.fromEntries(
  fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);

// --loja <slug>: monta o conjunto de outra loja (lojas/<slug>/, ver lojas.js). Sem --loja é a Gleide, como sempre.
const lojas = require('./lojas.js');
const iLoja = process.argv.indexOf('--loja');
const LOJA = iLoja > 0 ? lojas.carregarLoja(dir, process.argv[iLoja + 1] || '', env) : null;
// pasta onde ficam os JSON gerados e os .workflow-*-id (a da loja, ou esta para a Gleide)
const saida = (arquivo) => path.join(LOJA ? LOJA.pasta : dir, path.basename(arquivo));

// sem \r: no Windows o Git baixa o .md com CRLF e o prompt no n8n ficaria diferente do publicado pelo Linux
const md = fs.readFileSync(saida('prompt-agente.md'), 'utf8').replace(/\r\n/g, '\n');
const prompt = md.match(/```text\r?\n([\s\S]*?)```/)[1].trim();

const REDIS = { redis: { id: env.N8N_REDIS_CRED_ID || '', name: 'Redis local' } };
const GEMINI = env.N8N_GEMINI_CRED_ID ? { googlePalmApi: { id: env.N8N_GEMINI_CRED_ID, name: 'Google Gemini(PaLM) Api account' } } : undefined;

const EVO = "={{ $env.EVOLUTION_URL }}";
const apikeyHeader = { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] };
const D = "$('Extrair dados').first().json"; // .first(): depois de uma ferramenta o .item não acha mais os nós de antes do agente

let n = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
  name, type, typeVersion, position, parameters, ...extra,
});
const str = (name, value) => ({ id: `a-${name}`, name, value, type: 'string' });
const bool = (name, value) => ({ id: `a-${name}`, name, value, type: 'boolean' });
const cond = (id, left, operator, right) => ({ id, leftValue: left, rightValue: right ?? '', operator });
const ifNode = (name, position, conditions) =>
  node(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions, combinator: 'and',
    },
    options: {},
  });

const main = (to) => ({ main: [[{ node: to, type: 'main', index: 0 }]] });

// ================= Subworkflow "Agenda Salão" (ferramentas do agente) =================
// A agenda é a do app (Supabase, tabela agendamentos): o supabase-workflows.js encaixa as leituras
// (horários ocupados, config do salão, horários da cliente) e as gravações (criar, cancelar, remarcar).
const { PREPARAR, CALCULAR } = require('./agenda-calculo.js');
const CAMPOS = ['acao', 'data', 'periodo', 'duracao_minutos', 'nome', 'telefone', 'servico', 'data_hora_inicio', 'motivo', 'data_hora_nova'];

const agendaNodes = [
  node('Recebe pedido do agente', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
    workflowInputs: { values: CAMPOS.map((name) => (name === 'duracao_minutos' ? { name, type: 'number' } : { name })) },
  }),
  node('Preparar', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: PREPARAR.trim() }),
  node('Calcular', 'n8n-nodes-base.code', 2, [660, 0], { jsCode: CALCULAR.trim() }),
  ifNode('Criar evento?', [880, 0], [
    cond('g1', '={{ $json.acao }}', { type: 'string', operation: 'equals' }, 'criar'),
    cond('g2', '={{ $json.ok }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  ifNode('Cancelar evento?', [1100, 120], [
    cond('x1', '={{ $json.acao }}', { type: 'string', operation: 'equals' }, 'cancelar'),
    cond('x2', '={{ $json.ok }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  ifNode('Remarcar evento?', [1320, 220], [
    cond('r1', '={{ $json.acao }}', { type: 'string', operation: 'equals' }, 'remarcar'),
    cond('r2', '={{ $json.ok }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  // o texto de sucesso/falha de cada ação é preenchido pelo supabase-workflows.js (depende da gravação no app)
  ...['Resposta (agendado)', 'Resposta (cancelado)', 'Resposta (remarcado)'].map((nome) => node(nome, 'n8n-nodes-base.set', 3.4, [0, 0], {
    assignments: { assignments: [str('resposta', '')] },
    options: {},
  })),
  node('Resposta', 'n8n-nodes-base.set', 3.4, [1540, 300], {
    assignments: { assignments: [str('resposta', '={{ $json.resposta }}')] },
    options: {},
  }),
];
const agendaWorkflow = {
  name: 'Agenda Salão (ferramentas do agente)',
  nodes: agendaNodes,
  connections: {
    'Recebe pedido do agente': main('Preparar'),
    'Preparar': main('Calcular'),
    'Calcular': main('Criar evento?'),
    'Criar evento?': { main: [[{ node: 'Resposta (agendado)', type: 'main', index: 0 }], [{ node: 'Cancelar evento?', type: 'main', index: 0 }]] },
    'Cancelar evento?': { main: [[{ node: 'Resposta (cancelado)', type: 'main', index: 0 }], [{ node: 'Remarcar evento?', type: 'main', index: 0 }]] },
    'Remarcar evento?': { main: [[{ node: 'Resposta (remarcado)', type: 'main', index: 0 }], [{ node: 'Resposta', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
};

// Tool do agente que chama o subworkflow. `fixos` = valores fixos; `ia` = [campo, descrição, tipo] preenchidos pela IA.
const agendaIdFile = path.join(dir, '.workflow-agenda-id');
const lerAgendaId = () => (fs.existsSync(agendaIdFile) ? fs.readFileSync(agendaIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_AGENDA');
const toolSub = (name, position, description, lerId, campos, fixos, ia) => node(name, '@n8n/n8n-nodes-langchain.toolWorkflow', 2.2, position, {
  description,
  workflowId: { __rl: true, value: lerId(), mode: 'id' },
  workflowInputs: {
    mappingMode: 'defineBelow',
    value: {
      ...fixos,
      ...Object.fromEntries(ia.map(([c, d, t]) => [c, `={{ $fromAI('${c}', \`${d}\`, '${t}') }}`])),
    },
    matchingColumns: [],
    schema: campos.map((id) => ({
      id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true,
      type: id === 'duracao_minutos' ? 'number' : 'string', removed: false,
    })),
    attemptToConvertTypes: false, convertFieldsToString: false,
  },
});
const toolAgenda = (name, position, description, fixos, ia) => toolSub(name, position, description, lerAgendaId, CAMPOS, fixos, ia);

// ================= Subworkflow "Pausar IA" (transferência para humano) =================
const PAUSA_TTL = 43200; // 12 horas
const pausaIdFile = path.join(dir, '.workflow-pausa-id');
const lerPausaId = () => (fs.existsSync(pausaIdFile) ? fs.readFileSync(pausaIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_PAUSA');
const pausaWorkflow = {
  name: 'Pausar IA (transferir para humano)',
  nodes: [
    node('Recebe pedido do agente', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
      workflowInputs: { values: [{ name: 'telefone' }, { name: 'motivo' }, { name: 'resumo' }, { name: 'o_que_precisa' }] },
    }),
    node('Gravar pausa (12h)', 'n8n-nodes-base.redis', 1, [220, 0], {
      operation: 'set', key: '=pausa:{{ $json.telefone }}', value: "={{ 'agente: ' + ($json.motivo || 'transferido') }}", expire: true, ttl: PAUSA_TTL,
    }, { credentials: REDIS }),
    node('Resposta', 'n8n-nodes-base.set', 3.4, [440, 0], {
      assignments: { assignments: [str('resposta', 'TRANSFERIDO: a Gleide recebeu o resumo no WhatsApp e vai assumir esta conversa; você (IA) fica pausada para esta cliente por 12h. Responda agora numa frase gentil que passou o assunto pra Gleide e que ela responde por aqui (ex.: "Vou confirmar com a Gleide se pode trazer seu cachorro, ela te responde por aqui, tá?" ou "Vou passar sua conversa pra Gleide, ela te chama por aqui 😊"), sem prometer prazo e sem falar em equipe.')] },
      options: {},
    }),
  ],
  connections: { 'Recebe pedido do agente': main('Gravar pausa (12h)'), 'Gravar pausa (12h)': main('Resposta') },
  settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
};
const GEMINI_HTTP = { authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi' };
const LER_BUFFER = "[].concat($('Buffer: ler mensagens').item.json.mensagens || []).map((m) => { try { const o = JSON.parse(m); if (o && typeof o.texto === 'string') return o; } catch (e) {} return { id: '', texto: String(m) }; })";
// Várias mensagens seguidas chegam numeradas; a IA marca com --- onde quer outra mensagem e o Quebrar mensagens manda até 3 balões
const REGRA_CITAR = `

MENSAGENS SEGUIDAS (numeradas)
Quando a mensagem da cliente vier em linhas numeradas ([1], [2], [3]...), são mensagens separadas que ela mandou em sequência.
Leia tudo como uma conversa só e responda uma vez, cobrindo todas na ordem em que ela mandou, começando pela [1] (um parágrafo curto por assunto).
Cumprimento ("oi", "tudo bem?") se responde junto, numa frase só. Não escreva os números [1], [2] na resposta.

COMO A RESPOSTA CHEGA NO WHATSAPP
Cada parágrafo (linha em branco entre eles) chega como uma mensagem separada, na ordem, como uma pessoa manda.
Padrão: 1 parágrafo curto; quando útil, 2; até 3 em casos necessários (múltiplas dúvidas ou explicação que não cabe sem perda). Uma ideia por bloco; pergunta final somente quando for útil. Não use ---.
Exemplo (duas mensagens):
A manutenção costuma ocupar umas 2 horas na agenda.

Quer que eu veja um horário pra você?`;

const nodes = [
  // Senha no webhook: a Evolution manda o cabeçalho x-webhook-token (webhook/set da instância) e o n8n recusa
  // quem chega sem ele (403). Sem isso, qualquer um que soubesse o endereço mandava "mensagem de cliente" falsa.
  // A senha fica na credencial do n8n (N8N_WEBHOOK_CRED_ID), não no Git. Ver RECUPERACAO.md.
  node('Webhook Evolution', 'n8n-nodes-base.webhook', 2, [0, 0],
    { httpMethod: 'POST', path: 'whatsapp-salao', authentication: 'headerAuth', options: {} },
    { webhookId: '7d1f3c2a-9b8e-4c6d-a5f4-3e2d1c0b9a87',
      credentials: { httpHeaderAuth: { id: env.N8N_WEBHOOK_CRED_ID || 'tV8sJuiNWidQ4Dnn', name: 'Webhook WhatsApp (senha da Evolution)' } } }),

  node('Extrair dados', 'n8n-nodes-base.set', 3.4, [220, 0], {
    assignments: { assignments: [
      str('evento', '={{ $json.body.event }}'),
      str('jid', '={{ $json.body.data.key.remoteJid }}'),
      str('telefone', "={{ ($json.body.data.key.remoteJid.endsWith('@lid') && $json.body.data.key.remoteJidAlt ? $json.body.data.key.remoteJidAlt : $json.body.data.key.remoteJid).split('@')[0] }}"),
      bool('fromMe', '={{ $json.body.data.key.fromMe }}'),
      str('msgId', '={{ $json.body.data.key.id }}'),
      str('nome', "={{ $json.body.data.pushName || '' }}"),
      str('tipo', '={{ $json.body.data.messageType }}'),
      str('texto', "={{ $json.body.data.message?.conversation || $json.body.data.message?.extendedTextMessage?.text || $json.body.data.message?.imageMessage?.caption || '' }}"),
      // id da mensagem que ela respondeu citando ("Responder" do WhatsApp): é assim que a Gleide responde a uma
      // pergunta da IA (ver pedidos-workflows.js)
      str('citado', "={{ $json.body.data.contextInfo?.stanzaId || $json.body.data.message?.extendedTextMessage?.contextInfo?.stanzaId || '' }}"),
      // Trava de segurança da demo: se NUMEROS_PERMITIDOS estiver preenchido, só esses números recebem resposta.
      bool('permitido', "={{ !$env.NUMEROS_PERMITIDOS || $env.NUMEROS_PERMITIDOS.split(',').map(s => s.trim()).includes(($json.body.data.key.remoteJid.endsWith('@lid') && $json.body.data.key.remoteJidAlt ? $json.body.data.key.remoteJidAlt : $json.body.data.key.remoteJid).split('@')[0]) }}"),
    ] },
    options: {},
  }),

  // Você respondeu manualmente pelo celular (fromMe) -> pausa a IA para esse número. "#ia" tira a pausa.
  ifNode('Minha resposta manual?', [440, -260], [
    cond('m1', '={{ $json.evento }}', { type: 'string', operation: 'equals' }, 'messages.upsert'),
    cond('m2', '={{ $json.fromMe }}', { type: 'boolean', operation: 'true', singleValue: true }),
    cond('m3', "={{ /@(s\\.whatsapp\\.net|lid)$/.test($json.jid) }}", { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  ifNode('Comando #ia?', [660, -360], [
    cond('k1', "={{ $json.texto.trim().toLowerCase() }}", { type: 'string', operation: 'equals' }, '#ia'),
  ]),
  node('Pausa: remover', 'n8n-nodes-base.redis', 1, [880, -440], {
    operation: 'delete', key: `=pausa:{{ ${D}.telefone }}`,
  }, { credentials: REDIS }),
  node('Pausa: humano assumiu (12h)', 'n8n-nodes-base.redis', 1, [880, -280], {
    operation: 'set', key: `=pausa:{{ ${D}.telefone }}`, value: 'manual', expire: true, ttl: PAUSA_TTL,
  }, { credentials: REDIS }),

  ifNode('Filtro', [660, 0], [
    cond('c1', '={{ $json.evento }}', { type: 'string', operation: 'equals' }, 'messages.upsert'),
    cond('c2', '={{ $json.fromMe }}', { type: 'boolean', operation: 'false', singleValue: true }),
    cond('c3', "={{ /@(s\\.whatsapp\\.net|lid)$/.test($json.jid) }}", { type: 'boolean', operation: 'true', singleValue: true }),
    cond('c4', "={{ ['audioMessage', 'imageMessage'].includes($json.tipo) || (['conversation', 'extendedTextMessage'].includes($json.tipo) && $json.texto.trim() !== '') }}", { type: 'boolean', operation: 'true', singleValue: true }),
    cond('c5', '={{ $json.permitido }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),

  node('Pausa: verificar', 'n8n-nodes-base.redis', 1, [880, 0], {
    operation: 'get', key: `=pausa:{{ ${D}.telefone }}`, propertyName: 'pausa', keyType: 'string', options: {},
  }, { credentials: REDIS }),
  ifNode('IA ativa?', [1100, 0], [
    cond('p1', '={{ !$json.pausa }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  ifNode('É áudio ou foto?', [1320, 0], [
    cond('a1', `={{ ['audioMessage', 'imageMessage'].includes(${D}.tipo) }}`, { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  node('Baixar mídia (Evolution)', 'n8n-nodes-base.httpRequest', 4.2, [1540, -120], {
    method: 'POST',
    url: `${EVO}/chat/getBase64FromMediaMessage/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ message: { key: { id: ${D}.msgId } }, convertToMp4: false }) }}`,
    options: {},
  }, { onError: 'continueRegularOutput' }),
  node('Entender mídia (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [1760, -120], {
    method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', ...GEMINI_HTTP,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ contents: [{ parts: [ { text: $('Extrair dados').first().json.tipo === 'imageMessage' ? 'Uma cliente de um salão de mega hair mandou esta foto no WhatsApp. Descreva em português, em no máximo 4 frases objetivas, só o que dá para ver e importa para o salão: se parece o cabelo da própria pessoa (foto caseira) ou uma foto de referência (modelo, foto de internet); de costas, de frente ou de lado; comprimento aproximado (ex.: no ombro, no meio das costas, na cintura); cor (preto, castanho escuro, castanho claro, loiro, ruivo, grisalho) e se tem mechas, luzes ou reflexos; textura e curvatura (liso; ondulado; cacheado com cachos abertos/largos; cacheado com cachos fechados/pequenos; crespo); volume aparente (ralo, médio, cheio); e se aparenta mega hair, mechas, luzes ou química. Se a luz, o ângulo ou o enquadramento não deixam ver o cabelo direito, diga isso. Não avalie saúde do fio nem couro cabeludo. Se for print de conversa, comprovante ou outra coisa, diga só o que é. Não invente.' : 'Transcreva este áudio de WhatsApp em português do Brasil, exatamente como foi falado. Responda só com a transcrição, sem comentários.' }, { inline_data: { mime_type: String($json.mimetype || 'audio/ogg').split(';')[0], data: $json.base64 } } ] }] }) }}",
    options: {},
  }, { credentials: GEMINI || {}, onError: 'continueRegularOutput' }),
  node('Texto da mensagem', 'n8n-nodes-base.set', 3.4, [1980, 0], {
    assignments: { assignments: [
      str('texto', `={{ (() => { const tipo = ${D}.tipo; if (!['audioMessage', 'imageMessage'].includes(tipo)) return ${D}.texto; const r = ($json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join(' ').trim(); if (tipo === 'audioMessage') return r ? '[áudio] ' + r : '[áudio que não consegui ouvir]'; const legenda = ${D}.texto ? ' Legenda: ' + ${D}.texto : ''; return (r ? '[foto da cliente] ' + r : '[foto da cliente que não consegui ver]') + legenda; })() }}`),
    ] },
    options: {},
  }),

  node('Buffer: guardar msg', 'n8n-nodes-base.redis', 1, [2200, 0], {
    // guarda o id junto do texto: a resposta sai "respondendo" (citando) a mensagem certa
    operation: 'push', list: `=buffer:{{ ${D}.telefone }}`, messageData: `={{ JSON.stringify({ id: ${D}.msgId, texto: $json.texto }) }}`, tail: true,
  }, { credentials: REDIS }),

  node('Buffer: marcar última', 'n8n-nodes-base.redis', 1, [880, 0], {
    operation: 'set', key: `=buffer_ultima:{{ ${D}.telefone }}`, value: `={{ ${D}.msgId }}`, expire: true, ttl: 120,
  }, { credentials: REDIS }),

  // junta a rajada: só responde depois de 20 s sem mensagem nova da mesma pessoa (10 s cortava quem digita devagar)
  node('Aguardar (juntar mensagens)', 'n8n-nodes-base.wait', 1.1, [1100, 0], { resume: 'timeInterval', amount: 20, unit: 'seconds' }, { webhookId: '1b2c3d4e-5f60-4718-9a0b-c1d2e3f40516' }),

  node('Buffer: ler última', 'n8n-nodes-base.redis', 1, [1320, 0], {
    operation: 'get', key: `=buffer_ultima:{{ ${D}.telefone }}`, propertyName: 'ultima', keyType: 'string', options: {},
  }, { credentials: REDIS }),

  ifNode('É a última msg?', [1540, 0], [
    cond('u1', '={{ $json.ultima }}', { type: 'string', operation: 'equals' }, `={{ ${D}.msgId }}`),
  ]),

  node('Pausa: verificar de novo', 'n8n-nodes-base.redis', 1, [1760, -20], {
    operation: 'get', key: `=pausa:{{ ${D}.telefone }}`, propertyName: 'pausa', keyType: 'string', options: {},
  }, { credentials: REDIS }),
  ifNode('Ainda ativa?', [1980, -20], [
    cond('p2', '={{ !$json.pausa }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  node('Buffer: descartar (pausada)', 'n8n-nodes-base.redis', 1, [2200, 120], {
    operation: 'delete', key: `=buffer:{{ ${D}.telefone }}`,
  }, { credentials: REDIS }),

  // Trava por conversa: enquanto a IA responde esta pessoa, mensagens novas esperam e depois entram juntas
  node('Trava: ler', 'n8n-nodes-base.redis', 1, [0, 0], {
    operation: 'get', key: `=processando:{{ ${D}.telefone }}`, propertyName: 'processando', keyType: 'string', options: {},
  }, { credentials: REDIS }),
  ifNode('Ninguém respondendo?', [0, 0], [
    cond('t1', '={{ !$json.processando }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  node('Aguardar 3s (IA respondendo)', 'n8n-nodes-base.wait', 1.1, [0, 0], { resume: 'timeInterval', amount: 3, unit: 'seconds' }, { webhookId: '2c3d4e5f-6071-4829-8a1b-d2e3f4051627' }),
  node('Trava: marcar', 'n8n-nodes-base.redis', 1, [0, 0], {
    operation: 'set', key: `=processando:{{ ${D}.telefone }}`, value: `={{ ${D}.msgId }}`, expire: true, ttl: 180,
  }, { credentials: REDIS }),
  node('Trava: liberar', 'n8n-nodes-base.redis', 1, [0, 0], {
    operation: 'delete', key: `=processando:{{ ${D}.telefone }}`,
  }, { credentials: REDIS }),
  // Contra ban (pedido do Victor, 28/10): no máximo 3 conversas sendo respondidas ao mesmo tempo; a 4ª espera a vez
  // (5 s e confere de novo). As travas vencem sozinhas em 180 s, então a fila nunca fica presa.
  node('Vez: contar', 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'keys', keyPattern: 'processando:*', getValues: false },
    { credentials: REDIS, alwaysOutputData: true }),
  ifNode('Tem vez?', [0, 0], [
    cond('v1', '={{ Object.keys($json).length < 3 }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  node('Vez: esperar 5s', 'n8n-nodes-base.wait', 1.1, [0, 0], { resume: 'timeInterval', amount: 5, unit: 'seconds' }, { webhookId: '7d8e9f0a-1b2c-4d3e-8f4a-5b6c7d8e9f0a' }),
  // Depois de responder, sai do "online" como gente (antes ficava online para sempre: com atendimento 24 h o número
  // parecia nunca sair do WhatsApp). Espera 5–15 s e só sai se nenhuma outra conversa estiver sendo respondida
  // (o "online" é do número inteiro, não de uma conversa).
  node('Offline: esperar', 'n8n-nodes-base.wait', 1.1, [0, 0], { resume: 'timeInterval', amount: '={{ 5 + Math.floor(Math.random() * 11) }}', unit: 'seconds' },
    { webhookId: '8e9f0a1b-2c3d-4e4f-9a5b-6c7d8e9f0a1b', executeOnce: true }),
  node('Offline: alguém respondendo?', 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'keys', keyPattern: 'processando:*', getValues: false },
    { credentials: REDIS, alwaysOutputData: true }),
  ifNode('Ninguém mais respondendo?', [0, 0], [
    cond('o1', '={{ Object.keys($json).length === 0 }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  node('Offline: sair', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method: 'POST',
    url: `${EVO}/chat/sendPresence/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ number: $('Montar entrada').first().json.jid, presence: 'unavailable', delay: 1000 }) }}",
    options: {},
  }, { onError: 'continueRegularOutput' }),

  node('Buffer: ler mensagens', 'n8n-nodes-base.redis', 1, [1760, -20], {
    operation: 'get', key: `=buffer:{{ ${D}.telefone }}`, propertyName: 'mensagens', keyType: 'list', options: {},
  }, { credentials: REDIS }),

  node('Buffer: limpar', 'n8n-nodes-base.redis', 1, [1980, -20], {
    operation: 'delete', key: `=buffer:{{ ${D}.telefone }}`,
  }, { credentials: REDIS }),

  // Várias mensagens seguidas viram "[1] ...\n[2] ..." para a IA dizer qual está respondendo
  // (item antigo do buffer, só texto, ainda é aceito)
  node('Montar entrada', 'n8n-nodes-base.set', 3.4, [2200, -20], {
    assignments: { assignments: [
      str('mensagens', `={{ JSON.stringify(${LER_BUFFER}) }}`),
      str('texto_cliente', `={{ (() => { const ms = ${LER_BUFFER}; return ms.length > 1 ? ms.map((m, i) => '[' + (i + 1) + '] ' + m.texto).join('\\n') : ms.map((m) => m.texto).join('\\n'); })() }}`),
      str('telefone', `={{ ${D}.telefone }}`),
      str('jid', `={{ ${D}.jid }}`),
      str('msgId', `={{ ${D}.msgId }}`),
      str('nome', `={{ ${D}.nome }}`),
    ] },
    options: {},
  }),

  // Leitura como gente (pedido do Victor, 27/10, para não parecer robô e evitar banimento): fica online, espera
  // um pouco (abrindo a conversa) e marca como lida CADA mensagem da rajada, na ordem em que chegou, com o tempo
  // de ler cada uma (texto pelo tamanho, áudio pelo tempo de ouvir, foto alguns segundos). Antes só a última era
  // marcada, na hora, junto com todas.
  node('Leitura: ficar online', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method: 'POST',
    url: `${EVO}/chat/sendPresence/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ number: $('Montar entrada').first().json.jid, presence: 'available', delay: 1000 }) }}",
    options: {},
  }, { onError: 'continueRegularOutput' }),
  node('Leitura: uma por vez', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: [
    "// espera (s) antes de marcar cada mensagem como lida: a 1ª inclui 'abrir a conversa' (2-5 s)",
    "const e = $('Montar entrada').first().json;",
    "let ms = [];",
    "try { ms = JSON.parse(e.mensagens || '[]'); } catch (err) {}",
    "if (!ms.length) ms = [{ id: e.msgId, texto: e.texto_cliente || '' }];",
    "const ale = (a, b) => a + Math.random() * (b - a);",
    "const ler = (t) => {",
    "  t = String(t || '');",
    "  if (/^\\[áudio\\]/i.test(t)) return Math.min(25, Math.max(3, t.length / 14)) * ale(0.9, 1.1); // ouvir (~14 letras/s)",
    "  if (/^\\[foto/i.test(t)) return ale(2, 4);",
    "  return Math.min(6, Math.max(0.8, t.length * 0.05)) * ale(0.8, 1.2); // ler (~20 letras/s)",
    "};",
    "return ms.filter((m) => m.id).map((m, i) => ({ json: { jid: e.jid, id: m.id,",
    "  espera: Math.round(((i === 0 ? ale(2, 5) : ale(0.4, 1.2)) + ler(m.texto)) * 10) / 10 }, pairedItem: 0 }));",
  ].join('\n') }),
  node('Leitura: próxima', 'n8n-nodes-base.splitInBatches', 3, [0, 0], { options: {} }),
  node('Leitura: lendo', 'n8n-nodes-base.wait', 1.1, [0, 0], { resume: 'timeInterval', amount: '={{ $json.espera }}', unit: 'seconds' },
    { webhookId: '4e5f6071-8293-4a4b-8c3d-f40516273849' }),
  node('Leitura: marcar lida', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method: 'POST',
    url: `${EVO}/chat/markMessageAsRead/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ readMessages: [{ remoteJid: $('Leitura: próxima').item.json.jid, fromMe: false, id: $('Leitura: próxima').item.json.id }] }) }}",
    options: {},
  }, { onError: 'continueRegularOutput' }),
  // fim da leitura: um item só segue (o resto do fluxo continua ligado em "Marcar como lida")
  node('Marcar como lida', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: 'return [{ json: {}, pairedItem: 0 }];' }, { executeOnce: true }),

  node('Agente IA', '@n8n/n8n-nodes-langchain.agent', 3.1, [2640, -20], {
    promptType: 'define',
    text: "={{ $('Montar entrada').first().json.texto_cliente }}",
    // returnIntermediateSteps: o "Quebrar mensagens" vê se o áudio saiu (o prompt manda não escrever nada depois)
    options: { systemMessage: '=' + prompt + REGRA_CITAR, returnIntermediateSteps: true },
  // Gemini falhou (sobrecarga, erro de ferramenta): tenta de novo; se ainda falhar, segue sem resposta e o
  // Quebrar mensagens manda o pedido de desculpas. Antes a execução morria com a trava presa (2 min) e a
  // mensagem da cliente se perdia.
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),

  node('Gemini Flash', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, [2560, 200], {
    modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.4 },
  }, GEMINI ? { credentials: GEMINI } : {}),

  node('Memória (Redis)', '@n8n/n8n-nodes-langchain.memoryRedisChat', 1.5, [2720, 200], {
    sessionIdType: 'customKey',
    sessionKey: "=memoria:{{ $('Montar entrada').first().json.telefone }}",
    sessionTTL: 604800, // 7 dias: quem volta no dia seguinte ainda é lembrada
    contextWindowLength: 20,
  }, { credentials: REDIS }),

  node('Quebrar mensagens', 'n8n-nodes-base.code', 2, [2960, -20], {
    jsCode: [
      "const jid = $('Montar entrada').first().json.jid;",
      "// caractere invisível (espaço de largura zero) não é texto: em 27/10 a IA respondeu só isso e saiu um balão em branco",
      "let t = ($input.first().json.output || '').replace(/[\\u200B-\\u200D\\u2060\\uFEFF]/g, '').trim();",
      "// Prompt: se o áudio respondeu tudo, a IA não escreve nada. Áudio enviado + resposta vazia = não manda balão",
      "// (sem isso cairia na mensagem de erro lá embaixo). [SEM TEXTO] também vale, se a IA usar.",
      "const passos = $input.first().json.intermediateSteps || [];",
      "// fotos do catálogo enviadas também são resposta: se elas responderam tudo, a IA pode não escrever nada",
      "const audioEnviado = passos.some(p => (p.action?.tool === 'enviar_audio' && /ÁUDIO ENVIADO/.test(JSON.stringify(p.observation || ''))) ||",
      "  (p.action?.tool === 'enviar_catalogo' && /FOTOS ENVIADAS/.test(JSON.stringify(p.observation || ''))));",
      "const semTexto = /\\[SEM TEXTO\\]/i.test(t);",
      "t = t.replace(/\\[SEM TEXTO\\]/gi, '').trim();",
      "if ((audioEnviado || semTexto) && !t.replace(/\\[\\d{1,2}\\]/g, '').replace(/[\\s😊😉.!]/gu, '')) return [{ json: { jid, semTexto: true } }];",
      "// --- numa linha = a IA quer outra mensagem a partir dali (ver COMO A RESPOSTA CHEGA NO WHATSAPP)",
      "t = t.replace(/\\n?[ \\t]*-{3,}[ \\t]*(\\n|$)/g, '\\n\\n§§\\n\\n');",
      "// Cumprimento (pedido do Victor, 26/10): devolve o MESMO que a cliente usou ('Boa tarde' às 17h59 → 'Boa tarde',",
      "// não 'Boa noite' porque o relógio virou); se ela não cumprimentou, vale a hora do salão.",
      "const hSalao = $now.setZone('America/Cuiaba').hour;",
      "const dela = (String($('Montar entrada').first().json.texto_cliente || '').match(/bom dia|boa tarde|boa noite/gi) || []).pop();",
      "const cumprimento = dela ? dela.toLowerCase() : hSalao < 12 ? 'bom dia' : hSalao < 18 ? 'boa tarde' : 'boa noite';",
      "t = t.replace(/^(\\s*(?:(?:oi|olá)[^.!?\\n]{0,25}[!,.]\\s*)?)(bom dia|boa tarde|boa noite)/i, (m, antes, g) => antes + (g[0] === g[0].toUpperCase() ? cumprimento[0].toUpperCase() + cumprimento.slice(1) : cumprimento));",
      "// Cumprimenta UMA vez: se a IA já respondeu esta cliente nas últimas 3 h, tira o 'Oi, Victor! Boa tarde.' / 'Boa noite!' do",
      "// começo (26/10: 'Boa tarde' e o áudio 30 s depois viraram duas respostas, cada uma com cumprimento)",
      "const jaFalou = ($('Sobre esta cliente').first().json.texto || '').match(/Você já conversou com ela hoje \\(sua última resposta foi às (\\d\\d):(\\d\\d)/);",
      "if (jaFalou) {",
      "  const ultima = $now.setZone('America/Cuiaba').set({ hour: +jaFalou[1], minute: +jaFalou[2] });",
      "  if ($now.diff(ultima, 'hours').hours < 3) {",
      "    const semOi = t.replace(/^\\s*(?:(?:oi|olá)(?:,\\s*[^.!?\\n]{1,25})?[!.,]\\s*)?(?:(?:bom dia|boa tarde|boa noite)(?:,\\s*[^.!?\\n]{1,25})?[!.]\\s*)?/i, '').trim();",
      "    if (semOi) t = semOi[0].toUpperCase() + semOi.slice(1);",
      "  }",
      "}",
      "// já conversaram hoje (ficha): tira a reapresentação que a IA às vezes ainda põe ('Sou a assistente virtual da Gleide.')",
      "if (/Você já conversou com ela hoje/.test($('Sobre esta cliente').first().json.texto || '')) {",
      "  const semApresentacao = t.replace(/(^|[.!?]\\s+|\\n)\\s*((Eu )?sou a assistente virtual( da Gleide)?( Vieira)?|Aqui é a assistente( virtual)?( da Gleide)?)[^.!?\\n]*[.!?]?/gi, '$1').trim();",
      "  if (semApresentacao) t = semApresentacao;",
      "}",
      "// sem negrito/markdown: mensagem de gente não tem *asterisco*",
      "t = t.replace(/\\*\\*(.+?)\\*\\*/g, '$1').replace(/\\*([^*\\n]+)\\*/g, '$1').replace(/^#+\\s*/gm, '').replace(/^\\s*[-•]\\s+/gm, '');",
      "// frases de robô que a IA às vezes insiste em usar: tira antes de enviar (se sobrar texto)",
      "const semRobo = t.replace(/\\s*(como|em que) (posso|eu posso|poderia) (te |lhe )?ajudar( você)?( hoje)?\\s*\\?/gi, '').replace(/\\s*(posso te ajudar|te ajudo) (em|com) (mais )?(algo|alguma coisa)( mais)?\\s*\\?/gi, '').replace(/, do Toda Bonita Mega Hair/gi, '').trim();",
      "if (semRobo) t = semRobo;",
      "// sobras de chatbot no fim (humanizer §22): fecho automático que não diz nada; só sai se sobrar texto",
      "const semFecho = t.replace(/\\s*(fico|ficamos|estou|estamos) (à|a) (sua )?disposi[çc][ãa]o[^.!?\\n]*[.!?]?/gi, '').replace(/\\s*(qualquer coisa|qualquer d[úu]vida|se precisar|se tiver (alguma|mais alguma) d[úu]vida)[^.!?\\n]*(estou|estamos|é só|me (chama|fala|avisa))[^.!?\\n]*[.!?]?/gi, '').replace(/\\s*espero ter ajudado[.!]?/gi, '').replace(/\\s*(e )?estou aqui (pra|para) (te |lhe )?ajudar[.!]?/gi, '').trim();",
      "if (semFecho && semFecho !== t) t = /[.!?😊😉]$/u.test(semFecho) ? semFecho : semFecho + '.';",
      "// palavra de controle das ferramentas (\"REMARCADO! Mudei…\"): é para a IA, não para a cliente",
      "t = t.replace(/\\b(REMARCADO|AGENDADO|CANCELADO|ANOTADO)\\b[!.:,]?\\s*/g, '').replace(/^\\s*([a-zà-ú])/, (m, l) => m.replace(l, l.toUpperCase()));",
      "// a IA não informa valor (prompt v4): tira as frases com R$; se ela nem perguntou de preço, tira também",
      "// o 'o valor depende…' (a IA às vezes solta mesmo assim) e o 'que legal' de robô",
      "const pediuPreco = /(quanto|valor|pre[cç]o|cust|or[cç]amento|caro|barat|cobra|tabela)/i.test($('Montar entrada').first().json.texto_cliente || '');",
      "const FRASES = /(?<=[.!?😊😉🥰])\\s+/u;",
      "const QUANDO = /\\b\\d{1,2}(h|:\\d\\d)/;",
      "// valor em dinheiro: R$ 160, R$160,00 ou 350 reais",
      "const VALOR = /R\\$\\s?\\d|\\b\\d{2,}(?:\\.\\d{3})*(?:,\\d{2})?\\s*reais\\b/i;",
      "// limpa linha por linha: o quadro da agenda vem uma linha por período e precisa chegar assim",
      "const limpar = (p) => p.split('\\n').map(limparLinha).filter(Boolean).join('\\n');",
      "const limparLinha = (p) => {",
      "  let fs = p.split(FRASES).filter(f => !/^(ah,? )?que legal\\b/i.test(f));",
      "  // frase que também oferece horário (\"que fica R$ 450, eu tenho segunda às 13h\"): tira só o preço, senão a",
      "  // cliente recebe \"algum desses horários?\" sem horário nenhum",
      "  // política sem preços (prompt v4, 29/10): frase com R$ sai SEMPRE, mesmo se ela perguntou o valor",
      "  fs = fs.map(f => {",
      "    if (!VALOR.test(f)) return f;",
      "    const s = f.replace(/,?\\s*(?:que\\s+)?(?:fica|custa|sai|é|está|no valor de|por)?\\s*(?:em\\s+|por\\s+|de\\s+)?(?:a partir de\\s+)?(?:R\\$\\s?\\d+(?:\\.\\d{3})*(?:,\\d{2})?(?:\\s*reais)?|\\d{2,}(?:\\.\\d{3})*(?:,\\d{2})?\\s*reais)/gi, '').replace(/\\s+,/g, ',').replace(/^[\\s,;:–-]+/, '').trim().replace(/^\\p{Ll}/u, (l) => l.toUpperCase());",
      "    return !VALOR.test(s) && !/R\\$/.test(s) && QUANDO.test(s) ? s : '';",
      "  }).filter(Boolean);",
      "  if (!pediuPreco) fs = fs.filter(f => !/\\bvalor\\b[^.?!]*\\bdepende/i.test(f));",
      "  return fs.join(' ').trim();",
      "};",
      "// [n] = parágrafo que responde a n-ª mensagem seguida dela. Número no meio do texto também abre parágrafo;",
      "// parágrafo sem número continua respondendo a mesma mensagem do anterior",
      "t = t.replace(/\\s*\\[(\\d{1,2})\\]\\s*/g, '\\n\\n[$1] ').trim();",
      "let ref = 0;",
      "let paragrafos = t.split(/\\n\\s*\\n/).map(s => { const m = s.trim().match(/^\\[(\\d{1,2})\\]\\s*/); if (m) ref = Number(m[1]); return { t: s.trim().slice(m ? m[0].length : 0).trim(), ref }; }).filter(p => p.t);",
      "const limpos = paragrafos.map(p => ({ t: limpar(p.t), ref: p.ref })).filter(p => p.t);",
      "// a resposta era só preço e a limpeza tirou tudo: não volta para o texto com o valor (prompt v4)",
      "// (§§ é só a marca de quebra do ---: lista só com §§ também conta como vazia)",
      "if (!limpos.some(p => p.t !== '§§') && paragrafos.some(p => VALOR.test(p.t))) paragrafos = [{ t: 'Quem passa o orçamento é a Gleide, depois de ver o seu caso. Quer que eu veja um horário pra você conversar com ela?', ref: 0 }];",
      "else if (limpos.length) paragrafos = limpos;",
      "// Rede de segurança: se a IA falhar e devolver vazio, a cliente não fica sem resposta",
      "const falhou = !paragrafos.some(p => p.t !== '§§'); // o alerta-workflows.js avisa o Victor",
      "if (falhou) paragrafos = [{ t: 'Desculpa, tive um probleminha aqui e não consegui ler sua mensagem. Pode mandar de novo? 😊', ref: 0 }];",
      "// Como gente manda no WhatsApp (pedido do Victor, 26/10): um balão por parágrafo, na ordem, no máximo 2.",
      "// Parágrafo minúsculo (menos de 25 letras, ex.: 'Oi, Maria!') gruda no seguinte; parágrafo enorme (mais de",
      "// 300 letras) é cortado entre frases; se passar de 3, os do fim se juntam no 3º. O --- da IA conta como parágrafo.",
      "const ps = paragrafos.filter(p => p.t !== '§§').map(p => p.t);",
      "let baloes = [];",
      "let junto = '';",
      "for (const p of ps) {",
      "  junto = junto ? junto + '\\n\\n' + p : p;",
      "  if (junto.length >= 25) { baloes.push({ t: junto, ref: 0 }); junto = ''; }",
      "}",
      "if (junto) { if (baloes.length) baloes[baloes.length - 1].t += '\\n\\n' + junto; else baloes.push({ t: junto, ref: 0 }); }",
      "const cortar = (t) => {",
      "  if (t.length <= 300 || t.includes('\\n')) return [t]; // quadro do dia (em linhas) vai inteiro",
      "  const fs = t.split(FRASES);",
      "  if (fs.length < 2) return [t];",
      "  let a = '', i = 0;",
      "  while (i < fs.length - 1 && (a + ' ' + fs[i]).trim().length < t.length / 2) a = (a + ' ' + fs[i++]).trim();",
      "  if (!a) a = fs[i++];",
      "  return [a, fs.slice(i).join(' ').trim()].filter(Boolean);",
      "};",
      "baloes = baloes.flatMap((b) => cortar(b.t).map((t) => ({ t, ref: 0 })));",
      "// no máximo 2 balões (26/10: 3 balões era texto demais)",
      "if (baloes.length > 2) baloes = [baloes[0], { t: baloes.slice(1).map(b => b.t).join('\\n\\n'), ref: 0 }];",
      "baloes = baloes.filter(b => b.t);",
      "// Pontuação grudada no fim de um link (ex.: 'wa.me/c/556696795639.') faz o WhatsApp abrir 'Page Not Found' (28/10)",
      "baloes.forEach(b => { b.t = b.t.replace(/(https?:\\/\\/\\S*?)[.,;:!?]+(?=\\s|$)/g, '$1'); });",
      "// Responder citando só quando a mensagem chegou enquanto a IA ainda respondia outra (a resposta sai",
      "// depois de outra e ficaria solta): cita a última mensagem do bloco",
      "let msgs = [];",
      "try { msgs = JSON.parse($('Montar entrada').first().json.mensagens || '[]'); } catch (e) {}",
      "const esperou = $('Aguardar 3s (IA respondendo)').isExecuted;",
      "const citarDe = (b, i) => (esperou && i === 0 && msgs.length ? msgs[msgs.length - 1].id || '' : '');",
      "// Ritmo de gente (pedido do Victor, 25/10): o tempo depende do tamanho do texto.",
      "// pausa = 'pensando' antes do 'digitando…' (a leitura já foi feita antes, em Leitura: …): 1º balão 1-3 s;",
      "//         balões seguintes 1-2,5 s (respiro entre uma mensagem e outra).",
      "// delay = tempo de 'digitando…': 65-90 ms por letra (uns 12 caracteres por segundo, alguém rápido no celular),",
      "//         no mínimo 2,5 s e no máximo 22 s. Ex.: 40 letras ≈ 3 s; 120 ≈ 9 s; 250 ≈ 19 s.",
      "const ale = (a, b) => a + Math.random() * (b - a);",
      "return baloes.map(({ t: texto, ref }, i) => ({ json: { jid, texto, falhou, citar: citarDe({ ref }, i),",
      "  pausa: Math.round((i === 0 ? ale(1, 3) : ale(1, 2.5)) * 10) / 10,",
      "  delay: Math.round(Math.min(22000, Math.max(2500, texto.length * ale(65, 90)))) } }));",
    ].join('\n'),
  }),

  toolAgenda('consultar_horarios_livres', [2880, 200],
    'Consulta a agenda do salão e devolve o QUADRO DO DIA: manhã, almoço e tarde, o que está livre e o que já tem cliente marcada, e os inícios que cabem o serviço. ' +
    'Use SEMPRE antes de oferecer horários. Se o dia pedido estiver fechado ou lotado, ela já devolve o próximo dia com vaga.',
    { acao: 'consultar' },
    [
      ['data', 'Dia desejado no formato AAAA-MM-DD (calcule "amanhã", "sábado" etc. a partir da data atual). Se a cliente pediu um HORÁRIO específico, envie AAAA-MM-DDTHH:mm para verificar exatamente esse horário.', 'string'],
      ['duracao_minutos', 'Duração do serviço em minutos, conforme a lista de serviços (ex.: 240 para aplicação de mega hair, 120 para manutenção, 30 para avaliação)', 'number'],
      ['periodo', 'Período preferido: manha, tarde ou qualquer', 'string'],
    ]),

  toolAgenda('ver_agendamentos', [2880, 360],
    'Lista os agendamentos futuros desta cliente (os que foram marcados por este WhatsApp). Use quando ela perguntar o horário ' +
    'dela, ou antes de remarcar/cancelar se você não souber o data_hora_inicio do agendamento atual.',
    { acao: 'listar', telefone: "={{ $('Montar entrada').first().json.telefone }}" }, []),

  toolAgenda('remarcar_agendamento', [3040, 360],
    'MUDA o horário de um agendamento que a cliente JÁ TEM (o mesmo agendamento passa para o novo horário). Use sempre que ela quiser ' +
    'remarcar/trocar/mudar/adiantar/atrasar o horário. NUNCA use criar_agendamento para remarcar. Só diga que remarcou se a resposta começar com REMARCADO.',
    { acao: 'remarcar', telefone: "={{ $('Montar entrada').first().json.telefone }}" },
    [
      ['data_hora_inicio', 'Horário ATUAL do agendamento, AAAA-MM-DDTHH:mm (pode deixar vazio se ela só tem um agendamento)', 'string'],
      ['data_hora_nova', 'NOVO horário desejado, AAAA-MM-DDTHH:mm', 'string'],
    ]),

  toolAgenda('cancelar_agendamento', [3200, 360],
    'Cancela (remove da agenda) um agendamento que a cliente já tem. Use só depois que ela confirmar que quer cancelar. ' +
    'Só diga que cancelou se a resposta começar com CANCELADO.',
    { acao: 'cancelar', telefone: "={{ $('Montar entrada').first().json.telefone }}" },
    [['data_hora_inicio', 'Horário do agendamento a cancelar, AAAA-MM-DDTHH:mm (pode deixar vazio se ela só tem um)', 'string']]),

  toolAgenda('criar_agendamento', [3040, 200],
    'Cria um agendamento NOVO na agenda do salão. Use SOMENTE depois que a cliente escolheu um dos horários de consultar_horarios_livres ' +
    'e confirmou serviço e nome. NÃO use para remarcar (para isso existe remarcar_agendamento). Se a resposta não começar com AGENDADO, o horário NÃO foi marcado.',
    { acao: 'criar', telefone: "={{ $('Montar entrada').first().json.telefone }}" },
    [
      ['nome', 'Nome da cliente', 'string'],
      ['servico', 'Nome COMPLETO do serviço, como na lista, dizendo se é aplicação ou manutenção (ex.: "Manutenção – mão de obra", "Aplicação de mega hair – mão de obra", "Selagem")', 'string'],
      ['motivo', 'Resumo curto (até ~60 caracteres) do que a cliente quer e do que ela contou na conversa, para a Gleide ler na agenda. Ex.: "comprar cabelo vietnamita 60 cm", "selagem - cabelo ressecado", "manutenção tela adesiva colocada em agosto", "avaliar técnica, cabelo curto"', 'string'],
      ['data_hora_inicio', 'Início no formato AAAA-MM-DDTHH:mm, exatamente como veio em consultar_horarios_livres', 'string'],
      ['duracao_minutos', 'Duração do serviço em minutos', 'number'],
    ]),

  toolSub('transferir_para_humano', [3200, 200],
    'Passa a conversa para a Gleide e PAUSA a IA para esta cliente por 12h. A Gleide recebe no WhatsApp o resumo e o link ' +
    'da conversa no app, para não precisar ler tudo. Use nos casos do bloco QUANDO PRECISA DA GLEIDE (passar a conversa). ' +
    'Dúvida que só a Gleide decide (levar cachorro, criança, atraso, serviço fora da tabela) é perguntar_para_gleide, que não pausa, ' +
    'MESMO que a cliente diga "quero falar com a Gleide" por causa disso: a resposta da Gleide chega sozinha para a cliente.',
    lerPausaId, ['telefone', 'motivo', 'resumo', 'o_que_precisa'],
    { telefone: "={{ $('Montar entrada').first().json.telefone }}" },
    [['motivo', 'Motivo curto, até 12 palavras (ex.: quer avaliação à distância, mora longe)', 'string'],
      ['resumo', 'Uma frase curta, até 20 palavras, só com o que a Gleide não sabe pelo pedido: nova ou já cliente, horário marcado, o que você já explicou ou enviou (áudio, preço, fotos). Não repita o pedido. Sem diagnóstico.', 'string'],
      ['o_que_precisa', 'O que a Gleide precisa fazer, direto, até 15 palavras (ex.: Dizer se dá para orientar por foto)', 'string']]),

  // Só áudio nesta resposta ([SEM TEXTO]): não manda balão, só libera a trava
  ifNode('Tem texto pra enviar?', [0, 0], [
    cond('t1', '={{ !$json.semTexto }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),

  // Um balão por vez, em ordem: "digitando..." (a Evolution segura a resposta pelo delay) -> envia -> próximo
  node('Um balão por vez', 'n8n-nodes-base.splitInBatches', 3, [3180, -20], { options: {} }),

  node('Pausa (lendo/respirando)', 'n8n-nodes-base.wait', 1.1, [0, 0], { resume: 'timeInterval', amount: '={{ $json.pausa }}', unit: 'seconds' },
    { webhookId: '3d4e5f60-7182-493a-9b2c-e3f405162738' }),

  // O WhatsApp apaga o "digitando…" em ~10 s se ninguém renova: divide o tempo em blocos de até 7,5 s
  node('Digitando (blocos de 8s)', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: [
    "// o tempo de 'digitando…' em blocos iguais de até 7,5 s: cada chamada da Evolution dura o delay do bloco e o",
    "// próximo bloco começa um bloco depois (batchInterval = delay), então o tempo total é o delay calculado",
    "const b = $input.first().json;",
    "const n = Math.max(1, Math.ceil(b.delay / 7500));",
    "const delay = Math.round(b.delay / n);",
    "return Array.from({ length: n }, () => ({ json: { jid: b.jid, delay }, pairedItem: 0 }));",
  ].join('\n') }),

  node('Digitando...', 'n8n-nodes-base.httpRequest', 4.2, [3400, 80], {
    method: 'POST',
    url: `${EVO}/chat/sendPresence/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ number: $json.jid, presence: 'composing', delay: $json.delay }) }}",
    // um bloco por vez: o n8n não espera a resposta entre lotes, então o intervalo é o próprio tamanho do bloco
    options: { batching: { batch: { batchSize: 1, batchInterval: '={{ $json.delay }}' } } },
  }, { onError: 'continueRegularOutput' }),

  node('Enviar mensagem', 'n8n-nodes-base.httpRequest', 4.2, [3620, 80], {
    method: 'POST',
    url: `${EVO}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    // quoted só com o id: a Evolution acha a mensagem dela no próprio banco e manda como resposta citando
    jsonBody: "={{ JSON.stringify(Object.assign({ number: $('Um balão por vez').item.json.jid, text: $('Um balão por vez').item.json.texto }, $('Um balão por vez').item.json.citar ? { quoted: { key: { id: $('Um balão por vez').item.json.citar } } } : {})) }}",
    options: {},
  // a conexão do WhatsApp às vezes cai por alguns segundos: tenta de novo antes de desistir.
  // executeOnce: chegam vários itens (um por bloco de "digitando"), mas a mensagem sai uma vez só
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput', executeOnce: true }),
];

const connections = {
  'Webhook Evolution': main('Extrair dados'),
  'Extrair dados': main('Minha resposta manual?'),
  'Minha resposta manual?': { main: [[{ node: 'Comando #ia?', type: 'main', index: 0 }], [{ node: 'Filtro', type: 'main', index: 0 }]] },
  'Comando #ia?': { main: [[{ node: 'Pausa: remover', type: 'main', index: 0 }], [{ node: 'Pausa: humano assumiu (12h)', type: 'main', index: 0 }]] },
  'Filtro': main('Pausa: verificar'),
  'Pausa: verificar': main('IA ativa?'),
  'IA ativa?': main('É áudio ou foto?'),
  'É áudio ou foto?': { main: [[{ node: 'Baixar mídia (Evolution)', type: 'main', index: 0 }], [{ node: 'Texto da mensagem', type: 'main', index: 0 }]] },
  'Baixar mídia (Evolution)': main('Entender mídia (Gemini)'),
  'Entender mídia (Gemini)': main('Texto da mensagem'),
  'Texto da mensagem': main('Buffer: guardar msg'),
  'Buffer: guardar msg': main('Buffer: marcar última'),
  'Buffer: marcar última': main('Aguardar (juntar mensagens)'),
  'Aguardar (juntar mensagens)': main('Buffer: ler última'),
  'Buffer: ler última': main('É a última msg?'),
  'É a última msg?': main('Pausa: verificar de novo'),
  'Pausa: verificar de novo': main('Ainda ativa?'),
  'Ainda ativa?': { main: [[{ node: 'Trava: ler', type: 'main', index: 0 }], [{ node: 'Buffer: descartar (pausada)', type: 'main', index: 0 }]] },
  'Trava: ler': main('Ninguém respondendo?'),
  // livre -> marca a trava e segue; ocupado -> espera 3 s e volta a conferir se ainda é a última mensagem
  'Ninguém respondendo?': { main: [[{ node: 'Vez: contar', type: 'main', index: 0 }], [{ node: 'Aguardar 3s (IA respondendo)', type: 'main', index: 0 }]] },
  // até 3 conversas ao mesmo tempo; sem vez, espera 5 s e volta a conferir se ainda é a última mensagem dela
  'Vez: contar': main('Tem vez?'),
  'Tem vez?': { main: [[{ node: 'Trava: marcar', type: 'main', index: 0 }], [{ node: 'Vez: esperar 5s', type: 'main', index: 0 }]] },
  'Vez: esperar 5s': main('Buffer: ler última'),
  // respondeu: depois de 5–15 s sai do "online", se ninguém mais estiver sendo respondido
  'Trava: liberar': main('Offline: esperar'),
  'Offline: esperar': main('Offline: alguém respondendo?'),
  'Offline: alguém respondendo?': main('Ninguém mais respondendo?'),
  'Ninguém mais respondendo?': { main: [[{ node: 'Offline: sair', type: 'main', index: 0 }], []] },
  'Aguardar 3s (IA respondendo)': main('Buffer: ler última'),
  'Trava: marcar': main('Buffer: ler mensagens'),
  'Buffer: ler mensagens': main('Buffer: limpar'),
  'Buffer: limpar': main('Montar entrada'),
  'Montar entrada': main('Leitura: ficar online'),
  'Leitura: ficar online': main('Leitura: uma por vez'),
  'Leitura: uma por vez': main('Leitura: próxima'),
  // saída 0 = "done" (leu todas), saída 1 = "loop" (próxima mensagem)
  'Leitura: próxima': { main: [[{ node: 'Marcar como lida', type: 'main', index: 0 }], [{ node: 'Leitura: lendo', type: 'main', index: 0 }]] },
  'Leitura: lendo': main('Leitura: marcar lida'),
  'Leitura: marcar lida': main('Leitura: próxima'),
  'Marcar como lida': main('Agente IA'),
  'Agente IA': main('Quebrar mensagens'),
  'Quebrar mensagens': main('Tem texto pra enviar?'),
  'Tem texto pra enviar?': { main: [[{ node: 'Um balão por vez', type: 'main', index: 0 }], [{ node: 'Trava: liberar', type: 'main', index: 0 }]] },
  // saída 0 = "done" (fim), saída 1 = "loop" (próximo balão)
  'Um balão por vez': { main: [[{ node: 'Trava: liberar', type: 'main', index: 0 }], [{ node: 'Pausa (lendo/respirando)', type: 'main', index: 0 }]] },
  'Pausa (lendo/respirando)': main('Digitando (blocos de 8s)'),
  'Digitando (blocos de 8s)': main('Digitando...'),
  'Digitando...': main('Enviar mensagem'),
  'Enviar mensagem': main('Um balão por vez'),
  'Gemini Flash': { ai_languageModel: [[{ node: 'Agente IA', type: 'ai_languageModel', index: 0 }]] },
  'Memória (Redis)': { ai_memory: [[{ node: 'Agente IA', type: 'ai_memory', index: 0 }]] },
  'consultar_horarios_livres': { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] },
  'criar_agendamento': { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] },
  'ver_agendamentos': { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] },
  'remarcar_agendamento': { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] },
  'cancelar_agendamento': { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] },
  'transferir_para_humano': { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] },
};

const workflow = {
  name: 'Demo Salão - Agente WhatsApp',
  nodes, connections,
  settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', saveManualExecutions: true },
};

// CRM: ficha por cliente no Postgres + tool anotar_no_crm (ver crm-workflows.js)
const crmIdFile = path.join(dir, '.workflow-crm-id');
const lerCrmId = () => (fs.existsSync(crmIdFile) ? fs.readFileSync(crmIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_CRM');
const { crmWorkflow } = require('./crm-workflows.js')({ env, node, str, main, D, toolSub, workflow, agendaWorkflow, pausaWorkflow, lerCrmId });

// Supabase (banco do CRM): mensagens, pausa e agenda passam a ser gravadas lá (ver supabase-workflows.js)
require('./supabase-workflows.js')({ node, main, D, workflow, agendaWorkflow, pausaWorkflow, crmWorkflow });

// Áudios prontos da Gleide: tool enviar_audio + catálogo no fim do prompt (ver audios-workflows.js)
const audios = require('./audios-workflows.js')({ env, node, str, main, toolSub, workflow });

// Catálogo de fotos de cabelo: tool enviar_catalogo (ver catalogo-workflows.js e cadastrar-catalogo.js)
// fotosIndividuais: false enquanto o prompt estiver no modo de link do catálogo do WhatsApp Business (seção 01-A)
const catalogo = require('./catalogo-workflows.js')({ node, str, main, toolSub, workflow, fotosIndividuais: false });

// Assistente da Gleide: desvia o número dela no principal + 3 workflows novos (ver assistente-workflows.js)
const assistente = require('./assistente-workflows.js')({ env, node, str, main, toolSub, workflow });

// Faltas: a IA chama quem faltou e avisa a Gleide do que remarcou (ver faltas-workflows.js e supabase/007)
const faltas = require('./faltas-workflows.js')({ env, node, main });
// Retomar conversa: a cliente sumiu depois da resposta da IA (ver retomar-workflows.js e supabase/019)
const retomar = require('./retomar-workflows.js')({ env, node, main, GEMINI });

// Pergunta rápida para a Gleide: a IA pergunta, a Gleide responde citando e a IA repassa (ver pedidos-workflows.js)
const perguntaIdFile = path.join(dir, '.workflow-pergunta-id');
const lerPerguntaId = () => (fs.existsSync(perguntaIdFile) ? fs.readFileSync(perguntaIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_PERGUNTA');
const pedidos = require('./pedidos-workflows.js')({ node, str, main, toolSub, workflow, REDIS, GEMINI, lerPerguntaId });

// Alerta de erro no WhatsApp do Victor (ver alerta-workflows.js)
const alerta = require('./alerta-workflows.js')({ env, node, main, workflow });

// memória sem começo quebrado no meio de uma ferramenta (ver memoria-janela.js)
const memoriaJanela = require('./memoria-janela.js')({ node, main });
memoriaJanela(workflow, 'Agente IA', REDIS);
memoriaJanela(assistente.assistenteWorkflow, 'Agente assistente', REDIS);

// organiza os nós de todos os workflows e põe uma nota no topo de cada um (só visual, ver layout-n8n.js)
const organizar = require('./layout-n8n.js');
organizar(workflow, 'Atendimento das clientes (WhatsApp)', [
  'Roda a cada mensagem que chega no WhatsApp do salão (Evolution).',
  '1. Entrada: separa telefone, nome e texto. Mensagem sua pelo celular pausa a IA 12 h para aquele número; #ia tira a pausa.',
  '2. Resposta da Gleide a uma pergunta rápida (ela tocou em Responder): a IA repassa para a cliente.',
  '3. Filtro e pausa: ignora grupos e status; cliente pausada para aqui. Áudio é transcrito e foto é descrita pelo Gemini.',
  '4. Junta as mensagens seguidas (20 s) e só a última da rajada segue. A trava evita duas respostas ao mesmo tempo.',
  '5. Agente IA: prompt-agente.md + ficha da cliente + memória (Redis) + ferramentas (agenda, Gleide, áudio, CRM).',
  '6. Quebra a resposta em até 3 mensagens, mostra "digitando…" proporcional ao texto e envia.',
  'Publicar mudanças: node montar-workflow.js --enviar --ativar (não edite aqui pela tela).',
].join('\n'), 5);
organizar(agendaWorkflow, 'Agenda (ferramentas do agente)', [
  'Chamado pelo agente para consultar horários livres, ver, marcar, remarcar ou cancelar.',
  'Lê a agenda do app (Supabase), aplica as regras do salão (expediente, almoço, dias bloqueados) e grava o resultado.',
].join('\n'), 4);
organizar(pausaWorkflow, 'Transferir para a Gleide', [
  'Chamado pelo agente quando a cliente pede uma pessoa, reclama ou o assunto precisa da Gleide.',
  'Pausa a IA 12 h para a cliente, salva o resumo na ficha e avisa a Gleide no WhatsApp (número de alerta do app).',
  'Mande #ia na conversa para devolver à IA.',
].join('\n'), 3);
organizar(crmWorkflow, 'Anotações do agente (CRM)', 'Chamado pelo agente nos marcos da conversa: grava o interesse, a objeção ou o agendamento como pré-avaliação da cliente.', 7);
organizar(assistente.assistenteWorkflow, 'Assistente da Gleide (WhatsApp)', [
  'Roda quando a Gleide escreve para o número do salão (números da assistente).',
  'Ela pede em linguagem normal e a assistente faz no app: agenda, fichas, bloqueios, pausar IA, avisar cliente (ferramentas embaixo do agente).',
].join('\n'), 6);
organizar(assistente.ferramentasWorkflow, 'Assistente - Ferramentas', 'Executa no banco o que a assistente da Gleide pediu (funções n8n_assistente_* do Supabase) e devolve o resultado.', 6);
organizar(assistente.pendenciasWorkflow, 'Assistente - Pendências', 'A cada 15 min (8h–20h) pergunta à Gleide o que falta registrar no app (atendimento sem resultado, avaliação sem retorno).', 6);
organizar(audios.enviarWorkflow, 'Áudios prontos - Enviar', 'Chamado pelo agente (enviar_audio): acha o áudio do tema na lista do app, baixa do Storage e manda no WhatsApp da cliente.', 2);
organizar(audios.transcreverWorkflow, 'Áudios prontos - Transcrever', 'Transcreve um áudio novo cadastrado para a IA saber o que ele diz.', 2);
organizar(catalogo.enviarWorkflow, 'Catálogo - Enviar fotos', [
  'Chamado pelo agente (enviar_catalogo) quando a cliente pede para ver os cabelos: escolhe 2 a 4 fotos que combinam',
  '(tipo, cor, comprimento, textura), sem repetir as que ela já recebeu, e manda uma por vez pela Evolution (URL assinada do Storage).',
  'Fotos e fichas: tabela catalogo + bucket "catalogo" (node cadastrar-catalogo.js <pasta>). Nunca manda preço.',
].join('\n'), 2);
organizar(faltas.faltasWorkflow, 'Faltas, atrasos e vagas', [
  'A cada 5 min (8h–20h): chama quem faltou ou está atrasada, oferece vaga que abriu para quem tem horário depois,',
  'e conta para a Gleide o que mudou. Liga e desliga em empresas.config (faltas, atrasos, vagas).',
].join('\n'), 1);
organizar(retomar.retomarWorkflow, 'Retomar conversa', [
  'A cada 1 min: a cliente parou de responder depois da IA? 5 min e 30 min depois (config.retomada.minutos, com o salão aberto) o Gemini',
  'escreve uma mensagem que retoma de onde parou, ou decide não retomar. Vai pelo número do salão, para o CRM e para a memória da IA.',
].join('\n'), 1);
organizar(alerta.alertaWorkflow, 'Alerta de erro', 'Quando qualquer workflow dá erro, manda um aviso no WhatsApp do número de alerta (no máximo 1 a cada 10 min).', 3);
organizar(pedidos.perguntaWorkflow, 'Perguntar para a Gleide', 'Chamado pelo agente (perguntar_para_gleide): manda a dúvida da cliente para a Gleide e guarda para repassar a resposta quando ela tocar em Responder.', 1);

const todos = [agendaWorkflow, pausaWorkflow, crmWorkflow, assistente.ferramentasWorkflow, assistente.assistenteWorkflow, assistente.pendenciasWorkflow,
  audios.enviarWorkflow, audios.transcreverWorkflow, catalogo.enviarWorkflow, faltas.faltasWorkflow, retomar.retomarWorkflow, pedidos.perguntaWorkflow,
  alerta.alertaWorkflow, workflow];
// Loja: troca o que é da Gleide pelo que é da loja e confere; se sobrar algo da Gleide, para aqui
const idsGleide = LOJA ? lojas.idsDaGleide(dir) : [];
if (LOJA) {
  const ids = lojas.mapaIds(dir, LOJA);
  for (const wf of todos) lojas.paraLoja(wf, LOJA, ids);
  const { erros, avisos } = lojas.conferirLoja(todos, LOJA, idsGleide);
  for (const a of avisos) console.log(`aviso: ${a}`);
  if (erros.length) {
    console.error(`\nNÃO GEREI a loja "${LOJA.slug}": sobrou coisa da Gleide.\n- ${erros.join('\n- ')}\n`);
    process.exit(1);
  }
}
// errorWorkflow já no JSON gerado (o id do "Alerta de erro" fica em .workflow-alerta-id depois do 1º envio)
const alertaIdFile = saida(alerta.idFile);
if (fs.existsSync(alertaIdFile)) alerta.ligarEm([agendaWorkflow, pausaWorkflow, crmWorkflow, assistente.ferramentasWorkflow, assistente.assistenteWorkflow,
  assistente.pendenciasWorkflow, audios.enviarWorkflow, audios.transcreverWorkflow, catalogo.enviarWorkflow, faltas.faltasWorkflow, retomar.retomarWorkflow, pedidos.perguntaWorkflow, workflow], fs.readFileSync(alertaIdFile, 'utf8').trim());
fs.writeFileSync(saida('workflow-demo-salao.json'), JSON.stringify(workflow, null, 2));
fs.writeFileSync(saida('workflow-agenda-salao.json'), JSON.stringify(agendaWorkflow, null, 2));
fs.writeFileSync(saida('workflow-pausa-salao.json'), JSON.stringify(pausaWorkflow, null, 2));
fs.writeFileSync(saida('workflow-crm-salao.json'), JSON.stringify(crmWorkflow, null, 2));
fs.writeFileSync(saida('workflow-assistente.json'), JSON.stringify(assistente.assistenteWorkflow, null, 2));
fs.writeFileSync(saida('workflow-assistente-ferramentas.json'), JSON.stringify(assistente.ferramentasWorkflow, null, 2));
fs.writeFileSync(saida('workflow-assistente-pendencias.json'), JSON.stringify(assistente.pendenciasWorkflow, null, 2));
fs.writeFileSync(saida('workflow-audios-enviar.json'), JSON.stringify(audios.enviarWorkflow, null, 2));
fs.writeFileSync(saida('workflow-audios-transcrever.json'), JSON.stringify(audios.transcreverWorkflow, null, 2));
fs.writeFileSync(saida('workflow-catalogo-enviar.json'), JSON.stringify(catalogo.enviarWorkflow, null, 2));
fs.writeFileSync(saida('workflow-faltas.json'), JSON.stringify(faltas.faltasWorkflow, null, 2));
fs.writeFileSync(saida('workflow-retomar.json'), JSON.stringify(retomar.retomarWorkflow, null, 2));
fs.writeFileSync(saida('workflow-alerta.json'), JSON.stringify(alerta.alertaWorkflow, null, 2));
fs.writeFileSync(saida('workflow-pergunta.json'), JSON.stringify(pedidos.perguntaWorkflow, null, 2));
console.log('workflow-demo-salao.json, workflow-agenda-salao.json e workflow-pausa-salao.json gerados');

// Trava: só envia ao n8n com o código em dia com a main e sem mudança fora do Git. Em 24/10 alguém enviou de uma
// cópia antiga e apagou do n8n o prompt novo e a mensagem única. --forcar pula a trava.
if (process.argv.includes('--enviar') && !process.argv.includes('--forcar')) {
  const { execSync } = require('child_process');
  const git = (c) => execSync(`git ${c}`, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let erro = '';
  try {
    git('fetch -q origin main');
    const faltam = git('rev-list --count HEAD..origin/main');
    if (faltam !== '0') erro = `sua cópia está ${faltam} commit(s) atrás da main. Rode: git pull origin main`;
    // sem aspas em volta do *.js: no Windows (cmd) as aspas simples iam junto e o Git não achava nada
    else if (git('status --porcelain -- *.js prompt-agente.md')) erro = 'há mudanças não commitadas no prompt ou nos *.js. Faça commit e push antes de enviar';
    else if (LOJA && git(`status --porcelain -- lojas/${LOJA.slug}/loja.json lojas/${LOJA.slug}/prompt-agente.md`)) erro = `há mudanças não commitadas em lojas/${LOJA.slug}. Faça commit e push antes de enviar`;
  } catch (e) {
    erro = 'não consegui conferir o Git (sem internet ou fora do repositório)';
  }
  if (erro) {
    console.error(`\nNÃO ENVIEI: ${erro}.\nO n8n ficaria diferente do Git. Para enviar mesmo assim: --forcar\n`);
    process.exit(1);
  }
}

if (process.argv.includes('--enviar')) {
  const base = `${env.N8N_URL || 'http://localhost:5678'}/api/v1/workflows`;
  const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
  const upsert = async (wf, arquivoId) => {
    // loja: o id fica na pasta dela; e nunca envia nada que aponte para (ou grave em cima de) um workflow da Gleide
    const idFile = saida(arquivoId);
    if (LOJA) {
      const s = JSON.stringify(wf);
      const ruim = idsGleide.find((g) => s.includes(g)) || (s.includes('PENDENTE.workflow') && 'id pendente');
      if (ruim) { console.error(`NÃO ENVIEI "${wf.name}": aponta para ${ruim}`); process.exit(1); }
    }
    const id = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : '';
    if (LOJA && idsGleide.includes(id)) { console.error(`NÃO ENVIEI "${wf.name}": o id ${id} é da Gleide`); process.exit(1); }
    const res = await fetch(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', headers, body: JSON.stringify(wf) });
    const body = await res.json();
    if (!res.ok) { console.error(`Erro em "${wf.name}"`, res.status, JSON.stringify(body)); process.exit(1); }
    fs.writeFileSync(idFile, body.id);
    console.log(`${id ? 'Atualizado' : 'Criado'}: ${wf.name} (id=${body.id})`);
    return body.id;
  };
  const ativar = async (id) => {
    const a = await fetch(`${base}/${id}/activate`, { method: 'POST', headers });
    const ab = await a.json();
    console.log(a.ok ? `  ativo: ${ab.active}` : `  erro ao ativar: ${JSON.stringify(ab)}`);
  };
  (async () => {
    // alerta primeiro: os outros workflows apontam para ele em settings.errorWorkflow
    const alertaId = await upsert(alerta.alertaWorkflow, alerta.idFile);
    await ativar(alertaId); // o n8n só aceita errorWorkflow publicado
    alerta.ligarEm([agendaWorkflow, pausaWorkflow, crmWorkflow, assistente.ferramentasWorkflow, assistente.assistenteWorkflow,
      assistente.pendenciasWorkflow, audios.enviarWorkflow, audios.transcreverWorkflow, catalogo.enviarWorkflow, faltas.faltasWorkflow, retomar.retomarWorkflow, pedidos.perguntaWorkflow, workflow], alertaId);
    const agendaId = await upsert(agendaWorkflow, agendaIdFile);
    // n8n 2.x: subworkflow também precisa estar publicado (ativo) para ser chamado
    if (process.argv.includes('--ativar')) await ativar(agendaId);
    const pausaId = await upsert(pausaWorkflow, pausaIdFile);
    if (process.argv.includes('--ativar')) await ativar(pausaId);
    // aponta as tools para os subworkflows e regrava o JSON exportado
    const crmId = await upsert(crmWorkflow, crmIdFile);
    if (process.argv.includes('--ativar')) await ativar(crmId);
    // assistente: ferramentas primeiro (as tools do agente apontam para ele)
    const ferramentasId = await upsert(assistente.ferramentasWorkflow, assistente.ferramentasIdFile);
    if (process.argv.includes('--ativar')) await ativar(ferramentasId);
    for (const nd of assistente.assistenteWorkflow.nodes) if (nd.type.endsWith('toolWorkflow')) nd.parameters.workflowId.value = ferramentasId;
    fs.writeFileSync(saida('workflow-assistente.json'), JSON.stringify(assistente.assistenteWorkflow, null, 2));
    for (const [wf, arq] of [[assistente.assistenteWorkflow, '.workflow-assistente-id'], [assistente.pendenciasWorkflow, '.workflow-assistente-pendencias-id']]) {
      const wid = await upsert(wf, path.join(dir, arq));
      if (process.argv.includes('--ativar')) await ativar(wid);
    }
    // áudios prontos: o subworkflow da tool enviar_audio e o webhook de transcrever
    const audiosId = await upsert(audios.enviarWorkflow, audios.idFile);
    if (process.argv.includes('--ativar')) await ativar(audiosId);
    const transcreverId = await upsert(audios.transcreverWorkflow, path.join(dir, '.workflow-audios-transcrever-id'));
    if (process.argv.includes('--ativar')) await ativar(transcreverId);
    // catálogo de fotos: o subworkflow da tool enviar_catalogo
    const catalogoId = await upsert(catalogo.enviarWorkflow, catalogo.idFile);
    if (process.argv.includes('--ativar')) await ativar(catalogoId);
    const faltasId = await upsert(faltas.faltasWorkflow, faltas.idFile);
    if (process.argv.includes('--ativar')) await ativar(faltasId);
    const retomarId = await upsert(retomar.retomarWorkflow, retomar.idFile);
    if (process.argv.includes('--ativar')) await ativar(retomarId);
    const perguntaId = await upsert(pedidos.perguntaWorkflow, pedidos.idFile);
    if (process.argv.includes('--ativar')) await ativar(perguntaId);
    const idTool = { transferir_para_humano: pausaId, anotar_no_crm: crmId, enviar_audio: audiosId, enviar_catalogo: catalogoId, perguntar_para_gleide: perguntaId };
    for (const nd of workflow.nodes) if (nd.type.endsWith('toolWorkflow')) nd.parameters.workflowId.value = idTool[nd.name] || agendaId;
    fs.writeFileSync(saida('workflow-demo-salao.json'), JSON.stringify(workflow, null, 2));
    const id = await upsert(workflow, path.join(dir, '.workflow-id'));
    if (process.argv.includes('--ativar')) await ativar(id);
  })();
}
