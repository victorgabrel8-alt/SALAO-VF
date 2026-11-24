// Testes da conferência semanal de vendas (conferencia-vendas.js, supabase/066). Rodar: node --test n8n/demo-agente/testes/*.test.js
// O banco é testado à parte: n8n/demo-agente/teste-066-vendas.sql (Loja Teste, transação desfeita).
// Revisão de 21/11 (testador + /code-review): lista no prompt pelo banco, 10h30, nomes iguais, "tá certo" só na conferência,
// tipo gravado diferente da lista, trecho da fala por cliente, "aplicação" sozinha não é cabelo novo.
const test = require('node:test');
const assert = require('node:assert');
const conferencia = require('../conferencia-vendas.js');
const { montarConferencia, REGRAS_PROMPT } = conferencia;
const { conferirAcoes, montarResumo } = require('../portao-regras.js');

// 23/11/2026 (segunda) 10h30 em Cuiabá
const SEGUNDA = Date.parse('2026-11-23T14:30:00Z');
let seq = 0;
const item = (nome, inicio, sugerido, extra = {}) => ({ agendamento_id: 'ag' + (++seq), cliente_id: 'cli-' + nome, nome, tel_final: '0000', inicio, sugerido, servico: '', valor: null, ...extra });

// ---------- texto para a Gleide ----------
test('lista de várias clientes: natural, sem número de pedido e sem "responda sim ou não"', () => {
  const t = montarConferencia([
    item('Vitoria', '2026-11-19T13:00:00Z', 'mega_novo'),
    item('Renata Souza', '2026-11-20T18:30:00Z', 'manutencao'),
    item('Dienne', '2026-11-21T17:00:00Z', 'manutencao', { valor: 1200 }),
  ], SEGUNDA);
  assert.match(t, /^Oi, Gleide! Fechando a semana das clientes que vieram pelo WhatsApp, eu anotei assim:/);
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
    'mega hair com cabelo novo. Foi isso mesmo? Se foi diferente, ou se teve mais alguém, me conta que eu acerto.');
});

test('primeira vez (itens de semanas atrás): "Organizando aqui os atendimentos das últimas semanas"', () => {
  const t = montarConferencia([item('Vitoria', '2026-11-04T17:00:00Z', 'manutencao'), item('Dienne', '2026-11-18T17:00:00Z', 'manutencao')], SEGUNDA);
  assert.match(t, /^Oi, Gleide! Organizando aqui os atendimentos das últimas semanas das clientes que vieram pelo WhatsApp, eu anotei assim:/);
  assert.match(t, /\*Vitoria\*, quarta 04\/11: manutenção/);
});

test('nomes: mesma cliente em dois dias fica só com o primeiro nome; clientes diferentes com nome parecido se diferenciam', () => {
  const t = montarConferencia([
    item('Renata Souza', '2026-11-19T13:00:00Z', 'manutencao'), item('Renata de Lima', '2026-11-20T13:00:00Z', 'manutencao'),
    item('Vitoria', '2026-11-18T13:00:00Z', 'manutencao'), item('Vitoria', '2026-11-21T13:00:00Z', 'mega_novo'),
    item('Vitória Lima', '2026-11-17T13:00:00Z', 'manutencao', { cliente_id: 'outra-vitoria' }),
    item('Ana Paula', '2026-11-17T15:00:00Z', 'manutencao', { tel_final: '1111' }), item('Ana Paula', '2026-11-17T16:00:00Z', 'manutencao', { cliente_id: 'outra-ana', tel_final: '2222' }),
  ], SEGUNDA);
  assert.match(t, /\*Renata Souza\*/);
  assert.match(t, /\*Renata Lima\*/);
  assert.match(t, /\*Vitória Lima\*/, 'com e sem acento é o mesmo primeiro nome');
  assert.match(t, /\*Ana Paula \(final 1111\)\*/);
  assert.match(t, /\*Ana Paula \(final 2222\)\*/);
});

