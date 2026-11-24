// A cliente diz que não vem a um horário marcado -> aviso à dona NA HORA, sem depender da IA (só nas lojas com
// "aviso_nao_vem": true no loja.json; a Gleide não passa por aqui).
//
// Por quê (24/11/2026): "o que eu mais preciso tomar cuidado é a assistente, ela precisa avisar se o cliente faltou"
// (Victor). Caso da Rebeca (23/11): "amanhã eu não vou poder, tô sem condução" e a Caroline não ficou sabendo. O prompt
// já manda a IA avisar (perguntar_para_gleide "AVISO…"), mas isso depende do Gemini lembrar.
//
// Como funciona: cada mensagem da cliente, logo depois de registrada, vai para n8n_cliente_nao_vem (supabase/078), que
// reconhece o jeito de dizer que não vem ("não vou poder", "imprevisto", "desmarcar", "sem condução"…), acha o próximo
// horário marcado dela (até 10 dias) e responde se avisa (uma vez por horário a cada 12 h). Avisando:
//   - a dona recebe "⚠️ Fulana tem horário amanhã às 14h e escreveu: …" pelo número do salão;
//   - o aviso entra na memória da assistente (a resposta da dona, "libera", é entendida);
//   - fica um pedido AVISO aberto por 6 h: quando a IA também chamar perguntar_para_gleide com AVISO sobre ela, o
//     "Perguntar para a dona" não manda de novo (pedido-numerado.js);
//   - cópia ao Victor, nas lojas com "copia_victor".
// Ramo à parte depois de "Supabase: registrar entrada", como o confirmou-presenca.js: a IA continua respondendo a
// cliente como sempre, e erro aqui não segura nada.

