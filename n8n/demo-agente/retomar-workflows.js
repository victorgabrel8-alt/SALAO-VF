// IA - Retomar conversa (follow-up, ver supabase/019_retomar_conversa.sql).
// A IA respondeu e a cliente sumiu: a cada 15 min o banco diz quem está esperando retomada (última mensagem da IA,
// passou o tempo da tentativa, salão aberto, sem horário marcado, sem pausa; no máximo config.retomada.horas.length
// tentativas desde a última mensagem dela). Para cada uma, o Gemini lê o histórico e escreve UMA mensagem que retoma
// de onde parou, ou responde PULAR quando não cabe (ela se despediu, disse que não quer, a pendência é do salão...).
// Enviada: vai pelo número do salão, entra no histórico do CRM e na memória da IA (a resposta dela cai no agente
// normal, que sabe o que foi dito). Pulada: não tenta mais até ela mandar mensagem de novo.
// GET /webhook/retomar-conversa dispara na hora, para testar (com o header x-webhook-token).
// Ligar no salão: empresas.config.retomada = {"ligado": true, "so_para": [...], "horas": [3, 24], "janela_dias": 3}.

const EMPRESA = "$env.EMPRESA_ID";

// histórico do CRM -> instrução para o Gemini. Uma instrução por cliente.
const PREPARAR = String.raw`
const TZ = 'America/Cuiaba';
// chaves do Redis vêm com o número do WhatsApp, que pode ter ou não o 9 depois do DDD: acha pelos 8 últimos dígitos
const chaves = (j) => [].concat(j?.keys || Object.keys(j || {})).map(String);
const pausas = chaves($('Pausas').first().json);
const memorias = chaves($('Memórias').first().json);
const achar = (lista, prefixo, tel) => lista.find((k) => k.startsWith(prefixo + tel.slice(0, 4)) && k.endsWith(tel.slice(-8)));
const agora = new Date().toLocaleString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const quem = { cliente: 'Cliente', ia: 'Você (IA)', humano: 'Gleide' };
return $('Quem retomar').all().map((i) => i.json).filter((c) => c.cliente_id).filter((c) => !achar(pausas, 'pausa:', c.telefone)).map((c) => {
  const nome = String(c.nome || '').trim().split(/\s+/)[0] || '';
  const conversa = (c.historico || []).map((m) => '[' + m.em + '] ' + (quem[m.autor] || m.autor) + (m.tipo !== 'texto' ? ' (' + m.tipo + ')' : '') + ': ' + m.texto).join('\n');
  const ultima = c.tentativa >= c.total;
  const instrucao = [
    'Você é a assistente virtual da Gleide, do salão Toda Bonita Mega Hair (Sinop-MT), no WhatsApp do salão.',
    'A conversa abaixo parou: a última mensagem foi sua e a cliente' + (nome ? ' (' + nome + ')' : '') + ' não respondeu. Agora é ' + agora + '.',
    'Esta é a tentativa ' + c.tentativa + ' de ' + c.total + ' de retomar a conversa' + (ultima ? ' (a última: depois dela você não manda mais nada).' : '.'),
    c.resumo_ia ? 'Resumo do que se sabe dela: ' + c.resumo_ia : '',
    '', 'CONVERSA (mais antiga primeiro):', conversa, '',
    'O QUE ELA FALOU POR ÚLTIMO: ' + (c.historico || []).filter((m) => m.autor === 'cliente').slice(-3).map((m) => '"' + m.texto + '"').join(' / '), '',
    'Primeiro decida se faz sentido retomar. Responda exatamente "PULAR: <motivo curto>" se:',
    '- a conversa terminou de forma natural (ela agradeceu, se despediu ou disse "ok, obrigada" sem nada pendente);',
    '- ela disse que não quer, não tem interesse, vai procurar outro lugar ou pediu para não mandar mensagem;',
    '- quem está devendo resposta é o salão (você disse que ia confirmar com a Gleide, ou a Gleide assumiu a conversa);',
    '- o horário já está marcado e não há nada pendente;',
    '- sua última mensagem não deixou nada em aberto e retomar seria só insistência.',
    'Se fizer sentido, escreva UM alô curto, em português do Brasil, como a atendente que lembrou dela e voltou para ver se ficou alguma dúvida:',
    '- parta do que ELA falou por último (o assunto dela: "como funciona", as fotos, o valor, o horário...), não da sua última mensagem;',
    '- o alô é para saber se ficou alguma dúvida sobre esse assunto ou se ela quer ajuda com ele. Ex.: "Oi, Ana! Ficou alguma dúvida sobre como funciona o mega hair? Tô por aqui 😊" ou "Oi! Conseguiu ver as fotos dos cabelos? Se ficou alguma dúvida, me fala";',
    '- NÃO repita nem reformule a pergunta que você já fez e ficou sem resposta, e não explique de novo o que já foi explicado;',
    '- curta (1 ou 2 frases), leve, sem cobrança, sem culpa, sem urgência ou promoção inventada, sem "só passando pra lembrar";',
    '- não invente preço, valor, horário livre, estoque nem resultado; não diga que ela respondeu nem que você "viu" algo novo;',
    '- sem negrito, sem lista, no máximo um emoji; use o primeiro nome no máximo uma vez, se souber;',
    ultima ? '- como é a última tentativa, deixe a porta aberta sem pressão (ex.: "se não for o momento, tudo bem, é só me chamar quando quiser").'
      : '- não fale de tempo sem resposta.',
    'Responda só com a mensagem (ou com PULAR: motivo), sem aspas.',
  ].filter((l) => l !== null).join('\n');
  // memória da IA: a chave que já existe; sem ela, o formato do WhatsApp (sem o 9)
  const memoria = achar(memorias, 'memoria:', c.telefone) || 'memoria:' + c.telefone.replace(/^(55\d{2})9(\d{8})$/, '$1$2');
  return { json: { ...c, nome, instrucao, memoria, historico: undefined } };
});
`;