test('nome em minúsculo sai com maiúscula; sem nome sai com o final do telefone; outro serviço sem "mão de obra"; vazio não manda', () => {
  assert.match(montarConferencia([item('joana silva', '2026-11-20T13:00:00Z', 'manutencao')], SEGUNDA), /\*Joana\*/);
  assert.match(montarConferencia([item('', '2026-11-20T13:00:00Z', 'manutencao', { tel_final: '4321' })], SEGUNDA), /\*cliente \(final 4321\)\*/);
  const t = montarConferencia([item('Ana', '2026-11-20T13:00:00Z', 'outro', { servico: 'Remoção de mega hair – mão de obra' })], SEGUNDA);
  assert.match(t, /eu anotei remoção de mega hair\./);
  assert.strictEqual(montarConferencia([], SEGUNDA), '');
  assert.strictEqual(montarConferencia(null, SEGUNDA), '');
  assert.strictEqual(montarConferencia([{ nome: 'sem id' }], SEGUNDA), '');
});

test('o prompt: não chuta cabelo novo, "aplicação" sozinha não prova, pergunta o dia, não cobra, lê a lista do banco', () => {
  assert.match(REGRAS_PROMPT, /Quem diz se foi cabelo novo é ela/);
  assert.match(REGRAS_PROMPT, /"Foi aplicação", "colocou o mega" ou "colocou o cabelo" NÃO dizem se o cabelo era novo/);
  assert.match(REGRAS_PROMPT, /Nunca escolha o dia por ela/);
  assert.match(REGRAS_PROMPT, /Se ela não responder à lista, não cobre/);
  assert.match(REGRAS_PROMPT, /\$\('Conferência: esperando resposta'\)/);
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
const caminho = (wf, de) => { const ordem = []; let at = de; while (at && !ordem.includes(at)) { ordem.push(at); at = wf.connections[at]?.main?.[0]?.[0]?.node; } return ordem; };

test('montagem: ferramenta, prompt, lista esperando resposta antes do agente e o ramo de segunda 10h30', () => {
  const a = montarAssistente();
  const antes = a.assistenteWorkflow.connections['Ler pendências'].main[0][0].node;
  conferencia({ assistenteWorkflow: a.assistenteWorkflow, pendenciasWorkflow: a.pendenciasWorkflow });
  require('../pendencias-loja.js')({ pendenciasWorkflow: a.pendenciasWorkflow, horas: [12, 18] });
  const ag = a.assistenteWorkflow, pe = a.pendenciasWorkflow;
  const t = ag.nodes.find((x) => x.name === 'conferir_venda');
  assert.strictEqual(t.parameters.workflowInputs.value.acao, 'conferir_venda');
  assert.ok(t.parameters.workflowInputs.value.desfazer);
  assert.strictEqual(ag.connections.conferir_venda.ai_tool[0][0].node, 'Agente assistente');
  assert.ok(ag.nodes.find((x) => x.name === 'Agente assistente').parameters.options.systemMessage.includes('CONFERÊNCIA DA SEMANA'));
  // Ler pendências → Conferência: esperando resposta → (o que vinha antes) … → Agente assistente
  const c = caminho(ag, 'Ler pendências');
  assert.deepStrictEqual(c.slice(0, 3), ['Ler pendências', 'Conferência: esperando resposta', antes]);
  assert.ok(c.includes('Agente assistente'));
  assert.match(ag.nodes.find((x) => x.name === 'Conferência: esperando resposta').parameters.url, /rpc\/n8n_conferencia_vendas_pendente_texto$/);

  const g = pe.nodes.find((x) => x.name === 'Conferência: toda segunda 10h30');
  assert.strictEqual(g.parameters.rule.interval[0].expression, '30 10 * * 1', 'às 10h00 saem as pendências de hora em hora');
  assert.deepStrictEqual(caminho(pe, 'Conferência: toda segunda 10h30'), ['Conferência: toda segunda 10h30', 'Conferência: lista', 'Conferência: montar',
    'Conferência: mandar para a Gleide', 'Conferência: guardar na memória', 'Conferência: marcar perguntado']);
  const no = (x) => pe.nodes.find((y) => y.name === x);
  assert.strictEqual(no('Conferência: mandar para a Gleide').onError, undefined, 'envio falhou: para e não marca');
  assert.strictEqual(no('Conferência: guardar na memória').onError, 'continueRegularOutput');
  assert.strictEqual(no('Conferência: marcar perguntado').onError, undefined, 'marcar falhou: alerta');
  assert.match(no('Conferência: lista').parameters.url, /rpc\/n8n_conferencia_vendas_lista$/);
  assert.match(no('Pendências novas').parameters.url, /rpc\/n8n_assistente_pendencias_uma_vez$/);
  assert.throws(() => conferencia({ assistenteWorkflow: ag, pendenciasWorkflow: pe }), /já montada/);
});

test('montagem: "Conferência: montar" monta uma mensagem por número; banco fora vira erro (alerta), lista vazia não manda', () => {
  const a = montarAssistente();
  conferencia({ assistenteWorkflow: a.assistenteWorkflow, pendenciasWorkflow: a.pendenciasWorkflow });
  const code = a.pendenciasWorkflow.nodes.find((x) => x.name === 'Conferência: montar').parameters.jsCode;
  const rodar = (json) => new Function('$input', '$env', code)({ first: () => ({ json }) }, { ASSISTENTE_NUMEROS: '5500000000001' });
  assert.deepStrictEqual(rodar({ data: '[]' }), []);
  assert.throws(() => rodar({ data: 'não é json' }), /não é JSON/);
  assert.throws(() => rodar({ error: { message: 'timeout' } }), /não consegui ler a lista/);
  const out = rodar({ data: JSON.stringify([item('Vitoria', '2026-11-19T13:00:00Z', 'mega_novo', { agendamento_id: 'x1' })]) });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].json.tel, '5500000000001');
  assert.deepStrictEqual(out[0].json.ids, ['x1']);
  assert.match(JSON.parse(out[0].json.memoria).data.content, /^\[\S+ \d\d\/\d\d \d\d:\d\d\] Oi, Gleide!/);
});

