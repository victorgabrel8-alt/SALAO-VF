// Repasse da cliente que a IA passou para a dona: o que ela escrever enquanto a IA está parada vai para a dona.
//
// 24/11/2026, Gleide: a IA passou uma cliente para ela às 17:21 (pedido de link de pagamento) e parou de responder a
// cliente por 12 h. A Gleide mandou o link pela assistente e pediu "Me fala se deu certo". Às 19:16 a cliente escreveu que
// ia pagar no Pix porque achou muito juros na máquina, e ninguém avisou: com a IA parada o fluxo só gravava a mensagem.
//
// Agora, só quando a pausa veio da IA (transferir_para_humano: motivo_pausa 'pediu_humano' ou 'reclamacao'), as mensagens
// novas da cliente vão para a dona no chat da assistente, juntas (espera 20 s para pegar a rajada), sem "oi" e "ok", e entram
// na memória da assistente com o id da cliente. Pausa que a própria dona pôs ('manual', 'dona_respondeu') não repassa nada:
// ela já está na conversa. Só na Gleide.

// Roda dentro do n8n (nó de código): só JavaScript simples.
// ctx: { cliente: { id, nome, telefone, motivo_pausa, ia_pausada_ate }, mensagens (a mais nova primeiro), ate (ISO da última
//   repassada), agora (ms), numero (alerta), lista (ASSISTENTE_NUMEROS), app }
function repasseDaPausada(ctx) {
  ctx = ctx || {};
  const c = ctx.cliente || {};
  const agora = Number(ctx.agora) || Date.now();
  if (!c.id || !['pediu_humano', 'reclamacao'].includes(c.motivo_pausa)) return null;
  if (!(Date.parse(c.ia_pausada_ate) > agora)) return null;
  const NFC = (x) => String(x == null ? '' : x).normalize('NFC');
  const semAcento = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const SOLTAS = ['oi', 'oie', 'oii', 'ola', 'e', 'ai', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'td', 'tb', 'sim', 'nao', 'ok', 'okay', 'ta', 'to', 'tah',
    'certo', 'beleza', 'blz', 'obrigada', 'obrigado', 'obrigadaa', 'obg', 'brigada', 'valeu', 'aham', 'uhum', 'otimo', 'joia', 'show', 'combinado', 'entendi', 'perfeito', 'ah', 'vc', 'voce'];
  const trivial = (t) => { const ps = semAcento(t).split(/[^a-z]+/).filter(Boolean); return ps.length <= 5 && ps.every((w) => SOLTAS.includes(w)); };
  let midia = false;
  const legivel = (t) => {
    if (/^\[(foto|imagem)/i.test(t)) { midia = true; return '(mandou uma foto)'; }
    if (/^\[v[íi]deo/i.test(t)) { midia = true; return '(mandou um vídeo)'; }
    if (/^\[(arquivo|documento|pdf)/i.test(t)) { midia = true; return '(mandou um arquivo)'; }
    if (/^\[[áa]udio\]/i.test(t)) { const r = t.replace(/^\[[áa]udio\]\s*/i, ''); if (!r || /envie o arquivo|n[ãa]o (consegui|foi poss[ií]vel)/i.test(r)) { midia = true; return '(mandou um áudio)'; } return r; }
    return t;
  };
  const desde = Date.parse(ctx.ate || '') || 0;
  const dela = [];
  let ate = '';
  for (const m of Array.isArray(ctx.mensagens) ? ctx.mensagens : []) {
    if (!m || typeof m !== 'object' || !m.direcao) continue;
    if (m.direcao !== 'entrada') break;
    const em = Date.parse(m.criado_em) || 0;
    if (em <= desde) break;
    if (!ate) ate = m.criado_em;
    const t = legivel(NFC(m.conteudo).replace(/\s+/g, ' ').trim());
    if (t && !trivial(t) && dela[0] !== t) dela.unshift(t.length > 200 ? t.slice(0, 200) + '…' : t);
  }
  if (!ate) return null;
  if (!dela.length) return { pular: true, ate };
  const nome = NFC(c.nome).replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/).filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w)).slice(0, 2)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const quem = nome && !/^cliente( teste)?$/i.test(nome) ? '*' + nome + '*' : 'A cliente';
  let citacao = dela.slice(-4).map((t) => (/^\(mandou/.test(t) ? t : '«' + t + '»')).join(' ');
  if (citacao.length > 500) citacao = citacao.slice(0, 500) + '…';
  // pagamento e o que for delicado a Gleide resolve direto com a cliente (Victor, 24/11): vai o contato com o link que abre a
  // conversa. Celular gravado sem o 9 sai com o 9, como ela disca.
  const f = String(c.telefone || '').replace(/\D/g, '').match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  const meio = f ? (f[2].length === 4 && /^[6-9]/.test(f[2]) ? '9' + f[2] : f[2]) : '';
  const contato = f ? 'Fala direto com ela no (' + f[1] + ') ' + meio + '-' + f[3] + ': https://wa.me/55' + f[1] + meio + f[3] : 'Pode falar com ela pelo WhatsApp do salão.';
  const linhas = [quem + ' respondeu: ' + citacao, 'A IA continua sem responder ela. ' + contato];
  if (midia) linhas.push('Conversa dela no app: ' + String(ctx.app || 'https://app.oistudio.com.br').replace(/\/$/, '') + '/conversas/' + c.id);
  const texto = linhas.join('\n');
  const d = new Date(agora - 4 * 3600e3), p2 = (n) => String(n).padStart(2, '0');
  const quando = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getUTCDay()] + ' ' + p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  const memoria = JSON.stringify({ type: 'ai', data: { content: '[' + quando + '] ' + texto + '\n(cliente_id: ' + c.id + ', telefone: ' + String(c.telefone || '').replace(/\D/g, '') + ', nome no cadastro: ' + NFC(c.nome) + ')',
    additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } });
  // a chave da memória é a que a assistente lê: o número como está em ASSISTENTE_NUMEROS (o alerta pode estar sem o 9)
  const numero = String(ctx.numero || '').replace(/\D/g, '');
  const semNove = (n) => String(n || '').replace(/^(55\d\d)9(\d{8})$/, '$1$2');
  const chave = String(ctx.lista || '').split(',').map((s) => s.trim()).filter(Boolean).find((n) => semNove(n) === semNove(numero)) || numero;
  if (!numero) return { pular: true, ate };
  return { numero, chave, texto, memoria, ate };
}

