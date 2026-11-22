// A cliente LIGOU para o WhatsApp do salão: o que a IA faz (vale para a Gleide e para as lojas).
// 15/11/2026, pedido do Victor. Até aqui a ligação era recusada pela Evolution com uma mensagem automática fria, que
// saía 2 ou 3 vezes por ligação, era gravada como "a dona respondeu" (pausava a IA 12 h) e ninguém ficava sabendo.
// Agora:
//   1. a Evolution continua recusando a ligação, mas manda o evento "call" para cá (webhook com o evento CALL) e a
//      mensagem automática dela fica vazia (ver ligar-ligacao.js, que muda a configuração da instância);
//   2. a IA responde UMA vez a cada 10 minutos, com contexto: quem tem horário nas próximas 24 h ouve "é sobre o seu
//      horário de hoje às 14h?"; na hora da avaliação por ligação, "é a Gleide que liga para você";
//   3. a dona só é avisada se a cliente tem horário nas próximas 24 h ou ligou 3 vezes em meia hora;
//   4. ligação nunca pausa a IA: a mensagem automática antiga, se ainda sair, não conta como resposta da dona.
// Banco: tabela ligacoes e n8n_ligacao_recebida (supabase/051).
// Quem liga quase sempre chega com o número escondido (@lid; visto na ligação de teste de 15/11). O telefone verdadeiro
// sai do histórico da conversa na Evolution (remoteJidAlt das mensagens antigas). Quem nunca escreveu continua escondido:
// recebe a resposta, mas só entra no app quando mandar a primeira mensagem.

const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;
const EMPRESA = '$env.EMPRESA_ID';
const NUMEROS = "($env.ASSISTENTE_NUMEROS || '5566999596740').split(',').map(s => s.trim()).filter(Boolean)";
// textos automáticos de ligação já usados nas instâncias (Gleide e Caroline): não são "a dona respondeu"
// 22/11/2026: entrou também a saudação automática do WhatsApp/anúncio que ficou com o texto de exemplo ("Aqui você
// pode colocar o que você quer dizer na primeira mensagem enviada pelo cliente"). Ela sai sozinha antes de a cliente
// escrever, contava como "a dona respondeu" e pausava a IA 12 h (Aliny e Anny ficaram sem resposta em 21/11).
const AUTOMATICA = 'atendimento é só por mensagem|não atendo ligações por aqui|aqui voc[eê] pode colocar o que voc[eê] quer dizer';

const DADOS = String.raw`
// Evento "call" da Evolution (Baileys): { id, from, status: offer|ringing|timeout|reject|accept, isGroup, isVideo }.
// Só a oferta conta (os outros sinais são da mesma ligação) e só de pessoa (grupo não).
const b = $input.first().json.body || {};
const d = b.data || {};
const jid = String(d.from || d.chatId || d.remoteJid || '');
if (String(d.status || '') !== 'offer' || d.isGroup || !/@(s\.whatsapp\.net|lid)$/.test(jid)) return [];
const escondido = jid.endsWith('@lid');
const digitos = jid.split('@')[0].replace(/\D/g, '');
const permitidos = String($env.NUMEROS_PERMITIDOS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (permitidos.length && !permitidos.includes(digitos)) return [];
return [{ json: { jid, digitos, telefone: escondido ? '' : digitos, numero: escondido ? jid : digitos } }];
`;

const TELEFONE = String.raw`
// número escondido: procura o telefone nas mensagens antigas dessa conversa (a Evolution guarda em key.remoteJidAlt)
const l = $('Ligação: dados').first().json;
if (l.telefone) return [{ json: l }];
const r = $input.first().json || {};
const lista = (r.messages && r.messages.records) || r.records || (Array.isArray(r) ? r : []);
const alt = lista.map((x) => String((x.key && x.key.remoteJidAlt) || '')).find((j) => /^\d{10,15}@s\.whatsapp\.net$/.test(j));
if (!alt) return [{ json: l }];
const tel = alt.split('@')[0];
return [{ json: { ...l, telefone: tel, digitos: tel } }];
`;

