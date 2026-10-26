// IA - Faltas e avisos (situação 2, ver supabase/007_ia_chama_faltas.sql).
// Chamado pelo montar-workflow.js: devolve 1 workflow novo que confere a cada 5 min (8h–20h). Conferir não é
// mandar: cada cliente recebe no máximo 2 mensagens de atraso, 1 de falta e 1 oferta por vaga.
//   D) atraso (supabase/011): +5 min "está a caminho?", +25 min "conseguiu vir?"
//   E) sem resposta 10 min depois: pergunta à Gleide "veio ou libera?". Silêncio não libera nada; o "libera"
//      dela (ferramenta liberar_horario da assistente) marca falta e abre a vaga (C, só no mesmo dia)
//   F) liberou, outra adiantou e a atrasada apareceu: avisa a Gleide do conflito
//   A) quem faltou hoje/ontem e ainda não foi chamada -> a IA manda a mensagem pelo número do salão,
//      grava o contato 'falta' e a mensagem; quando a cliente responde, o agente lê o "ALÔ DE FALTA"
//      na ficha e marca outro horário
//   B) o que contar à Gleide -> remarcou (falta ou pedido de remarcação do app) ou sem resposta em 24 h
//   C) vaga que abriu (horário cancelado/remarcado, ver supabase/010_vagas_adiantar.sql) -> oferece
//      para a cliente com o próximo horário depois dela; se ela topar, o agente lê o "ALÔ DE VAGA"
//      na ficha e remarca o horário dela para a vaga. A Gleide recebe "adiantou" pelo aviso B
// GET /webhook/faltas-avisos dispara na hora, para testar (com o header x-webhook-token).
// Ligar no salão: empresas.config.faltas = {"chamar": true, "so_para": [...]} (só_para vazio = todas).
//                 empresas.config.vagas = {"oferecer": true, "so_para": [...]} (idem, para as vagas).

const EMPRESA = "$env.EMPRESA_ID";
const NUMEROS = "($env.ASSISTENTE_NUMEROS || '').split(',').map(s => s.trim()).filter(Boolean)";

// Hora e dia no fuso do salão: "hoje às 14:00", "ontem às 14:00", "qui, 30/10 às 09:00"
const QUANDO = String.raw`
const TZ = 'America/Cuiaba';
const diaDe = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const hora = (d) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const quando = (s) => {
  if (!s) return '';
  const d = new Date(s), dia = diaDe(d);
  const hoje = diaDe(new Date()), ontem = diaDe(new Date(Date.now() - 86400000)), amanha = diaDe(new Date(Date.now() + 86400000));
  const nome = dia === hoje ? 'hoje' : dia === ontem ? 'ontem' : dia === amanha ? 'amanhã'
    : d.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: TZ }).replace('.', '') + ', ' + dia.slice(8) + '/' + dia.slice(5, 7);
  return nome + ' às ' + hora(d);
};
const primeiro = (n) => String(n || '').trim().split(/\s+/)[0] || '';
`;

const MENSAGEM_FALTA = QUANDO + String.raw`
return $input.all().map((i) => i.json).filter((f) => f.agendamento_id).map((f) => {
  const nome = primeiro(f.nome);
  const texto = 'Oi' + (nome ? ' ' + nome : '') + '! Sentimos sua falta ' + quando(f.inicio) +
    ' 💛 Aconteceu alguma coisa? Se quiser, já vejo outro horário pra você.';
  return { json: { ...f, texto } };
});
`;

// atraso (supabase/011): etapa 1 = +5 min, etapa 2 = +25 min; depois disso a IA não chama mais
const MENSAGEM_ATRASO = QUANDO + String.raw`
return $input.all().map((i) => i.json).filter((a) => a.agendamento_id).map((a) => {
  const nome = primeiro(a.nome);
  const texto = a.etapa === 1
    ? 'Oi' + (nome ? ' ' + nome : '') + '! Seu horário aqui no salão era ' + quando(a.inicio) + ' 💛 Está a caminho?'
    : (nome ? nome + ', c' : 'C') + 'onseguiu vir? Se hoje não der, me avisa que eu vejo outro horário pra você, sem problema 💛';
  return { json: { ...a, texto } };
});
`;

