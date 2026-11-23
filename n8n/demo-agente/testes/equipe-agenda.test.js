// Testes da equipe na agenda (equipe-agenda.js, supabase/069). Rodar: node --test n8n/demo-agente/testes/
// Roda o "Preparar" e o "Calcular" gerados para a Caroline (lojas/carol/workflow-agenda-salao.json) com agendas de
// mentira, sem n8n e sem banco. Precisa do luxon (o n8n já tem; aqui: npm i luxon numa pasta e NODE_PATH para ela).
const test = require('node:test');
const assert = require('node:assert');
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('equipe na agenda (sem o luxon: npm i luxon numa pasta e NODE_PATH para ela)', { skip: 'sem o luxon' }, () => {}); return; }

const wf = require('../lojas/carol/workflow-agenda-salao.json');
const codigo = (nome) => wf.nodes.find((n) => n.name === nome).parameters.jsCode;
const TZ = 'America/Cuiaba';
const C = 'c0000000-0000-4000-8000-000000000001', D = 'd0000000-0000-4000-8000-000000000002', B = 'b0000000-0000-4000-8000-000000000003';
const CAROL = { id: C, nome: 'Caroline Ferreira', preferencia: 0, apelidos: ['carol', 'karol'] };
const DUDA = { id: D, nome: 'Duda', preferencia: 1, apelidos: ['eduarda', 'dud'] };
const BIA = { id: B, nome: 'Bia', preferencia: 0, apelidos: [] };
// um dia de semana daqui a 3 dias ou mais, das 8h às 18h, sem almoço
const DIA = (() => { let d = DateTime.now().setZone(TZ).startOf('day').plus({ days: 3 }); while (d.weekday > 5) d = d.plus({ days: 1 }); return d; })();
const hora = (h, m = 0) => DIA.set({ hour: h, minute: m });
const isoH = (h, m = 0) => hora(h, m).toFormat("yyyy-LL-dd'T'HH:mm");
const ag = (prof, h1, h2, extra = {}) => ({ inicio: hora(h1).toUTC().toISO(), fim: hora(h2).toUTC().toISO(), status: 'agendado', profissional_id: prof, ...extra });
const CONFIG = { config: { horario_funcionamento: { seg: '08:00-18:00', ter: '08:00-18:00', qua: '08:00-18:00', qui: '08:00-18:00', sex: '08:00-18:00', sab: '08:00-18:00', dom: '08:00-18:00' }, almoco: null } };

// roda Preparar + Calcular; "dados" = o que cada nó de leitura devolveu
const rodar = (pedido, { ocupados = [], daCliente = [], equipe = [CAROL, DUDA], dela = null, semEquipe = false, config = CONFIG } = {}) => {
  const no = (itens) => ({ first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })) });
  const prep = new Function('$input', 'DateTime', codigo('Preparar'))({ first: () => ({ json: { telefone: '5566999990000', ...pedido } }) }, DateTime)[0].json;
  const dados = {
    Preparar: [prep],
    'Supabase: horários ocupados': ocupados,
    'Supabase: config do salão': [config],
    'Supabase: agendamentos da cliente': daCliente,
    'Supabase: equipe': [semEquipe ? { code: 'PGRST', message: 'erro' } : { profissionais: equipe, da_cliente: dela }],
    'Google: horários ocupados': [],
  };
  const $ = (nome) => { if (!dados[nome]) throw new Error('nó sem dado: ' + nome); return no(dados[nome]); };
  return new Function('$', 'DateTime', '$input', codigo('Calcular'))($, DateTime, no([]))[0].json;
};
const oferta = (r) => (/OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: (.*?)\. Não mande/.exec(r.resposta) || [])[1] || '';
const consultar = (extra, dados) => rodar({ acao: 'consultar', data: DIA.toISODate(), duracao_minutos: 150, ...extra }, dados);
const criar = (h, extra, dados) => rodar({ acao: 'criar', data_hora_inicio: isoH(h), duracao_minutos: 150, nome: 'Ana', servico: 'Manicure', ...extra }, dados);

test('cliente nova: os 2 horários oferecidos são da preferida (Duda)', () => {
  const o = oferta(consultar());
  assert.match(o, /^8h com a Duda .* ou 12h com a Duda /);
  assert.doesNotMatch(o, /Caroline/);
});

test('cliente nova: a Duda sem horário de manhã, pediu manhã: vem a Caroline', () => {
  const o = oferta(consultar({ periodo: 'manhã' }, { ocupados: [ag(D, 8, 13)] }));
  assert.match(o, /com a Caroline/);
  assert.doesNotMatch(o, /Duda/);
});