module.exports = ({ node, main, ifNode, cond, workflow, EVO, apikeyHeader, REDIS, D }) => {
  const achar = (nome) => { const n = workflow.nodes.find((x) => x.name === nome); if (!n) throw new Error('repasse-pausada: não achei "' + nome + '"'); return n; };
  const ativa = achar('IA ativa?');
  const saidas = workflow.connections['IA ativa?']?.main || [];
  if (saidas[1] && saidas[1].length) throw new Error('repasse-pausada: o "IA ativa?" já tem saída para pausada');
  const sim = { type: 'boolean', operation: 'true', singleValue: true };
  const supaHeaders = { parameters: [{ name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' }, { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' }] };
  const supa = (name, url) => node(name, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], { method: 'GET', url: '={{ $env.SUPABASE_URL }}/rest/v1/' + url, sendHeaders: true, headerParameters: supaHeaders, options: { timeout: 15000 } },
    { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
  const TEL = `(() => { const d = String(${D}.telefone || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;
  const y = 10200;
  workflow.nodes.push(
    node('Repasse: marcar última', 'n8n-nodes-base.redis', 1, [0, y], { operation: 'set', key: `=repasse_ultima:{{ ${D}.telefone }}`, value: `={{ ${D}.msgId }}`, expire: true, ttl: 600 },
      { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('Repasse: esperar', 'n8n-nodes-base.wait', 1.1, [0, y], { resume: 'timeInterval', amount: 20, unit: 'seconds' }, { webhookId: '7d1e2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b' }),
    node('Repasse: ler última', 'n8n-nodes-base.redis', 1, [0, y], { operation: 'get', key: `=repasse_ultima:{{ ${D}.telefone }}`, propertyName: 'ultima', keyType: 'string', options: {} },
      { credentials: REDIS, alwaysOutputData: true, onError: 'continueRegularOutput' }),
    ifNode('Repasse: é a última?', [0, y], [cond('rp1', `={{ $json.ultima === ${D}.msgId }}`, sim)]),
    supa('Repasse: cliente', `clientes?select=id,nome,telefone,motivo_pausa,ia_pausada_ate&empresa_id=eq.{{ $env.EMPRESA_ID }}&telefone=eq.{{ ${TEL} }}`),
    supa('Repasse: número da dona', 'empresas?select=alerta:config->>whatsapp_alerta&id=eq.{{ $env.EMPRESA_ID }}'),
    supa('Repasse: mensagens', "mensagens?select=direcao,conteudo,criado_em&cliente_id=eq.{{ $('Repasse: cliente').first().json.id || '00000000-0000-0000-0000-000000000000' }}" +
      "&criado_em=gte.{{ $now.minus(12, 'hours').toUTC().toISO() }}&order=criado_em.desc&limit=15"),
    node('Repasse: até onde', 'n8n-nodes-base.redis', 1, [0, y], { operation: 'get', key: `=repasse_ate:{{ ${D}.telefone }}`, propertyName: 'ate', keyType: 'string', options: {} },
      { credentials: REDIS, alwaysOutputData: true, onError: 'continueRegularOutput', executeOnce: true }),
    node('Repasse: montar', 'n8n-nodes-base.code', 2, [0, y], { jsCode: [
      '// repasse-pausada.js: o que a cliente escreveu depois que a IA passou ela para a dona',
      `const repasseDaPausada = ${repasseDaPausada.toString()};`,
      'const pega = (f) => { try { return f(); } catch (e) { return undefined; } };',
      'let r = null;',
      "try { r = repasseDaPausada({ cliente: pega(() => $('Repasse: cliente').first().json) || {},",
      "  mensagens: (pega(() => $('Repasse: mensagens').all().map((i) => i.json)) || []), ate: pega(() => $('Repasse: até onde').first().json.ate) || '',",
      "  agora: Date.now(), numero: pega(() => $('Repasse: número da dona').first().json.alerta) || '',",
      "  lista: pega(() => $env.ASSISTENTE_NUMEROS) || '5566999596740', app: pega(() => $env.APP_URL) || 'https://app.oistudio.com.br' }); } catch (e) { r = null; }",
      'return r ? [{ json: r }] : [];',
    ].join('\n') }, { executeOnce: true }),
    ifNode('Repasse: mandar?', [0, y], [cond('rp2', '={{ !$json.pular }}', sim)]),
    node('Repasse: avisar a dona', 'n8n-nodes-base.httpRequest', 4.2, [0, y], {
      method: 'POST', url: `${EVO}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}`, sendHeaders: true, headerParameters: apikeyHeader,
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ number: $json.numero, text: $json.texto }) }}', options: { timeout: 10000 },
    }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
    node('Repasse: memória da assistente', 'n8n-nodes-base.redis', 1, [0, y], {
      operation: 'push', list: "=assistente:{{ $('Repasse: montar').first().json.chave || 'sem-numero' }}", messageData: "={{ $('Repasse: montar').first().json.memoria }}", tail: false,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('Repasse: guardar até', 'n8n-nodes-base.redis', 1, [0, y], {
      operation: 'set', key: `=repasse_ate:{{ ${D}.telefone }}`, value: "={{ $('Repasse: montar').first().json.ate }}", expire: true, ttl: 86400,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
  );
  workflow.connections['IA ativa?'] = { main: [saidas[0] || [], [{ node: 'Repasse: marcar última', type: 'main', index: 0 }]] };
  const liga = (de, para) => { workflow.connections[de] = main(para); };
  liga('Repasse: marcar última', 'Repasse: esperar');
  liga('Repasse: esperar', 'Repasse: ler última');
  liga('Repasse: ler última', 'Repasse: é a última?');
  workflow.connections['Repasse: é a última?'] = { main: [[{ node: 'Repasse: cliente', type: 'main', index: 0 }], []] };
  liga('Repasse: cliente', 'Repasse: número da dona');
  liga('Repasse: número da dona', 'Repasse: mensagens');
  liga('Repasse: mensagens', 'Repasse: até onde');
  liga('Repasse: até onde', 'Repasse: montar');
  liga('Repasse: montar', 'Repasse: mandar?');
  workflow.connections['Repasse: mandar?'] = { main: [[{ node: 'Repasse: avisar a dona', type: 'main', index: 0 }], [{ node: 'Repasse: guardar até', type: 'main', index: 0 }]] };
  liga('Repasse: avisar a dona', 'Repasse: memória da assistente');
  liga('Repasse: memória da assistente', 'Repasse: guardar até');
  return ativa;
};

module.exports.repasseDaPausada = repasseDaPausada;
