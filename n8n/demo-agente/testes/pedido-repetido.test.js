// Testes do pedido repetido (pedido-repetido.js). Rodar: node --test n8n/demo-agente/testes/*.test.js
// Os nós são os gerados de verdade (pasta temporária, sem enviar nada).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { pedidoRepetido } = require('../pedido-repetido.js');

const E = 'emp-1';
const AGORA = Date.parse('2026-11-22T16:40:00Z');
const min = (n) => AGORA - n * 60000;
const aberto = (pergunta, extra = {}) => JSON.stringify({ telefone: '556699991390', jid: 'x', nome: 'Rafaela', pergunta, tipo: 'orcamento_cabelo', empresa: E, em: min(1), ...extra });
const novo = (pergunta, extra = {}) => ({ telefone: '556699991390', nome: 'Rafaela', pergunta, tipo: 'orcamento_cabelo', ...extra });
const rep = (abertos, n) => pedidoRepetido(abertos, n, E, AGORA, 10);
const VIRGEM = '2 telas, 65 cm, cabelo humano virgem (para a cliente pintar).';

test('o caso real de 22/11: o mesmo orçamento pedido de novo 1 minuto depois é repetido', () => {
  const abertos = { 'pedido:A': aberto('2 telas, 65 cm, loiro claríssimo acinzentado, cabelo humano.', { em: min(20) }), 'pedido:B': aberto(VIRGEM) };
  const r = rep(abertos, novo('2 telas, 65 cm, cabelo virgem (para cliente pintar).'));
  assert.ok(r);
  assert.strictEqual(r.pergunta, VIRGEM);
  // igual, com maiúscula, pontuação, ordem e número colado diferentes; e a mesma cliente com e sem o 9
  assert.ok(rep({ a: aberto('250 g, 70 cm, vietnamita, castanho escuro, liso') }, novo('250g 70cm Vietnamita liso castanho-escuro.')));
  assert.ok(rep({ a: aberto(VIRGEM, { telefone: '5566999991390' }) }, novo(VIRGEM)));
  // pergunta igual
  const p = { a: JSON.stringify({ telefone: '5566999991390', pergunta: 'Pode levar cachorro de porte grande na avaliação?', tipo: 'pergunta', empresa: E, em: min(2) }) };
  assert.ok(rep(p, { telefone: '5566999991390', pergunta: 'Pode levar cachorro de porte grande na avaliação', tipo: 'pergunta' }));
});

test('só vale para o pedido que acabou de ir: mais de 10 minutos, sem hora ou envio que falhou passam', () => {
  assert.strictEqual(rep({ a: aberto(VIRGEM, { em: min(11) }) }, novo(VIRGEM)), null);
  assert.strictEqual(rep({ a: aberto(VIRGEM, { em: undefined }) }, novo(VIRGEM)), null, 'pedido antigo, guardado sem a hora');
  assert.strictEqual(rep({ 'pedido:falhou': aberto(VIRGEM) }, novo(VIRGEM)), null, 'o envio falhou: a dona não recebeu');
  assert.ok(rep({ a: aberto(VIRGEM, { em: min(9) }) }, novo(VIRGEM)));
});

test('pedido com informação nova, correção ou outra cliente continua indo para a dona', () => {
  const base = '250 g, 70 cm, vietnamita, castanho escuro, liso';
  const passa = (antes, depois, extra) => assert.strictEqual(rep({ a: aberto(antes) }, novo(depois, extra)), null, antes + ' → ' + depois);
  // outro cabelo com as mesmas medidas (a cliente quer os dois valores)
  passa('2 telas, 65 cm, loiro claríssimo acinzentado, cabelo humano.', VIRGEM);
  // palavra nova: outro tipo, outra cor, um detalhe a mais, a resposta ao que a Gleide perguntou
  passa(base, '250 g, 70 cm, indiano, castanho escuro, liso');
  passa('250 g, 70 cm, castanho escuro', '250 g, 70 cm, loiro');
  passa('topo, castanho escuro', 'topo, castanho escuro, liso');
  passa('topo, castanho escuro, para volume no alto da cabeça', 'topo, castanho escuro, para volume no alto da cabeça; comprimento: 30 cm');
  // números: outro valor, trocados de lugar, um a menos
  passa(base, '200 g, 70 cm, vietnamita, castanho escuro, liso');
  passa('100 g, 70 cm, loiro', '70 g, 100 cm, loiro');
  passa('2 telas 65 cm e 2 telas 70 cm loiro', '2 telas 65 cm e 70 cm loiro');
  // correção, inclusive a que volta atrás e a que vem no contexto
  passa('100 g, 60 cm, vietnamita, castanho escuro', 'CORREÇÃO do pedido anterior (desconsiderar 60 cm): 100 g, 70 cm, vietnamita, castanho escuro');
  passa('CORREÇÃO do pedido anterior (desconsiderar 60 cm): 100 g, 70 cm, vietnamita, castanho escuro', 'CORREÇÃO do pedido anterior (desconsiderar 70 cm): 100 g, 60 cm, vietnamita, castanho escuro');
  passa(base, base, { contexto: 'Substitui solicitação anterior' });
  // tirar mais do que um detalhe muda o pedido
  passa('topo e rabo de cavalo, castanho escuro', 'topo, castanho escuro');
  passa('250 g, 70 cm, loiro claríssimo acinzentado', '250 g, 70 cm, loiro');
  // palavras que mudam o sentido
  passa('250 g, 70 cm, castanho, sem química', '250 g, 70 cm, castanho, com química');
  passa('2 telas, 65 cm, loiro, quer franja', '2 telas, 65 cm, loiro, não quer franja');
  // outro tipo, outra cliente, outra empresa, sem empresa
  passa(VIRGEM, VIRGEM, { tipo: 'pergunta' });
  passa(VIRGEM, VIRGEM, { telefone: '556699990000' });
  assert.strictEqual(rep({ a: aberto(VIRGEM, { empresa: 'outra' }) }, novo(VIRGEM)), null);
  assert.strictEqual(pedidoRepetido({ a: aberto(VIRGEM) }, novo(VIRGEM), '', AGORA, 10), null);
});

