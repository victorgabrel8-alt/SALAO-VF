// Testes do repasse da cliente que a IA passou para a dona (repasse-pausada.js). Rodar: node --test n8n/demo-agente/testes/*.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { repasseDaPausada: r } = require('../repasse-pausada.js');

const AGORA = Date.parse('2026-11-24T23:17:00Z');
const CLI = { id: 'id-1', nome: 'joana souza', telefone: '5566999990011', motivo_pausa: 'pediu_humano', ia_pausada_ate: '2026-11-25T09:21:00Z' };
const MS = [
  { direcao: 'entrada', conteudo: 'Vou pagar no Pix, achei muito juros na máquina', criado_em: '2026-11-24T23:16:30Z' },
  { direcao: 'entrada', conteudo: 'Oi', criado_em: '2026-11-24T23:16:10Z' },
  { direcao: 'saida', conteudo: 'Oi, Joana! A Gleide gerou o link de pagamento', criado_em: '2026-11-24T22:58:00Z' },
  { direcao: 'entrada', conteudo: 'Ta bom obrigada', criado_em: '2026-11-24T21:21:30Z' },
];
const base = (extra = {}) => ({ cliente: CLI, mensagens: MS, agora: AGORA, numero: '556699990001', lista: '5566999990002,5566999990001', ...extra });

test('a cliente que a IA passou para a dona escreveu: vai para a dona, sem o "oi", e com a chave da memória da assistente', () => {
  const x = r(base());
  assert.strictEqual(x.texto, '*Joana Souza* respondeu: «Vou pagar no Pix, achei muito juros na máquina»\nA IA continua sem responder ela. Fala direto com ela no (66) 99999-0011: https://wa.me/5566999990011');
  assert.strictEqual(x.numero, '556699990001');
  assert.strictEqual(x.chave, '5566999990001', 'alerta sem o 9: a chave é a da lista da assistente');
  assert.strictEqual(x.ate, '2026-11-24T23:16:30Z');
  const m = JSON.parse(x.memoria);
  assert.strictEqual(m.type, 'ai');
  assert.ok(m.data.content.startsWith('[ter 24/11 19:17] *Joana Souza* respondeu:'), m.data.content);
  assert.ok(m.data.content.endsWith('(cliente_id: id-1, telefone: 5566999990011, nome no cadastro: joana souza)'));
});

test('não repassa: pausa da própria dona, pausa vencida, já repassado, nada novo depois da resposta do salão', () => {
  for (const motivo of ['manual', 'dona_respondeu', null, 'fora_escopo']) assert.strictEqual(r(base({ cliente: { ...CLI, motivo_pausa: motivo } })), null, String(motivo));
  assert.strictEqual(r(base({ cliente: { ...CLI, ia_pausada_ate: '2026-11-24T20:00:00Z' } })), null);
  assert.strictEqual(r(base({ cliente: { ...CLI, ia_pausada_ate: null } })), null);
  assert.strictEqual(r(base({ ate: '2026-11-24T23:16:30Z' })), null);
  assert.strictEqual(r(base({ mensagens: [MS[2], MS[3]] })), null);
  assert.strictEqual(r(base({ cliente: {} })), null);
  assert.strictEqual(r(null), null);
  // só "oi" e "obrigada": não manda, mas guarda até onde viu
  assert.deepStrictEqual(r(base({ mensagens: [MS[1], MS[2]] })), { pular: true, ate: '2026-11-24T23:16:10Z' });
  // sem número da dona: não manda
  assert.strictEqual(r(base({ numero: '' })).pular, true);
});