test('Montar chamada: conferir_venda chama a função certa e entende vários jeitos de escrever o dia', () => {
  const a = montarAssistente();
  const code = a.ferramentasWorkflow.nodes.find((x) => x.name === 'Montar chamada').parameters.jsCode;
  const chamar = (e) => new Function('$input', '$env', code)({ first: () => ({ json: { acao: 'conferir_venda', cliente_nome: 'Renata', tipo: 'manutencao', ...e } }) }, {})[0].json;
  const r = chamar({ pedido_por: '5500000000001', cliente_nome: 'Vitoria', data: '2026-11-13', tipo: 'mega_novo', valor: '1.500', observacoes: 'tá certinho' });
  assert.strictEqual(r.funcao, 'n8n_assistente_conferir_venda');
  assert.deepStrictEqual({ ...r.args, p_empresa_id: undefined }, { p_empresa_id: undefined, p_pedido_por: '5500000000001', p_nome: 'Vitoria',
    p_data: '2026-11-13', p_tipo: 'mega_novo', p_valor: 1500, p_fala: 'tá certinho', p_limpar_valor: false });
  assert.strictEqual(r.conferir.p_nome, '', 'não passa pela conferência de id (não tem id)');
  assert.match(chamar({ data: '13/11' }).args.p_data, /^\d{4}-11-13$/);
  assert.match(chamar({ data: 'terça 18/11' }).args.p_data, /^\d{4}-11-18$/);
  assert.strictEqual(chamar({ data: '18/11/26' }).args.p_data, '2026-11-18');
  assert.strictEqual(chamar({ data: '30/02/2026' }).args.p_data, null, 'dia que não existe fica sem data');
  assert.strictEqual(chamar({ data: '' }).args.p_data, null);
  assert.strictEqual(chamar({ valor: '0' }).args.p_valor, null);
  assert.strictEqual(chamar({ desfazer: 'sim' }).args.p_limpar_valor, true);
  // dia que ainda não chegou neste ano é do ano passado
  const hoje = new Date(Date.now() - 4 * 3600e3), amanha = new Date(hoje.getTime() + 86400e3);
  if (amanha.getUTCFullYear() === hoje.getUTCFullYear()) {
    const dm = String(amanha.getUTCDate()).padStart(2, '0') + '/' + String(amanha.getUTCMonth() + 1).padStart(2, '0');
    assert.ok(chamar({ data: dm }).args.p_data.startsWith(String(hoje.getUTCFullYear() - 1)));
  }
});

