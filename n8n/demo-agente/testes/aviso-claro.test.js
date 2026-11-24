// Testes dos avisos à dona que a assistente sabe explicar (24/11/2026). Rodar: node --test n8n/demo-agente/testes/*.test.js
// Caso real: chegou "joana · telefone / Gerar e enviar link de pagamento… / link" e a Gleide perguntou "Esse link"; a
// assistente não sabia do aviso. Os nós são os GERADOS de verdade (pasta temporária, sem enviar nada).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { avisoTransferencia } = require('../aviso-transferencia.js');

// mensagens do banco, a mais nova primeiro (como a consulta devolve)
const JOANA = [
  { direcao: 'entrada', conteudo: 'Amanhã vou viajar e não consigo passar aí' },
  { direcao: 'entrada', conteudo: 'Queria saber se ela consegue me mandar um link de pagamento' },
  { direcao: 'entrada', conteudo: 'Sim' },
  { direcao: 'saida', conteudo: 'Conseguiu resolver tudo com a Gleide ontem sobre o seu cabelo?' },
  { direcao: 'entrada', conteudo: 'Boa tarde, preciso falar de outra coisa antiga' },
];
const ID = '11111111-2222-4333-8444-555555555555';
const AGORA = Date.parse('2026-11-24T21:21:00Z');

test('o caso da Joana: quem, o que fazer, o que ela escreveu, o número e para que serve o link', () => {
  const r = avisoTransferencia({ nome: 'joana', telefone: '5566999990011', cliente_id: ID, o_que_precisa: 'Gerar e enviar link de pagamento para a Joana', mensagens: JOANA, agora: AGORA });
  assert.strictEqual(r.texto, [
    '*Joana* precisa de você: gerar e enviar link de pagamento.',
    'Ela escreveu: «Queria saber se ela consegue me mandar um link de pagamento» «Amanhã vou viajar e não consigo passar aí»',
    'A IA disse a ela que você responde e não vai mais responder ela por 12 h.',
    'Pode falar com ela pelo WhatsApp do salão (o número dela é (66) 99999-0011) ou me dizer aqui o que mandar.',
    'Conversa dela no app: https://app.oistudio.com.br/conversas/' + ID,
  ].join('\n'));
  // a memória da assistente: o mesmo texto, com a hora e os dados para ela agir
  const m = JSON.parse(r.memoria);
  assert.strictEqual(m.type, 'ai');
  assert.ok(m.data.content.startsWith('[ter 24/11 17:21] *Joana* precisa de você'), m.data.content);
  assert.ok(m.data.content.includes(r.texto));
  assert.ok(m.data.content.endsWith('(cliente_id: ' + ID + ', telefone: 5566999990011, nome no cadastro: joana)'));
  for (const k of ['additional_kwargs', 'response_metadata', 'tool_calls', 'invalid_tool_calls']) assert.ok(k in m.data, k);
});