test('cliente nova: a Duda só tem a tarde e ela não disse período: oferece a tarde da Duda', () => {
  const o = oferta(consultar({}, { ocupados: [ag(D, 8, 13)] }));
  assert.match(o, /^13h com a Duda/);
  assert.doesNotMatch(o, /Caroline/);
});

test('cliente nova: a Duda com o dia cheio: oferece a Caroline no mesmo dia', () => {
  const r = consultar({}, { ocupados: [ag(D, 8, 18)] });
  assert.match(oferta(r), /^8h com a Caroline/);
  assert.doesNotMatch(r.resposta, /Próximo dia com vaga/);
});

test('cliente da Caroline continua com a Caroline', () => {
  const o = oferta(consultar({}, { dela: C }));
  assert.match(o, /^8h com a Caroline/);
  assert.doesNotMatch(o, /Duda/);
  assert.equal(criar(9, {}, { dela: C }).profissional_id, C);
});

test('cliente da Caroline: a Caroline cheia, vai para a Duda', () => {
  assert.match(oferta(consultar({}, { dela: C, ocupados: [ag(C, 8, 18)] })), /^8h com a Duda/);
});

test('cliente pede a Caroline pelo nome: só ela, e avisa quando a Duda tem o horário', () => {
  assert.doesNotMatch(oferta(consultar({ profissional: 'Carol' })), /Duda/);
  const r = rodar({ acao: 'consultar', data: isoH(9), duracao_minutos: 150, profissional: 'a Caroline' }, { ocupados: [ag(C, 8, 11)] });
  assert.match(r.resposta, /^INDISPONÍVEL: .*a Caroline já tem cliente nesse horário, MAS a Duda está livre nele/);
  const c = criar(9, { profissional: 'Caroline' }, { ocupados: [ag(C, 8, 11)] });
  assert.equal(c.ok, false);
  assert.match(c.resposta, /^NÃO AGENDADO: a Caroline já tem cliente nesse horário, mas a Duda está livre nele/);
});

test('apelido do cadastro: "Eduarda" acha a Duda', () => {
  assert.equal(criar(9, { profissional: 'Eduarda' }, { dela: C }).profissional_id, D);
});

test('horário exato que só a Caroline tem: livre com a Caroline', () => {
  const r = rodar({ acao: 'consultar', data: isoH(9), duracao_minutos: 150 }, { ocupados: [ag(D, 8, 12)] });
  assert.match(r.resposta, /^LIVRE: .* com a Caroline está disponível/);
});

test('criar: cliente nova com as duas livres fica com a Duda; com a Duda ocupada, com a Caroline', () => {
  const a = criar(9);
  assert.equal(a.profissional_id, D);
  assert.match(a.quando, /com a Duda$/);
  assert.equal(criar(9, {}, { ocupados: [ag(D, 8, 12)] }).profissional_id, C);
  assert.equal(criar(9, {}, { ocupados: [ag(D, 8, 12), ag(C, 9, 10)] }).ok, false);
});

test('horário sem profissional é da dona (a primeira do cadastro)', () => {
  assert.equal(criar(9, { profissional: 'Caroline' }, { ocupados: [ag(null, 9, 10)] }).ok, false);
  assert.equal(criar(9, {}, { ocupados: [ag(null, 9, 10)] }).profissional_id, D);
});

test('falta libera o horário', () => {
  assert.equal(criar(9, {}, { ocupados: [ag(D, 8, 12, { status: 'faltou' })] }).profissional_id, D);
});

test('hora bloqueada no app fecha para todas', () => {
  const config = { config: { ...CONFIG.config, bloqueios_horario: [{ dia: DIA.toISODate(), inicio: '08:00', fim: '12:00' }] } };
  assert.equal(criar(9, {}, { config }).ok, false);
  assert.match(oferta(consultar({}, { config })), /^12h com a Duda/);
});

test('remarcar: fica com a profissional do horário atual, mesmo com outra preferida', () => {
  const dela = { id: 'a1', ...ag(C, 9, 11, { observacoes: '', servicos: { nome: 'Manicure' } }) };
  const r = rodar({ acao: 'remarcar', data_hora_nova: isoH(14) }, { ocupados: [ag(C, 9, 11)], daCliente: [dela], dela: C });
  assert.equal(r.ok, true);
  assert.equal(r.profissional_id, C);
  assert.match(r.quando, /com a Caroline$/);
});