// ---------- portão (modo observar) ----------
const tipos = (r) => r.acoes.flatMap((x) => x.falhas.map((f) => f.tipo)).sort();
const ass = (fala, ...passos) => conferirAcoes({ agente: 'assistente', fala, passos });
// o banco devolve o que a lista mostrou (sugerido)
const cv = (cliente_nome, tipo, sugerido, extra = {}) => ({ ferramenta: 'conferir_venda', entrada: { cliente_nome, tipo, ...extra },
  resultado: 'OK: ' + JSON.stringify({ ok: true, nome: cliente_nome, sugerido, tipo }) });

test('portão: "tá certinho" confirma a lista como estava', () => {
  for (const f of ['tá certinho', 'isso mesmo', 'tudo certo', 'tá tudo certo', 'está tudo certo sim', 'certíssimo', 'é isso'])
    assert.deepStrictEqual(tipos(ass(f, cv('Vitoria', 'mega_novo', 'mega_novo'), cv('Renata', 'manutencao', 'manutencao'))), [], f);
});

test('portão: "tá certo" e a IA grava mega novo onde a lista dizia manutenção → alarme', () => {
  assert.deepStrictEqual(tipos(ass('tá certinho', cv('Renata', 'mega_novo', 'manutencao'))), ['venda_mega_sem_prova']);
});

