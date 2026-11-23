// Segunda passada de fala: o que pode e o que não pode sair editado. Rodar: node --test testes/fala-editor.test.js
const test = require('node:test');
const assert = require('node:assert');
const { fatos, pedidoEditor, valeEditar, escolherFala } = require('../fala-editor.js');

const RASCUNHO = 'Entendo, ver o cabelo ralo incomoda bastante. A avaliação é gratuita e a Gleide te atende na terça às 14h, pode ser?';

test('só edita para quem está na lista (com ou sem o 9)', () => {
  const so_para = ['5566999270860'];
  assert.strictEqual(valeEditar({ rascunho: RASCUNHO, telefone: '5566999270860', so_para }), '');
  assert.strictEqual(valeEditar({ rascunho: RASCUNHO, telefone: '556699270860', so_para }), '');
  assert.strictEqual(valeEditar({ rascunho: RASCUNHO, telefone: '5566996551390', so_para }), 'fora da lista');
  assert.strictEqual(valeEditar({ rascunho: RASCUNHO, telefone: '5566999270860', so_para: [] }), 'fora da lista');
  assert.strictEqual(valeEditar({ rascunho: RASCUNHO, telefone: '', so_para: [''] }), 'fora da lista');
});

test('resposta curta, vazia ou com marca de sistema sai como veio', () => {
  const base = { telefone: '5566999270860', so_para: ['5566999270860'] };
  assert.strictEqual(valeEditar({ ...base, rascunho: '' }), 'curta');
  assert.strictEqual(valeEditar({ ...base, rascunho: 'Combinado, te espero!' }), 'curta');
  assert.strictEqual(valeEditar({ ...base, rascunho: '[[NAO_ENVIAR]] ' + RASCUNHO }), 'marca de sistema');
});

test('edição que só muda o jeito de falar passa', () => {
  const r = escolherFala(RASCUNHO, 'A avaliação é gratuita. A Gleide te atende na terça às 14h, pode ser?');
  assert.strictEqual(r.usou, 'editado');
  assert.ok(!/Entendo/.test(r.texto));
});

test('mexeu em horário, valor ou link: fica o rascunho', () => {
  assert.strictEqual(escolherFala(RASCUNHO, 'A avaliação é gratuita. A Gleide te atende na terça às 15h, pode ser?').usou, 'rascunho');
  assert.strictEqual(escolherFala('A manutenção é a partir de R$ 150. Veja: https://wa.me/c/556696795639', 'A manutenção sai a partir de R$ 150.').usou, 'rascunho');
  assert.strictEqual(escolherFala(RASCUNHO, 'A avaliação é gratuita e sai por R$ 50. A Gleide te atende na terça às 14h, pode ser?').usou, 'rascunho');
});

test('não pode criar pergunta, criar balão, tirar a apresentação, cortar demais nem alongar', () => {
  assert.strictEqual(escolherFala(RASCUNHO, 'A avaliação é gratuita. Terça às 14h, pode ser? O que você acha?').motivo, 'criou pergunta');
  assert.strictEqual(escolherFala(RASCUNHO, 'A avaliação é gratuita.\n---\nA Gleide te atende na terça às 14h, pode ser?').motivo, 'criou balão');
  const apres = 'Oi! Sou a assistente virtual do Toda Bonita Mega Hair, aqui em Sinop. Me conta como está o seu cabelo hoje?';
  assert.strictEqual(escolherFala(apres, 'Oi! Sou do Toda Bonita Mega Hair, aqui em Sinop. Como está o seu cabelo hoje?').motivo, 'tirou a apresentação');
  assert.strictEqual(escolherFala(RASCUNHO, 'Terça às 14h?').motivo, 'cortou demais');
  assert.strictEqual(escolherFala(RASCUNHO, RASCUNHO + ' ' + 'Fico à disposição para o que precisar por aqui. '.repeat(4)).motivo, 'ficou mais longo');
  assert.strictEqual(escolherFala(RASCUNHO, '').usou, 'rascunho');
  assert.strictEqual(escolherFala(RASCUNHO, '=== RASCUNHO ===\nA avaliação é gratuita, terça às 14h, pode ser?').usou, 'rascunho');
});

test('fatos: pega número, horário, link e e-mail, sem ligar para a ordem', () => {
  assert.strictEqual(fatos('às 14h, R$ 150, 10x'), fatos('10x de R$ 150 às 14h.'));
  assert.strictEqual(escolherFala(RASCUNHO, 'A avaliação é gratuita. A Gleide te atende na quarta às 14h, pode ser?').usou, 'rascunho');
  assert.notStrictEqual(fatos('amanhã às 9h'), fatos('hoje às 9h'));
  assert.notStrictEqual(fatos('em até 10x sem juros'), fatos('em 10x sem juros'));
  assert.notStrictEqual(fatos('a partir de R$ 150 por tela'), fatos('R$ 150 por tela'));
  assert.strictEqual(fatos('fica a partir de R$ 150, em até 10x'), fatos('Em até 10x. A partir de R$150.'));
  assert.notStrictEqual(fatos('chave pix: gleide@salao.com'), fatos('chave pix: outra@salao.com'));
});

