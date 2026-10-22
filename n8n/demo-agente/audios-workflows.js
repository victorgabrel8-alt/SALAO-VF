// Áudios prontos da Gleide (docs/PLANO-PROMPT-E-AUDIOS.md, Fase 4).
// Chamado pelo montar-workflow.js. Devolve 2 workflows e encaixa no principal:
//   - "Áudios prontos - Enviar"      subworkflow da tool enviar_audio: acha o áudio no catálogo
//                                     (empresas.config.audios_prontos), baixa do Supabase Storage (bucket
//                                     privado "audios"), mostra "gravando…" e manda como mensagem de voz;
//                                     grava no CRM com a transcrição. Se falhar, devolve o texto para a IA.
//   - "Áudios prontos - Transcrever" POST /webhook/audios-transcrever {base64, mime} -> {transcricao}
//                                     (usado pelo cadastrar-audio.js para cadastrar áudio novo)
//   - Principal: tool enviar_audio + bloco "ÁUDIOS PRONTOS" no fim do prompt (temas disponíveis e os que
//     esta cliente já recebeu).
// Catálogo: [{ "tema", "quando_usar", "arquivo", "duracao_s", "transcricao" }]

const EMPRESA = '$env.EMPRESA_ID';
const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;
// marca na mensagem gravada no CRM: é por ela que a IA sabe quais áudios a cliente já recebeu
const MARCA = (tema) => `'[áudio pronto: ' + ${tema} + ']'`;