test('aviso sem nome, sem mensagens, sem o que fazer, com link do app de outro endereço e nome no "o que fazer" com acento', () => {
  const r = avisoTransferencia({ nome: '', telefone: '5566999990000', cliente_id: 'x', o_que_precisa: '', motivo: 'Quer falar com a dona', mensagens: [], app: 'https://outro.app/' });
  assert.match(r.texto, /^A cliente do \(66\) 99999-0000 precisa de você: quer falar com a dona\.\n/);
  assert.doesNotMatch(r.texto, /Ela escreveu/);
  assert.match(r.texto, /Conversa dela no app: https:\/\/outro\.app\/conversas\/x$/);
  const vazio = avisoTransferencia({});
  assert.match(vazio.texto, /^Uma cliente precisa de você\.\n/);
  assert.doesNotMatch(vazio.texto, /Conversa dela no app|, no \(/);
  assert.match(avisoTransferencia({ nome: 'Joana Souza', o_que_precisa: 'Mandar o Pix para a Joana.' }).texto, /precisa de você: mandar o Pix\.\n/);
  // sigla no começo fica como está; mensagem enorme é cortada; só "oi" e "ok" não entram
  assert.match(avisoTransferencia({ nome: 'Ana', o_que_precisa: 'PIX do sinal' }).texto, /precisa de você: PIX do sinal\./);
  const longa = avisoTransferencia({ nome: 'Ana', mensagens: [{ direcao: 'entrada', conteudo: 'x'.repeat(900) }, { direcao: 'entrada', conteudo: 'ok' }, { direcao: 'entrada', conteudo: 'oi' }] });
  assert.ok(longa.texto.split('\n')[1].length < 200, longa.texto);
  assert.ok(avisoTransferencia({ nome: 'Ana', mensagens: [null, 3, { direcao: 'entrada' }] }).texto.startsWith('*Ana*'));
});

// ---------- fluxos gerados ----------
const origem = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aviso-claro-teste-'));
for (const f of fs.readdirSync(origem)) {
  if (/\.(js|md|json|txt)$/.test(f) && !/^workflow-/.test(f) && fs.statSync(path.join(origem, f)).isFile()) fs.copyFileSync(path.join(origem, f), path.join(tmp, f));
}
fs.writeFileSync(path.join(tmp, '.env'), '');
execFileSync(process.execPath, ['montar-workflow.js'], { cwd: tmp, stdio: 'pipe' });
const wf = (f) => JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'));
const pausa = wf('workflow-pausa-salao.json'), principal = wf('workflow-demo-salao.json'), assistente = wf('workflow-assistente.json');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const no = (w, nome) => { const n = w.nodes.find((x) => x.name === nome); assert.ok(n, 'falta o nó ' + nome); return n; };
const caminho = (w, de) => { const o = []; let at = de; while (at && !o.includes(at)) { o.push(at); at = w.connections[at]?.main?.[0]?.[0]?.node; } return o; };
const dolar = (dados) => (nome) => {
  if (!(nome in dados)) throw new Error('nó sem dados no teste: ' + nome);
  const itens = [].concat(dados[nome]);
  return { first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })) };
};