const O_QUE_DIZER = String.raw`
const l = $('Ligação: telefone').first().json;
let r = $input.first().json || {};
if (typeof r === 'string') { try { r = JSON.parse(r); } catch (e) { r = {}; } }
// o banco não respondeu: ainda assim a cliente recebe a resposta simples (melhor que silêncio)
if (r.responder === undefined) r = { responder: true, avisar: false };
const primeiro = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return /^[A-Za-zÀ-ÿ]{2,}$/.test(p) && !/^cliente$/i.test(p) ? p[0].toUpperCase() + p.slice(1).toLowerCase() : ''; };
const nome = primeiro(r.nome);
const oi = 'Oi' + (nome ? ', ' + nome : '') + '!';
const dia = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Cuiaba' });
const quando = (iso) => {
  const d = new Date(iso);
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Cuiaba' });
  return (dia(d) === dia(new Date()) ? 'hoje' : 'amanhã') + ' às ' + h;
};
let texto;
if (r.hora_da_online) {
  texto = oi + ' Vi sua ligação. Na avaliação online é a Gleide que liga para você, por aqui mesmo, no horário combinado (' + quando(r.inicio) + '). Se precisar de algo antes, é só me escrever.';
} else if (r.inicio) {
  texto = oi + ' Vi sua ligação. Por aqui o atendimento é por mensagem. É sobre o seu horário de ' + quando(r.inicio) + '? Me escreve ou manda um áudio que eu resolvo agora.';
} else if (nome) {
  texto = oi + ' Vi sua ligação. Por aqui o atendimento é por mensagem, e eu já estou aqui para te ajudar. Me conta por escrito ou por áudio o que você precisa?';
} else {
  texto = 'Oi! Vi que você ligou. Por aqui o atendimento é por mensagem, e eu já estou aqui para te ajudar. Me conta o que você está procurando? Pode ser por áudio, se preferir.';
}
// aviso para a dona: só quando importa (horário nas próximas 24 h, ou 3 ligações em meia hora)
const fone = (t) => { const m = String(t || '').match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : 'Um número novo'; };
const doisNomes = String(r.nome || '').trim().split(/\s+/).filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w)).slice(0, 2)
  .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
const quem = doisNomes && !/^cliente( teste)?$/i.test(doisNomes) ? '*' + doisNomes + '*' : fone(l.telefone);
const textoDona = '📞 ' + quem + (Number(r.chamadas) >= 3 ? ' ligou ' + r.chamadas + ' vezes em meia hora' : ' ligou agora') +
  (r.inicio ? ' (horário ' + quando(r.inicio) + (r.servico ? ', ' + String(r.servico).toLowerCase() : '') + ')' : '') +
  '. Respondi que o atendimento é por mensagem.';
const mem = (t) => JSON.stringify({ type: 'ai', data: { content: t, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } });
return [{ json: { ...l, responder: !!r.responder, avisar: !!r.avisar, texto, textoDona, memoria: mem(texto), memoriaDona: mem(textoDona) } }];
`;