test('remarcar: a dela ocupada no horário novo passa para a outra; as duas ocupadas, não remarca', () => {
  const dela = { id: 'a1', ...ag(C, 9, 11, { observacoes: '', servicos: { nome: 'Manicure' } }) };
  const r = rodar({ acao: 'remarcar', data_hora_nova: isoH(14) }, { ocupados: [ag(C, 9, 11), ag(C, 14, 16)], daCliente: [dela], dela: C });
  assert.equal(r.profissional_id, D);
  const n = rodar({ acao: 'remarcar', data_hora_nova: isoH(14) }, { ocupados: [ag(C, 9, 11), ag(C, 14, 16), ag(D, 13, 15)], daCliente: [dela], dela: C });
  assert.equal(n.ok, false);
});

test('remarcar para cima do próprio horário: o horário dela não conta como ocupado', () => {
  const dela = { id: 'a1', ...ag(D, 9, 11, { observacoes: '', servicos: { nome: 'Manicure' } }) };
  const r = rodar({ acao: 'remarcar', data_hora_nova: isoH(10) }, { ocupados: [ag(D, 9, 11)], daCliente: [dela], dela: D });
  assert.equal(r.profissional_id, D);
});

test('listar: cada horário diz com quem é', () => {
  const itens = [{ id: 'a1', ...ag(D, 9, 11, { servicos: { nome: 'Manicure' } }) }, { id: 'a2', ...ag(null, 14, 16, { servicos: { nome: 'Pedicure' } }) }];
  const r = rodar({ acao: 'listar' }, { daCliente: itens });
  assert.match(r.resposta, /Manicure com a Duda/);
  assert.match(r.resposta, /Pedicure com a Caroline/);
});

test('sem preferência no cadastro (todas 0): diz as duas e grava com a primeira livre', () => {
  const equipe = [CAROL, { ...DUDA, preferencia: 0 }];
  assert.match(oferta(consultar({}, { equipe })), /^8h com a Caroline ou a Duda /);
  assert.equal(criar(9, {}, { equipe }).profissional_id, C);
  assert.equal(criar(9, {}, { equipe, ocupados: [ag(C, 9, 10)] }).profissional_id, D);
});

test('três profissionais: a ordem segue a preferência e o quadro só fecha com as três ocupadas', () => {
  const equipe = [CAROL, DUDA, { ...BIA, preferencia: 2 }];
  assert.match(oferta(consultar({}, { equipe })), /^8h com a Bia/);
  assert.equal(criar(9, {}, { equipe, ocupados: [ag(B, 8, 12)] }).profissional_id, D);
  assert.equal(criar(9, {}, { equipe, ocupados: [ag(B, 8, 12), ag(D, 8, 12)] }).profissional_id, C);
  const r = consultar({}, { equipe, ocupados: [ag(B, 8, 10), ag(D, 8, 10), ag(C, 8, 9)] });
  assert.match(r.resposta, /das 8h às 9h já tem cliente marcada/);
  assert.doesNotMatch(r.resposta, /das 8h às 10h já tem cliente marcada/);
});

test('loja de uma profissional só: tudo com ela', () => {
  const equipe = [CAROL];
  assert.match(oferta(consultar({}, { equipe })), /^8h com a Caroline/);
  assert.equal(criar(9, {}, { equipe }).profissional_id, C);
  assert.equal(criar(9, {}, { equipe, ocupados: [ag(null, 9, 10)] }).ok, false);
});

test('profissional que não está mais na equipe: o horário dela conta para a dona e a cliente não fica presa a ela', () => {
  assert.equal(criar(9, { profissional: 'Caroline' }, { ocupados: [ag(B, 9, 10)] }).ok, false);
  assert.equal(criar(9, {}, { dela: B }).profissional_id, D);
});

test('sem a equipe (banco fora): não oferece nem marca; listar continua', () => {
  assert.match(consultar({}, { semEquipe: true }).resposta, /fora do ar/);
  assert.equal(criar(9, {}, { semEquipe: true }).ok, false);
  const r = rodar({ acao: 'listar' }, { semEquipe: true, daCliente: [{ id: 'a1', ...ag(D, 9, 11, { servicos: { nome: 'Manicure' } }) }] });
  assert.equal(r.ok, true);
});

test('jeitos de chamar: Carolina, Carolzinha e Dudinha acham a profissional certa', () => {
  for (const nome of ['Carolina', 'a Carolzinha', 'CAROL']) assert.equal(criar(9, { profissional: nome }).profissional_id, C, nome);
  for (const nome of ['Dudinha', 'com a Duda', 'Eduarda']) assert.equal(criar(9, { profissional: nome }, { dela: C }).profissional_id, D, nome);
});

