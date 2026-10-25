// Pergunta rápida para a Gleide (caminho A de docs/PLANO-PEDIDOS-PARA-GLEIDE.md).
// Dúvida que só a Gleide responde e não precisa dela na conversa ("posso levar meu cachorro?"):
//   1. a IA chama a ferramenta perguntar_para_gleide e continua atendendo (não pausa);
//   2. o subworkflow "Perguntar para a Gleide" manda a pergunta para empresas.config.whatsapp_alerta e guarda no
//      Redis pedido:{id da mensagem enviada} -> cliente (3 dias);
//   3. a Gleide responde CITANDO a mensagem (segurar → Responder). O principal vê a citação, acha o pedido e,
//      em vez de tratar como mensagem de cliente, escreve a resposta para a cliente (Gemini, com o que a Gleide
//      disse), envia, grava no banco e na memória da conversa e confirma para a Gleide: "Avisei a Maria ✓".
// Funciona mesmo quando o número de alerta também é cliente de teste (o do Victor): só conta a mensagem citada.

module.exports = ({ node, str, main, toolSub, workflow, REDIS, GEMINI, lerPerguntaId }) => {
  const EVO_ENVIAR = '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}';
  const evoHeaders = { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] };
  const supaHeaders = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const enviar = (name, position, numero, texto, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: EVO_ENVIAR, sendHeaders: true, headerParameters: evoHeaders,
    sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify({ number: ${numero}, text: ${texto} }) }}`, options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput', executeOnce: true, ...extra });
  const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;

  // ---------- Subworkflow da ferramenta ----------
  const P = "$('Recebe pergunta da IA').first().json";
  const FONE = `String(${TEL_BR(`${P}.telefone`)}).replace(/^55(\\d{2})(\\d{4,5})(\\d{4})$/, '($1) $2-$3')`;
  const perguntaWorkflow = {
    name: 'Perguntar para a Gleide',
    nodes: [
      node('Recebe pergunta da IA', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: ['telefone', 'jid', 'nome', 'pergunta', 'contexto'].map((name) => ({ name })) },
      }),
      node('Supabase: número de alerta', 'n8n-nodes-base.httpRequest', 4.2, [220, 0], {
        method: 'GET', url: '={{ $env.SUPABASE_URL }}/rest/v1/empresas?select=alerta:config->>whatsapp_alerta&id=eq.{{ $env.EMPRESA_ID }}',
        sendHeaders: true, headerParameters: supaHeaders, options: {},
      }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
      enviar('Enviar pergunta à Gleide', [440, 0], '$json.alerta',
        `'❓ Pergunta da ' + (${P}.nome || 'cliente') + ' · ' + ${FONE} + '\\n' + ${P}.pergunta + (${P}.contexto ? '\\n(' + ${P}.contexto + ')' : '') +
        '\\n\\nSegure esta mensagem, toque em *Responder* e escreva o que posso dizer a ela. Eu passo pra ela e sigo o atendimento.'`),
      node('Guardar pedido', 'n8n-nodes-base.redis', 1, [660, 0], {
        operation: 'set', key: "=pedido:{{ $json.key?.id || 'falhou' }}", expire: true, ttl: 259200,
        value: `={{ JSON.stringify({ telefone: ${P}.telefone, jid: ${P}.jid, nome: ${P}.nome, pergunta: ${P}.pergunta }) }}`,
      }, { credentials: REDIS, onError: 'continueRegularOutput' }),
      node('Resposta', 'n8n-nodes-base.set', 3.4, [880, 0], {
        assignments: { assignments: [str('resposta', "={{ $('Enviar pergunta à Gleide').first().json.key?.id ? " +
          "'PERGUNTADO: a Gleide recebeu a pergunta. Diga à cliente, numa frase gentil, que vai confirmar isso com a Gleide e avisa por aqui assim que ela responder. Continue o atendimento normalmente nos outros assuntos. Não invente a resposta: quando a Gleide responder, a resposta chega à cliente automaticamente.' : " +
          "'NÃO PERGUNTADO: não consegui mandar a pergunta agora. Diga com gentileza que não conseguiu confirmar isso agora e não invente a regra. Se a cliente precisar resolver já, use transferir_para_humano.' }}")] },
        options: {},
      }),
    ],
    connections: {
      'Recebe pergunta da IA': main('Supabase: número de alerta'), 'Supabase: número de alerta': main('Enviar pergunta à Gleide'),
      'Enviar pergunta à Gleide': main('Guardar pedido'), 'Guardar pedido': main('Resposta'),
    },
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
  };

  // ---------- Ferramenta no agente ----------
  workflow.nodes.push(toolSub('perguntar_para_gleide', [3360, 200],
    'Pergunta à Gleide uma dúvida simples que só ela pode responder (regra do salão não cadastrada: levar pet, criança ou ' +
    'acompanhante, estacionamento, comida etc.) SEM pausar o atendimento. Ela responde pelo WhatsApp e a resposta chega à ' +
    'cliente sozinha. Use quando não for preciso a Gleide assumir a conversa. Para avaliação à distância, reclamação, dor, ' +
    'negociação ou pedido de falar com ela, use transferir_para_humano.',
    lerPerguntaId, ['telefone', 'jid', 'nome', 'pergunta', 'contexto'],
    { telefone: "={{ $('Montar entrada').first().json.telefone }}", jid: "={{ $('Montar entrada').first().json.jid }}",
      nome: "={{ $('Montar entrada').first().json.nome }}" },
    [['pergunta', 'A pergunta para a Gleide, curta e direta, como a cliente quis saber (ex.: Pode trazer a cachorrinha no dia da avaliação? Ela não tem com quem deixar.)', 'string'],
      ['contexto', 'Contexto útil em poucas palavras, se houver (ex.: avaliação quinta 29/10 às 9h). Pode ficar vazio.', 'string']]));
  workflow.connections.perguntar_para_gleide = { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] };

  // ---------- Principal: resposta da Gleide (mensagem citando a pergunta) ----------
  const E = "$('Extrair dados').first().json";
  const PD = "$('Pedido: preparar').first().json";
  workflow.nodes.push(
    node('Pedido: procurar', 'n8n-nodes-base.redis', 1, [330, -760], {
      operation: 'get', key: `=pedido:{{ ${E}.citado || 'nenhum' }}`, propertyName: 'pedido', keyType: 'string', options: {},
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('É resposta da Gleide?', 'n8n-nodes-base.if', 2.2, [550, -760], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'rg1', leftValue: `={{ !!$json.pedido && !${E}.fromMe && ${E}.texto.trim() !== '' }}`, rightValue: '',
          operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and' },
      options: {},
    }),
    node('Pedido: preparar', 'n8n-nodes-base.code', 2, [770, -900], { jsCode: String.raw`
