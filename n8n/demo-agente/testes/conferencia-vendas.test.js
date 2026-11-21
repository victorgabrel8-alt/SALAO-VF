// Testes da conferência semanal de vendas (conferencia-vendas.js, supabase/066). Rodar: node --test "n8n/demo-agente/testes/**/*.test.js"
// O banco é testado à parte: n8n/demo-agente/teste-066-vendas.sql (Loja Teste, transação desfeita).
const test = require('node:test');
const assert = require('node:assert');
const conferencia = require('../conferencia-vendas.js');
const { montarConferencia, REGRAS_PROMPT } = conferencia;
const { conferirAcoes } = require('../portao-regras.js');

// 23/11/2026 (segunda) 10h em Cuiabá
const SEGUNDA = Date.parse('2026-11-23T14:00:00Z');
const item = (nome, inicio, sugerido, extra = {}) => ({ agendamento_id: nome + inicio, nome, inicio, sugerido, servico: '', valor: null, ...extra });

// ---------- texto para a Gleide ----------
test('lista de várias clientes: natural, sem número de pedido e sem "responda sim ou não"', () => {
  const t = montarConferencia([
    item('Vitoria', '2026-11-19T13:00:00Z', 'mega_novo'),
    item('Renata Souza', '2026-11-20T18:30:00Z', 'manutencao'),
    item('Dienne', '2026-11-21T17:00:00Z', 'manutencao', { valor: 1200 }),
  ], SEGUNDA);
  assert.match(t, /^Oi, Gleide! Fechando a semana das clientes que vieram pelo WhatsApp/);
  assert.match(t, /• \*Vitoria\*, quinta 19\/11: mega hair com cabelo novo/);
  assert.match(t, /• \*Renata\*, sexta 20\/11: manutenção/);
  assert.match(t, /• \*Dienne\*, sábado 21\/11: manutenção, R\$ 1\.200/);
  assert.match(t, /Tá certinho\?/);
  assert.doesNotMatch(t, /\b(responda|sim ou n[ãa]o|digite|op[çc][ãa]o|pedido|\d+\))/i);
  assert.doesNotMatch(t, /relat[óo]rio|comiss[ãa]o|IA\b/);
});

test('uma cliente só: frase corrida', () => {
  const t = montarConferencia([item('Vitoria', '2026-11-19T13:00:00Z', 'mega_novo')], SEGUNDA);
  assert.strictEqual(t, 'Oi, Gleide! Fechando a semana das clientes que vieram pelo WhatsApp: a *Vitoria* veio quinta 19/11 e eu anotei ' +
    'mega hair com cabelo novo. Foi isso mesmo? Se foi diferente, ou se teve mais alguém, me conta que eu acerto 🙂');
});

test('primeira vez (itens de semanas atrás) diz "as últimas semanas"', () => {
  const t = montarConferencia([item('Vitoria', '2026-11-04T17:00:00Z', 'manutencao'), item('Dienne', '2026-11-18T17:00:00Z', 'manutencao')], SEGUNDA);
  assert.match(t, /Fechando as últimas semanas/);
  assert.match(t, /\*Vitoria\*, quarta 04\/11: manutenção/);
});

test('duas clientes diferentes com o mesmo primeiro nome vão com sobrenome; a mesma cliente duas vezes, não', () => {
  const t = montarConferencia([
    item('Renata Souza', '2026-11-19T13:00:00Z', 'manutencao'), item('Renata de Lima', '2026-11-20T13:00:00Z', 'manutencao'),
    item('Vitoria', '2026-11-18T13:00:00Z', 'manutencao'), item('Vitoria', '2026-11-21T13:00:00Z', 'mega_novo'),
  ], SEGUNDA);
  assert.match(t, /\*Renata Souza\*/);
  assert.match(t, /\*Renata Lima\*/);
  assert.match(t, /\*Vitoria\*, quarta 18\/11/);
});

test('outro serviço sai com o nome do serviço, sem "mão de obra"; lista vazia não manda nada', () => {
  const t = montarConferencia([item('Ana', '2026-11-20T13:00:00Z', 'outro', { servico: 'Remoção de mega hair – mão de obra' })], SEGUNDA);
  assert.match(t, /eu anotei remoção de mega hair\./);
  assert.strictEqual(montarConferencia([], SEGUNDA), '');
  assert.strictEqual(montarConferencia(null, SEGUNDA), '');
  assert.strictEqual(montarConferencia([{ nome: 'sem id' }], SEGUNDA), '');
});