module.exports = ({ env, node, str, main, toolSub, workflow }) => {
  const GEMINI = env.N8N_GEMINI_CRED_ID ? { googlePalmApi: { id: env.N8N_GEMINI_CRED_ID, name: 'Google Gemini(PaLM) Api account' } } : {};
  const SUPA_H = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const supa = (name, method, rota, body, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method, url: `={{ $env.SUPABASE_URL }}/rest/v1/${rota}`, sendHeaders: true, headerParameters: SUPA_H,
    ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}` } : {}), options: {},
  }, { onError: 'continueRegularOutput', alwaysOutputData: true, ...extra });
  const settings = { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', saveManualExecutions: true };
  const ifNode = (name, cond) => node(name, 'n8n-nodes-base.if', 2.2, [0, 0], {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: name, leftValue: `={{ ${cond} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    options: {},
  });
  const ligar = (wf, pares) => { for (const [de, para] of pares) wf.connections[de] = main(para); };

  // ---------- 1. Subworkflow da tool enviar_audio ----------
  const E = "$('Recebe pedido da IA').item.json";
  const A = "$('Achar áudio').item.json";
  const enviarWorkflow = {
    name: 'Áudios prontos - Enviar',
    nodes: [
      node('Recebe pedido da IA', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: ['tema', 'telefone', 'jid', 'mensagem'].map((name) => ({ name })) },
      }),
      supa('Catálogo de áudios', 'GET', `empresas?select=config&id=eq.{{ ${EMPRESA} }}`, null),
      supa('Já enviados a ela', 'GET',
        "mensagens?select=conteudo,clientes!inner(telefone)&autor=eq.ia&tipo=eq.audio&clientes.telefone=eq.{{ " + TEL_BR(`${E}.telefone`) + " }}", null),
      node('Achar áudio', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: String.raw`
// O tema pedido pela IA -> o áudio do catálogo com mais palavras em comum
const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const palavras = (s) => sem(s).split(/[^a-z0-9]+/).filter((p) => p.length > 2);
const pedido = $('Recebe pedido da IA').first().json;
const catalogo = ($('Catálogo de áudios').first().json.config || {}).audios_prontos || [];
const alvo = palavras(pedido.tema);
let melhor = null, nota = 0;
for (const a of catalogo) {
  const ps = palavras(a.tema + ' ' + (a.quando_usar || ''));
  const n = alvo.filter((p) => ps.includes(p)).length / Math.max(1, alvo.length);
  if (n > nota) { melhor = a; nota = n; }
}
if (!melhor || nota < 0.5) return [{ json: { ok: false, resposta: 'ÁUDIO NÃO ENVIADO: não existe áudio pronto para "' + pedido.tema + '". Temas disponíveis: ' + catalogo.map((a) => a.tema).join('; ') + '. Responda em texto.' } }];
// trava: a mensagem da cliente precisa falar do assunto do áudio (a IA às vezes manda áudio "de brinde"
// numa conversa de outro assunto). Palavras genéricas não contam.
const COMUNS = new Set('mega hair cabelo cabelos quero queria fazer faz quando perguntar pergunta voce pra para por com uma uns que qual quanto natural sobre isso esse essa tem ter'.split(' '));
const chave = (s) => palavras(s).filter((p) => !COMUNS.has(p));
const doTema = chave(melhor.tema + ' ' + (melhor.quando_usar || ''));
if (pedido.mensagem && !chave(pedido.mensagem).some((p) => doTema.some((t) => t.startsWith(p.slice(0, 5)) || p.startsWith(t.slice(0, 5)))))
  return [{ json: { ok: false, resposta: 'ÁUDIO NÃO ENVIADO: a cliente não perguntou sobre "' + melhor.tema + '" nesta mensagem. Responda em texto só o que ela perguntou, sem falar desse assunto.' } }];
const enviados = $('Já enviados a ela').all().map((i) => i.json.conteudo || '').join(' ');
if (enviados.includes('[áudio pronto: ' + melhor.tema + ']')) return [{ json: { ok: false, resposta: 'ÁUDIO NÃO ENVIADO: ela JÁ recebeu o áudio "' + melhor.tema + '" antes. Não mande de novo; responda em texto, curto, sem repetir tudo.' } }];
return [{ json: { ok: true, ...melhor } }];
` }),
      ifNode('Tem áudio?', '$json.ok'),
      node('Baixar do Storage', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
        method: 'GET', url: `={{ $env.SUPABASE_URL }}/storage/v1/object/audios/{{ encodeURIComponent($json.arquivo) }}`,
        sendHeaders: true, headerParameters: SUPA_H, options: { response: { response: { responseFormat: 'file' } } },
      }, { onError: 'continueRegularOutput' }),
      node('Para base64', 'n8n-nodes-base.extractFromFile', 1, [0, 0], { operation: 'binaryToPropery', options: {} },
        { onError: 'continueRegularOutput' }),
      // "gravando áudio…" pelo tempo do próprio áudio (como se a Gleide estivesse gravando agora), até 45 s.
      // O WhatsApp apaga o aviso em ~10 s se ninguém renova: um "gravando" por bloco de até 8 s, em sequência
      node('Gravando (blocos de 8s)', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: [
        `const total = Math.min(45000, Math.max(5000, Math.round((${A}.duracao_s || 10) * 1000)));`,
        'const n = Math.max(1, Math.round(total / 7500));',
        `return Array.from({ length: n }, () => ({ json: { jid: ${E}.jid, delay: 7500 }, pairedItem: 0 }));`,
      ].join('\n') }),
      node('Gravando...', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
        method: 'POST', url: '={{ $env.EVOLUTION_URL }}/chat/sendPresence/{{ $env.EVOLUTION_INSTANCE }}',
        sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ number: $json.jid, presence: 'recording', delay: $json.delay }) }}",
        // um bloco a cada 7,5 s (sem o intervalo o n8n disparava todos juntos)
        options: { batching: { batch: { batchSize: 1, batchInterval: 7500 } } },
      }, { onError: 'continueRegularOutput' }),
      // manda como mensagem de voz (encoding = PTT); executeOnce: um envio só, mesmo com vários blocos antes
      node('Enviar áudio', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
        method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendWhatsAppAudio/{{ $env.EVOLUTION_INSTANCE }}',
        sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ number: ${E}.jid, audio: $('Para base64').item.json.data, encoding: true, delay: 2000 }) }}`,
        options: {},
      }, { onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, executeOnce: true }),
      // só vai para o CRM (e conta como "já enviado") o áudio que a Evolution aceitou
      ifNode('Enviou?', "!!$json.key?.id"),
      supa('Registrar no CRM', 'POST', 'rpc/n8n_registrar_saida',
        `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR(`${E}.telefone`)},
           p_conteudo: '🎤 Áudio pronto ' + ${MARCA(`${A}.tema`)} + ': ' + ${A}.transcricao,
           p_autor: 'ia', p_tipo: 'audio', p_wa_message_id: $('Enviar áudio').item.json.key?.id || null }`),
      node('Resposta (enviado)', 'n8n-nodes-base.set', 3.4, [0, 0], {
        assignments: { assignments: [str('resposta',
          `={{ $('Enviar áudio').item.json.key?.id
  ? 'ÁUDIO ENVIADO ("' + ${A}.tema + '"). A cliente acabou de receber este áudio (voz de terceiro, NÃO diga que é a Gleide): «' + ${A}.transcricao + '». ' +
    'O áudio É a resposta: NÃO escreva nada sobre ele (sem apresentar, resumir, perguntar ou convidar). ' +
    'Se ele respondeu tudo o que ela perguntou, não escreva nada (resposta vazia). ' +
    'Se ficaram perguntas que o áudio não responde, responda só essas, curto, sem citar o áudio.'
  : 'ÁUDIO NÃO ENVIADO (falhou). Responda em texto, curto (até 3 frases), usando SÓ o que este áudio explica, sem dizer que é da Gleide e sem acrescentar promessa (nada de \"fica super natural\", \"imperceptível\", \"não estraga\"): ' + ${A}.transcricao }}`)] },
        options: {},
      }),
      node('Resposta (sem áudio)', 'n8n-nodes-base.set', 3.4, [0, 0], {
        assignments: { assignments: [str('resposta', '={{ $json.resposta }}')] }, options: {},
      }),
    ],
    connections: {},
    settings: { ...settings, callerPolicy: 'workflowsFromSameOwner' },
  };
  ligar(enviarWorkflow, [
    ['Recebe pedido da IA', 'Catálogo de áudios'], ['Catálogo de áudios', 'Já enviados a ela'], ['Já enviados a ela', 'Achar áudio'],
    ['Achar áudio', 'Tem áudio?'], ['Baixar do Storage', 'Para base64'], ['Para base64', 'Gravando (blocos de 8s)'],
    ['Gravando (blocos de 8s)', 'Gravando...'], ['Gravando...', 'Enviar áudio'],
    ['Enviar áudio', 'Enviou?'], ['Registrar no CRM', 'Resposta (enviado)'],
  ]);
  enviarWorkflow.connections['Enviou?'] = { main: [[{ node: 'Registrar no CRM', type: 'main', index: 0 }], [{ node: 'Resposta (enviado)', type: 'main', index: 0 }]] };
  enviarWorkflow.connections['Tem áudio?'] = { main: [[{ node: 'Baixar do Storage', type: 'main', index: 0 }], [{ node: 'Resposta (sem áudio)', type: 'main', index: 0 }]] };

  // ---------- 2. Transcrever (para cadastrar áudio novo) ----------
  const transcreverWorkflow = {
    name: 'Áudios prontos - Transcrever',
    nodes: [
      node('Recebe áudio', 'n8n-nodes-base.webhook', 2, [0, 0],
        { httpMethod: 'POST', path: 'audios-transcrever', responseMode: 'lastNode', options: {} }, { webhookId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c02' }),
      node('Transcrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [220, 0], {
        method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ contents: [{ parts: [ { text: 'Transcreva este áudio em português do Brasil, exatamente como foi falado, com pontuação. Responda só com a transcrição.' }, { inline_data: { mime_type: $json.body.mime || 'audio/mpeg', data: $json.body.base64 } } ] }] }) }}",
        options: {},
      }, { credentials: GEMINI }),
      node('Transcrição', 'n8n-nodes-base.set', 3.4, [440, 0], {
        assignments: { assignments: [str('transcricao', "={{ ($json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join(' ').trim() }}")] },
        options: {},
      }),
    ],
    connections: {},
    settings,
  };
  ligar(transcreverWorkflow, [['Recebe áudio', 'Transcrever (Gemini)'], ['Transcrever (Gemini)', 'Transcrição']]);

  // ---------- 3. Principal: tool + lista de áudios no fim do prompt ----------
  const fs = require('fs');
  const idFile = require('path').join(__dirname, '.workflow-audios-id');
  const lerId = () => (fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : 'ID_DO_WORKFLOW_AUDIOS');
  const M = "$('Montar entrada').item.json";
  workflow.nodes.push(toolSub('enviar_audio', [0, 0],
    'Manda para a cliente um ÁUDIO pronto (voz de terceiro, não diga que é a Gleide) explicando um assunto (temas em ÁUDIOS PRONTOS, no fim das instruções). ' +
    'Use quando a pergunta dela for exatamente sobre um desses temas. A resposta diz se o áudio foi enviado e o que ele fala.',
    lerId, ['tema', 'telefone', 'jid', 'mensagem'], { telefone: `={{ ${M}.telefone }}`, jid: `={{ ${M}.jid }}`, mensagem: `={{ ${M}.texto_cliente }}` },
    [['tema', 'O tema do áudio, igual à lista ÁUDIOS PRONTOS', 'string']]));
  workflow.connections.enviar_audio = { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] };

  workflow.nodes.push(
    supa('Supabase: áudios do salão', 'GET', `empresas?select=config&id=eq.{{ ${EMPRESA} }}`, null, { executeOnce: true }),
    supa('Supabase: áudios já enviados', 'GET',
      "mensagens?select=conteudo&autor=eq.ia&tipo=eq.audio&cliente_id=eq.{{ $('Supabase: ficha da cliente').first().json.id || '00000000-0000-0000-0000-000000000000' }}", null),
    node('Áudios disponíveis', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: String.raw`
