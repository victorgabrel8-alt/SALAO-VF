// Avisos de falta da Caroline (24/11/2026): aviso "não vem" (nao-vem.js), resumo das 18h com o sem baixa
// (resumo-noite.js), pendências sem "fulana veio?" (pendencias-loja.js) e AVISO que não sai repetido nem segura
// pergunta (pedido-numerado.js). Roda o código dos nós gerados para a Caroline com dados de mentira; não manda nada.
// Precisa do luxon (NODE_PATH). Rodar: node --test testes/aviso-falta.test.js
const test = require('node:test');
const assert = require('node:assert');
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('avisos de falta (sem o luxon)', { skip: 'sem o luxon' }, () => {}); return; }

const ler = (f) => require('../lojas/carol/' + f);
const codigo = (wf, nome) => { const n = ler(wf).nodes.find((x) => x.name === nome); assert.ok(n, 'sem o nó ' + nome); return n.parameters.jsCode; };
const TZ = 'America/Cuiaba';
const itens = (lista) => ({ first: () => ({ json: lista[0] || {} }), all: () => lista.map((json) => ({ json })) });
const rodar = (js, nos, entrada = [], env = {}) => {
  const $ = (nome) => { if (!(nome in nos)) throw new Error('nó sem dado: ' + nome); return itens(nos[nome]); };
  return new Function('$', '$input', '$env', 'DateTime', js)($, itens(entrada), env, DateTime);
};