test('rajada, mídia e reclamação', () => {
  const ms = [
    { direcao: 'entrada', conteudo: '[foto da cliente] Foto do comprovante', criado_em: '2026-11-24T23:16:50Z' },
    { direcao: 'entrada', conteudo: '[áudio] já fiz o pix', criado_em: '2026-11-24T23:16:40Z' },
    { direcao: 'entrada', conteudo: 'Paguei', criado_em: '2026-11-24T23:16:30Z' },
    { direcao: 'saida', conteudo: 'x', criado_em: '2026-11-24T22:58:00Z' },
  ];
  const x = r(base({ mensagens: ms, cliente: { ...CLI, motivo_pausa: 'reclamacao' } }));
  assert.match(x.texto, /^\*Joana Souza\* respondeu: «Paguei» «já fiz o pix» \(mandou uma foto\)\n/);
  assert.match(x.texto, /\nConversa dela no app: https:\/\/app\.oistudio\.com\.br\/conversas\/id-1$/);
  // celular gravado sem o 9 sai com o 9; telefone que não dá para discar fica sem link
  assert.match(r(base({ cliente: { ...CLI, telefone: '556699990011' } })).texto, /no \(66\) 99999-0011: https:\/\/wa\.me\/5566999990011$/);
  assert.match(r(base({ cliente: { ...CLI, telefone: '123456' } })).texto, /A IA continua sem responder ela\. Pode falar com ela pelo WhatsApp do salão\.$/);
  // só o que veio depois do último repasse
  assert.match(r(base({ mensagens: ms, ate: '2026-11-24T23:16:35Z' })).texto, /respondeu: «já fiz o pix» \(mandou uma foto\)/);
});

// ---------- fluxo gerado ----------
const origem = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repasse-teste-'));
for (const f of fs.readdirSync(origem)) {
  if (/\.(js|md|json|txt)$/.test(f) && !/^workflow-/.test(f) && fs.statSync(path.join(origem, f)).isFile()) fs.copyFileSync(path.join(origem, f), path.join(tmp, f));
}
fs.writeFileSync(path.join(tmp, '.env'), '');
execFileSync(process.execPath, ['montar-workflow.js'], { cwd: tmp, stdio: 'pipe' });
const W = JSON.parse(fs.readFileSync(path.join(tmp, 'workflow-demo-salao.json'), 'utf8'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('fluxo: com a IA parada, a mensagem vai para o repasse; com a IA ativa, segue como antes', () => {
  const s = W.connections['IA ativa?'].main;
  assert.strictEqual(s[0][0].node, 'Pausa: alinhar com o CRM');
  assert.strictEqual(s[1][0].node, 'Repasse: marcar última');
  const o = []; let at = 'Repasse: marcar última';
  while (at && !o.includes(at)) { o.push(at); at = W.connections[at]?.main?.[0]?.[0]?.node; }
  assert.deepStrictEqual(o, ['Repasse: marcar última', 'Repasse: esperar', 'Repasse: ler última', 'Repasse: é a última?', 'Repasse: cliente', 'Repasse: número da dona',
    'Repasse: mensagens', 'Repasse: até onde', 'Repasse: montar', 'Repasse: mandar?', 'Repasse: avisar a dona', 'Repasse: memória da assistente', 'Repasse: guardar até']);
  assert.strictEqual(W.connections['Repasse: mandar?'].main[1][0].node, 'Repasse: guardar até');
  for (const n of W.nodes.filter((x) => x.name.startsWith('Repasse: ') && /redis|httpRequest/.test(x.type))) assert.strictEqual(n.onError, 'continueRegularOutput', n.name);
  // o código do nó, como o n8n roda
  const code = W.nodes.find((x) => x.name === 'Repasse: montar').parameters.jsCode;
  const dados = { 'Repasse: cliente': [CLI], 'Repasse: mensagens': MS, 'Repasse: até onde': [{}], 'Repasse: número da dona': [{ alerta: '5566999990001' }] };
  const out = new Function('$', '$env', code)((n) => ({ first: () => ({ json: (dados[n] || [{}])[0] }), all: () => (dados[n] || []).map((json) => ({ json })) }), { ASSISTENTE_NUMEROS: '5566999990001' });
  assert.match(out[0].json.texto, /^\*Joana Souza\* respondeu: «Vou pagar no Pix/);
  assert.deepStrictEqual(new Function('$', '$env', code)(() => { throw new Error('x'); }, {}), []);
});
