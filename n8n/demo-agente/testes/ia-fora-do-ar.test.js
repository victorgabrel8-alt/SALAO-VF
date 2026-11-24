// Testes do ia-fora-do-ar.js. Rodar: node --test n8n/demo-agente/testes/*.test.js
// Caso real de 21/11/2026: o Gemini bateu o teto de gasto do mês e a Dienne, avisando que tinha chegado ao salão,
// recebeu duas vezes "Desculpa, tive um probleminha… Pode mandar de novo?".
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const iaFora = require('../ia-fora-do-ar.js');
const { decidirFalha, avisoDaDona } = iaFora;

const AGORA = Date.parse('2026-11-21T14:25:00Z');
const ha = (min, conteudo, direcao = 'saida') => ({ direcao, conteudo, criado_em: new Date(AGORA - min * 60000).toISOString() });
const DESCULPA = 'Desculpa, tive um probleminha aqui e não consegui ler sua mensagem. Pode mandar de novo? 😊';
const ESPERA = 'Recebi sua mensagem 💛 A Gleide te responde por aqui assim que puder, tá?';
const TETO = '[GoogleGenerativeAI Error]: Error fetching from https://generativelanguage.googleapis.com/…: [429 ] Your project has exceeded its monthly spending cap.';
const d = (o) => decidirFalha({ agora: AGORA, dona: 'Gleide', anteriores: [], ...o });

test('falha comum, primeira vez: o pedido de desculpas de sempre, sem avisar a dona', () => {
  assert.deepStrictEqual(d({ erro: '' }), { tipo: 'desculpa', texto: DESCULPA, avisarDona: false });
  assert.deepStrictEqual(d({ erro: 'Cannot read properties of undefined' }).tipo, 'desculpa');
});

test('o provedor recusou por limite ou teto de gasto: recado de espera já na primeira vez, e a dona é avisada', () => {
  for (const erro of [TETO, 'The service is receiving too many requests from you', 'Resource exhausted: quota', 'rate limit exceeded'])
    assert.deepStrictEqual(d({ erro }), { tipo: 'espera', texto: ESPERA, avisarDona: true }, erro);
});

test('sobrecarga passageira (503, overloaded) segue o caminho comum: desculpas na primeira, espera na segunda', () => {
  for (const erro of ['503 Service Unavailable', 'The model is overloaded. Please try again later.']) {
    assert.strictEqual(d({ erro }).tipo, 'desculpa', erro);
    assert.strictEqual(d({ erro, anteriores: [ha(2, DESCULPA)] }).tipo, 'espera', erro);
  }
});

test('só conta a ÚLTIMA mensagem que saiu: se a IA (ou a dona) respondeu depois, uma falha nova começa do zero', () => {
  // recado de espera às 09:20, a IA voltou e respondeu às 10:00, falha de novo: não é silêncio
  assert.strictEqual(d({ erro: '', anteriores: [ha(5, 'Oi, Dienne! Que bom que chegou 🌹'), ha(60, ESPERA)] }).tipo, 'desculpa');
  assert.strictEqual(d({ erro: TETO, anteriores: [ha(5, 'Oi, Dienne! Que bom que chegou 🌹'), ha(60, ESPERA)] }).tipo, 'espera');
  // pedido de desculpas, depois uma resposta boa, depois falha: desculpas de novo, não o recado
  assert.strictEqual(d({ erro: '', anteriores: [ha(5, 'Tenho amanhã às 9h.'), ha(20, DESCULPA)] }).tipo, 'desculpa');
  // a ordem da lista não importa (a consulta devolve a mais nova primeiro)
  assert.strictEqual(d({ erro: TETO, anteriores: [ha(60, 'Oi!'), ha(2, ESPERA)] }).tipo, 'silencio');
  // mensagem da cliente no meio não muda nada: o que conta é o que SAIU
  assert.strictEqual(d({ erro: TETO, anteriores: [ha(1, 'Oi eu já cheguei', 'entrada'), ha(2, ESPERA)] }).tipo, 'silencio');
});

test('segunda falha em 1 hora com a mesma cliente: recado de espera em vez de repetir o pedido', () => {
  assert.strictEqual(d({ erro: '', anteriores: [ha(2, DESCULPA), ha(3, 'Oi cheguei', 'entrada')] }).tipo, 'espera');
  assert.strictEqual(d({ erro: '', anteriores: [ha(59, DESCULPA)] }).tipo, 'espera');
  // pedido de desculpas antigo (mais de 1 h): começa de novo
  assert.strictEqual(d({ erro: '', anteriores: [ha(90, DESCULPA)] }).tipo, 'desculpa');
  // a própria cliente escrever "Desculpa, tive um probleminha" não conta
  assert.strictEqual(d({ erro: '', anteriores: [ha(2, DESCULPA, 'entrada')] }).tipo, 'desculpa');
});