module.exports = ({ node, workflow: W, loja, REDIS }) => {
  const achar = (nome) => { const n = W.nodes.find((x) => x.name === nome); if (!n) throw new Error('nao-vem: sem o nó ' + nome); return n; };
  achar('Supabase: registrar entrada');
  achar('Texto da mensagem');
  achar('Extrair dados');
  if (!loja || !loja.empresa_id || !loja.dona) throw new Error('nao-vem: loja sem empresa_id ou dona');
  const saida = W.connections['Supabase: registrar entrada']?.main?.[0];
  if (!saida || !saida.length) throw new Error('nao-vem: "Supabase: registrar entrada" sem saída');
  const [fx, fy] = achar(saida[0].node).position;
  const x = fx - 300, y = fy - 640;
  const DONA = String(loja.dona).trim().split(/\s+/)[0];
  const supa = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const evo = { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] };
  const enviar = (nome, pos, corpo, extra = {}) => node(nome, 'n8n-nodes-base.httpRequest', 4.2, pos, {
    method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
    sendHeaders: true, headerParameters: evo, sendBody: true, specifyBody: 'json', jsonBody: corpo, options: {},
  }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, onError: 'continueRegularOutput', ...extra });

  const MENSAGEM = String.raw`
// nao-vem.js: o aviso que a dona recebe. Não diz o que fazer com o horário: ela decide ("libera", "remarca").
const r = $input.first().json;
const TZ = 'America/Cuiaba';
const ini = DateTime.fromISO(String(r.inicio)).setZone(TZ);
const hoje = DateTime.now().setZone(TZ).startOf('day');
const dias = Math.round(ini.startOf('day').diff(hoje, 'days').days);
const hora = ini.minute ? ini.toFormat("H'h'mm") : ini.toFormat("H'h'");
const quando = (dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : ini.setLocale('pt-BR').toFormat("cccc, dd/LL")) + ' às ' + hora;
const partes = String(r.nome || 'A cliente').trim().split(/\s+/);
const nome = partes.slice(0, /^(d[aeo]s?|e)$/i.test(partes[1] || '') ? 3 : 2).join(' ');
// "com a Duda" só quando é de outra profissional (a dona não precisa ler "com a Caroline" sobre ela mesma)
const prof = r.profissional && !new RegExp('^' + ${JSON.stringify(DONA)}, 'i').test(String(r.profissional).trim()) ? ' com a ' + String(r.profissional).trim().split(/\s+/)[0] : '';
const fala = String(r.texto || '').replace(/^\[áudio\]\s*/i, '').replace(/\s+/g, ' ').trim();
const trecho = fala.length > 220 ? fala.slice(0, 217).trim() + '…' : fala;
const texto = '⚠️ *' + nome + '* tem horário ' + quando + prof + (r.servico ? ' (' + String(r.servico).toLowerCase() + ')' : '') +
  ' e escreveu:' + String.fromCharCode(10) + '"' + trecho + '"' + String.fromCharCode(10, 10) +
  'A IA continua a conversa com ela. Se quiser liberar o horário, me fala.';
const numeros = ($env.ASSISTENTE_NUMEROS || '').split(',').map((s) => s.trim()).filter(Boolean);
// pedido AVISO aberto (pedido-numerado.js): o AVISO da IA sobre o mesmo assunto não sai repetido
const pedido = JSON.stringify({ telefone: ${'$'}('Extrair dados').first().json.telefone, jid: ${'$'}('Extrair dados').first().json.jid || null,
  nome: r.nome || null, pergunta: 'AVISO, não precisa responder: ' + nome + ' não vem ' + quando + ' (' + trecho + ')',
  tipo: 'pergunta', empresa: ${JSON.stringify(loja.empresa_id)}, num: null, criado: Date.now() });
return numeros.map((tel) => ({ json: { tel, texto, agendamento_id: r.agendamento_id, pedido,
  memoria: JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } }) } }));
`;

  W.nodes.push(
    node('Não vem: avisar?', 'n8n-nodes-base.httpRequest', 4.2, [x, y], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_cliente_nao_vem',
      sendHeaders: true, headerParameters: supa, sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ p_empresa_id: '${loja.empresa_id}', p_cliente_id: $('Supabase: registrar entrada').first().json.cliente_id || null, p_texto: String($('Texto da mensagem').first().json.texto || '') }) }}`,
      options: { timeout: 5000 },
    }, { onError: 'continueRegularOutput' }),
    node('Não vem: tem aviso?', 'n8n-nodes-base.if', 2.2, [x + 220, y], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'nv1', leftValue: '={{ $json.avisar === true }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and' },
      options: {},
    }),
    node('Não vem: mensagem', 'n8n-nodes-base.code', 2, [x + 440, y], { jsCode: MENSAGEM }),
    enviar('Não vem: avisar a dona', [x + 660, y], '={{ JSON.stringify({ number: $json.tel, text: $json.texto }) }}'),
    node('Não vem: memória da assistente', 'n8n-nodes-base.redis', 1, [x + 880, y], {
      operation: 'push', list: "=assistente:{{ $('Não vem: mensagem').item.json.tel }}",
      messageData: "={{ $('Não vem: mensagem').item.json.memoria }}", tail: false,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('Não vem: segurar o AVISO da IA', 'n8n-nodes-base.redis', 1, [x + 660, y + 180], {
      // "=pedido:{{" para o paraLoja pôr o prefixo da loja (carol:pedido:…), que é onde o "Perguntar para a dona" procura
      operation: 'set', key: "=pedido:{{ 'naovem-' + $json.agendamento_id }}", value: '={{ $json.pedido }}', expire: true, ttl: 21600,
    }, { credentials: REDIS, onError: 'continueRegularOutput', executeOnce: true }),
  );
  const liga = (de, ...para) => { W.connections[de] = { main: [para.map((p) => ({ node: p, type: 'main', index: 0 }))] }; };
  saida.push({ node: 'Não vem: avisar?', type: 'main', index: 0 });
  liga('Não vem: avisar?', 'Não vem: tem aviso?');
  W.connections['Não vem: tem aviso?'] = { main: [[{ node: 'Não vem: mensagem', type: 'main', index: 0 }], []] };
  const depois = ['Não vem: segurar o AVISO da IA', 'Não vem: avisar a dona'];
  if (loja.copia_victor) {
    if (!/^\d{12,13}$/.test(String(loja.copia_victor))) throw new Error('nao-vem: copia_victor inválido');
    W.nodes.push(enviar('Não vem: cópia ao Victor', [x + 660, y - 180],
      `={{ JSON.stringify({ number: '${loja.copia_victor}', text: '👀 Cópia: ' + $json.texto }) }}`, { executeOnce: true }));
    depois.push('Não vem: cópia ao Victor');
  }
  liga('Não vem: mensagem', ...depois);
  liga('Não vem: avisar a dona', 'Não vem: memória da assistente');
};
