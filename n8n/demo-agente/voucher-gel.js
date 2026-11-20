// Voucher da esmaltação em gel (só nas lojas com "voucher_gel": true no loja.json; a Gleide não passa por aqui).
// Pedido do Victor (20/11/2026, Caroline): quem faz ESMALTAÇÃO EM GEL ganha, depois do atendimento, um voucher
// (código) de R$ 20 no PRÓXIMO SERVIÇO, válido por 30 dias. Quem gera o código é o banco (supabase/057_voucher_gel.sql,
// quando o horário vira "realizado"; ligar em empresas.config.loja.voucher_gel.ativo). Aqui:
//   1. "IA - Faltas e avisos": ramo novo no mesmo gatilho de 5 min (8h às 20h). Lê n8n_vouchers_para_mandar, monta a
//      mensagem do jeito da Caroline, manda pelo número do salão (uma de cada vez, como o lembrete) e, se o WhatsApp
//      aceitou, grava com n8n_voucher_enviado. Não aceitou: fica para a próxima rodada (até 48 h).
//      A trava de teste (lojas.travarEnvios) entra sozinha no envio, porque este workflow já está na lista dela.
//   2. IA de atendimento: um nó novo logo antes de "Sobre esta cliente" lê n8n_vouchers_da_cliente (1 item só), e a
//      ficha ganha a linha "VOUCHER: código X, R$ 20 no próximo serviço, vale até dd/mm (não usado)".
//      Nó novo em vez de mexer na leitura da ficha (clientes_status, que a Gleide também usa); erro nele só tira a linha.

const crypto = require('crypto');

const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;

// mensagem curta, sem enfeite, emoji só 🙏 (jeito da Caroline)
const MENSAGEM = String.raw`
const primeiro = (n) => { const p = String(n || '').trim().split(/\s+/)[0] || ''; return /^\p{L}[\p{L}'-]*$/u.test(p) ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''; };
const ddmm = (d) => { const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] : ''; };
const reais = (v) => 'R$ ' + Number(v || 20).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
return $input.all().map((i) => i.json).filter((v) => v.voucher_id && v.codigo && v.telefone).map((v) => {
  const nome = primeiro(v.nome);
  const ate = ddmm(v.valido_ate);
  const texto = 'Oi' + (nome ? ' ' + nome : '') + ', obrigada pela visita 🙏 Você ganhou um voucher de ' + reais(v.valor) +
    ' pro seu próximo serviço aqui, é só mostrar o código ' + v.codigo + '.' + (ate ? ' Vale até ' + ate + '.' : '');
  return { json: { ...v, texto } };
});
`;