test('portão: o "cabelo dela" vale só para a cliente de quem ela falou', () => {
  assert.deepStrictEqual(tipos(ass('a vitoria foi o cabelo dela mesmo, recolocou', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_com_cabelo_da_cliente']);
  assert.deepStrictEqual(tipos(ass('Tá certinho, mas a Vitoria foi o cabelo dela', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_com_cabelo_da_cliente']);
  assert.deepStrictEqual(tipos(ass('a vitoria foi o cabelo dela mesmo', cv('Vitoria', 'manutencao', 'mega_novo'))), []);
  assert.deepStrictEqual(tipos(ass('A Renata foi o cabelo dela, o resto tá certo', cv('Renata', 'manutencao', 'mega_novo'), cv('Vitoria', 'mega_novo', 'mega_novo'))), []);
  assert.deepStrictEqual(tipos(ass('as outras certinho, a Renata foi o cabelo dela', cv('Renata', 'manutencao', 'mega_novo'), cv('Vitoria', 'mega_novo', 'mega_novo'))), []);
  assert.deepStrictEqual(tipos(ass('a vitoria foi cabelo novo e a renata o cabelo dela', cv('Vitoria', 'mega_novo', 'manutencao'), cv('Renata', 'manutencao', 'mega_novo'))), []);
});

test('portão: "foi aplicação" ou "foi manutenção" não provam cabelo novo', () => {
  assert.deepStrictEqual(tipos(ass('a vitoria foi aplicação', cv('Vitoria', 'mega_novo', 'manutencao'))), ['venda_mega_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a vitoria foi manutenção', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a vitoria comprou o cabelo, foi cabelo novo', cv('Vitoria', 'mega_novo', 'manutencao'))), []);
});

test('portão: "não fez" só com a Gleide dizendo (vários jeitos); "não faltou" não prova', () => {
  assert.deepStrictEqual(tipos(ass('a renata eu acho que foi manutenção', cv('Renata', 'nao_fez', 'manutencao'))), ['venda_nao_fez_sem_prova']);
  for (const f of ['a dienne não veio', 'a Adriana nem veio', 'a Adriana não compareceu', 'essa da Adriana não foi feito', 'a Adriana acabou não vindo, remarcou'])
    assert.deepStrictEqual(tipos(ass(f, cv(f.match(/dienne/i) ? 'Dienne' : 'Adriana', 'nao_fez', 'manutencao'))), [], f);
  assert.deepStrictEqual(tipos(ass('a Adriana veio sim, não faltou', cv('Adriana', 'nao_fez', 'manutencao'))), ['venda_nao_fez_sem_prova']);
});

test('portão: valor só se ela disse', () => {
  assert.deepStrictEqual(tipos(ass('a vitoria foi cabelo novo', cv('Vitoria', 'mega_novo', 'mega_novo', { valor: '1500' }))), ['valor_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a vitoria foi cabelo novo, pagou 1500', cv('Vitoria', 'mega_novo', 'mega_novo', { valor: '1500' }))), []);
});

test('portão: "tá certo / tudo certo" NÃO cala os alarmes das outras ações (revisão de 21/11)', () => {
  const p = (ferramenta, entrada) => ({ ferramenta, entrada, resultado: 'OK: feito' });
  assert.deepStrictEqual(tipos(ass('tá certo, marca a Ana amanhã', p('marcar_horario', { servico: 'manutenção', inicio: '2026-11-24T15:00' }))), ['hora_sem_prova']);
  assert.deepStrictEqual(tipos(ass('tudo certo, e a Ana?', p('excluir_horario', { agendamento_id: 'x' }))), ['excluir_sem_prova']);
  assert.deepStrictEqual(tipos(ass('é isso, e a Bia?', p('concluir', { agendamento_id: 'x' }))), ['concluir_sem_prova']);
  assert.deepStrictEqual(tipos(ass('tudo certo', p('avisar_cliente', { agendamento_id: 'x' }))), ['envio_sem_pedido']);
});

test('portão: o resumo das 20h tem nome para os alarmes novos', () => {
  for (const [tipo, re] of [['venda_mega_com_cabelo_da_cliente', /gravou mega hair novo, mas a Gleide falou do cabelo/],
    ['venda_mega_sem_prova', /sem a Gleide dizer cabelo novo/], ['venda_nao_fez_sem_prova', /não aconteceu sem a Gleide dizer/]]) {
    const t = montarResumo([{ agente: 'assistente', n_falhas: 1, fala: 'x', criado_em: '2026-11-23T14:00:00Z',
      acoes: [{ ferramenta: 'conferir_venda', falhas: [{ tipo }] }] }], '23/11');
    assert.match(t, re);
  }
});

// ---------- segunda rodada do testador (21/11) ----------
const embrulhado = (cliente_nome, tipo, sugerido, extra = {}) => ({ ferramenta: 'conferir_venda', entrada: { cliente_nome, tipo, ...extra },
  resultado: JSON.stringify([{ resposta: 'OK: ' + JSON.stringify({ ok: true, nome: cliente_nome, sugerido, tipo }) }]) });

test('portão: resposta embrulhada ({"resposta": …}) também traz o sugerido e o erro', () => {
  assert.deepStrictEqual(tipos(ass('tá certinho', embrulhado('Vitoria', 'mega_novo', 'mega_novo'))), []);
  assert.deepStrictEqual(tipos(ass('tá certinho', embrulhado('Renata', 'mega_novo', 'manutencao'))), ['venda_mega_sem_prova']);
  const erro = { ferramenta: 'conferir_venda', entrada: { cliente_nome: 'Renata', tipo: 'mega_novo' }, resultado: JSON.stringify({ resposta: 'ERRO: achei mais de um atendimento' }) };
  assert.deepStrictEqual(conferirAcoes({ agente: 'assistente', fala: 'a renata foi o cabelo dela', passos: [erro] }).acoes, [], 'não gravou: nada a apontar');
});

test('portão: áudio sem pontuação separa as clientes', () => {
  assert.deepStrictEqual(tipos(ass('a renata foi o cabelo dela a vitoria foi cabelo novo', cv('Renata', 'mega_novo', 'mega_novo'))), ['venda_mega_com_cabelo_da_cliente']);
  assert.deepStrictEqual(tipos(ass('a renata foi o cabelo dela a vitoria foi cabelo novo', cv('Vitoria', 'mega_novo', 'manutencao'))), []);
  assert.deepStrictEqual(tipos(ass('a ana paula foi cabelo novo a ana clara o dela', cv('Ana Clara', 'mega_novo', 'mega_novo'))), ['venda_mega_com_cabelo_da_cliente']);
  assert.deepStrictEqual(tipos(ass('a ana paula foi cabelo novo a ana clara o dela', cv('Ana Paula', 'mega_novo', 'manutencao'))), []);
});

test('portão: falsos alarmes da segunda rodada não aparecem mais', () => {
  for (const f of ['oi amiga tá certo sim', 'pode ser, tá certo', '👍', 'exatamente'])
    assert.deepStrictEqual(tipos(ass(f, cv('Vitoria', 'mega_novo', 'mega_novo'))), [], f);
  assert.deepStrictEqual(tipos(ass('Vitória foi cabelo que comprou com a gente', cv('Vitória', 'mega_novo', 'manutencao'))), []);
  assert.deepStrictEqual(tipos(ass('a vitoria e a renata foram cabelo novo', cv('Vitoria', 'mega_novo', 'manutencao'), cv('Renata', 'mega_novo', 'manutencao'))), []);
  assert.deepStrictEqual(tipos(ass('só a renata que não, foi o cabelo dela', cv('Vitoria', 'mega_novo', 'mega_novo'))), []);
  assert.deepStrictEqual(tipos(ass('só a renata que não, foi o cabelo dela', cv('Renata', 'mega_novo', 'mega_novo'))), ['venda_mega_com_cabelo_da_cliente']);
  assert.deepStrictEqual(tipos(ass('adriana só veio olhar, não fez nada', cv('Adriana', 'nao_fez', 'manutencao'))), []);
});

test('portão: nome com "(final 1234)" acha o trecho da cliente', () => {
  assert.deepStrictEqual(tipos(ass('a renata souza foi o cabelo dela', cv('Renata Souza (final 6004)', 'mega_novo', 'mega_novo'))), ['venda_mega_com_cabelo_da_cliente']);
});

test('portão: "não tá certo" não confirma a lista', () => {
  for (const f of ['não tá certo', 'nao ta tudo certo', 'hmm, não está certo não', 'tá certo não'])
    assert.deepStrictEqual(tipos(ass(f, cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_sem_prova'], f);
  assert.deepStrictEqual(tipos(ass('oi amiga tá certo sim', cv('Vitoria', 'mega_novo', 'mega_novo'))), []);
});

// ---------- terceira rodada do testador (21/11) ----------
test('portão: "só a X que não" e "tá certo menos a X" não confirmam a X', () => {
  assert.deepStrictEqual(tipos(ass('só a Vitoria que não', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_sem_prova']);
  assert.deepStrictEqual(tipos(ass('tá certo menos a vitória', cv('Vitória', 'mega_novo', 'mega_novo'))), ['venda_mega_sem_prova']);
  assert.deepStrictEqual(tipos(ass('tá certo menos a vitória', cv('Renata', 'mega_novo', 'mega_novo'))), []);
});

test('portão: áudio sem artigo e com "faltou" separa as clientes', () => {
  assert.deepStrictEqual(tipos(ass('vitoria foi o cabelo dela renata foi cabelo novo', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_com_cabelo_da_cliente']);
  assert.deepStrictEqual(tipos(ass('vitoria foi o cabelo dela renata foi cabelo novo', cv('Renata', 'mega_novo', 'manutencao'))), []);
  assert.deepStrictEqual(tipos(ass('a vitória ela foi o dela a renata ela comprou cabelo', cv('Vitória', 'mega_novo', 'mega_novo'))), ['venda_mega_com_cabelo_da_cliente']);
  assert.deepStrictEqual(tipos(ass('a Adriana veio a Renata faltou', cv('Adriana', 'nao_fez', 'manutencao'))), ['venda_nao_fez_sem_prova']);
  assert.deepStrictEqual(tipos(ass('adriana veio renata faltou', cv('Adriana', 'nao_fez', 'manutencao'))), ['venda_nao_fez_sem_prova']);
  assert.deepStrictEqual(tipos(ass('adriana veio renata faltou', cv('Renata', 'nao_fez', 'manutencao'))), []);
});

test('portão: "beleza", "blz", "fechado" confirmam a lista; "tá certo?" (pergunta) não', () => {
  for (const f of ['beleza', 'blz', 'fechado', 'uhum']) assert.deepStrictEqual(tipos(ass(f, cv('Vitoria', 'mega_novo', 'mega_novo'))), [], f);
  assert.deepStrictEqual(tipos(ass('tá certo?', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_sem_prova']);
});

// ---------- /code-review da fase 2 (21/11) ----------
test('portão: a lista dizia cabelo novo e a IA gravou manutenção sem a Gleide dizer → alarme', () => {
  assert.deepStrictEqual(tipos(ass('tá certinho', cv('Vitoria', 'manutencao', 'mega_novo'))), ['venda_mega_rebaixada_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a vitoria foi o cabelo dela', cv('Vitoria', 'manutencao', 'mega_novo'))), []);
  assert.deepStrictEqual(tipos(ass('a vitoria foi manutenção', cv('Vitoria', 'manutencao', 'mega_novo'))), []);
  assert.deepStrictEqual(tipos(ass('tá certinho', cv('Renata', 'manutencao', 'manutencao'))), []);
});

test('portão: "isso não" / "certo não" não confirmam; "não teve problema" não prova que não aconteceu', () => {
  assert.deepStrictEqual(tipos(ass('isso não, tá errado', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_sem_prova']);
  assert.deepStrictEqual(tipos(ass('certo não', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a adriana não teve problema nenhum', cv('Adriana', 'nao_fez', 'manutencao'))), ['venda_nao_fez_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a adriana não teve atendimento', cv('Adriana', 'nao_fez', 'manutencao'))), []);
});

test('Montar chamada: desfazer só com "sim" exato apaga o valor', () => {
  const a = montarAssistente();
  const code = a.ferramentasWorkflow.nodes.find((x) => x.name === 'Montar chamada').parameters.jsCode;
  const chamar = (e) => new Function('$input', '$env', code)({ first: () => ({ json: { acao: 'conferir_venda', cliente_nome: 'Renata', tipo: 'manutencao', ...e } }) }, {})[0].json;
  assert.strictEqual(chamar({ desfazer: 'sem alteração' }).args.p_limpar_valor, false);
  assert.strictEqual(chamar({ desfazer: 'Sim' }).args.p_limpar_valor, true);
});

// ---------- quarta rodada do testador (21/11) ----------
test('portão: "cabelo novo comprou aqui" e "isso mesmo né?" não dão alarme falso', () => {
  for (const f of ['vitoria colocou cabelo novo comprou aqui comigo', 'a vitoria colocou cabelo novo ela comprou aqui'])
    assert.deepStrictEqual(tipos(ass(f, cv('Vitoria', 'mega_novo', 'manutencao'))), [], f);
  assert.deepStrictEqual(tipos(ass('isso mesmo né?', cv('Vitoria', 'mega_novo', 'mega_novo'))), []);
  assert.deepStrictEqual(tipos(ass('tá certo?', cv('Vitoria', 'mega_novo', 'mega_novo'))), ['venda_mega_sem_prova']);
});