test('o prompt ensina a não chutar cabelo novo e a não cobrar', () => {
  assert.match(REGRAS_PROMPT, /Quem diz se foi cabelo novo é ela/);
  assert.match(REGRAS_PROMPT, /Nunca escolha por ela/);
  assert.match(REGRAS_PROMPT, /Se ela não responder à lista, não cobre/);
  assert.doesNotMatch(REGRAS_PROMPT, /sim ou não"?\)?$/m);
});

// ---------- montagem no n8n (sem gravar arquivo) ----------
const montarAssistente = () => {
  let n = 0;
  const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ id: 'id-' + (++n), name, type, typeVersion, position, parameters, ...extra });
  const str = (name, value) => ({ id: 'a-' + name, name, value, type: 'string' });
  const main = (to) => ({ main: [[{ node: to, type: 'main', index: 0 }]] });
  const toolSub = (name, position, description, lerId, campos, fixos, ia) => node(name, '@n8n/n8n-nodes-langchain.toolWorkflow', 2.2, position, {
    description, workflowInputs: { value: { ...fixos, ...Object.fromEntries(ia.map(([c, d, t]) => [c, `={{ $fromAI('${c}', \`${d}\`, '${t}') }}`])) } },
  });
  const workflow = { nodes: [], connections: { 'Extrair dados': main('Depois'), 'Quebrar mensagens': { main: [[]] } } };
  return require('../assistente-workflows.js')({ env: {}, node, str, main, toolSub, workflow, megaHair: true });
};

test('montagem: ferramenta, prompt e o ramo de segunda 10h no workflow das pendências', () => {
  const a = montarAssistente();
  conferencia({ assistenteWorkflow: a.assistenteWorkflow, pendenciasWorkflow: a.pendenciasWorkflow });
  require('../pendencias-loja.js')({ pendenciasWorkflow: a.pendenciasWorkflow, horas: [12, 18] });
  const ag = a.assistenteWorkflow, pe = a.pendenciasWorkflow;
  const t = ag.nodes.find((x) => x.name === 'conferir_venda');
  assert.ok(t);
  assert.strictEqual(t.parameters.workflowInputs.value.acao, 'conferir_venda');
  assert.deepStrictEqual(ag.connections.conferir_venda.ai_tool[0][0].node, 'Agente assistente');
  assert.ok(ag.nodes.find((x) => x.name === 'Agente assistente').parameters.options.systemMessage.includes('CONFERÊNCIA DA SEMANA'));
  const g = pe.nodes.find((x) => x.name === 'Conferência: toda segunda 10h');
  assert.strictEqual(g.parameters.rule.interval[0].expression, '0 10 * * 1');
  const ordem = []; let at = 'Conferência: toda segunda 10h';
  while (at) { ordem.push(at); at = pe.connections[at]?.main?.[0]?.[0]?.node; }
  assert.deepStrictEqual(ordem, ['Conferência: toda segunda 10h', 'Conferência: lista', 'Conferência: montar', 'Conferência: mandar para a Gleide',
    'Conferência: guardar na memória', 'Conferência: marcar perguntado']);
  assert.match(pe.nodes.find((x) => x.name === 'Conferência: lista').parameters.url, /rpc\/n8n_conferencia_vendas_lista$/);
  // as pendências de sempre continuam iguais (o pendencias-loja troca a função delas depois)
  assert.match(pe.nodes.find((x) => x.name === 'Pendências novas').parameters.url, /rpc\/n8n_assistente_pendencias_uma_vez$/);
  assert.throws(() => conferencia({ assistenteWorkflow: ag, pendenciasWorkflow: pe }), /já montada/);
});

test('montagem: o nó "Conferência: montar" roda e monta uma mensagem por número da assistente', () => {
  const a = montarAssistente();
  conferencia({ assistenteWorkflow: a.assistenteWorkflow, pendenciasWorkflow: a.pendenciasWorkflow });
  const code = a.pendenciasWorkflow.nodes.find((x) => x.name === 'Conferência: montar').parameters.jsCode;
  const rodar = (data) => new Function('$input', '$env', code)({ first: () => ({ json: { data } }) }, { ASSISTENTE_NUMEROS: '5500000000001' });
  assert.deepStrictEqual(rodar('[]'), []);
  assert.deepStrictEqual(rodar('não é json'), []);
  const out = rodar(JSON.stringify([item('Vitoria', '2026-11-19T13:00:00Z', 'mega_novo')]));
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].json.tel, '5500000000001');
  assert.deepStrictEqual(out[0].json.ids, ['Vitoria2026-11-19T13:00:00Z']);
  assert.match(JSON.parse(out[0].json.memoria).data.content, /^\[\S+ \d\d\/\d\d \d\d:\d\d\] Oi, Gleide!/);
});

