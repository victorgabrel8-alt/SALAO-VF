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
  const ORCAMENTO = `${P}.tipo === 'orcamento_cabelo'`;
  const perguntaWorkflow = {
    name: 'Perguntar para a Gleide',
    nodes: [
      node('Recebe pergunta da IA', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: ['telefone', 'jid', 'nome', 'pergunta', 'contexto', 'tipo'].map((name) => ({ name })) },
      }),
      node('Supabase: número de alerta', 'n8n-nodes-base.httpRequest', 4.2, [220, 0], {
        method: 'GET', url: '={{ $env.SUPABASE_URL }}/rest/v1/empresas?select=alerta:config->>whatsapp_alerta&id=eq.{{ $env.EMPRESA_ID }}',
        sendHeaders: true, headerParameters: supaHeaders, options: {},
      }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
      enviar('Enviar pergunta à Gleide', [440, 0], '$json.alerta',
        `(${ORCAMENTO} ? '💰 Orçamento de cabelo: ' : '❓ ') + (${P}.nome || 'Cliente') + ' · ' + ${FONE} + '\\n' + ${P}.pergunta + (${P}.contexto ? '\\n' + ${P}.contexto : '') +
        (${ORCAMENTO} ? '\\n\\n↩️ Toque em Responder e escreva o valor. Eu passo para ela.' : '\\n\\n↩️ Toque em Responder e escreva a resposta.')`),
      node('Guardar pedido', 'n8n-nodes-base.redis', 1, [660, 0], {
        operation: 'set', key: "=pedido:{{ $json.key?.id || 'falhou' }}", expire: true, ttl: 259200,
        value: `={{ JSON.stringify({ telefone: ${P}.telefone, jid: ${P}.jid, nome: ${P}.nome, pergunta: ${P}.pergunta, tipo: ${P}.tipo || 'pergunta' }) }}`,
      }, { credentials: REDIS, onError: 'continueRegularOutput' }),
      // a assistente precisa saber do pedido: se a Gleide escrever sem citar, ela pede para tocar em Responder
      node('Memória da assistente', 'n8n-nodes-base.redis', 1, [880, 0], {
        operation: 'push', list: "=assistente:{{ $('Supabase: número de alerta').first().json.alerta }}", tail: false,
        messageData: `={{ JSON.stringify({ type: 'ai', data: { content: (${ORCAMENTO} ? 'Pedi à Gleide o orçamento de cabelo de ' : 'Perguntei à Gleide sobre ') + (${P}.nome || 'uma cliente') + ': ' + ${P}.pergunta, tool_calls: [], invalid_tool_calls: [], additional_kwargs: {}, response_metadata: {} } }) }}`,
      }, { credentials: REDIS, onError: 'continueRegularOutput' }),
      node('Resposta', 'n8n-nodes-base.set', 3.4, [1100, 0], {
        assignments: { assignments: [str('resposta', `={{ $('Enviar pergunta à Gleide').first().json.key?.id ? (${ORCAMENTO} ? ` +
          "'ORÇAMENTO PEDIDO: a Gleide recebeu o pedido. Diga em uma frase o que você pediu e que avisa por aqui assim que ela passar o valor. Não invente valor nem prazo: a resposta da Gleide chega à cliente automaticamente.' : " +
          "'PERGUNTADO: a Gleide recebeu a pergunta. Diga à cliente, numa frase gentil, que vai confirmar isso com a Gleide e avisa por aqui assim que ela responder. Continue o atendimento normalmente nos outros assuntos. Não invente a resposta: quando a Gleide responder, a resposta chega à cliente automaticamente.') : " +
          "'NÃO PERGUNTADO: não consegui mandar agora. Não diga que pediu e não invente nada. Use transferir_para_humano se for orçamento de cabelo ou se a cliente precisar resolver já.' }}")] },
        options: {},
      }),
    ],
    connections: {
      'Recebe pergunta da IA': main('Supabase: número de alerta'), 'Supabase: número de alerta': main('Enviar pergunta à Gleide'),
      'Enviar pergunta à Gleide': main('Guardar pedido'), 'Guardar pedido': main('Memória da assistente'), 'Memória da assistente': main('Resposta'),
    },
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
  };

  // ---------- Ferramenta no agente ----------
  workflow.nodes.push(toolSub('perguntar_para_gleide', [3360, 200],
    'Pergunta à Gleide uma dúvida simples que depende de decisão dela (ex.: trazer cachorro ou outro animal, deixar criança ' +
    'sozinha no salão, atendimento fora do horário, tolerância de atraso) SEM pausar o atendimento. Coisas de bom senso (levar o ' +
    'filho junto, acompanhante, chegar antes) você responde sozinha, sem esta ferramenta. Ela responde pelo WhatsApp e a resposta chega à ' +
    'cliente sozinha. Use quando não for preciso a Gleide assumir a conversa. Para reclamação, dor ou pedido de falar com ela, ' +
    'use transferir_para_humano (pergunta de preço ou desconto não é transferência; avaliação à distância é a avaliação online da agenda). NUNCA use para preço, orçamento, valor de cabelo ou ' +
    'estimativa: orçamento de cabelo de cliente decidida é pedir_orcamento_cabelo.',
    lerPerguntaId, ['telefone', 'jid', 'nome', 'pergunta', 'contexto', 'tipo'],
    { telefone: "={{ $('Montar entrada').first().json.telefone }}", jid: "={{ $('Montar entrada').first().json.jid }}",
      nome: "={{ $('Montar entrada').first().json.nome }}", tipo: 'pergunta' },
    [['pergunta', 'A pergunta direta para a Gleide, até 15 palavras, sem "a cliente quer saber" nem o nome dela (ex.: Pode trazer cachorro de porte grande na avaliação?)', 'string'],
      ['contexto', 'Só o que a Gleide precisa e não está na pergunta, até 8 palavras (ex.: avaliação qui 29/10 9h). Não repita a pergunta. Pode ficar vazio.', 'string']]));
  workflow.connections.perguntar_para_gleide = { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] };
  workflow.nodes.push(toolSub('pedir_orcamento_cabelo', [3580, 200],
    'Pede à Gleide o orçamento de uma compra avulsa de cabelo, SEM pausar o atendimento. Use só com cliente DECIDIDA a comprar e com o pedido montado (seção 01). ' +
    'Nunca use para cliente que só está pesquisando, para aplicação ou para mão de obra. A Gleide responde pelo WhatsApp e o valor chega sozinho à cliente. Use uma vez por pedido.',
    lerPerguntaId, ['telefone', 'jid', 'nome', 'pergunta', 'contexto', 'tipo'],
    { telefone: "={{ $('Montar entrada').first().json.telefone }}", jid: "={{ $('Montar entrada').first().json.jid }}",
      nome: "={{ $('Montar entrada').first().json.nome }}", tipo: 'orcamento_cabelo' },
    [['pergunta', 'O pedido em poucas palavras, só com o que ela informou (ex.: 250 g, 70 cm, vietnamita, castanho escuro, liso). Sem nome e sem frase.', 'string'],
      ['contexto', 'Só se ela disse: fora da cidade e onde mora (ex.: mora em Peixoto de Azevedo). Pode ficar vazio.', 'string']]));
  workflow.connections.pedir_orcamento_cabelo = { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] };

  // ---------- Avaliação presencial ↔ online: a IA troca sozinha e a Gleide só recebe o aviso (supabase/033) ----------
  const modalidadeWorkflow = {
    name: 'IA - Mudar modalidade',
    nodes: [
      node('Recebe pedido da IA', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: ['telefone', 'para', 'data_hora_inicio'].map((name) => ({ name })) },
      }),
      node('Mudar no banco', 'n8n-nodes-base.httpRequest', 4.2, [220, 0], {
        method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_mudar_modalidade', sendHeaders: true, headerParameters: supaHeaders,
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ p_empresa_id: $env.EMPRESA_ID, p_telefone: $json.telefone, p_para: $json.para, p_inicio: $json.data_hora_inicio ? $json.data_hora_inicio + '-04:00' : null }) }}",
        options: {},
      }, { onError: 'continueRegularOutput' }),
      node('Resposta', 'n8n-nodes-base.set', 3.4, [440, 0], {
        assignments: { assignments: [str('resposta', "={{ $json.error ? 'NÃO MUDEI: ' + ($json.error.message || 'a agenda falhou') + '. Não diga que mudou. Se ela precisa disso, use transferir_para_humano.' : ($json.ja ? 'JÁ ESTÁ ' + $json.para + ': ' + $json.quando + '. Só confirme para a cliente.' : 'MUDADO com sucesso: a avaliação de ' + $json.quando + ' agora é ' + $json.para + ', no mesmo horário. A Gleide recebe o aviso sozinha. Confirme em uma frase para a cliente' + ($json.para === 'online' ? ' e lembre que é por ligação de voz no WhatsApp.' : ' e mande o endereço com o link do mapa.')) }}")] },
        options: {},
      }),
    ],
    connections: { 'Recebe pedido da IA': main('Mudar no banco'), 'Mudar no banco': main('Resposta') },
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
  };
  const modalidadeIdFile = require('path').join(__dirname, '.workflow-modalidade-id');
  const lerModalidadeId = () => (require('fs').existsSync(modalidadeIdFile) ? require('fs').readFileSync(modalidadeIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_MODALIDADE');
  workflow.nodes.push(toolSub('mudar_modalidade', [3800, 200],
    'Troca a avaliação da cliente entre presencial e online, no mesmo dia e hora. Use quando ela pedir ou aceitar a troca, sem perguntar à Gleide e sem transferir. ' +
    'Só diga que mudou se a resposta começar com MUDADO. Para mudar o dia ou a hora, use remarcar_agendamento.',
    lerModalidadeId, ['telefone', 'para', 'data_hora_inicio'],
    { telefone: "={{ $('Montar entrada').first().json.telefone }}" },
    [['para', 'online ou presencial', 'string'],
      ['data_hora_inicio', 'Horário da avaliação, AAAA-MM-DDTHH:mm. Pode ficar vazio se ela só tem uma marcada.', 'string']]));
  workflow.connections.mudar_modalidade = { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] };

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
const instrucao = p.tipo === 'orcamento_cabelo' ? 'Você é a assistente virtual da Gleide, do salão Toda Bonita Mega Hair, conversando pelo WhatsApp com a cliente ' +
  (nome || '') + '. A cliente pediu o orçamento deste cabelo: "' + p.pergunta + '". A Gleide respondeu: "' + resposta + '". ' +
  'Escreva a mensagem para a cliente passando essa resposta, em português do Brasil, curta (1 ou 2 frases), natural e gentil. ' +
  'Copie exatamente todos os valores, quantidades e condições que a Gleide escreveu. Não calcule, não arredonde e não acrescente desconto, parcela, prazo, entrega ou estoque. ' +
  'Não use negrito nem listas, no máximo um emoji. Se a resposta trouxer um valor, termine perguntando só "Quer fechar?". Responda só com a mensagem.' :
  'Você é a assistente virtual da Gleide, do salão Toda Bonita Mega Hair, conversando pelo WhatsApp com a cliente ' +
  (nome || '') + '. Antes, a cliente perguntou algo que só a Gleide sabia: "' + p.pergunta + '". Você disse que ia confirmar com a Gleide. ' +
  'A Gleide respondeu: "' + resposta + '". Escreva a mensagem para a cliente passando essa resposta, em português do Brasil, ' +
  'curta (1 ou 2 frases), natural e gentil, como uma atendente de verdade. Não invente nada além do que a Gleide disse, ' +
  'não mude o sentido, não use negrito nem listas, no máximo um emoji. NUNCA passe valor, preço, orçamento ou parcela, ' +
  'mesmo que a Gleide tenha escrito um número: nesse caso diga só que a Gleide explica o orçamento na avaliação ' +
  '(o salão não informa valores por mensagem). Responda só com a mensagem.';
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
if (p.tipo === 'orcamento_cabelo') {
  // valor é da Gleide: se o texto perdeu ou inventou algum número, manda as palavras dela
  const numeros = (s) => String(s).match(/\d+(?:[.,]\d+)*/g) || [];
  const dela = numeros(p.resposta), permitidos = dela.concat(numeros(p.pergunta));
  if (!t || !dela.every((n) => numeros(t).includes(n)) || !numeros(t).every((n) => permitidos.includes(n))) t = 'A Gleide passou o orçamento: ' + p.resposta;
}
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
  // o Redis devolve só o campo pedido: o resto do fluxo precisa do item de Extrair dados de volta
  workflow.nodes.push(node('Pedido: seguir normal', 'n8n-nodes-base.code', 2, [660, -760], {
    jsCode: "return [{ json: $('Extrair dados').first().json }];" }));
  const depois = workflow.connections['Extrair dados'].main[0][0].node;
  workflow.connections['Extrair dados'] = main('Pedido: procurar');
  workflow.connections['Pedido: procurar'] = main('É resposta da Gleide?');
  workflow.connections['É resposta da Gleide?'] = { main: [[{ node: 'Pedido: preparar', type: 'main', index: 0 }], [{ node: 'Pedido: seguir normal', type: 'main', index: 0 }]] };
  workflow.connections['Pedido: seguir normal'] = main(depois);
  workflow.connections['Pedido: preparar'] = main('Pedido: escrever (Gemini)');
  workflow.connections['Pedido: escrever (Gemini)'] = main('Pedido: texto');
  workflow.connections['Pedido: texto'] = main('Pedido: enviar à cliente');
  workflow.connections['Pedido: enviar à cliente'] = main('Pedido: registrar saída');
  workflow.connections['Pedido: registrar saída'] = main('Pedido: memória (resposta da Gleide)');
  workflow.connections['Pedido: memória (resposta da Gleide)'] = main('Pedido: memória (mensagem enviada)');
  workflow.connections['Pedido: memória (mensagem enviada)'] = main('Pedido: apagar');
  workflow.connections['Pedido: apagar'] = main('Pedido: confirmar à Gleide');

  return { perguntaWorkflow, idFile: require('path').join(__dirname, '.workflow-pergunta-id'), modalidadeWorkflow, modalidadeIdFile };
};