test('já recebeu o recado de espera nas últimas 3 horas: silêncio (sem laço), com qualquer erro', () => {
  for (const erro of ['', TETO]) {
    assert.deepStrictEqual(d({ erro, anteriores: [ha(1, ESPERA)] }), { tipo: 'silencio', texto: '', avisarDona: false });
    assert.strictEqual(d({ erro, anteriores: [ha(179, ESPERA)] }).tipo, 'silencio');
  }
  // passou de 3 h e continua fora: recado de novo (e a dona de novo)
  assert.strictEqual(d({ erro: TETO, anteriores: [ha(200, ESPERA)] }).tipo, 'espera');
});

test('o caso da Dienne: teto de gasto, duas mensagens seguidas → um recado só', () => {
  const primeira = d({ erro: TETO });
  assert.strictEqual(primeira.texto, ESPERA);
  const segunda = d({ erro: TETO, anteriores: [ha(2, primeira.texto), ha(3, 'Oi cheguei', 'entrada')] });
  assert.strictEqual(segunda.texto, '');
});

test('entrada estranha não quebra', () => {
  assert.doesNotThrow(() => decidirFalha());
  assert.strictEqual(decidirFalha({}).tipo, 'desculpa');
  assert.strictEqual(decidirFalha({ anteriores: [null, {}, { direcao: 'saida' }, { direcao: 'saida', conteudo: ESPERA, criado_em: 'não é data' }], agora: AGORA }).tipo, 'desculpa');
  assert.strictEqual(decidirFalha({ erro: TETO, dona: '' }).texto, 'Recebi sua mensagem 💛 A gente te responde por aqui assim que puder, tá?');
});

test('aviso para a dona: conversa normal, com quem é e o que ela escreveu', () => {
  const t = avisoDaDona({ nome: 'dienne souza de lima', telefone: '556696736156', mensagem: 'Oi cheguei' });
  assert.strictEqual(t, '⚠️ Estou com um problema aqui no sistema e não consegui responder a *Dienne Souza*, que escreveu agora: «Oi cheguei». ' +
    'Eu só disse a ela que você responde assim que puder.\nConsegue responder ela pelo WhatsApp do salão? O número dela é (66) 99673-6156.\nO Victor já foi avisado do problema.');
  // 24/11/2026: com o link da conversa no app (a Gleide perguntou "Qual o WhatsApp dela?")
  assert.ok(avisoDaDona({ nome: 'Lia', telefone: '5566999990022', mensagem: 'oi', link: 'https://app.oistudio.com.br/conversas/abc' })
    .endsWith('O número dela é (66) 99999-0022.\nConversa dela no app: https://app.oistudio.com.br/conversas/abc\nO Victor já foi avisado do problema.'));
  assert.doesNotMatch(t, /\b(responda|sim ou n[ãa]o|digite)\b|^\s*\d+\)/im);
  // sem nome: o número; numeração do buffer sai; mensagem comprida é cortada
  assert.match(avisoDaDona({ nome: '', telefone: '5566999990000', mensagem: '[1] oi\n[2] cheguei' }), /responder o número \(66\) 99999-0000, que escreveu agora: «oi cheguei»/);
  assert.match(avisoDaDona({ nome: '5566999990000', telefone: '', mensagem: '' }), /responder uma cliente\. Eu só disse/);
  assert.ok(avisoDaDona({ nome: 'Ana', telefone: '5566999990000', mensagem: 'x'.repeat(500) }).length < 520);
});