const catalogo = (($('Supabase: áudios do salão').first().json.config) || {}).audios_prontos || [];
const enviados = $('Supabase: áudios já enviados').all().map((i) => i.json.conteudo || '').join(' ');
if (!catalogo.length) return [{ json: { texto: '(nenhum áudio pronto cadastrado: responda sempre em texto)' } }];
return [{ json: { texto: catalogo.map((a) => '- ' + a.tema + ' — quando usar: ' + (a.quando_usar || a.tema) +
  (enviados.includes('[áudio pronto: ' + a.tema + ']') ? ' (JÁ ENVIADO para esta cliente: não mande de novo)' : '')).join('\n') } }];
` }),
  );
  // entra logo antes do agente: Sobre esta cliente -> áudios -> Agente IA
  workflow.connections['Sobre esta cliente'] = main('Supabase: áudios do salão');
  ligar(workflow, [['Supabase: áudios do salão', 'Supabase: áudios já enviados'], ['Supabase: áudios já enviados', 'Áudios disponíveis'], ['Áudios disponíveis', 'Agente IA']]);
  const agente = workflow.nodes.find((n) => n.name === 'Agente IA').parameters.options;
  // o prompt do Victor já traz a lista de áudios na seção 22: só acrescenta se ele não tiver
  if (!agente.systemMessage.includes("$('Áudios disponíveis')")) agente.systemMessage += `

ÁUDIOS PRONTOS (temas cadastrados, voz de terceiro; use enviar_audio sem atribuir a voz à Gleide)
{{ $('Áudios disponíveis').first().json.texto }}`;

  return { enviarWorkflow, transcreverWorkflow, idFile };
};