module.exports = ({ node, main, ifNode, cond, workflow, EVO, apikeyHeader, REDIS }) => {
  const achar = (nome) => { const n = workflow.nodes.find((x) => x.name === nome); if (!n) throw new Error(`ligacao: não achei "${nome}"`); return n; };
  const sim = { type: 'boolean', operation: 'true', singleValue: true };
  const headers = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const rpc = (name, pos, fn, body) => node(name, 'n8n-nodes-base.httpRequest', 4.2, pos, {
    method: 'POST', url: `={{ $env.SUPABASE_URL }}/rest/v1/rpc/${fn}`, sendHeaders: true, headerParameters: headers,
    sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}`, options: { timeout: 15000 },
  }, { onError: 'continueRegularOutput', alwaysOutputData: true });
  const enviar = (name, pos, body) => node(name, 'n8n-nodes-base.httpRequest', 4.2, pos, {
    method: 'POST', url: `${EVO}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}`, sendHeaders: true, headerParameters: apikeyHeader,
    sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}`, options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' });
  const L = "$('Ligação: o que dizer').first().json";

  // 4. a mensagem automática de ligação (se ainda sair) não é "a dona respondeu": não pausa nem vai para o app
  const manual = achar('Minha resposta manual?');
  const conds = manual.parameters.conditions.conditions;
  if (conds.length !== 3) throw new Error('ligacao: "Minha resposta manual?" mudou');
  conds.push(cond('m4', `={{ !/${AUTOMATICA}/i.test($json.texto || '') }}`, sim));

  // 1 a 3. o evento de ligação sai do caminho das mensagens logo na entrada
  if (JSON.stringify(workflow.connections['Webhook Evolution']) !== JSON.stringify(main('Extrair dados'))) throw new Error('ligacao: a entrada do webhook mudou');
  workflow.nodes.push(
    ifNode('É ligação?', [110, 0], [cond('lg1', "={{ String($json.body?.event || '').toLowerCase() === 'call' }}", sim)]),
    node('Ligação: dados', 'n8n-nodes-base.code', 2, [220, 420], { jsCode: DADOS }),
    node('Ligação: histórico', 'n8n-nodes-base.httpRequest', 4.2, [330, 420], {
      method: 'POST', url: `${EVO}/chat/findMessages/{{ $env.EVOLUTION_INSTANCE }}`, sendHeaders: true, headerParameters: apikeyHeader,
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ where: { key: { remoteJid: $json.jid } }, limit: 30 }) }}', options: { timeout: 10000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    node('Ligação: telefone', 'n8n-nodes-base.code', 2, [385, 420], { jsCode: TELEFONE }),
    rpc('Ligação: anotar', [440, 420], 'n8n_ligacao_recebida', `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR('$json.digitos')} }`),
    node('Ligação: o que dizer', 'n8n-nodes-base.code', 2, [660, 420], { jsCode: O_QUE_DIZER }),
    ifNode('Ligação: responde?', [880, 360], [cond('lg2', '={{ $json.responder }}', sim)]),
    enviar('Ligação: responder', [1100, 360], `{ number: ${L}.numero, text: ${L}.texto, delay: 1500 }`),
    ifNode('Ligação: chegou e tem telefone?', [1320, 360], [cond('lg3', `={{ !!$json.key?.id && !!${L}.telefone }}`, sim)]),
    node('Ligação: memória da IA', 'n8n-nodes-base.redis', 1, [1540, 360], {
      operation: 'push', list: `=memoria:{{ ${L}.telefone }}`, messageData: `={{ ${L}.memoria }}`, tail: false,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    rpc('Ligação: registrar no app', [1760, 360], 'n8n_registrar_saida',
      `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR(`${L}.telefone`)}, p_conteudo: ${L}.texto, p_autor: 'ia', p_tipo: 'texto', p_wa_message_id: $('Ligação: responder').first().json.key.id }`),
    ifNode('Ligação: avisa a dona?', [880, 520], [cond('lg4', '={{ $json.avisar }}', sim)]),
    node('Ligação: números da dona', 'n8n-nodes-base.code', 2, [1100, 520], { jsCode:
      `const l = $input.first().json;\nreturn ${NUMEROS}.map((tel) => ({ json: { tel, texto: l.textoDona, memoria: l.memoriaDona } }));` }),
    enviar('Ligação: avisar a dona', [1320, 520], '{ number: $json.tel, text: $json.texto }'),
    node('Ligação: memória da assistente', 'n8n-nodes-base.redis', 1, [1540, 520], {
      operation: 'push', list: "=assistente:{{ $('Ligação: números da dona').item.json.tel }}",
      messageData: "={{ $('Ligação: números da dona').item.json.memoria }}", tail: false,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
  );
  Object.assign(workflow.connections, {
    'Webhook Evolution': main('É ligação?'),
    'É ligação?': { main: [[{ node: 'Ligação: dados', type: 'main', index: 0 }], [{ node: 'Extrair dados', type: 'main', index: 0 }]] },
    'Ligação: dados': main('Ligação: histórico'),
    'Ligação: histórico': main('Ligação: telefone'),
    'Ligação: telefone': main('Ligação: anotar'),
    'Ligação: anotar': main('Ligação: o que dizer'),
    'Ligação: o que dizer': { main: [[{ node: 'Ligação: responde?', type: 'main', index: 0 }, { node: 'Ligação: avisa a dona?', type: 'main', index: 0 }]] },
    'Ligação: responde?': main('Ligação: responder'),
    'Ligação: responder': main('Ligação: chegou e tem telefone?'),
    'Ligação: chegou e tem telefone?': main('Ligação: memória da IA'),
    'Ligação: memória da IA': main('Ligação: registrar no app'),
    'Ligação: avisa a dona?': main('Ligação: números da dona'),
    'Ligação: números da dona': main('Ligação: avisar a dona'),
    'Ligação: avisar a dona': main('Ligação: memória da assistente'),
  });
};