// ---------- montagem (sem gravar arquivo) ----------
const montar = () => {
  let n = 0;
  const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ id: 'id-' + (++n), name, type, typeVersion, position, parameters, ...extra });
  const ifNode = (name, position, conditions) => node(name, 'n8n-nodes-base.if', 2.2, position, { conditions: { conditions } });
  const cond = (id, left, operator) => ({ id, leftValue: left, operator });
  const main = (to) => ({ main: [[{ node: to, type: 'main', index: 0 }]] });
  const QUEBRAR = [
    "const jid = $('Montar entrada').first().json.jid;",
    "let paragrafos = String($('Agente IA').first().json.output || '').split(/\\n\\s*\\n/).map((t) => ({ t: t.trim(), ref: 0 })).filter((p) => p.t);",
    "const falhou = !paragrafos.some(p => p.t !== '§§'); // o alerta-workflows.js avisa o Victor",
    "if (falhou) paragrafos = [{ t: 'Desculpa, tive um probleminha aqui e não consegui ler sua mensagem. Pode mandar de novo? 😊', ref: 0 }];",
    "return paragrafos.map(({ t: texto }) => ({ json: { jid, texto, falhou } }));",
  ].join('\n');
  const workflow = {
    nodes: [
      ...['Agente IA', 'Supabase: últimas mensagens', 'Supabase: ficha da cliente', 'Montar entrada', 'Extrair dados'].map((x) => node(x, 'x', 1, [0, 0], {})),
      node('Quebrar mensagens', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: QUEBRAR }),
      node('IA falhou? (alerta)', 'n8n-nodes-base.if', 2.2, [3180, -240], {}),
      node('Avisar Victor (IA falhou)', 'n8n-nodes-base.httpRequest', 4.2, [3400, -260], {
        jsonBody: "={{ JSON.stringify({ number: '5500', text: '⚠️ A IA falhou e mandou o pedido de desculpas para ' + $('Montar entrada').first().json.telefone + ': «' + String($('Montar entrada').first().json.texto_cliente || '').slice(0, 200) + '».' + ' Veja em n8n → Executions.' }) }}" }),
    ],
    connections: { 'Quebrar mensagens': { main: [[{ node: 'IA falhou? (alerta)', type: 'main', index: 0 }]] }, 'IA falhou? (alerta)': main('Avisar Victor (IA falhou)') },
  };
  iaFora({ node, main, ifNode, cond, workflow, EVO: '={{ $env.EVOLUTION_URL }}', apikeyHeader: {}, REDIS: {}, dona: 'Gleide' });
  return workflow;
};
// roda o código de um nó Code com $('nó') simulado
const rodar = (code, nos, env = {}, guardado = {}) => new Function('$', '$input', '$env', '$getWorkflowStaticData', code)((nome) => {
  if (!(nome in nos)) throw new Error('nó não executado: ' + nome);
  const v = nos[nome];
  return { first: () => ({ json: Array.isArray(v) ? v[0] : v }), all: () => (Array.isArray(v) ? v : [v]).map((json) => ({ json })) };
}, {}, env, () => guardado);

test('montagem: o "Quebrar mensagens" decide entre desculpas, espera e silêncio', () => {
  const wf = montar();
  const code = wf.nodes.find((x) => x.name === 'Quebrar mensagens').parameters.jsCode;
  const base = { 'Montar entrada': { jid: '5566@s.whatsapp.net' } };
  const sai = (agente, ultimas) => rodar(code, { ...base, 'Agente IA': agente, 'Supabase: últimas mensagens': ultimas });
  // resposta normal não muda
  assert.deepStrictEqual(sai({ output: 'Oi, tudo bem?' }, []), [{ json: { jid: '5566@s.whatsapp.net', texto: 'Oi, tudo bem?', falhou: false } }]);
  // falha comum
  assert.strictEqual(sai({ output: '' }, [])[0].json.texto, DESCULPA);
  // teto de gasto: espera; erro em forma de objeto também
  assert.strictEqual(sai({ error: 'The service is receiving too many requests from you' }, [])[0].json.texto, ESPERA);
  assert.strictEqual(sai({ error: { message: '429 quota' } }, [])[0].json.texto, ESPERA);
  // já recebeu a espera agora há pouco: sem texto, mas com falhou (o Victor é avisado) e semTexto (libera a trava)
  const agora = new Date(Date.now() - 60000).toISOString();
  assert.deepStrictEqual(sai({ error: '429' }, [{ direcao: 'saida', conteudo: ESPERA, criado_em: agora }]), [{ json: { jid: '5566@s.whatsapp.net', semTexto: true, falhou: true, falha: 'silencio' } }]);
  // nó das últimas mensagens não rodou: não quebra, cai no caso sem histórico
  assert.strictEqual(rodar(code, { ...base, 'Agente IA': { output: '' } })[0].json.texto, DESCULPA);
});