test('veio mais de um nome ("Caroline ou a Duda"): ela não escolheu, vale a ordem de sempre', () => {
  assert.equal(criar(9, { profissional: 'Caroline ou a Duda' }).profissional_id, D);
  assert.equal(criar(9, { profissional: 'Caroline ou a Duda' }, { dela: C }).profissional_id, C);
  assert.equal(criar(9, { profissional: 'Caroline ou a Duda' }, { ocupados: [ag(C, 8, 12)] }).profissional_id, D);
});

test('a preferida com um horário só no dia: ele e mais um da outra', () => {
  const o = oferta(consultar({}, { ocupados: [ag(D, 8, 15), { ...ag(D, 15, 16), fim: hora(15, 30).toUTC().toISO() }] }));
  assert.match(o, /^8h com a Caroline .* ou 15h30 com a Duda /);
});

test('nome que é começo de outro: "Anabela" não é a Ana', () => {
  const A = { id: C, nome: 'Ana', preferencia: 0, apelidos: [] }, AB = { id: D, nome: 'Anabela Souza', preferencia: 0, apelidos: [] };
  assert.equal(criar(9, { profissional: 'a Anabela' }, { equipe: [A, AB] }).profissional_id, D);
  assert.equal(criar(9, { profissional: 'Ana' }, { equipe: [A, AB] }).profissional_id, C);
});

test('duas com o mesmo primeiro nome: saem com dois nomes e o pedido acha a certa', () => {
  const equipe = [{ id: C, nome: 'Érica Lima', preferencia: 0, apelidos: [] }, { id: D, nome: 'Ana Paula', preferencia: 1, apelidos: ['paulinha'] }, { id: B, nome: 'Ana Clara', preferencia: 0, apelidos: [] }];
  const c = criar(9, { profissional: 'Ana Clara' }, { equipe });
  assert.equal(c.profissional_id, B);
  assert.match(c.quando, /com a Ana Clara$/);
  assert.equal(criar(9, { profissional: 'a Clara' }, { equipe }).profissional_id, B);
  assert.equal(criar(9, { profissional: 'Paulinha' }, { equipe }).profissional_id, D);
  assert.match(oferta(consultar({}, { equipe })), /^8h com a Ana Paula /);
  // só "Ana": não dá para saber qual, vale a ordem
  assert.equal(criar(9, { profissional: 'Ana' }, { equipe }).profissional_id, D);
});

test('"Karol" e "Karoline" acham a Caroline pelo apelido', () => {
  for (const nome of ['Karol', 'Karoline']) assert.equal(criar(9, { profissional: nome }).profissional_id, C, nome);
});

test('remarcar para a hora de outro horário dela: não fica com dois na mesma hora', () => {
  const a1 = { id: 'a1', ...ag(D, 9, 11, { observacoes: '', servicos: { nome: 'Manicure' } }) }, a2 = { id: 'a2', ...ag(C, 14, 16, { observacoes: '', servicos: { nome: 'Pedicure' } }) };
  const r = rodar({ acao: 'remarcar', data_hora_inicio: isoH(9), data_hora_nova: isoH(14) }, { ocupados: [ag(D, 9, 11), ag(C, 14, 16)], daCliente: [a1, a2], dela: C });
  assert.equal(r.ok, false);
  assert.match(r.resposta, /^NÃO REMARCADO: nesse horário ela já tem outro horário dela .Pedicure/);
});

test('remarcar pedindo uma profissional ocupada: avisa que a outra está livre', () => {
  const a1 = { id: 'a1', ...ag(D, 9, 11, { observacoes: '', servicos: { nome: 'Manicure' } }) };
  const r = rodar({ acao: 'remarcar', data_hora_nova: isoH(14), profissional: 'Caroline' }, { ocupados: [ag(D, 9, 11), ag(C, 13, 16)], daCliente: [a1], dela: D });
  assert.equal(r.ok, false);
  assert.match(r.resposta, /^NÃO REMARCADO: a Caroline já tem cliente nesse horário, mas a Duda está livre nele/);
});

test('pediu a Duda e ela está cheia no dia: diz que a Caroline tem horário e mostra o próximo dia da Duda', () => {
  const r = consultar({ profissional: 'Duda' }, { ocupados: [ag(D, 8, 18)] });
  assert.match(r.resposta, /Isso vale para a Duda, que ela pediu. Nesse dia a Caroline tem horário .ex.: 8h,/);
  assert.match(r.resposta, /Próximo dia com vaga com a Duda: /);
  // sem pedido de nome, o texto é o de sempre
  assert.match(consultar({}, { ocupados: [ag(D, 8, 18), ag(C, 8, 18)] }).resposta, /Próximo dia com vaga: /);
});