test('transferir_para_humano: monta o aviso, manda à Gleide e guarda na memória da assistente, sempre terminando na resposta à IA', () => {
  assert.deepStrictEqual(caminho(pausa, 'Supabase: pausar IA'), ['Supabase: pausar IA', 'Supabase: número de alerta', 'Supabase: mensagens da cliente',
    'Montar aviso à Gleide', 'Avisar a Gleide (WhatsApp)', 'Memória da assistente (aviso)', 'Resposta']);
  assert.match(no(pausa, 'Supabase: mensagens da cliente').parameters.url, /mensagens\?select=direcao,conteudo,criado_em&cliente_id=eq\.\{\{ \$\('Supabase: pausar IA'\)/);
  assert.strictEqual(no(pausa, 'Avisar a Gleide (WhatsApp)').parameters.jsonBody, '={{ JSON.stringify({ number: $json.numero, text: $json.texto }) }}');
  const mem = no(pausa, 'Memória da assistente (aviso)');
  assert.strictEqual(mem.parameters.list, "=assistente:{{ $('Montar aviso à Gleide').first().json.chave || 'sem-numero' }}");
  assert.ok(mem.credentials && mem.credentials.redis, 'credencial do Redis');
  for (const n of ['Supabase: mensagens da cliente', 'Avisar a Gleide (WhatsApp)', 'Memória da assistente (aviso)']) assert.strictEqual(no(pausa, n).onError, 'continueRegularOutput', n);
  // o código do nó, como o n8n roda
  const rodar = (dados, env = {}) => new Function('$', '$env', no(pausa, 'Montar aviso à Gleide').parameters.jsCode)(dolar(dados), env)[0].json;
  const out = rodar({
    'Supabase: pausar IA': { id: ID, nome: 'joana', telefone: '5566999990011' },
    'Recebe pedido do agente': { telefone: '556699990011', o_que_precisa: 'Gerar e enviar link de pagamento', motivo: 'quer link de pagamento' },
    'Supabase: mensagens da cliente': JOANA, 'Supabase: número de alerta': { alerta: '5566999596740' },
  });
  assert.strictEqual(out.numero, '5566999596740');
  assert.strictEqual(out.chave, '5566999596740');
  // alerta gravado sem o 9: a chave é a da lista da assistente (a que ela lê)
  const sem9 = rodar({ 'Supabase: pausar IA': {}, 'Recebe pedido do agente': {}, 'Supabase: mensagens da cliente': [{}], 'Supabase: número de alerta': { alerta: '556699596740' } },
    { ASSISTENTE_NUMEROS: '5566999270860, 5566999596740' });
  assert.strictEqual(sem9.chave, '5566999596740');
  assert.match(out.texto, /^\*Joana\* precisa de você: gerar e enviar link de pagamento\.\nEla escreveu: «Queria saber/);
  assert.ok(JSON.parse(out.memoria).data.content.includes(out.texto));
  // consulta vazia (alwaysOutputData devolve {}), sem número de alerta, ou com erro no meio: o aviso sai mesmo assim e a memória é JSON
  const semNada = rodar({ 'Supabase: pausar IA': {}, 'Recebe pedido do agente': { motivo: 'reclamação' }, 'Supabase: mensagens da cliente': [{}], 'Supabase: número de alerta': {} });
  assert.strictEqual(semNada.numero, '');
  assert.match(semNada.texto, /^Uma cliente precisa de você: reclamação\./);
  JSON.parse(semNada.memoria);
  const comErro = new Function('$', '$env', no(pausa, 'Montar aviso à Gleide').parameters.jsCode)(() => { throw new Error('x'); }, {})[0].json;
  assert.match(comErro.texto, / precisa de você/);
  assert.strictEqual(JSON.parse(comErro.memoria).type, 'ai');
});

test('a IA escreve o que a Gleide precisa fazer começando por verbo (descrição da ferramenta)', () => {
  const v = no(principal, 'transferir_para_humano').parameters.workflowInputs.value.o_que_precisa;
  assert.match(v, /começando por um verbo/);
  assert.doesNotMatch(v, /única frase do aviso/);
});

test('o "Guardei essa resposta" e o "Avisei a …" também vão para a memória da assistente', () => {
  assert.deepStrictEqual(caminho(principal, 'Pedido: memória (mensagem enviada)').slice(0, 4),
    ['Pedido: memória (mensagem enviada)', 'Pedido: memória da assistente', 'Pedido: apagar', 'Pedido: confirmar à Gleide']);
  assert.strictEqual(principal.connections['Aprender: avisar a Gleide'].main[0][0].node, 'Aprender: memória da assistente');
  for (const n of ['Pedido: memória da assistente', 'Aprender: memória da assistente']) {
    const x = no(principal, n);
    assert.ok(x.credentials && x.credentials.redis, n + ': credencial');
    assert.strictEqual(x.onError, 'continueRegularOutput', n);
    // a chave é o número da Gleide como a assistente guarda (com o 9), venha o telefone com ou sem o 9
    const expr = x.parameters.list.replace(/^=assistente:\{\{ /, '').replace(/ \}\}$/, '');
    for (const t of ['556699596740', '5566999596740']) {
      const chave = new Function('$', '$env', 'return ' + expr)(dolar({ 'Extrair dados': { telefone: t } }), { ASSISTENTE_NUMEROS: '5566999270860,5566999596740' });
      assert.strictEqual(chave, '5566999596740', n + ' ' + t);
    }
  }
  const md = no(principal, 'Pedido: memória da assistente').parameters.messageData.replace(/^=\{\{ /, '').replace(/ \}\}$/, '');
  const conteudo = JSON.parse(new Function('$', 'return ' + md)(dolar({ 'Pedido: preparar': { nome: 'Bia', pergunta: '2 telas, 65 cm', resposta: '2800' }, 'Pedido: texto': { texto: 'Oi Bia!' } }))).data.content;
  assert.match(conteudo, /^\[\w{3} \d\d\/\d\d \d\d:\d\d\] Avisei a \*Bia\* \(você respondeu ao pedido dela «2 telas, 65 cm» com «2800»\)\. Mandei para ela: «Oi Bia!»$/);
  const ap = no(principal, 'Aprender: memória da assistente').parameters.messageData.replace(/^=\{\{ /, '').replace(/ \}\}$/, '');
  assert.match(JSON.parse(new Function('$', 'return ' + ap)(dolar({ 'Aprender: preparar': { pergunta: 'Pode levar criança?', resposta: 'Pode sim' } }))).data.content,
    /^\[\S+ \d\d\/\d\d \d\d:\d\d\] Guardei essa resposta para responder sozinha da próxima vez: Pode levar criança\? → Pode sim$/);
  // nome no meio da frase fica; mídia vira o que ela mandou; número sem o 9 sai com o 9
  const carla = avisoTransferencia({ nome: 'Carla Souza', telefone: '556699990000', o_que_precisa: 'Conferir se a Carla tem horário dia 12/12 às 10h.',
    mensagens: [{ direcao: 'entrada', conteudo: '[foto da cliente] Foto caseira de costas' }, { direcao: 'entrada', conteudo: '[áudio] três tela quanto ela cobra' }] }).texto;
  assert.match(carla, /^\*Carla Souza\* precisa de você: conferir se a Carla tem horário dia 12\/12 às 10h\.\nEla escreveu: «três tela quanto ela cobra» \(mandou uma foto\)\n/);
  assert.match(carla, /\(o número dela é \(66\) 99999-0000\)/);
});

test('assistente: lê as conversas das clientes e sabe explicar um aviso; as regras antigas saíram', () => {
  assert.deepStrictEqual(caminho(assistente, 'Ler pedidos abertos').slice(0, 3), ['Ler pedidos abertos', 'Ler conversas', 'Ler feitos']);
  const s = no(assistente, 'Agente assistente').parameters.options.systemMessage;
  assert.strictEqual(s.split('CONVERSAS COM AS CLIENTES NAS ÚLTIMAS 3 HORAS').length - 1, 1);
  assert.strictEqual(s.split('\nAVISOS QUE CHEGAM PARA ELA (').length - 1, 1);
  assert.match(s, /abre a conversa daquela cliente no app\. É só para a Gleide ler; não é link de pagamento/);
  assert.match(s, /Nunca responda a um aviso com "não apareceu nada aqui"/);
  assert.match(s, /Pediu o número \("qual o WhatsApp dela\?"/);
  assert.match(s, /do aviso "precisa de você"\n  daquela cliente na conversa/);
  assert.match(s, /"Oi" junto com outra mensagem: responda à outra\./);
  assert.match(s, /Os avisos automáticos da conversa \(AVISOS QUE CHEGAM PARA ELA/);
  // trocado no lugar, não somado
  assert.ok(!s.includes('Avisos que você mandou ("✅ Remarquei…"'));
  assert.ok(!s.includes('O que chega para ela sozinho: remarcação'));
  assert.ok(!s.includes('Um "Oi" dela pede só'));
  // personalidade nova e sem emoji (24/11/2026): o único é o 👍 que descreve a mensagem DELA
  assert.match(s, /\nQUEM VOCÊ É\nVocê é a secretária que a Gleide sempre quis/);
  assert.match(s, /Sem emoji, nunca\./);
  assert.deepStrictEqual((s.match(/\p{Extended_Pictographic}|✓/gu) || []), ['👍']);
  assert.ok(!s.includes('Emoji só de vez em quando'));
});