test('montagem: ramo da dona sai do "Quebrar mensagens", lá embaixo na tela, só quando saiu o recado de espera', () => {
  const wf = montar();
  assert.deepStrictEqual(wf.connections['Quebrar mensagens'].main[0].map((c) => c.node), ['IA falhou? (alerta)', 'IA fora: avisa a dona?']);
  assert.deepStrictEqual(wf.connections['IA falhou? (alerta)'].main[0].map((c) => c.node), ['Avisar Victor (IA falhou)']);
  // y = 9600: com executionOrder v1 roda depois do caminho da resposta (a cliente recebe o recado antes)
  for (const x of wf.nodes.filter((n) => /^IA fora:/.test(n.name))) assert.strictEqual(x.position[1], 9600, x.name);
  const ordem = []; let at = 'IA fora: avisa a dona?';
  while (at) { ordem.push(at); at = wf.connections[at]?.main?.[0]?.[0]?.node; }
  assert.deepStrictEqual(ordem, ['IA fora: avisa a dona?', 'IA fora: aviso da dona', 'IA fora: avisar a dona', 'IA fora: memória da assistente']);
  const no = (x) => wf.nodes.find((y) => y.name === x);
  assert.match(no('IA fora: avisa a dona?').parameters.conditions.conditions[0].leftValue, /falhou === true && .*startsWith\('Recebi sua mensagem 💛'\)/);
  for (const x of ['IA fora: avisar a dona', 'IA fora: memória da assistente']) assert.strictEqual(no(x).onError, 'continueRegularOutput', x);
  // o nó que monta o aviso nunca derruba a execução: sem os nós de onde lê, ou com erro, só não avisa
  assert.deepStrictEqual(new Function('$', '$input', '$env', '$getWorkflowStaticData', no('IA fora: aviso da dona').parameters.jsCode)(() => { throw new Error('x'); }, {}, undefined, () => { throw new Error('y'); }), []);
  // o nó que monta o aviso: uma mensagem por número da dona, com a memória da assistente
  const out = rodar(no('IA fora: aviso da dona').parameters.jsCode, { 'Supabase: ficha da cliente': { nome: 'Dienne' }, 'Extrair dados': { nome: 'Di' },
    'Montar entrada': { telefone: '556696736156', texto_cliente: 'Oi cheguei' } }, { ASSISTENTE_NUMEROS: '5500000000001' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].json.tel, '5500000000001');
  assert.match(out[0].json.texto, /responder a \*Dienne\*, que escreveu agora: «Oi cheguei»[\s\S]*O número dela é \(66\) 99673-6156\./);
  // com a ficha: o link da conversa dela no app
  const comFicha = rodar(no('IA fora: aviso da dona').parameters.jsCode, { 'Supabase: ficha da cliente': { nome: 'Dienne', id: 'id-dienne' }, 'Extrair dados': { nome: 'Di' },
    'Montar entrada': { telefone: '556696736156', texto_cliente: 'Oi' } }, { ASSISTENTE_NUMEROS: '5500000000001' });
  assert.ok(comFicha[0].json.texto.includes('\nConversa dela no app: https://app.oistudio.com.br/conversas/id-dienne\n'), comFicha[0].json.texto);
  assert.strictEqual(JSON.parse(out[0].json.memoria).data.content, out[0].json.texto);
  // sem a ficha (cliente nova): usa o nome do WhatsApp
  const novo = rodar(no('IA fora: aviso da dona').parameters.jsCode, { 'Extrair dados': { nome: 'Bia' }, 'Montar entrada': { telefone: '5566999990000', texto_cliente: 'oi' } }, {});
  assert.match(novo[0].json.texto, /\*Bia\*/);
  assert.throws(() => iaFora({ node: () => ({}), main: () => ({}), ifNode: () => ({}), cond: () => ({}), workflow: wf, EVO: '', apikeyHeader: {}, REDIS: {} }), /já montado/);
});

test('montagem: numa queda longa a dona recebe 3 avisos por hora, o 4º junta e depois para', () => {
  const wf = montar();
  const code = wf.nodes.find((x) => x.name === 'IA fora: aviso da dona').parameters.jsCode;
  const guardado = {};
  let n = 0;
  const um = (nome, telefone) => rodar(code, { 'Supabase: ficha da cliente': { nome }, 'Extrair dados': {}, 'Montar entrada': { telefone: telefone || '55669999900' + String(10 + (++n)), texto_cliente: 'oi' } }, { ASSISTENTE_NUMEROS: '5500000000001' }, guardado);
  for (const nome of ['Ana', 'Bia', 'Carla']) assert.match(um(nome)[0].json.texto, new RegExp('\\*' + nome + '\\*'));
  const quarto = um('Duda');
  assert.match(quarto[0].json.texto, /^Tem mais clientes escrevendo/);
  assert.doesNotMatch(quarto[0].json.texto, /Duda/);
  assert.deepStrictEqual(um('Eva'), []);
  assert.deepStrictEqual(um('Fabi'), []);
  // uma hora depois volta a avisar
  guardado.iaForaAvisos = guardado.iaForaAvisos.map((t) => t - 3700e3);
  assert.match(um('Gabi')[0].json.texto, /\*Gabi\*/);
});