const p = JSON.parse($('Pedido: procurar').first().json.pedido);
const resposta = $('Extrair dados').first().json.texto.trim();
const nome = String(p.nome || '').trim().split(/\s+/)[0] || '';
const instrucao = 'Você é a assistente virtual da Gleide, do salão Toda Bonita Mega Hair, conversando pelo WhatsApp com a cliente ' +
  (nome || '') + '. Antes, a cliente perguntou algo que só a Gleide sabia: "' + p.pergunta + '". Você disse que ia confirmar com a Gleide. ' +
  'A Gleide respondeu: "' + resposta + '". Escreva a mensagem para a cliente passando essa resposta, em português do Brasil, ' +
  'curta (1 ou 2 frases), natural e gentil, como uma atendente de verdade. Não invente nada além do que a Gleide disse, ' +
  'não mude o sentido, não use negrito nem listas, no máximo um emoji. Responda só com a mensagem.';
return [{ json: { ...p, nome, resposta, instrucao } }];
` }),
    node('Pedido: escrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [990, -900], {
      method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ contents: [{ parts: [{ text: $json.instrucao }] }] }) }}', options: {},
    }, { credentials: GEMINI || {}, retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput' }),
    node('Pedido: texto', 'n8n-nodes-base.code', 2, [1210, -900], { jsCode: String.raw`