// atraso sem resposta (supabase/011): a IA não decide sozinha, pergunta à Gleide. Silêncio = o horário continua dela
const MEMORIA = "memoria: JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } })";
const MENSAGEM_CONFIRMAR = QUANDO + String.raw`
const as = $input.all().map((i) => i.json).filter((a) => a.agendamento_id);
if (!as.length) return [];
const linha = (a) => '⏰ *' + (a.nome || 'cliente').split(' ').slice(0, 2).join(' ') + '* (' + quando(a.inicio) +
  (a.servico ? ', ' + a.servico.toLowerCase() : '') + ') não chegou nem respondeu às 2 mensagens. Ela está aí?';
const texto = as.map(linha).join('\n') + '\nResponda *veio* ou *libera* (aí ofereço o horário pra quem vem depois). Sem resposta, eu não mexo em nada.';
const ids = as.map((a) => a.pendencia_id);
const numeros = ${NUMEROS};
return numeros.map((tel) => ({ json: { tel, texto, ids, ${MEMORIA} } }));
`;

// a Gleide liberou, outra adiantou e depois a atrasada apareceu: a Gleide decide
const MENSAGEM_CONFLITO = QUANDO + String.raw`
const cs = $input.all().map((i) => i.json).filter((c) => c.contato_id);
if (!cs.length) return [];
const n = (s) => '*' + (s || 'cliente').split(' ').slice(0, 2).join(' ') + '*';
const texto = cs.map((c) => '⚠️ ' + n(c.nome_atrasada) + ' (' + quando(c.horario_atrasada) + ') apareceu, mas ' + n(c.nome_adiantou) +
  ' já adiantou para ' + quando(c.novo_horario) + '. As duas estão no mesmo horário: como quer resolver?').join('\n');
const itens = cs.map((c) => ({ id: c.contato_id, situacao: 'conflito' }));
const numeros = ${NUMEROS};
return numeros.map((tel) => ({ json: { tel, texto, itens, ${MEMORIA} } }));
`;

const MENSAGEM_VAGA = QUANDO + String.raw`
// uma oferta por cliente por vez, mesmo se abriram duas vagas antes do horário dela
const vistas = new Set();
return $input.all().map((i) => i.json).filter((v) => v.vaga_id && !vistas.has(v.cliente_id) && vistas.add(v.cliente_id)).map((v) => {
  const nome = primeiro(v.nome);
  const texto = 'Oi' + (nome ? ' ' + nome : '') + '! Abriu um horário ' + quando(v.vaga_inicio) + ', antes do seu (' + quando(v.inicio_atual) +
    ') 💛 Se quiser adiantar, é só me falar que eu já troco pra você. Se preferir manter o seu, tudo certo também!';
  return { json: { ...v, texto } };
});
`;

const MENSAGEM_AVISO = QUANDO + String.raw`
const as = $input.all().map((i) => i.json).filter((a) => a.contato_id);
if (!as.length) return [];
const linha = (a) => {
  const n = '*' + (a.nome || 'cliente').split(' ').slice(0, 2).join(' ') + '*';
  if (a.situacao === 'remarcou') {
    const novo = a.novo_horario ? ' para *' + quando(a.novo_horario) + '*' : '';
    if (a.tipo === 'vaga') return '⏩ ' + n + ' adiantou: saiu de ' + quando(a.horario_original) + novo + ' (vaga que abriu).';
    return a.tipo === 'falta'
      ? '✅ Remarquei ' + n + ' (faltou ' + quando(a.horario_original) + ')' + novo + '.'
      : '✅ ' + n + ' remarcou o horário de ' + quando(a.horario_original) + novo + '.';
  }
  return a.tipo === 'falta'
    ? '⚠️ ' + n + ' não respondeu sobre a falta de ' + quando(a.horario_original) + '. Quer chamar você mesma?'
    : '⚠️ ' + n + ' não respondeu ao pedido de remarcação (' + quando(a.horario_original) + '). Quer chamar você mesma?';
};
const texto = as.map(linha).join('\n');
const itens = as.map((a) => ({ id: a.contato_id, situacao: a.situacao }));
const numeros = ${NUMEROS};
return numeros.map((tel) => ({ json: { tel, texto, itens,
  // mesma estrutura que o nó de memória do n8n grava: a assistente sabe o que avisou se a Gleide responder
  memoria: JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } }) } }));
`;