test('montagem: o aviso do Victor diz o que a cliente recebeu', () => {
  const wf = montar();
  const body = wf.nodes.find((x) => x.name === 'Avisar Victor (IA falhou)').parameters.jsonBody;
  const f = new Function('$', '$json', 'return ' + body.replace(/^=\{\{\s*/, '').replace(/\s*\}\}\s*$/, ''));
  const texto = ($json) => JSON.parse(f(() => ({ first: () => ({ json: { telefone: '556696736156', texto_cliente: 'Oi cheguei' } }) }), $json)).text;
  assert.match(texto({ falhou: true, texto: ESPERA }), /A IA falhou com 556696736156, que escreveu: «Oi cheguei»\. Ela recebeu o recado de espera e a dona está sendo avisada/);
  assert.match(texto({ falhou: true, texto: DESCULPA }), /Ela recebeu o pedido de desculpas/);
  assert.match(texto({ falhou: true, semTexto: true }), /Ela NÃO recebeu resposta agora/);
});


// ---------- testador (21/11) ----------
test('testador: "suspended" não é teto de gasto e "R$ 429,00" não é o código 429', () => {
  assert.strictEqual(d({ erro: 'Your account has been suspended' }).tipo, 'desculpa');
  assert.strictEqual(d({ erro: 'Erro na ferramenta: valor R$ 429,00 inválido' }).tipo, 'desculpa');
  assert.strictEqual(d({ erro: '[429 ] Your project has exceeded its monthly spending cap.' }).tipo, 'espera');
  assert.strictEqual(d({ erro: 'Request failed with status code 429' }).tipo, 'espera');
});

test('testador: nome com emoji, nome que não é nome e contato sem número de verdade', () => {
  assert.match(avisoDaDona({ nome: '💕mari💕', telefone: '5566999990000', mensagem: 'oi' }), /a \*Mari\*, que escreveu[\s\S]*O número dela é \(66\) 99999-0000\./);
  assert.match(avisoDaDona({ nome: '.', telefone: '5566999990000', mensagem: 'oi' }), /responder o número \(66\) 99999-0000/);
  // contato @lid: o "telefone" é um código, não ajuda a achar a conversa
  const lid = avisoDaDona({ nome: 'Bia', telefone: '123456789012345', mensagem: 'oi' });
  assert.match(lid, /a \*Bia\*, que escreveu/);
  assert.doesNotMatch(lid, /final|número dela/);
});

test('testador: a mesma cliente não gera dois avisos à dona em 10 minutos (recado descartado), mas depois disso avisa de novo', () => {
  const wf = montar();
  const code = wf.nodes.find((x) => x.name === 'IA fora: aviso da dona').parameters.jsCode;
  const guardado = {};
  const um = (telefone) => rodar(code, { 'Supabase: ficha da cliente': { nome: 'Dienne' }, 'Extrair dados': {}, 'Montar entrada': { telefone, texto_cliente: 'Oi cheguei' } }, { ASSISTENTE_NUMEROS: '5500000000001' }, guardado);
  assert.strictEqual(um('556696730000').length, 1);
  assert.deepStrictEqual(um('556696730000'), [], 'o recado foi descartado e ela escreveu de novo: a dona não recebe outro aviso');
  assert.strictEqual(guardado.iaForaAvisos.length, 1, 'o aviso repetido não gasta o limite da hora');
  assert.strictEqual(um('556696731111').length, 1, 'outra cliente avisa normalmente');
  // 9 min depois ainda não; 11 min depois (a IA voltou, respondeu e falhou de novo; ou a dona respondeu) avisa de novo
  guardado.iaForaClientes['556696730000'] -= 9 * 60e3;
  assert.deepStrictEqual(um('556696730000'), []);
  guardado.iaForaClientes['556696730000'] -= 2 * 60e3;
  assert.strictEqual(um('556696730000').length, 1);
});

test('testador: o "Sobre esta cliente" não trata o recado de espera como resposta', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'supabase-workflows.js'), 'utf8');
  // os dois lugares: a pergunta dela continua "sem resposta" e a IA não acha que "já conversou" só por causa do recado
  assert.strictEqual(fonte.split("/^(Desculpa, tive um probleminha|Recebi sua mensagem 💛)/.test(m.conteudo || '')").length, 3);
});
