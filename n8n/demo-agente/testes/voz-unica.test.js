// Uma voz só com a cliente (voz-unica.js, 25/11/2026): roda o código gerado para a Caroline com os casos reais.
// Precisa do luxon (NODE_PATH). Rodar: node --test testes/
const test = require('node:test');
const assert = require('node:assert');
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('voz única (sem o luxon)', { skip: 'sem o luxon' }, () => {}); return; }

const F = require('../lojas/carol/workflow-assistente-ferramentas.json');
const A = require('../lojas/carol/workflow-assistente.json');
const no = (nome) => { const n = F.nodes.find((x) => x.name === nome); if (!n) throw new Error('sem o nó ' + nome); return n; };
const itens = (lista) => ({ first: () => ({ json: lista[0] || {} }), all: () => lista.map((json) => ({ json })) });
const rodar = (nome, dados, entrada) => new Function('$', '$input', 'DateTime', no(nome).parameters.jsCode)((n) => itens(dados[n] || []), itens(entrada || []), DateTime)[0].json;
const ISO = (dias, h, m = 0) => DateTime.now().setZone('America/Cuiaba').minus({ days: dias }).set({ hour: h, minute: m }).toUTC().toISO();

const GABRIELA = [
  { autor: 'cliente', conteudo: 'Eu tenho uma confra 12h no sábado', criado_em: ISO(0, 9, 36) },
  { autor: 'ia', conteudo: 'Poxa, verdade! A confra é importante 😍', criado_em: ISO(0, 9, 37) },
].reverse();

test('chamar_cliente: a IA recebe o pedido, a conversa e o jeito da Caroline (seção 11 do prompt dela)', () => {
  const r = rodar('Voz: preparar', {
    'Recebe pedido da assistente': [{ acao: 'chamar_cliente' }],
    'Montar chamada': [{ args: { p_cliente_id: 'c-gab', p_texto: 'Oferecer sexta às 13h ou 13h30' } }],
    'Voz: quem é': [{ id: 'c-gab', nome: 'Gabriela Marçal' }],
    'Voz: conversa': GABRIELA,
  });
  assert.strictEqual(r.pular, false);
  assert.match(r.instrucao, /PEDIDO DA CAROLINE[\s\S]*Oferecer sexta às 13h ou 13h30/);
  assert.match(r.instrucao, /ela: Eu tenho uma confra 12h no sábado/);
  assert.match(r.instrucao, /Tabom/, 'o tom vem do prompt da IA de atendimento');
  assert.match(r.instrucao, /A conversa de hoje já começou: sem cumprimento/);
  assert.match(r.instrucao, /CONFERIR/);
  assert.doesNotMatch(r.instrucao, /formal/i);
});

test('avisar_cliente remarcação sem texto: o pedido sai do horário, com motivo pessoal', () => {
  const r = rodar('Voz: preparar', {
    'Recebe pedido da assistente': [{ acao: 'avisar_cliente' }],
    'Montar chamada': [{ args: { p_agendamento_id: 'a-gab', p_tipo: 'remarcacao', p_texto: null } }],
    'Voz: quem é': [{ inicio: '2026-11-28T18:00:00+00:00', status: 'agendado', observacoes: '', cliente: { id: 'c-gab', nome: 'Gabriela Marçal' } }],
    'Voz: conversa': [],
  });
  assert.match(r.pedido, /a Caroline não vai conseguir atender sábado, 28\/11 às 14h por um motivo pessoal/);
  assert.match(r.instrucao, /Comece com o cumprimento/);
});

test('aviso sem texto e sem "Reagendado de": não escreve (o banco pede o texto, como antes)', () => {
  const r = rodar('Voz: preparar', {
    'Recebe pedido da assistente': [{ acao: 'avisar_cliente' }],
    'Montar chamada': [{ args: { p_agendamento_id: 'a', p_tipo: 'aviso', p_texto: null } }],
    'Voz: quem é': [{ inicio: '2026-11-28T18:00:00+00:00', observacoes: '' }],
  });
  assert.strictEqual(r.pular, true);
});

const gemini = (texto) => [{ candidates: [{ content: { parts: [{ text: texto }] } }] }];
const PRONTA = { 'Montar chamada': [{ args: { p_cliente_id: 'c', p_texto: 'Oferecer sexta às 13h ou 13h30' } }] };