const DECIDIR = String.raw`
const prep = $('Preparar').all();
return $input.all().map((r, i) => {
  const c = prep[i].json;
  let t = String(r.json.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || '').join('') || '').trim();
  t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^["“]|["”]$/g, '').trim();
  // sem resposta do Gemini: não grava nada, tenta de novo na próxima rodada
  if (!t) return { json: { ...c, acao: 'erro' } };
  const pular = t.match(/^PULAR\s*:?\s*(.*)$/is);
  if (pular) return { json: { ...c, acao: 'pular', motivo: pular[1].trim().slice(0, 300) || 'sem motivo' } };
  return { json: { ...c, acao: 'enviar', texto: t } };
});
`;

module.exports = ({ env, node, main, GEMINI }) => {
  const REDIS = { redis: { id: env.N8N_REDIS_CRED_ID || '', name: 'Redis local' } };
  const supaHeaders = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const rpc = (name, position, funcao, args, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: `={{ $env.SUPABASE_URL }}/rest/v1/rpc/${funcao}`,
    sendHeaders: true, headerParameters: supaHeaders, sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${args}) }}`,
    options: {},
  }, { onError: 'continueRegularOutput', ...extra });
  const se = (name, position, id, expr) => node(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id, leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    options: {},
  });
  const D = "$('Decidir').item.json";

  const retomarWorkflow = {
    name: 'IA - Retomar conversa',
    nodes: [
      node('A cada 15 min', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } }),
      node('Disparar agora (teste)', 'n8n-nodes-base.webhook', 2, [0, 220],
        { httpMethod: 'GET', path: 'retomar-conversa', authentication: 'headerAuth', responseMode: 'lastNode', options: {} },
        // mesma senha do webhook do WhatsApp (header x-webhook-token): sem ela, ninguém dispara de fora
        { webhookId: '5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e', credentials: { httpHeaderAuth: { id: env.N8N_WEBHOOK_CRED_ID || 'tV8sJuiNWidQ4Dnn', name: 'Webhook WhatsApp (senha da Evolution)' } } }),
      // o banco já confere salão aberto, prazo de cada tentativa e o resto (supabase/019)
      rpc('Quem retomar', [220, 0], 'n8n_retomadas_para_chamar', `{ p_empresa_id: ${EMPRESA} }`),
      // Gleide assumiu a conversa pelo celular (pausa no Redis, 12 h): não retoma
      node('Pausas', 'n8n-nodes-base.redis', 1, [440, 0], { operation: 'keys', keyPattern: 'pausa:*', getValues: false },
        { credentials: REDIS, executeOnce: true, alwaysOutputData: true }),
      node('Memórias', 'n8n-nodes-base.redis', 1, [660, 0], { operation: 'keys', keyPattern: 'memoria:*', getValues: false },
        { credentials: REDIS, executeOnce: true, alwaysOutputData: true }),
      node('Preparar', 'n8n-nodes-base.code', 2, [880, 0], { jsCode: PREPARAR }),
      node('Escrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [1100, 0], {
        method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ contents: [{ parts: [{ text: $json.instrucao }] }], generationConfig: { temperature: 0.6 } }) }}', options: {},
      }, { credentials: GEMINI || {}, retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput' }),
      node('Decidir', 'n8n-nodes-base.code', 2, [1320, 0], { jsCode: DECIDIR }),
      se('Enviar?', [1540, -100], 'r1', "={{ $json.acao === 'enviar' }}"),
      se('Pular?', [1760, 120], 'r2', "={{ $json.acao === 'pular' }}"),
      // uma de cada vez, com "digitando" de 2–4 s, como quem vai respondendo as conversas
      node('Mandar para a cliente', 'n8n-nodes-base.httpRequest', 4.2, [1760, -200], {
        method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
        sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ number: $json.telefone, text: $json.texto, delay: 2000 + Math.floor(Math.random() * 2000) }) }}',
        options: { batching: { batch: { batchSize: 1, batchInterval: 8000 } } },
      }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
      // só grava se o WhatsApp aceitou (senão tenta de novo na próxima rodada)
      se('Enviou?', [1980, -200], 'r3', '={{ !!$json.key?.id }}'),
      rpc('Registrar retomada', [2200, -200], 'n8n_registrar_retomada',
        `{ p_empresa_id: ${EMPRESA}, p_cliente_id: ${D}.cliente_id, p_tentativa: ${D}.tentativa, p_situacao: 'enviada', p_mensagem: ${D}.texto, p_wa_message_id: $json.key.id }`),
      // memória da conversa (LPUSH, a mais nova na frente): um turno "dela" dizendo o que houve e a mensagem da IA,
      // para o agente saber o que mandou quando ela responder (mesmo formato do "Pedido: memória" de pedidos-workflows.js)
      node('Memória (aviso)', 'n8n-nodes-base.redis', 1, [2420, -200], {
        operation: 'push', list: `={{ ${D}.memoria }}`, tail: false,
        messageData: `={{ JSON.stringify({ type: 'human', data: { content: '[a cliente não respondeu; ' + ${D}.tentativa + 'ª retomada automática da conversa]', additional_kwargs: {}, response_metadata: {} } }) }}`,
      }, { credentials: REDIS, onError: 'continueRegularOutput' }),
      node('Memória (mensagem enviada)', 'n8n-nodes-base.redis', 1, [2640, -200], {
        operation: 'push', list: `={{ ${D}.memoria }}`, tail: false,
        messageData: `={{ JSON.stringify({ type: 'ai', data: { content: ${D}.texto, tool_calls: [], invalid_tool_calls: [], additional_kwargs: {}, response_metadata: {} } }) }}`,
      }, { credentials: REDIS, onError: 'continueRegularOutput' }),
      rpc('Registrar pulada', [1980, 120], 'n8n_registrar_retomada',
        `{ p_empresa_id: ${EMPRESA}, p_cliente_id: $json.cliente_id, p_tentativa: $json.tentativa, p_situacao: 'pulada', p_motivo: $json.motivo }`),
    ],
    connections: {
      'A cada 15 min': main('Quem retomar'),
      'Disparar agora (teste)': main('Quem retomar'),
      'Quem retomar': main('Pausas'),
      'Pausas': main('Memórias'),
      'Memórias': main('Preparar'),
      'Preparar': main('Escrever (Gemini)'),
      'Escrever (Gemini)': main('Decidir'),
      'Decidir': { main: [[{ node: 'Enviar?', type: 'main', index: 0 }]] },
      'Enviar?': { main: [[{ node: 'Mandar para a cliente', type: 'main', index: 0 }], [{ node: 'Pular?', type: 'main', index: 0 }]] },
      'Pular?': main('Registrar pulada'),
      'Mandar para a cliente': main('Enviou?'),
      'Enviou?': main('Registrar retomada'),
      'Registrar retomada': main('Memória (aviso)'),
      'Memória (aviso)': main('Memória (mensagem enviada)'),
    },
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', saveManualExecutions: true },
  };

  return { retomarWorkflow, idFile: require('path').join(__dirname, '.workflow-retomar-id') };
};