test('lixo no Redis não quebra e nunca vira repetido', () => {
  for (const abertos of [null, undefined, {}, { a: 'não é json' }, { a: '{}' }, { a: null }, { a: 12 }, [], { error: 'redis fora' }]) assert.strictEqual(rep(abertos, novo(VIRGEM)), null);
  assert.strictEqual(rep({ a: aberto(VIRGEM) }, null), null);
  assert.strictEqual(rep({ a: aberto(VIRGEM) }, novo('')), null);
  assert.strictEqual(rep({ a: aberto(VIRGEM) }, novo(VIRGEM, { telefone: '' })), null);
});

// ---------- fluxo gerado ----------
const origem = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pedido-repetido-teste-'));
for (const f of fs.readdirSync(origem)) {
  if (/\.(js|md|json|txt)$/.test(f) && !/^workflow-/.test(f) && fs.statSync(path.join(origem, f)).isFile()) fs.copyFileSync(path.join(origem, f), path.join(tmp, f));
}
fs.writeFileSync(path.join(tmp, '.env'), '');
execFileSync(process.execPath, ['montar-workflow.js'], { cwd: tmp, stdio: 'pipe' });
const P = JSON.parse(fs.readFileSync(path.join(tmp, 'workflow-pergunta.json'), 'utf8'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const no = (nome) => { const n = P.nodes.find((x) => x.name === nome); assert.ok(n, 'falta o nó ' + nome); return n; };

test('fluxo: confere antes de enviar; repetido não chega no envio nem na memória da assistente', () => {
  const prox = (de, saida = 0) => P.connections[de]?.main?.[saida]?.[0]?.node;
  assert.strictEqual(prox('Recebe pergunta da IA'), 'Repetido: pedidos abertos');
  assert.strictEqual(prox('Repetido: pedidos abertos'), 'Repetido: conferir');
  assert.strictEqual(prox('Repetido: conferir'), 'Repetido?');
  assert.strictEqual(prox('Repetido?', 0), 'Resposta (já pedido)');
  assert.strictEqual(prox('Repetido?', 1), 'Supabase: número de alerta');
  assert.strictEqual(prox('Supabase: número de alerta'), 'Enviar pergunta à Gleide');
  assert.strictEqual(prox('Resposta (já pedido)'), undefined, 'o repetido termina na resposta');
  assert.match(no('Resposta (já pedido)').parameters.assignments.assignments[0].value, /JÁ PEDIDO/);
  // o pedido guardado leva a hora do envio
  assert.ok(no('Guardar pedido').parameters.value.includes('empresa: $env.EMPRESA_ID, em: Date.now() })'));
  // o código do nó, rodado como o n8n roda (a hora é a de agora)
  const rodar = (abertos, entrada) => new Function('$', '$env', no('Repetido: conferir').parameters.jsCode)(
    (nome) => ({ first: () => ({ json: nome === 'Repetido: pedidos abertos' ? abertos : entrada }) }), { EMPRESA_ID: E })[0].json;
  const agorinha = (pergunta) => JSON.stringify({ telefone: '556699991390', pergunta, tipo: 'orcamento_cabelo', empresa: E, em: Date.now() - 60000 });
  assert.deepStrictEqual(rodar({ 'pedido:B': agorinha(VIRGEM) }, novo('2 telas, 65 cm, cabelo virgem (para cliente pintar).')), { repetido: true, anterior: VIRGEM });
  assert.deepStrictEqual(rodar({ 'pedido:falhou': agorinha(VIRGEM) }, novo(VIRGEM)), { repetido: false, anterior: null });
  assert.deepStrictEqual(rodar({}, novo(VIRGEM)), { repetido: false, anterior: null });
  // leitura do Redis com erro: segue e envia
  assert.deepStrictEqual(rodar({ error: 'redis fora' }, novo(VIRGEM)), { repetido: false, anterior: null });
});
