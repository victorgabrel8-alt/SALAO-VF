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

const md = fs.readFileSync(path.join(dir, 'prompt-agente.md'), 'utf8');
const prompt = md.match(/```text\r?\n([\s\S]*?)```/)[1].trim();

const REDIS = { redis: { id: env.N8N_REDIS_CRED_ID || '', name: 'Redis local' } };
const GEMINI = env.N8N_GEMINI_CRED_ID ? { googlePalmApi: { id: env.N8N_GEMINI_CRED_ID, name: 'Google Gemini(PaLM) Api account' } } : undefined;

const EVO = "={{ $env.EVOLUTION_URL }}";
const apikeyHeader = { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] };
const D = "$('Extrair dados').item.json";

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
const { PREPARAR, CALCULAR } = require('./agenda-calculo.js');
const GCAL = { googleCalendarOAuth2Api: { id: env.N8N_GCAL_CRED_ID || '', name: 'Google Calendar account 2' } };
const gcalAuth = { authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api' };
const CAMPOS = ['acao', 'data', 'periodo', 'duracao_minutos', 'nome', 'telefone', 'servico', 'data_hora_inicio', 'motivo', 'data_hora_nova'];
const GCAL_EVENTS = '=https://www.googleapis.com/calendar/v3/calendars/{{ encodeURIComponent($env.GOOGLE_CALENDAR_ID) }}/events';

const agendaNodes = [
  node('Recebe pedido do agente', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
    workflowInputs: { values: CAMPOS.map((name) => (name === 'duracao_minutos' ? { name, type: 'number' } : { name })) },
  }),
  node('Preparar', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: PREPARAR.trim() }),
  node('Google: horários ocupados', 'n8n-nodes-base.httpRequest', 4.2, [440, 0], {
    method: 'POST', url: 'https://www.googleapis.com/calendar/v3/freeBusy', ...gcalAuth,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ timeMin: $json.timeMin, timeMax: $json.timeMax, timeZone: 'America/Cuiaba', items: [{ id: $env.GOOGLE_CALENDAR_ID }] }) }}",
    options: {},
  }, { credentials: GCAL, onError: 'continueRegularOutput' }),
  // agendamentos futuros desta cliente: o telefone dela está na descrição dos eventos criados pela IA
  node('Google: agendamentos da cliente', 'n8n-nodes-base.httpRequest', 4.2, [550, 160], {
    method: 'GET', url: GCAL_EVENTS, ...gcalAuth,
    sendQuery: true,
    queryParameters: { parameters: [
      { name: 'q', value: "={{ $('Preparar').item.json.telefone || 'sem-telefone' }}" },
      { name: 'timeMin', value: "={{ $('Preparar').item.json.agoraUtc }}" },
      { name: 'singleEvents', value: 'true' },
      { name: 'orderBy', value: 'startTime' },
      { name: 'maxResults', value: '20' },
    ] },
    options: {},
  }, { credentials: GCAL, onError: 'continueRegularOutput' }),
  node('Calcular', 'n8n-nodes-base.code', 2, [660, 0], { jsCode: CALCULAR.trim() }),
  ifNode('Criar evento?', [880, 0], [
    cond('g1', '={{ $json.acao }}', { type: 'string', operation: 'equals' }, 'criar'),
    cond('g2', '={{ $json.ok }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  node('Google: criar evento', 'n8n-nodes-base.httpRequest', 4.2, [1100, -100], {
    method: 'POST', url: '=https://www.googleapis.com/calendar/v3/calendars/{{ encodeURIComponent($env.GOOGLE_CALENDAR_ID) }}/events', ...gcalAuth,
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.evento) }}',
    options: {},
  }, { credentials: GCAL, onError: 'continueRegularOutput' }),
  node('Resposta (agendado)', 'n8n-nodes-base.set', 3.4, [1320, -100], {
    assignments: { assignments: [
      str('resposta', "={{ $json.id ? 'AGENDADO com sucesso na agenda do salão: ' + $('Calcular').item.json.quando + '. Agora confirme para a cliente o serviço, o dia e a hora.' : 'NÃO AGENDADO: a agenda falhou ao gravar. Peça desculpas e use transferir_para_humano para a equipe marcar.' }}"),
    ] },
    options: {},
  }),
  ifNode('Cancelar evento?', [1100, 120], [
    cond('x1', '={{ $json.acao }}', { type: 'string', operation: 'equals' }, 'cancelar'),
    cond('x2', '={{ $json.ok }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  node('Google: cancelar evento', 'n8n-nodes-base.httpRequest', 4.2, [1320, 40], {
    method: 'DELETE', url: GCAL_EVENTS.slice(0) + '/{{ $json.eventId }}', ...gcalAuth, options: {},
  }, { credentials: GCAL, onError: 'continueRegularOutput' }),
  node('Resposta (cancelado)', 'n8n-nodes-base.set', 3.4, [1540, 40], {
    assignments: { assignments: [
      str('resposta', "={{ $json.error ? 'NÃO CANCELADO: a agenda falhou. Peça desculpas e use transferir_para_humano.' : 'CANCELADO com sucesso: o agendamento de ' + $('Calcular').item.json.de + ' foi removido da agenda. Confirme para a cliente.' }}"),
    ] },
    options: {},
  }),
  ifNode('Remarcar evento?', [1320, 220], [
    cond('r1', '={{ $json.acao }}', { type: 'string', operation: 'equals' }, 'remarcar'),
    cond('r2', '={{ $json.ok }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]),
  node('Google: remarcar evento', 'n8n-nodes-base.httpRequest', 4.2, [1540, 160], {
    method: 'PATCH', url: GCAL_EVENTS + '/{{ $json.eventId }}', ...gcalAuth,
    sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.patch) }}', options: {},
  }, { credentials: GCAL, onError: 'continueRegularOutput' }),
  node('Resposta (remarcado)', 'n8n-nodes-base.set', 3.4, [1760, 160], {
    assignments: { assignments: [
      str('resposta', "={{ $json.id ? 'REMARCADO com sucesso: o agendamento saiu de ' + $('Calcular').item.json.de + ' para ' + $('Calcular').item.json.quando + ' (é o MESMO agendamento, o horário antigo não existe mais). Confirme para a cliente.' : 'NÃO REMARCADO: a agenda falhou. Peça desculpas e use transferir_para_humano.' }}"),
    ] },
    options: {},
  }),
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
    'Preparar': main('Google: horários ocupados'),
    'Google: horários ocupados': main('Google: agendamentos da cliente'),
    'Google: agendamentos da cliente': main('Calcular'),
    'Calcular': main('Criar evento?'),
    'Criar evento?': { main: [[{ node: 'Google: criar evento', type: 'main', index: 0 }], [{ node: 'Cancelar evento?', type: 'main', index: 0 }]] },
    'Google: criar evento': main('Resposta (agendado)'),
    'Cancelar evento?': { main: [[{ node: 'Google: cancelar evento', type: 'main', index: 0 }], [{ node: 'Remarcar evento?', type: 'main', index: 0 }]] },
    'Google: cancelar evento': main('Resposta (cancelado)'),
    'Remarcar evento?': { main: [[{ node: 'Google: remarcar evento', type: 'main', index: 0 }], [{ node: 'Resposta', type: 'main', index: 0 }]] },
    'Google: remarcar evento': main('Resposta (remarcado)'),
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
      workflowInputs: { values: [{ name: 'telefone' }, { name: 'motivo' }] },
    }),
    node('Gravar pausa (12h)', 'n8n-nodes-base.redis', 1, [220, 0], {
      operation: 'set', key: '=pausa:{{ $json.telefone }}', value: "={{ 'agente: ' + ($json.motivo || 'transferido') }}", expire: true, ttl: PAUSA_TTL,
    }, { credentials: REDIS }),
    node('Resposta', 'n8n-nodes-base.set', 3.4, [440, 0], {
      assignments: { assignments: [str('resposta', 'TRANSFERIDO: a equipe vai assumir esta conversa e você (IA) fica pausada para esta cliente por 12h. Responda agora apenas: "Vou chamar alguém da equipe pra te ajudar 😊"')] },
      options: {},
    }),
  ],
  connections: { 'Recebe pedido do agente': main('Gravar pausa (12h)'), 'Gravar pausa (12h)': main('Resposta') },
  settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
};
const GEMINI_HTTP = { authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi' };

const nodes = [
  node('Webhook Evolution', 'n8n-nodes-base.webhook', 2, [0, 0],
    { httpMethod: 'POST', path: 'whatsapp-salao', options: {} },
    { webhookId: '7d1f3c2a-9b8e-4c6d-a5f4-3e2d1c0b9a87' }),

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
    jsonBody: "={{ JSON.stringify({ contents: [{ parts: [ { text: $('Extrair dados').item.json.tipo === 'imageMessage' ? 'Uma cliente de um salão de mega hair mandou esta foto no WhatsApp. Descreva em português, em no máximo 2 frases objetivas, o que importa para o salão: se aparece cabelo, a cor, o comprimento, o tipo de fio (liso, ondulado, cacheado), o volume e o estilo (ex.: mega hair, mechas, luzes, corte). Se for print de conversa, comprovante ou outra coisa, diga só o que é. Não invente.' : 'Transcreva este áudio de WhatsApp em português do Brasil, exatamente como foi falado. Responda só com a transcrição, sem comentários.' }, { inline_data: { mime_type: String($json.mimetype || 'audio/ogg').split(';')[0], data: $json.base64 } } ] }] }) }}",
    options: {},
  }, { credentials: GEMINI || {}, onError: 'continueRegularOutput' }),
  node('Texto da mensagem', 'n8n-nodes-base.set', 3.4, [1980, 0], {
    assignments: { assignments: [
      str('texto', `={{ (() => { const tipo = ${D}.tipo; if (!['audioMessage', 'imageMessage'].includes(tipo)) return ${D}.texto; const r = ($json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join(' ').trim(); if (tipo === 'audioMessage') return r ? '[áudio] ' + r : '[áudio que não consegui ouvir]'; const legenda = ${D}.texto ? ' Legenda: ' + ${D}.texto : ''; return (r ? '[foto da cliente] ' + r : '[foto da cliente que não consegui ver]') + legenda; })() }}`),
    ] },
    options: {},
  }),

  node('Buffer: guardar msg', 'n8n-nodes-base.redis', 1, [2200, 0], {
    operation: 'push', list: `=buffer:{{ ${D}.telefone }}`, messageData: '={{ $json.texto }}', tail: true,
  }, { credentials: REDIS }),

  node('Buffer: marcar última', 'n8n-nodes-base.redis', 1, [880, 0], {
    operation: 'set', key: `=buffer_ultima:{{ ${D}.telefone }}`, value: `={{ ${D}.msgId }}`, expire: true, ttl: 120,
  }, { credentials: REDIS }),

  node('Aguardar 10s', 'n8n-nodes-base.wait', 1.1, [1100, 0], { resume: 'timeInterval', amount: 10, unit: 'seconds' }, { webhookId: '1b2c3d4e-5f60-4718-9a0b-c1d2e3f40516' }),

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
    operation: 'set', key: `=processando:{{ ${D}.telefone }}`, value: `={{ ${D}.msgId }}`, expire: true, ttl: 120,
  }, { credentials: REDIS }),
  node('Trava: liberar', 'n8n-nodes-base.redis', 1, [0, 0], {
    operation: 'delete', key: `=processando:{{ ${D}.telefone }}`,
  }, { credentials: REDIS }),

  node('Buffer: ler mensagens', 'n8n-nodes-base.redis', 1, [1760, -20], {
    operation: 'get', key: `=buffer:{{ ${D}.telefone }}`, propertyName: 'mensagens', keyType: 'list', options: {},
  }, { credentials: REDIS }),

  node('Buffer: limpar', 'n8n-nodes-base.redis', 1, [1980, -20], {
    operation: 'delete', key: `=buffer:{{ ${D}.telefone }}`,
  }, { credentials: REDIS }),

  node('Montar entrada', 'n8n-nodes-base.set', 3.4, [2200, -20], {
    assignments: { assignments: [
      str('texto_cliente', "={{ [].concat($('Buffer: ler mensagens').item.json.mensagens || []).join('\\n') }}"),
      str('telefone', `={{ ${D}.telefone }}`),
      str('jid', `={{ ${D}.jid }}`),
      str('msgId', `={{ ${D}.msgId }}`),
      str('nome', `={{ ${D}.nome }}`),
    ] },
    options: {},
  }),

  node('Marcar como lida', 'n8n-nodes-base.httpRequest', 4.2, [2420, -20], {
    method: 'POST',
    url: `${EVO}/chat/markMessageAsRead/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ readMessages: [{ remoteJid: $json.jid, fromMe: false, id: $json.msgId }] }) }}",
    options: {},
  }, { onError: 'continueRegularOutput' }),

  node('Agente IA', '@n8n/n8n-nodes-langchain.agent', 3.1, [2640, -20], {
    promptType: 'define',
    text: "={{ $('Montar entrada').item.json.texto_cliente }}",
    options: { systemMessage: '=' + prompt },
  }),

  node('Gemini Flash', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, [2560, 200], {
    modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.4 },
  }, GEMINI ? { credentials: GEMINI } : {}),

  node('Memória (Redis)', '@n8n/n8n-nodes-langchain.memoryRedisChat', 1.5, [2720, 200], {
    sessionIdType: 'customKey',
    sessionKey: "=memoria:{{ $('Montar entrada').item.json.telefone }}",
    sessionTTL: 86400,
    contextWindowLength: 12,
  }, { credentials: REDIS }),

  node('Quebrar mensagens', 'n8n-nodes-base.code', 2, [2960, -20], {
    jsCode: [
      "const jid = $('Montar entrada').first().json.jid;",
      "let t = ($input.first().json.output || '').trim();",
      "// sem negrito/markdown: mensagem de gente não tem *asterisco*",
      "t = t.replace(/\\*\\*(.+?)\\*\\*/g, '$1').replace(/\\*([^*\\n]+)\\*/g, '$1').replace(/^#+\\s*/gm, '').replace(/^\\s*[-•]\\s+/gm, '');",
      "// Rede de segurança: se a IA falhar e devolver vazio, a cliente não fica sem resposta",
      "if (!t) t = 'Desculpa, tive um probleminha aqui e não consegui ler sua mensagem. Pode mandar de novo? 😊';",
      "let partes = t.split(/\\n\\s*\\n/).map(s => s.trim()).filter(Boolean);",
      "// junta balões curtos (até ~200 caracteres) para não parecer robô; respostas longas viram 2-3 balões",
      "const juntos = [];",
      "for (const p of partes) {",
      "  const ult = juntos[juntos.length - 1];",
      "  if (ult !== undefined && (ult.length + p.length) <= 200) juntos[juntos.length - 1] = ult + '\\n\\n' + p; else juntos.push(p);",
      "}",
      "partes = juntos;",
      "if (partes.length > 2) partes = [partes[0], partes.slice(1).join('\\n\\n')];",
      "// \"digitando...\" em ritmo humano: ~70ms por caractere, entre 2,5s e 9s; o 1º balão ganha +1,5s (tempo de ler)",
      "// Ritmo de gente: pausa antes de começar (1º balão = 'terminando de ler'; demais = respiro entre frases)",
      "// e digitação com velocidade que varia (55-85 ms por letra), entre 2 s e 9 s por balão",
      "const ale = (a, b) => a + Math.random() * (b - a);",
      "return partes.map((texto, i) => ({ json: { jid, texto,",
      "  pausa: Math.round((i === 0 ? ale(0.8, 2.5) : ale(1.2, 3)) * 10) / 10,",
      "  delay: Math.round(Math.min(9000, Math.max(2000, texto.length * ale(55, 85)))) } }));",
    ].join('\n'),
  }),

  toolAgenda('consultar_horarios_livres', [2880, 200],
    'Consulta a agenda do salão e devolve até 3 horários livres (dentro do horário de funcionamento) para um serviço. ' +
    'Use SEMPRE antes de oferecer horários. Se o dia pedido estiver fechado ou lotado, ela já devolve o próximo dia com vaga.',
    { acao: 'consultar' },
    [
      ['data', 'Dia desejado no formato AAAA-MM-DD (calcule "amanhã", "sábado" etc. a partir da data atual). Se a cliente pediu um HORÁRIO específico, envie AAAA-MM-DDTHH:mm para verificar exatamente esse horário.', 'string'],
      ['duracao_minutos', 'Duração do serviço em minutos, conforme a lista de serviços (ex.: 240 para queratina, 30 para avaliação)', 'number'],
      ['periodo', 'Período preferido: manha, tarde ou qualquer', 'string'],
    ]),

  toolAgenda('ver_agendamentos', [2880, 360],
    'Lista os agendamentos futuros desta cliente (os que foram marcados por este WhatsApp). Use quando ela perguntar o horário ' +
    'dela, ou antes de remarcar/cancelar se você não souber o data_hora_inicio do agendamento atual.',
    { acao: 'listar', telefone: "={{ $('Montar entrada').item.json.telefone }}" }, []),

  toolAgenda('remarcar_agendamento', [3040, 360],
    'MUDA o horário de um agendamento que a cliente JÁ TEM (o mesmo evento passa para o novo horário). Use sempre que ela quiser ' +
    'remarcar/trocar/mudar/adiantar/atrasar o horário. NUNCA use criar_agendamento para remarcar. Só diga que remarcou se a resposta começar com REMARCADO.',
    { acao: 'remarcar', telefone: "={{ $('Montar entrada').item.json.telefone }}" },
    [
      ['data_hora_inicio', 'Horário ATUAL do agendamento, AAAA-MM-DDTHH:mm (pode deixar vazio se ela só tem um agendamento)', 'string'],
      ['data_hora_nova', 'NOVO horário desejado, AAAA-MM-DDTHH:mm', 'string'],
    ]),

  toolAgenda('cancelar_agendamento', [3200, 360],
    'Cancela (remove da agenda) um agendamento que a cliente já tem. Use só depois que ela confirmar que quer cancelar. ' +
    'Só diga que cancelou se a resposta começar com CANCELADO.',
    { acao: 'cancelar', telefone: "={{ $('Montar entrada').item.json.telefone }}" },
    [['data_hora_inicio', 'Horário do agendamento a cancelar, AAAA-MM-DDTHH:mm (pode deixar vazio se ela só tem um)', 'string']]),

  toolAgenda('criar_agendamento', [3040, 200],
    'Cria um agendamento NOVO na agenda do salão. Use SOMENTE depois que a cliente escolheu um dos horários de consultar_horarios_livres ' +
    'e confirmou serviço e nome. NÃO use para remarcar (para isso existe remarcar_agendamento). Se a resposta não começar com AGENDADO, o horário NÃO foi marcado.',
    { acao: 'criar', telefone: "={{ $('Montar entrada').item.json.telefone }}" },
    [
      ['nome', 'Nome da cliente', 'string'],
      ['servico', 'Nome do serviço, como na lista (ex.: Mega hair com queratina)', 'string'],
      ['motivo', 'Resumo curto (até ~60 caracteres) do que a cliente quer e do que ela contou na conversa, para a Gleide ler na agenda. Ex.: "comprar cabelo vietnamita 60 cm", "selagem - cabelo ressecado", "manutenção tela adesiva colocada em agosto", "avaliar técnica, cabelo curto"', 'string'],
      ['data_hora_inicio', 'Início no formato AAAA-MM-DDTHH:mm, exatamente como veio em consultar_horarios_livres', 'string'],
      ['duracao_minutos', 'Duração do serviço em minutos', 'number'],
    ]),

  toolSub('transferir_para_humano', [3200, 200],
    'Transfere a conversa para a equipe humana e PAUSA a IA para esta cliente por 12h. Use quando a cliente pedir para falar com ' +
    'uma pessoa (Gleide, dona, atendente), reclamar, ou pedir algo fora do atendimento do salão.',
    lerPausaId, ['telefone', 'motivo'],
    { telefone: "={{ $('Montar entrada').item.json.telefone }}" },
    [['motivo', 'Motivo curto da transferência (ex.: pediu para falar com a dona, reclamação)', 'string']]),

  // Um balão por vez, em ordem: "digitando..." (a Evolution segura a resposta pelo delay) -> envia -> próximo
  node('Um balão por vez', 'n8n-nodes-base.splitInBatches', 3, [3180, -20], { options: {} }),

  node('Pausa (lendo/respirando)', 'n8n-nodes-base.wait', 1.1, [0, 0], { resume: 'timeInterval', amount: '={{ $json.pausa }}', unit: 'seconds' },
    { webhookId: '3d4e5f60-7182-493a-9b2c-e3f405162738' }),

  node('Digitando...', 'n8n-nodes-base.httpRequest', 4.2, [3400, 80], {
    method: 'POST',
    url: `${EVO}/chat/sendPresence/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ number: $json.jid, presence: 'composing', delay: $json.delay }) }}",
    options: {},
  }, { onError: 'continueRegularOutput' }),

  node('Enviar mensagem', 'n8n-nodes-base.httpRequest', 4.2, [3620, 80], {
    method: 'POST',
    url: `${EVO}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ number: $('Um balão por vez').item.json.jid, text: $('Um balão por vez').item.json.texto }) }}",
    options: {},
  // a conexão do WhatsApp às vezes cai por alguns segundos: tenta de novo antes de desistir
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
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
  'Buffer: marcar última': main('Aguardar 10s'),
  'Aguardar 10s': main('Buffer: ler última'),
  'Buffer: ler última': main('É a última msg?'),
  'É a última msg?': main('Pausa: verificar de novo'),
  'Pausa: verificar de novo': main('Ainda ativa?'),
  'Ainda ativa?': { main: [[{ node: 'Trava: ler', type: 'main', index: 0 }], [{ node: 'Buffer: descartar (pausada)', type: 'main', index: 0 }]] },
  'Trava: ler': main('Ninguém respondendo?'),
  // livre -> marca a trava e segue; ocupado -> espera 3 s e volta a conferir se ainda é a última mensagem
  'Ninguém respondendo?': { main: [[{ node: 'Trava: marcar', type: 'main', index: 0 }], [{ node: 'Aguardar 3s (IA respondendo)', type: 'main', index: 0 }]] },
  'Aguardar 3s (IA respondendo)': main('Buffer: ler última'),
  'Trava: marcar': main('Buffer: ler mensagens'),
  'Buffer: ler mensagens': main('Buffer: limpar'),
  'Buffer: limpar': main('Montar entrada'),
  'Montar entrada': main('Marcar como lida'),
  'Marcar como lida': main('Agente IA'),
  'Agente IA': main('Quebrar mensagens'),
  'Quebrar mensagens': main('Um balão por vez'),
  // saída 0 = "done" (fim), saída 1 = "loop" (próximo balão)
  'Um balão por vez': { main: [[{ node: 'Trava: liberar', type: 'main', index: 0 }], [{ node: 'Pausa (lendo/respirando)', type: 'main', index: 0 }]] },
  'Pausa (lendo/respirando)': main('Digitando...'),
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

// CRM: ficha por cliente no Postgres + tool anotar_no_crm + painel web (ver crm-workflows.js)
const crmIdFile = path.join(dir, '.workflow-crm-id');
const painelIdFile = path.join(dir, '.workflow-crm-painel-id');
const lerCrmId = () => (fs.existsSync(crmIdFile) ? fs.readFileSync(crmIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_CRM');
const { crmWorkflow, painelWorkflow } = require('./crm-workflows.js')({ env, node, str, main, D, toolSub, workflow, agendaWorkflow, pausaWorkflow, lerCrmId });

// Supabase (banco do CRM): mensagens, pausa e agenda passam a ser gravadas lá (ver supabase-workflows.js)
require('./supabase-workflows.js')({ node, main, D, workflow, agendaWorkflow, pausaWorkflow });

// Assistente da Gleide: desvia o número dela no principal + 3 workflows novos (ver assistente-workflows.js)
const assistente = require('./assistente-workflows.js')({ env, node, str, main, toolSub, workflow });

// posições dos nós e notas coloridas por etapa (só visual)
require('./layout-n8n.js')(workflow, agendaWorkflow, pausaWorkflow);

fs.writeFileSync(path.join(dir, 'workflow-demo-salao.json'), JSON.stringify(workflow, null, 2));
fs.writeFileSync(path.join(dir, 'workflow-agenda-salao.json'), JSON.stringify(agendaWorkflow, null, 2));
fs.writeFileSync(path.join(dir, 'workflow-pausa-salao.json'), JSON.stringify(pausaWorkflow, null, 2));
fs.writeFileSync(path.join(dir, 'workflow-crm-salao.json'), JSON.stringify(crmWorkflow, null, 2));
fs.writeFileSync(path.join(dir, 'workflow-crm-painel.json'), JSON.stringify(painelWorkflow, null, 2));
fs.writeFileSync(path.join(dir, 'workflow-assistente.json'), JSON.stringify(assistente.assistenteWorkflow, null, 2));
fs.writeFileSync(path.join(dir, 'workflow-assistente-ferramentas.json'), JSON.stringify(assistente.ferramentasWorkflow, null, 2));
fs.writeFileSync(path.join(dir, 'workflow-assistente-pendencias.json'), JSON.stringify(assistente.pendenciasWorkflow, null, 2));
console.log('workflow-demo-salao.json, workflow-agenda-salao.json e workflow-pausa-salao.json gerados');

if (process.argv.includes('--enviar')) {
  const base = 'http://localhost:5678/api/v1/workflows';
  const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
  const upsert = async (wf, idFile) => {
    const id = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : '';
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
    const agendaId = await upsert(agendaWorkflow, agendaIdFile);
    // n8n 2.x: subworkflow também precisa estar publicado (ativo) para ser chamado
    if (process.argv.includes('--ativar')) await ativar(agendaId);
    const pausaId = await upsert(pausaWorkflow, pausaIdFile);
    if (process.argv.includes('--ativar')) await ativar(pausaId);
    // aponta as tools para os subworkflows e regrava o JSON exportado
    const crmId = await upsert(crmWorkflow, crmIdFile);
    if (process.argv.includes('--ativar')) await ativar(crmId);
    const painelId = await upsert(painelWorkflow, painelIdFile);
    if (process.argv.includes('--ativar')) await ativar(painelId);
    // assistente: ferramentas primeiro (as tools do agente apontam para ele)
    const ferramentasId = await upsert(assistente.ferramentasWorkflow, assistente.ferramentasIdFile);
    if (process.argv.includes('--ativar')) await ativar(ferramentasId);
    for (const nd of assistente.assistenteWorkflow.nodes) if (nd.type.endsWith('toolWorkflow')) nd.parameters.workflowId.value = ferramentasId;
    fs.writeFileSync(path.join(dir, 'workflow-assistente.json'), JSON.stringify(assistente.assistenteWorkflow, null, 2));
    for (const [wf, arq] of [[assistente.assistenteWorkflow, '.workflow-assistente-id'], [assistente.pendenciasWorkflow, '.workflow-assistente-pendencias-id']]) {
      const wid = await upsert(wf, path.join(dir, arq));
      if (process.argv.includes('--ativar')) await ativar(wid);
    }
    const idTool = { transferir_para_humano: pausaId, anotar_no_crm: crmId };
    for (const nd of workflow.nodes) if (nd.type.endsWith('toolWorkflow')) nd.parameters.workflowId.value = idTool[nd.name] || agendaId;
    fs.writeFileSync(path.join(dir, 'workflow-demo-salao.json'), JSON.stringify(workflow, null, 2));
    const id = await upsert(workflow, path.join(dir, '.workflow-id'));
    if (process.argv.includes('--ativar')) await ativar(id);
  })();
}