module.exports = ({ env, node, main }) => {
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
  const evoPost = (name, position, body, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
    sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}`, options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, ...extra });
  const cond = (id, left) => ({ id, leftValue: left, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } });
  const INICIOS = ['Atrasos para chamar', 'Atrasos para confirmar', 'Conflitos de atraso','Faltas para chamar', 'Vagas para oferecer', 'Avisos para a Gleide']
    .map((n) => ({ node: n, type: 'main', index: 0 }));

  const faltasWorkflow = {
    name: 'IA - Faltas e avisos',
    nodes: [
      node('A cada 5 min', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'minutes', minutesInterval: 5 }] } }),
      node('Horário do salão?', 'n8n-nodes-base.if', 2.2, [220, 0], {
        conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [cond('h1', "={{ $now.setZone('America/Cuiaba').hour >= 8 && $now.setZone('America/Cuiaba').hour < 20 }}")], combinator: 'and' },
        options: {},
      }),
      node('Disparar agora (teste)', 'n8n-nodes-base.webhook', 2, [0, 220],
        { httpMethod: 'GET', path: 'faltas-avisos', authentication: 'headerAuth', responseMode: 'lastNode', options: {} },
        // mesma senha do webhook do WhatsApp (header x-webhook-token): sem ela, ninguém dispara de fora
        { webhookId: '8a9b0c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d', credentials: { httpHeaderAuth: { id: env.N8N_WEBHOOK_CRED_ID || 'tV8sJuiNWidQ4Dnn', name: 'Webhook WhatsApp (senha da Evolution)' } } }),

      // A) chamar quem faltou
      rpc('Faltas para chamar', [440, -100], 'n8n_faltas_para_chamar', `{ p_empresa_id: ${EMPRESA} }`),
      node('Mensagem da falta', 'n8n-nodes-base.code', 2, [660, -100], { jsCode: MENSAGEM_FALTA }),
      evoPost('Mandar para a cliente', [880, -100], '{ number: $json.telefone, text: $json.texto }', { onError: 'continueRegularOutput' }),
      // só grava se o WhatsApp aceitou (senão tenta de novo daqui a 5 min)
      node('Enviou?', 'n8n-nodes-base.if', 2.2, [1100, -100], {
        conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [cond('e1', '={{ !!$json.key?.id }}')], combinator: 'and' },
        options: {},
      }),
      rpc('Registrar chamada', [1320, -100], 'n8n_registrar_chamada_falta',
        `{ p_empresa_id: ${EMPRESA}, p_agendamento_id: $('Mensagem da falta').item.json.agendamento_id, p_mensagem: $('Mensagem da falta').item.json.texto, p_wa_message_id: $json.key.id }`),

      // D) chamar quem está atrasada (+5 e +25 min)
      rpc('Atrasos para chamar', [440, -540], 'n8n_atrasos_para_chamar', `{ p_empresa_id: ${EMPRESA} }`),
      node('Mensagem do atraso', 'n8n-nodes-base.code', 2, [660, -540], { jsCode: MENSAGEM_ATRASO }),
      evoPost('Chamar a atrasada', [880, -540], '{ number: $json.telefone, text: $json.texto }', { onError: 'continueRegularOutput' }),
      node('Chamou?', 'n8n-nodes-base.if', 2.2, [1100, -540], {
        conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [cond('t1', '={{ !!$json.key?.id }}')], combinator: 'and' },
        options: {},
      }),
      rpc('Registrar chamada do atraso', [1320, -540], 'n8n_registrar_chamada_atraso',
        `{ p_empresa_id: ${EMPRESA}, p_agendamento_id: $('Mensagem do atraso').item.json.agendamento_id, p_mensagem: $('Mensagem do atraso').item.json.texto, p_wa_message_id: $json.key.id }`),

      // E) atraso sem resposta: pergunta à Gleide "veio ou libera?" (quem libera é ela, pela assistente)
      rpc('Atrasos para confirmar', [440, -760], 'n8n_atrasos_para_confirmar', `{ p_empresa_id: ${EMPRESA} }`),
      node('Mensagem veio ou libera', 'n8n-nodes-base.code', 2, [660, -760], { jsCode: MENSAGEM_CONFIRMAR }),
      evoPost('Perguntar à Gleide (atraso)', [880, -760], '{ number: $json.tel, text: $json.texto }'),
      node('Guardar pergunta do atraso', 'n8n-nodes-base.redis', 1, [1100, -760], {
        operation: 'push', list: "=assistente:{{ $('Mensagem veio ou libera').item.json.tel }}",
        messageData: "={{ $('Mensagem veio ou libera').item.json.memoria }}", tail: false,
      }, { credentials: REDIS }),
      // conta como "perguntou": a cobrança de 1 em 1 h repete daqui a 1 h, não agora
      rpc('Marcar atraso perguntado', [1320, -760], 'n8n_assistente_marcar_perguntado',
        `{ p_empresa_id: ${EMPRESA}, p_pedido_a: $('Mensagem veio ou libera').item.json.tel, p_ids: $('Mensagem veio ou libera').item.json.ids }`),

      // F) conflito: liberou, outra adiantou e a atrasada apareceu
      rpc('Conflitos de atraso', [440, -980], 'n8n_conflitos_atraso', `{ p_empresa_id: ${EMPRESA} }`),
      node('Mensagem do conflito', 'n8n-nodes-base.code', 2, [660, -980], { jsCode: MENSAGEM_CONFLITO }),
      evoPost('Avisar a Gleide (conflito)', [880, -980], '{ number: $json.tel, text: $json.texto }'),
      node('Guardar aviso do conflito', 'n8n-nodes-base.redis', 1, [1100, -980], {
        operation: 'push', list: "=assistente:{{ $('Mensagem do conflito').item.json.tel }}",
        messageData: "={{ $('Mensagem do conflito').item.json.memoria }}", tail: false,
      }, { credentials: REDIS }),
      rpc('Marcar conflito avisado', [1320, -980], 'n8n_marcar_avisado',
        `{ p_empresa_id: ${EMPRESA}, p_itens: $('Mensagem do conflito').item.json.itens }`, { executeOnce: true }),

      // C) oferecer a vaga que abriu
      rpc('Vagas para oferecer', [440, -320], 'n8n_vagas_para_oferecer', `{ p_empresa_id: ${EMPRESA} }`),
      node('Mensagem da vaga', 'n8n-nodes-base.code', 2, [660, -320], { jsCode: MENSAGEM_VAGA }),
      evoPost('Oferecer para a cliente', [880, -320], '{ number: $json.telefone, text: $json.texto }', { onError: 'continueRegularOutput' }),
      node('Ofereceu?', 'n8n-nodes-base.if', 2.2, [1100, -320], {
        conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [cond('v1', '={{ !!$json.key?.id }}')], combinator: 'and' },
        options: {},
      }),
      rpc('Registrar oferta', [1320, -320], 'n8n_registrar_oferta_vaga',
        `{ p_empresa_id: ${EMPRESA}, p_vaga_id: $('Mensagem da vaga').item.json.vaga_id, p_agendamento_id: $('Mensagem da vaga').item.json.agendamento_id, p_mensagem: $('Mensagem da vaga').item.json.texto, p_wa_message_id: $json.key.id }`),

      // B) avisar a Gleide
      rpc('Avisos para a Gleide', [440, 120], 'n8n_avisos_para_gleide', `{ p_empresa_id: ${EMPRESA} }`),
      node('Mensagem do aviso', 'n8n-nodes-base.code', 2, [660, 120], { jsCode: MENSAGEM_AVISO }),
      evoPost('Mandar para a Gleide', [880, 120], '{ number: $json.tel, text: $json.texto }'),
      node('Guardar na memória da assistente', 'n8n-nodes-base.redis', 1, [1100, 120], {
        operation: 'push', list: "=assistente:{{ $('Mensagem do aviso').item.json.tel }}",
        messageData: "={{ $('Mensagem do aviso').item.json.memoria }}", tail: false,
      }, { credentials: REDIS }),
      rpc('Marcar avisado', [1320, 120], 'n8n_marcar_avisado',
        `{ p_empresa_id: ${EMPRESA}, p_itens: $('Mensagem do aviso').item.json.itens }`, { executeOnce: true }),
    ],
    connections: {
      'A cada 5 min': main('Horário do salão?'),
      'Horário do salão?': { main: [INICIOS] },
      'Disparar agora (teste)': { main: [INICIOS] },
      'Atrasos para chamar': main('Mensagem do atraso'),
      'Mensagem do atraso': main('Chamar a atrasada'),
      'Chamar a atrasada': main('Chamou?'),
      'Chamou?': main('Registrar chamada do atraso'),
      'Atrasos para confirmar': main('Mensagem veio ou libera'),
      'Mensagem veio ou libera': main('Perguntar à Gleide (atraso)'),
      'Perguntar à Gleide (atraso)': main('Guardar pergunta do atraso'),
      'Guardar pergunta do atraso': main('Marcar atraso perguntado'),
      'Conflitos de atraso': main('Mensagem do conflito'),
      'Mensagem do conflito': main('Avisar a Gleide (conflito)'),
      'Avisar a Gleide (conflito)': main('Guardar aviso do conflito'),
      'Guardar aviso do conflito': main('Marcar conflito avisado'),
      'Faltas para chamar': main('Mensagem da falta'),
      'Mensagem da falta': main('Mandar para a cliente'),
      'Mandar para a cliente': main('Enviou?'),
      'Enviou?': main('Registrar chamada'),
      'Vagas para oferecer': main('Mensagem da vaga'),
      'Mensagem da vaga': main('Oferecer para a cliente'),
      'Oferecer para a cliente': main('Ofereceu?'),
      'Ofereceu?': main('Registrar oferta'),
      'Avisos para a Gleide': main('Mensagem do aviso'),
      'Mensagem do aviso': main('Mandar para a Gleide'),
      'Mandar para a Gleide': main('Guardar na memória da assistente'),
      'Guardar na memória da assistente': main('Marcar avisado'),
    },
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', saveManualExecutions: true },
  };

  return { faltasWorkflow, idFile: require('path').join(__dirname, '.workflow-faltas-id') };
};