test('Montar chamada: conferir_venda chama a função certa e entende "13/11" sem ano', () => {
  const a = montarAssistente();
  const code = a.ferramentasWorkflow.nodes.find((x) => x.name === 'Montar chamada').parameters.jsCode;
  const chamar = (e) => new Function('$input', '$env', code)({ first: () => ({ json: e }) }, {})[0].json;
  const r = chamar({ acao: 'conferir_venda', pedido_por: '5500000000001', cliente_nome: 'Vitoria', data: '2026-11-13', tipo: 'mega_novo', valor: '1.500', observacoes: 'tá certinho' });
  assert.strictEqual(r.funcao, 'n8n_assistente_conferir_venda');
  assert.deepStrictEqual({ ...r.args, p_empresa_id: undefined }, { p_empresa_id: undefined, p_pedido_por: '5500000000001', p_nome: 'Vitoria', p_data: '2026-11-13', p_tipo: 'mega_novo', p_valor: 1500, p_fala: 'tá certinho' });
  assert.strictEqual(r.conferir.p_nome, '', 'não passa pela conferência de id (não tem id)');
  const ano = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 4);
  assert.match(chamar({ acao: 'conferir_venda', cliente_nome: 'Renata', data: '13/11', tipo: 'manutencao', valor: '0' }).args.p_data, /^\d{4}-11-13$/);
  assert.strictEqual(chamar({ acao: 'conferir_venda', cliente_nome: 'Renata', data: '13/11', tipo: 'manutencao', valor: '0' }).args.p_valor, null);
  assert.strictEqual(chamar({ acao: 'conferir_venda', cliente_nome: 'Renata', data: '', tipo: 'manutencao' }).args.p_data, null);
  // dia que ainda não chegou neste ano é do ano passado
  const amanha = new Date(Date.now() - 4 * 3600e3 + 86400e3);
  const dm = String(amanha.getUTCDate()).padStart(2, '0') + '/' + String(amanha.getUTCMonth() + 1).padStart(2, '0');
  const esperado = amanha.getUTCFullYear() > Number(ano) ? null : String(Number(ano) - 1);
  if (esperado) assert.ok(chamar({ acao: 'conferir_venda', cliente_nome: 'Ana', data: dm, tipo: 'outro' }).args.p_data.startsWith(esperado));
});

// ---------- portão (modo observar) ----------
const tipos = (r) => r.acoes.flatMap((x) => x.falhas.map((f) => f.tipo)).sort();
const ass = (fala, ...passos) => conferirAcoes({ agente: 'assistente', fala, passos });
const passo = (entrada, resultado = 'OK: {"ok": true}') => ({ ferramenta: 'conferir_venda', entrada, resultado });

test('portão: "tá certinho" confirma a lista como estava', () => {
  assert.deepStrictEqual(tipos(ass('tá certinho', passo({ cliente_nome: 'Vitoria', tipo: 'mega_novo' }), passo({ cliente_nome: 'Renata', tipo: 'manutencao' }))), []);
  assert.deepStrictEqual(tipos(ass('isso mesmo', passo({ cliente_nome: 'Vitoria', tipo: 'mega_novo' }))), []);
  assert.deepStrictEqual(tipos(ass('tudo certo', passo({ cliente_nome: 'Vitoria', tipo: 'mega_novo' }))), []);
});

test('portão: mega novo com "o cabelo dela" na fala é apontado; com cabelo novo dito, não', () => {
  assert.deepStrictEqual(tipos(ass('a vitoria foi o cabelo dela mesmo, recolocou', passo({ cliente_nome: 'Vitoria', tipo: 'mega_novo' }))), ['venda_mega_com_cabelo_da_cliente']);
  assert.deepStrictEqual(tipos(ass('a vitoria foi o cabelo dela mesmo', passo({ cliente_nome: 'Vitoria', tipo: 'manutencao' }))), []);
  assert.deepStrictEqual(tipos(ass('a vitoria foi cabelo novo, a renata o cabelo dela', passo({ cliente_nome: 'Vitoria', tipo: 'mega_novo' }), passo({ cliente_nome: 'Renata', tipo: 'manutencao' }))), []);
});

test('portão: "não fez" só com a Gleide dizendo; valor só se ela disse', () => {
  assert.deepStrictEqual(tipos(ass('a renata eu acho que foi manutenção', passo({ cliente_nome: 'Renata', tipo: 'nao_fez' }))), ['venda_nao_fez_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a dienne não veio', passo({ cliente_nome: 'Dienne', tipo: 'nao_fez' }))), []);
  assert.deepStrictEqual(tipos(ass('a vitoria foi cabelo novo', passo({ cliente_nome: 'Vitoria', tipo: 'mega_novo', valor: '1500' }))), ['valor_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a vitoria foi cabelo novo, pagou 1500', passo({ cliente_nome: 'Vitoria', tipo: 'mega_novo', valor: '1500' }))), []);
});

test('portão: o resumo das 20h tem nome para os alarmes novos', () => {
  const { montarResumo } = require('../portao-regras.js');
  const t = montarResumo([{ agente: 'assistente', n_falhas: 1, fala: 'x', criado_em: '2026-11-23T14:00:00Z',
    acoes: [{ ferramenta: 'conferir_venda', falhas: [{ tipo: 'venda_mega_com_cabelo_da_cliente' }] }] }], '23/11');
  assert.match(t, /conferência: gravou mega hair novo/);
});