test('o pedido leva o rascunho, a fala da cliente e as últimas respostas da IA', () => {
  const p = pedidoEditor({ rascunho: RASCUNHO, cliente: 'meu cabelo tá ralo', iaAntes: ['a', 'b', 'c', 'd', 'e'] });
  assert.ok(p.includes(RASCUNHO) && p.includes('meu cabelo tá ralo'));
  assert.ok(!p.includes('\na\nb') && p.includes('b\nc\nd\ne'));
  assert.ok(pedidoEditor({ rascunho: RASCUNHO }).includes('(nenhuma)'));
});

test('o fluxo: editor entre o agente e o caminho de sempre, travado na lista', () => {
  const wf = {
    nodes: [
      { name: 'Agente IA', position: [0, 0], parameters: {} }, { name: 'Montar entrada', parameters: {} }, { name: 'Supabase: últimas mensagens', parameters: {} },
      { name: 'Entender mídia (Gemini)', parameters: { url: 'https://exemplo/gemini' }, credentials: { googlePalmApi: { id: 'x' } } },
      { name: 'Quebrar mensagens', parameters: { jsCode: "let t = ($('Agente IA').first().json.output || '').trim();" } },
    ],
    connections: { 'Agente IA': { main: [[{ node: 'Preço: ler pendência', type: 'main', index: 0 }, { node: 'Conferente: conferir', type: 'main', index: 0 }]] } },
  };
  require('../fala-editor.js')({ workflow: wf, so_para: ['5566999270860'] });
  const no = (n) => wf.nodes.find((x) => x.name === n);
  assert.deepStrictEqual(wf.connections['Agente IA'].main[0].map((x) => x.node), ['Fala: preparar', 'Conferente: conferir']);
  assert.deepStrictEqual(wf.connections['Fala: editar?'].main.map((x) => x[0].node), ['Fala: editar (Gemini)', 'Preço: ler pendência']);
  assert.strictEqual(wf.connections['Fala: decidir'].main[0][0].node, 'Preço: ler pendência');
  assert.ok(no('Fala: preparar').parameters.jsCode.includes('so_para: ["5566999270860"]'));
  assert.ok(no('Quebrar mensagens').parameters.jsCode.includes("falaEditada || $('Agente IA').first().json.output"));
  assert.deepStrictEqual(no('Fala: editar (Gemini)').credentials, { googlePalmApi: { id: 'x' } });

  // os nós rodam colados no n8n: roda o código deles com um $ de mentira
  const rodar = (nome, dados, entrada) => new Function('$', '$input', no(nome).parameters.jsCode)(
    (n) => { if (!(n in dados)) throw new Error('nó não rodou'); const v = dados[n]; return { first: () => ({ json: Array.isArray(v) ? v[0] : v }), all: () => [].concat(v).map((json) => ({ json })) }; },
    { first: () => ({ json: entrada }) })[0].json;
  const dados = { 'Agente IA': { output: RASCUNHO }, 'Montar entrada': { telefone: '556699270860', texto_cliente: 'meu cabelo tá ralo' },
    'Supabase: últimas mensagens': [{ direcao: 'saida', autor: 'ia', conteudo: 'nova' }, { direcao: 'entrada', conteudo: 'dela' }, { direcao: 'saida', autor: 'humano', conteudo: 'da Gleide' }, { direcao: 'saida', autor: 'ia', conteudo: 'velha' }] };
  const p = rodar('Fala: preparar', dados);
  assert.strictEqual(p.editar, true);
  assert.ok(p.pedido.includes('velha\nnova') && !p.pedido.includes('da Gleide'));
  assert.deepStrictEqual(rodar('Fala: preparar', { ...dados, 'Montar entrada': { telefone: '5566996551390' } }), { editar: false, porque: 'fora da lista' });
  assert.strictEqual(rodar('Fala: preparar', {}).editar, false);
  const gem = (t) => ({ candidates: [{ content: { parts: [{ text: 'pensando', thought: true }, { text: t }] } }] });
  assert.strictEqual(rodar('Fala: decidir', dados, gem('A avaliação é gratuita. A Gleide te atende na terça às 14h, pode ser?')).usou, 'editado');
  assert.strictEqual(rodar('Fala: decidir', dados, gem('Terça às 15h, pode ser? A avaliação é gratuita, viu.')).usou, 'rascunho');
  assert.match(rodar('Fala: decidir', dados, { error: { message: 'spending cap' } }).motivo, /erro do Gemini/);
});

test('o gerador para se o caminho mudou', () => {
  const wf = { nodes: ['Agente IA', 'Quebrar mensagens', 'Montar entrada', 'Supabase: últimas mensagens', 'Entender mídia (Gemini)'].map((name) => ({ name, parameters: { jsCode: '' } })),
    connections: { 'Agente IA': { main: [[{ node: 'Quebrar mensagens' }]] } } };
  assert.throws(() => require('../fala-editor.js')({ workflow: wf }), /esperava Agente IA/);
});