module.exports = ({ faltasWorkflow: wf, workflow: W, loja }) => {
  if (!loja || !loja.empresa_id) throw new Error('voucher_gel: a loja precisa de "empresa_id" no loja.json');
  // id fixo pelo nome do nó (e não o contador do node() do montar-workflow.js): ligar este módulo não muda o id dos
  // nós que outros módulos criam depois dele
  const node = (name, type, typeVersion, position, parameters, extra = {}) => {
    const h = crypto.createHash('md5').update(`voucher-gel:${name}`).digest('hex');
    return { id: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`, name, type, typeVersion, position, parameters, ...extra };
  };
  const achar = (w, nome) => { const n = w.nodes.find((x) => x.name === nome); if (!n) throw new Error(`voucher_gel: não achei "${nome}" em ${w.name}`); return n; };
  const supaHeaders = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const rpc = (name, position, funcao, args, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: `={{ $env.SUPABASE_URL }}/rest/v1/rpc/${funcao}`,
    sendHeaders: true, headerParameters: supaHeaders, sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${args}) }}`,
    options: { timeout: 15000 },
  }, { onError: 'continueRegularOutput', ...extra });

  // ---------- 1. Mandar o voucher (IA - Faltas e avisos) ----------
  // o ramo do lembrete é o modelo (mesmo jeito de ler, mandar, conferir e gravar)
  for (const nome of ['Lembretes para mandar', 'Lembrar a cliente', 'Lembrou?', 'Registrar lembrete']) achar(wf, nome);
  const lembrar = achar(wf, 'Lembrar a cliente');
  if (!/\/message\/sendText\//.test(lembrar.parameters.url || '')) throw new Error('voucher_gel: "Lembrar a cliente" mudou (não é mais sendText)');
  for (const nome of ['Vouchers para mandar', 'Mensagem do voucher', 'Mandar o voucher', 'Mandou o voucher?', 'Registrar voucher'])
    if (wf.nodes.some((x) => x.name === nome)) throw new Error(`voucher_gel: "${nome}" já existe (módulo ligado 2 vezes?)`);
  const [lx, ly] = achar(wf, 'Lembretes para mandar').position;
  const y = ly - 220;
  const lerVouchers = rpc('Vouchers para mandar', [lx, y], 'n8n_vouchers_para_mandar', '{ p_empresa_id: $env.EMPRESA_ID }');
  const mensagem = node('Mensagem do voucher', 'n8n-nodes-base.code', 2, [lx + 220, y], { jsCode: MENSAGEM });
  // mesmo envio do lembrete: uma cliente de cada vez, espaçadas
  const mandar = node('Mandar o voucher', 'n8n-nodes-base.httpRequest', 4.2, [lx + 440, y], {
    method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
    sendBody: true, specifyBody: 'json',
    jsonBody: '={{ JSON.stringify({ number: $json.telefone, text: $json.texto, delay: 2000 + Math.floor(Math.random() * 2000) }) }}',
    options: { batching: { batch: { batchSize: 1, batchInterval: 8000 } } },
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' });
  // só grava se o WhatsApp aceitou (senão tenta de novo daqui a 5 min)
  const mandou = node('Mandou o voucher?', 'n8n-nodes-base.if', 2.2, [lx + 660, y], {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'vg1', leftValue: '={{ !!$json.key?.id }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and' },
    options: {},
  });
  const registrar = rpc('Registrar voucher', [lx + 880, y], 'n8n_voucher_enviado',
    "{ p_empresa_id: $env.EMPRESA_ID, p_voucher_id: $('Mensagem do voucher').item.json.voucher_id, p_mensagem: $('Mensagem do voucher').item.json.texto, p_wa_message_id: $json.key.id }");
  wf.nodes.push(lerVouchers, mensagem, mandar, mandou, registrar);
  const liga = (de, para) => { wf.connections[de] = { main: [[{ node: para, type: 'main', index: 0 }]] }; };
  liga('Vouchers para mandar', 'Mensagem do voucher');
  liga('Mensagem do voucher', 'Mandar o voucher');
  liga('Mandar o voucher', 'Mandou o voucher?');
  liga('Mandou o voucher?', 'Registrar voucher');
  // começa junto com os outros ramos: no gatilho de 5 min (depois do "Horário do salão?") e no disparo de teste.
  // As duas saídas podem ser a mesma lista (INICIOS em faltas-workflows.js): acrescenta uma vez só.
  let ligados = 0;
  for (const inicio of ['Horário do salão?', 'Disparar agora (teste)']) {
    const saida = wf.connections[inicio]?.main?.[0];
    if (!saida || !saida.some((l) => l.node === 'Lembretes para mandar')) throw new Error(`voucher_gel: "${inicio}" não começa mais o lembrete`);
    if (!saida.some((l) => l.node === 'Vouchers para mandar')) saida.push({ node: 'Vouchers para mandar', type: 'main', index: 0 });
    ligados++;
  }
  if (ligados !== 2) throw new Error('voucher_gel: não liguei o ramo nos dois começos');

  // ---------- 2. A IA de atendimento vê o voucher na ficha ----------
  const sobre = achar(W, 'Sobre esta cliente');
  achar(W, 'Montar entrada');
  const antes = Object.entries(W.connections).filter(([, c]) => (c.main || []).some((s) => (s || []).some((l) => l.node === 'Sobre esta cliente')));
  if (antes.length !== 1) throw new Error(`voucher_gel: esperava 1 nó antes de "Sobre esta cliente", achei ${antes.length}`);
  const ler = rpc('Supabase: voucher da cliente', [sobre.position[0] - 220, sobre.position[1] + 200], 'n8n_vouchers_da_cliente',
    `{ p_empresa_id: $env.EMPRESA_ID, p_telefone: ${TEL_BR("$('Montar entrada').first().json.telefone")} }`,
    { alwaysOutputData: true, executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 });
  W.nodes.push(ler);
  for (const s of antes[0][1].main) for (const l of s || []) if (l.node === 'Sobre esta cliente') l.node = ler.name;
  W.connections[ler.name] = { main: [[{ node: 'Sobre esta cliente', type: 'main', index: 0 }]] };

  const de = "const faltas = hist.filter((a) => a.status === 'faltou').length;";
  if (sobre.parameters.jsCode.split(de).length !== 2) throw new Error('voucher_gel: o código de "Sobre esta cliente" mudou (faltas)');
  sobre.parameters.jsCode = sobre.parameters.jsCode.replace(de, () => [
    '// voucher-gel.js: voucher da esmaltação em gel que ainda vale (supabase/057); erro na leitura só tira a linha',
    "const VOUCHERS = (() => { try { return [].concat($('Supabase: voucher da cliente').first().json.vouchers || []); } catch (e) { return []; } })();",
    'for (const v of VOUCHERS) {',
    '  if (!v || !v.codigo) continue;',
    "  const ate = String(v.valido_ate || '').match(/^(\\d{4})-(\\d{2})-(\\d{2})/);",
    "  linhas.push('VOUCHER: código ' + v.codigo + ', R$ ' + Number(v.valor || 20).toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' no próximo serviço' +",
    "    (ate ? ', vale até ' + ate[3] + '/' + ate[2] : '') + ' (não usado' + (v.enviado ? '' : '; a mensagem com o código ainda não saiu para ela') + ')');",
    '}',
    de,
  ].join('\n'));
};
