// IA - Retorno combinado (ver supabase/028_retorno_combinado.sql).
// A cliente combinou de voltar a falar numa data ("semana que vem te falo", "segunda ou terça te aviso"): a IA grava a
// data pela ferramenta anotar_no_crm. A cada 10 min o banco diz quem chegou na data (salão aberto, depois de
// config.retorno.hora, sem horário marcado, a Gleide não falou com ela depois, ela não voltou sozinha, sem pausa).
// Para cada uma, o Gemini lê o histórico e escreve UM alô leve sobre o que ficou combinado, ou responde PULAR quando
// não cabe. Enviado: vai pelo número do salão, grava o contato 'retorno' (canal 'ia') e a mensagem no CRM e na memória
// da IA; a resposta dela cai no agente com o "ALÔ DE RETORNO" da ficha. A retomada de 30/180 min não insiste nesse alô.
// Pulado: não chama mais nessa data.
// GET /webhook/retorno-combinado dispara na hora, para testar (com o header x-webhook-token).
// Ligar no salão: empresas.config.retorno = {"ligado": true, "so_para": [...], "hora": "09:00", "atraso_dias": 3}.

const EMPRESA = "$env.EMPRESA_ID";

const PREPARAR = String.raw`
const TZ = 'America/Cuiaba';
// chaves do Redis vêm com o número do WhatsApp, que pode ter ou não o 9 depois do DDD: acha pelos 8 últimos dígitos
const chaves = (j) => [].concat(j?.keys || Object.keys(j || {})).map(String);
const pausas = chaves($('Pausas').first().json);
const memorias = chaves($('Memórias').first().json);
const achar = (lista, prefixo, tel) => lista.find((k) => k.startsWith(prefixo + tel.slice(0, 4)) && k.endsWith(tel.slice(-8)));
const agora = new Date().toLocaleString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const diaDe = (s) => new Date(s).toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: '2-digit', month: '2-digit' });
const quem = { cliente: 'Cliente', ia: 'Você (IA)', humano: 'Gleide' };
return $('Quem chamar').all().map((i) => i.json).filter((c) => c.retorno_id).filter((c) => !achar(pausas, 'pausa:', c.telefone)).map((c) => {
  const nome = String(c.nome || '').trim().split(/\s+/)[0] || '';
  const conversa = (c.historico || []).map((m) => '[' + m.em + '] ' + (quem[m.autor] || m.autor) + (m.tipo !== 'texto' ? ' (' + m.tipo + ')' : '') + ': ' + m.texto).join('\n');
  const instrucao = [
    'Você é a assistente virtual da Gleide, do salão Toda Bonita Mega Hair (Sinop-MT), no WhatsApp do salão.',
    'Em ' + diaDe(c.combinado_em) + ' a cliente' + (nome ? ' (' + nome + ')' : '') + ' combinou de voltar a falar com o salão por volta de ' +
      diaDe(c.data + 'T12:00:00-04:00') + (c.assunto ? ', sobre: ' + c.assunto : '') + '. Agora é ' + agora + ' e ela ainda não chamou.',
    c.resumo_ia ? 'Resumo do que se sabe dela: ' + c.resumo_ia : '',
    '', 'CONVERSA (mais antiga primeiro):', conversa, '',
    'Primeiro decida se faz sentido mandar o alô. Responda exatamente "PULAR: <motivo curto>" se:',
    '- na conversa ela não combinou de voltar a falar (a data foi anotada por engano) ou já resolveu o assunto;',
    '- ela disse que não quer, não tem interesse, vai procurar outro lugar ou pediu para não mandar mensagem;',
    '- ela pediu um tempo maior que ainda não passou (cirurgia, viagem, "só mês que vem").',
    // Lizete (30/10): o salão ficou de responder as marcas e ela ficou de contar como ficou o cabelo; o alô é sobre o que ELA combinou
    'Se o salão ficou devendo alguma resposta (você disse que ia confirmar algo com a Gleide), NÃO pule por isso: fale só do que ela combinou, sem citar a pendência e sem prometer a resposta.',
    'Se fizer sentido, escreva o alô como uma pessoa de verdade que atende o WhatsApp do salão e lembrou do combinado:',
    '- fale do assunto que ficou combinado, com o detalhe que ela trouxe, e pergunte de um jeito simples como foi ou o que ela decidiu;',
    '- leve e sem cobrança: ela não tem obrigação de responder; não convide para agendar nem para a avaliação (a não ser que ela mesma tenha falado em marcar);',
    '- não repita frases que você já mandou na conversa, nem a última pergunta com outras palavras;',
    '- nada de frase pronta de robô: "Se precisar de ajuda, estou por aqui", "Fico à disposição", "Só passando pra lembrar", "Tô passando pra saber", "Espero que esteja bem", "é só me chamar";',
    '- use só o que está escrito na conversa: não suponha o que ela não disse; não indique técnica, quantidade nem tipo de cabelo;',
    '- não afirme estoque, cor, resultado nem preço (nem repita um valor da conversa); não invente horário livre, promoção ou novidade;',
    '- não prometa passar foto ou mensagem para a Gleide nem que ela vai dar retorno (o alô não encaminha nada);',
    '- 1 frase (no máximo 2), jeito de WhatsApp de Sinop ("pra", "tá"), sem formalidade; sem negrito, sem lista; emoji só se combinar, no máximo um; o primeiro nome no máximo uma vez;',
    '- pode começar com um "Oi" curto (faz dias que vocês não falam), sem se apresentar de novo; não fale de tempo sem resposta nem diga "como combinamos" em tom de cobrança.',
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

  const retornoWorkflow = {
    name: 'IA - Retorno combinado',
    nodes: [
      node('A cada 10 min', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'minutes', minutesInterval: 10 }] } }),
      node('Disparar agora (teste)', 'n8n-nodes-base.webhook', 2, [0, 220],
        { httpMethod: 'GET', path: 'retorno-combinado', authentication: 'headerAuth', responseMode: 'lastNode', options: {} },
        // mesma senha do webhook do WhatsApp (header x-webhook-token): sem ela, ninguém dispara de fora
        { webhookId: '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f', credentials: { httpHeaderAuth: { id: env.N8N_WEBHOOK_CRED_ID || 'tV8sJuiNWidQ4Dnn', name: 'Webhook WhatsApp (senha da Evolution)' } } }),
      // o banco já confere a data, o horário do salão e o resto (supabase/028)
      rpc('Quem chamar', [220, 0], 'n8n_retornos_para_chamar', `{ p_empresa_id: ${EMPRESA} }`),
      // Gleide assumiu a conversa pelo celular (pausa no Redis, 12 h): não chama
      node('Pausas', 'n8n-nodes-base.redis', 1, [440, 0], { operation: 'keys', keyPattern: 'pausa:*', getValues: false },
        { credentials: REDIS, executeOnce: true, alwaysOutputData: true }),
      node('Memórias', 'n8n-nodes-base.redis', 1, [660, 0], { operation: 'keys', keyPattern: 'memoria:*', getValues: false },
        { credentials: REDIS, executeOnce: true, alwaysOutputData: true }),
      node('Preparar', 'n8n-nodes-base.code', 2, [880, 0], { jsCode: PREPARAR }),
      node('Escrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [1100, 0], {
        method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ contents: [{ parts: [{ text: $json.instrucao }] }], generationConfig: { temperature: 0.6, thinkingConfig: { thinkingLevel: \'low\' } } }) }}', options: {},
      }, { credentials: GEMINI || {}, retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput' }),
      node('Decidir', 'n8n-nodes-base.code', 2, [1320, 0], { jsCode: DECIDIR }),
      se('Enviar?', [1540, -100], 'c1', "={{ $json.acao === 'enviar' }}"),
      se('Pular?', [1760, 120], 'c2', "={{ $json.acao === 'pular' }}"),
      node('Mandar para a cliente', 'n8n-nodes-base.httpRequest', 4.2, [1760, -200], {
        method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
        sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ number: $json.telefone, text: $json.texto, delay: 2000 + Math.floor(Math.random() * 2000) }) }}',
        options: { batching: { batch: { batchSize: 1, batchInterval: 8000 } } },
      }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
      // só grava se o WhatsApp aceitou (senão tenta de novo na próxima rodada)
      se('Enviou?', [1980, -200], 'c3', '={{ !!$json.key?.id }}'),
      rpc('Registrar alô', [2200, -200], 'n8n_registrar_retorno',
        `{ p_empresa_id: ${EMPRESA}, p_retorno_id: ${D}.retorno_id, p_situacao: 'enviado', p_mensagem: ${D}.texto, p_wa_message_id: $json.key.id }`),
      // memória da conversa (LPUSH, a mais nova na frente), como na retomada: o agente sabe o que mandou quando ela responder
      node('Memória (aviso)', 'n8n-nodes-base.redis', 1, [2420, -200], {
        operation: 'push', list: `={{ ${D}.memoria }}`, tail: false,
        messageData: `={{ JSON.stringify({ type: 'human', data: { content: '[ela tinha combinado de falar com o salão por volta de hoje' + (${D}.assunto ? ' (' + ${D}.assunto + ')' : '') + '; alô automático de retorno]', additional_kwargs: {}, response_metadata: {} } }) }}`,
      }, { credentials: REDIS, onError: 'continueRegularOutput' }),
      node('Memória (mensagem enviada)', 'n8n-nodes-base.redis', 1, [2640, -200], {
        operation: 'push', list: `={{ ${D}.memoria }}`, tail: false,
        messageData: `={{ JSON.stringify({ type: 'ai', data: { content: ${D}.texto, tool_calls: [], invalid_tool_calls: [], additional_kwargs: {}, response_metadata: {} } }) }}`,
      }, { credentials: REDIS, onError: 'continueRegularOutput' }),
      rpc('Registrar pulado', [1980, 120], 'n8n_registrar_retorno',
        `{ p_empresa_id: ${EMPRESA}, p_retorno_id: $json.retorno_id, p_situacao: 'pulado', p_motivo: $json.motivo }`),
    ],
    connections: {
      'A cada 10 min': main('Quem chamar'),
      'Disparar agora (teste)': main('Quem chamar'),
      'Quem chamar': main('Pausas'),
      'Pausas': main('Memórias'),
      'Memórias': main('Preparar'),
      'Preparar': main('Escrever (Gemini)'),
      'Escrever (Gemini)': main('Decidir'),
      'Decidir': { main: [[{ node: 'Enviar?', type: 'main', index: 0 }]] },
      'Enviar?': { main: [[{ node: 'Mandar para a cliente', type: 'main', index: 0 }], [{ node: 'Pular?', type: 'main', index: 0 }]] },
      'Pular?': main('Registrar pulado'),
      'Mandar para a cliente': main('Enviou?'),
      'Enviou?': main('Registrar alô'),
      'Registrar alô': main('Memória (aviso)'),
      'Memória (aviso)': main('Memória (mensagem enviada)'),
    },
    // execução que deu certo não fica guardada (o que foi feito está na tabela retornos_combinados)
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'none', saveManualExecutions: true },
  };

  return { retornoWorkflow, idFile: require('path').join(__dirname, '.workflow-retorno-id') };
};