test('a mensagem que a IA escreveu vai para o banco e para a cliente no lugar do pedido', () => {
  const r = rodar('Voz: pronta', PRONTA, gemini('"Oi Gabriela, pra sexta a Caroline tem 13h ou 13h30. Algum serve pra você?"'));
  assert.strictEqual(r.args.p_texto, 'Oi Gabriela, pra sexta a Caroline tem 13h ou 13h30. Algum serve pra você?');
  assert.ok(!r.bloqueio);
});

test('CONFERIR: nada sai e a assistente conta à Caroline o que a cliente disse', () => {
  const r = rodar('Voz: pronta', PRONTA, gemini('CONFERIR: ela avisou que não pode sábado por causa de uma confraternização.'));
  assert.match(r.bloqueio, /^NÃO ENVIADO \(nada chegou à cliente\): a conversa com ela muda o pedido: ela avisou que não pode sábado/);
});

test('Gemini sem resposta: segue o texto da assistente (as travas do envio continuam)', () => {
  const r = rodar('Voz: pronta', PRONTA, [{ error: { message: '503' } }]);
  assert.strictEqual(r.args.p_texto, 'Oferecer sexta às 13h ou 13h30');
});

test('fluxo: o banco grava o texto da IA, a resposta traz o CONFERIR, e o que saiu entra na memória da IA', () => {
  assert.match(no('Executar no banco').parameters.jsonBody, /\$\('Voz: pronta'\)\.isExecuted/);
  const resp = no('Resposta').parameters.assignments.assignments.find((x) => x.name === 'resposta').value;
  assert.match(resp, /^=\{\{ \(\(\) => \{ try \{ if \(\$\('Voz: pronta'\)\.isExecuted && \$\('Voz: pronta'\)\.first\(\)\.json\.bloqueio\)/);
  const liga = (de) => (F.connections[de]?.main || []).map((s) => (s || []).map((l) => l.node));
  assert.deepStrictEqual(liga('Precisa da Google?')[1], ['Voz: escrever?']);
  assert.deepStrictEqual(liga('Google: eventos do dia')[0], ['Voz: escrever?']);
  assert.deepStrictEqual(liga('Voz: escrever?'), [['Voz: quem é'], ['Executar no banco']]);
  assert.deepStrictEqual(liga('Registrar na conversa')[0], ['Voz: memória da cliente']);
  assert.deepStrictEqual(liga('Voz: guardar na memória da IA')[0], ['Resposta']);
  assert.match(no('Voz: guardar na memória da IA').parameters.list, /'carol:memoria:'/);
});

test('ferramentas: o texto é o pedido, e ditado = sim manda as palavras dela sem reescrever', () => {
  for (const n of ['chamar_cliente', 'avisar_cliente']) {
    const v = A.nodes.find((x) => x.name === n).parameters.workflowInputs.value;
    assert.match(v.texto, /PEDIDO da Caroline/);
    assert.match(v.ditado, /\$fromAI\('ditado'/);
  }
  assert.match(no('Voz: escrever?').parameters.conditions.conditions[0].leftValue, /ditado/);
});

test('endereço, Pix e horário que já passou não passam pela escrita', () => {
  const base = { 'Recebe pedido da assistente': [{ acao: 'chamar_cliente' }], 'Voz: quem é': [{ id: 'c', nome: 'Ana' }], 'Voz: conversa': [] };
  for (const p of ['Rua dos Angicos, 690, Jardim Imperial\nhttps://maps.app.goo.gl/x', 'A chave Pix é 66999999999'])
    assert.strictEqual(rodar('Voz: preparar', { ...base, 'Montar chamada': [{ args: { p_cliente_id: 'c', p_texto: p } }] }).pular, true, p);
  const passado = rodar('Voz: preparar', { 'Recebe pedido da assistente': [{ acao: 'avisar_cliente' }], 'Montar chamada': [{ args: { p_agendamento_id: 'a', p_tipo: 'remarcacao', p_texto: null } }],
    'Voz: quem é': [{ inicio: '2026-01-02T12:00:00+00:00', status: 'agendado', cliente: { id: 'c', nome: 'Ana' } }] });
  assert.strictEqual(passado.pular, true);
});