const p = $('Pedido: preparar').first().json;
let t = String($input.first().json.candidates?.[0]?.content?.parts?.map((x) => x.text || '').join('') || '').trim();
t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^["“]|["”]$/g, '').trim();
if (!t) t = 'Falei com a Gleide sobre isso: ' + p.resposta;
return [{ json: { ...p, texto: t } }];
` }),
    enviar('Pedido: enviar à cliente', [1430, -900], `${PD}.jid`, '$json.texto'),
    node('Pedido: registrar saída', 'n8n-nodes-base.httpRequest', 4.2, [1650, -900], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_registrar_saida', sendHeaders: true, headerParameters: supaHeaders,
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ p_empresa_id: $env.EMPRESA_ID, p_telefone: ${TEL_BR(`${PD}.telefone`)}, p_conteudo: $('Pedido: texto').first().json.texto, p_autor: 'ia', p_tipo: 'texto', p_wa_message_id: $json.key?.id || null }) }}`,
      options: {},
    }, { onError: 'continueRegularOutput' }),
    // memória da conversa (LPUSH, a mais nova na frente): um turno "dela" com a resposta da Gleide e o turno da IA
    node('Pedido: memória (resposta da Gleide)', 'n8n-nodes-base.redis', 1, [1870, -900], {
      operation: 'push', list: `=memoria:{{ ${PD}.telefone }}`, tail: false,
      messageData: `={{ JSON.stringify({ type: 'human', data: { content: '[a Gleide respondeu à pergunta "' + ${PD}.pergunta + '": ' + ${PD}.resposta + ']', additional_kwargs: {}, response_metadata: {} } }) }}`,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('Pedido: memória (mensagem enviada)', 'n8n-nodes-base.redis', 1, [2090, -900], {
      operation: 'push', list: `=memoria:{{ ${PD}.telefone }}`, tail: false,
      messageData: "={{ JSON.stringify({ type: 'ai', data: { content: $('Pedido: texto').first().json.texto, tool_calls: [], invalid_tool_calls: [], additional_kwargs: {}, response_metadata: {} } }) }}",
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('Pedido: apagar', 'n8n-nodes-base.redis', 1, [2310, -900], {
      operation: 'delete', key: `=pedido:{{ ${E}.citado }}`,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    enviar('Pedido: confirmar à Gleide', [2530, -900], `${E}.jid`,
      `'Avisei ' + (${PD}.nome ? 'a ' + ${PD}.nome : 'a cliente') + ' ✓\\n' + $('Pedido: texto').first().json.texto`),
  );
  const depois = workflow.connections['Extrair dados'].main[0][0].node;
  workflow.connections['Extrair dados'] = main('Pedido: procurar');
  workflow.connections['Pedido: procurar'] = main('É resposta da Gleide?');
  workflow.connections['É resposta da Gleide?'] = { main: [[{ node: 'Pedido: preparar', type: 'main', index: 0 }], [{ node: depois, type: 'main', index: 0 }]] };
  workflow.connections['Pedido: preparar'] = main('Pedido: escrever (Gemini)');
  workflow.connections['Pedido: escrever (Gemini)'] = main('Pedido: texto');
  workflow.connections['Pedido: texto'] = main('Pedido: enviar à cliente');
  workflow.connections['Pedido: enviar à cliente'] = main('Pedido: registrar saída');
  workflow.connections['Pedido: registrar saída'] = main('Pedido: memória (resposta da Gleide)');
  workflow.connections['Pedido: memória (resposta da Gleide)'] = main('Pedido: memória (mensagem enviada)');
  workflow.connections['Pedido: memória (mensagem enviada)'] = main('Pedido: apagar');
  workflow.connections['Pedido: apagar'] = main('Pedido: confirmar à Gleide');

  return { perguntaWorkflow, idFile: require('path').join(__dirname, '.workflow-pergunta-id') };
};