test('não vem: aviso com dia, a outra profissional, o que ela escreveu, e o pedido AVISO para segurar o da IA', () => {
  const amanha = DateTime.now().setZone(TZ).plus({ days: 1 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
  const r = rodar(codigo('workflow-demo-salao.json', 'Não vem: mensagem'),
    { 'Extrair dados': [{ telefone: '5566999990000', jid: '5566999990000@s.whatsapp.net' }] },
    [{ avisar: true, agendamento_id: 'ag-1', nome: 'Rebeca de Souza Lima', inicio: amanha.toISO(), profissional: 'Duda', servico: 'Esmaltação em gel',
      texto: '[áudio] Amanhã eu não vou poder, tô sem condução' }]);
  assert.equal(r.length, 1);
  const j = r[0].json;
  assert.equal(j.tel, '5593991144926');
  assert.match(j.texto, /^⚠️ \*Rebeca de Souza\* tem horário amanhã às 14h com a Duda \(esmaltação em gel\) e escreveu:/);
  assert.match(j.texto, /"Amanhã eu não vou poder, tô sem condução"/);
  assert.doesNotMatch(j.texto, /\[áudio\]/);
  const p = JSON.parse(j.pedido);
  assert.match(p.pergunta, /^AVISO, não precisa responder: Rebeca de Souza não vem amanhã às 14h/);
  assert.equal(p.empresa, '26a5d3eb-e8e4-4ed8-b206-095095292fdd');
  assert.equal(p.telefone, '5566999990000');
  assert.equal(JSON.parse(j.memoria).data.content, j.texto);
});

test('não vem: horário da própria Caroline não diz "com a Caroline"', () => {
  const ini = DateTime.now().setZone(TZ).plus({ days: 3 }).set({ hour: 9, minute: 30 });
  const j = rodar(codigo('workflow-demo-salao.json', 'Não vem: mensagem'), { 'Extrair dados': [{ telefone: '1' }] },
    [{ avisar: true, nome: 'Ana', inicio: ini.toISO(), profissional: 'Caroline Ferreira', texto: 'preciso desmarcar' }])[0].json;
  assert.doesNotMatch(j.texto, /com a Caroline/);
  assert.match(j.texto, /às 9h30 e escreveu/);
});

const montar = () => codigo('workflow-faltas.json', 'Resumo: montar');
const resumo = (amanha, semBaixa) => rodar(montar(), {
  'Resumo: agenda de amanhã': amanha, 'Resumo: config': [{ config: {} }], 'Resumo: ler Google': [{}], 'Resumo: sem baixa': semBaixa,
  'Resumo: pedidos abertos': [{}],
}, [], { ASSISTENTE_NUMEROS: '5593991144926' });

test('resumo das 18h: sem cliente amanhã, mas com horário sem baixa, sai só a lista, sem pergunta de cada um', () => {
  const agora = DateTime.now().setZone(TZ);
  const r = resumo([], [
    { inicio: agora.minus({ hours: 3 }).toISO(), clientes: { nome: 'Dr Maila Souza' }, profissionais: { nome: 'Caroline' } },
    { inicio: agora.minus({ days: 4 }).set({ hour: 16, minute: 0 }).toISO(), clientes: { nome: 'Vanessa Vargas' }, profissionais: { nome: 'Duda' } },
  ]);
  assert.ok(r.length >= 1);
  const t = r[0].json.texto;
  assert.match(t, /🕒 \*Ainda sem baixa:\*/);
  assert.match(t, /\d\d\/\d\d 16:00 {2}Vanessa Vargas \(Duda\)/);
  assert.match(t, /hoje \d\d:\d\d {2}Dr Maila\n/); // da própria Caroline: sem "(Caroline)"
  assert.match(t, /Se alguma faltou, me fala que eu anoto\./);
  assert.doesNotMatch(t, /veio\?|Agenda de amanhã|Está tudo completo/);
});

test('resumo das 18h: agenda de amanhã continua igual e o sem baixa vem depois', () => {
  const amanha = DateTime.now().setZone(TZ).plus({ days: 1 }).set({ hour: 10, minute: 0 });
  const t = resumo([{ inicio: amanha.toISO(), fim: amanha.plus({ hours: 2 }).toISO(), clientes: { nome: 'Bia' }, servicos: { nome: 'Manicure' } }],
    [{ inicio: DateTime.now().setZone(TZ).minus({ hours: 2 }).toISO(), clientes: { nome: 'Ana' } }])[0].json.texto;
  assert.ok(t.indexOf('Agenda de amanhã') < t.indexOf('Ainda sem baixa'));
  assert.match(t, /10:00–12:00 {2}Bia — Manicure/);
});

test('resumo das 18h: nada amanhã e nada sem baixa, não manda nada', () => {
  assert.deepEqual(resumo([], []), []);
});

test('pendências: "fulana veio?" não sai mais; avaliação sem resultado continua', () => {
  const js = codigo('workflow-assistente-pendencias.json', 'Montar mensagem');
  const h12 = () => {
    const real = Date.now; const alvo = DateTime.now().setZone(TZ).set({ hour: 12, minute: 5 }).toMillis();
    Date.now = () => alvo; return () => { Date.now = real; };
  };
  const nos = { 'Pedido nº: abertos (pendências)': [{}] };
  const volta = h12();
  try {
    const so = rodar(js, nos, [{ tipo: 'atendimento_sem_status', pendencia_id: 'p1', nome: 'Ana', inicio: new Date().toISOString() }], { ASSISTENTE_NUMEROS: '5593991144926' });
    assert.deepEqual(so, []);
    const dois = rodar(js, nos, [
      { tipo: 'atendimento_sem_status', pendencia_id: 'p1', nome: 'Ana', inicio: new Date().toISOString() },
      { tipo: 'avaliacao_sem_resultado', pendencia_id: 'p2', nome: 'Bia', inicio: new Date().toISOString() },
    ], { ASSISTENTE_NUMEROS: '5593991144926' });
    assert.equal(dois.length, 1);
    assert.doesNotMatch(dois[0].json.texto, /veio\?/);
    assert.match(dois[0].json.texto, /avaliação de \*Bia\*/);
    assert.deepEqual(dois[0].json.ids, ['p2']);
  } finally { volta(); }
});

test('"veio ou libera" não sai mais: nem nas pendências, nem pelo fluxo de faltas; a IA continua chamando a atrasada', () => {
  const js = codigo('workflow-assistente-pendencias.json', 'Montar mensagem');
  assert.match(js, /\["atendimento_sem_status","atraso_confirmar"\]\.includes\(p\.tipo\)/);
  const F = ler('workflow-faltas.json');
  const nomes = F.nodes.map((n) => n.name);
  for (const n of ['Atrasos para confirmar', 'Mensagem veio ou libera', 'Perguntar à Caroline (atraso)']) assert.ok(!nomes.includes(n), n + ' ainda existe');
  assert.ok(nomes.includes('Atrasos para chamar') && nomes.includes('Chamar a atrasada'));
  const dosGatilhos = (F.connections['Horário do salão?'].main[0] || []).map((l) => l.node);
  assert.ok(!dosGatilhos.includes('Atrasos para confirmar') && dosGatilhos.includes('Atrasos para chamar'));
});

test('pergunta à dona: AVISO repetido não sai, AVISO não segura pergunta, pergunta repetida continua segurada', () => {
  const js = codigo('workflow-pergunta.json', 'Pedido nº: já tem aberto?');
  const emp = '26a5d3eb-e8e4-4ed8-b206-095095292fdd';
  const aberto = (pergunta, criado) => JSON.stringify({ telefone: '5566999990000', pergunta, tipo: 'pergunta', empresa: emp, criado });
  const ver = (abertos, pergunta) => rodar(js, {
    'Recebe pergunta da IA': [{ telefone: '556699990000', pergunta, tipo: 'pergunta' }],
    'Pedido nº: abertos': [Object.fromEntries(abertos.map((v, i) => ['carol:pedido:' + i, v]))],
  })[0].json.aberto;
  const agora = Date.now();
  const avisoNaoVem = aberto('AVISO, não precisa responder: Rebeca não vem amanhã às 14h', agora - 60e3);
  assert.ok(ver([avisoNaoVem], 'AVISO, não precisa responder: Rebeca não vem amanhã (sem condução)'), 'AVISO da IA logo depois do aviso do sistema: não sai');
  assert.equal(ver([avisoNaoVem], 'Ela pode trocar para quinta às 9h?'), null, 'pergunta de verdade não é segurada por AVISO');
  assert.equal(ver([aberto('AVISO, não precisa responder: x', agora - 7 * 3600e3)], 'AVISO, não precisa responder: y'), null, 'AVISO de 7 h atrás não segura');
  assert.ok(ver([aberto('Ela pode às 9h?', agora - 60e3)], 'E às 10h?'), 'pergunta repetida continua segurada (como antes)');
});
