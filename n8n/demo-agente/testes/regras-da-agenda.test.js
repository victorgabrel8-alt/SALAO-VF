// Testes das regras da agenda que a dona deu (agenda-calculo.js + equipe-agenda.js, supabase/071).
// Rodar: node --test n8n/demo-agente/testes/  (precisa do luxon: npm i luxon numa pasta e NODE_PATH para ela).
// Roda o "Preparar" e o "Calcular" gerados para a Caroline (lojas/carol/workflow-agenda-salao.json), sem n8n e sem banco.
const test = require('node:test');
const assert = require('node:assert');
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('regras da agenda (sem o luxon)', { skip: 'sem o luxon' }, () => {}); return; }

const wf = require('../lojas/carol/workflow-agenda-salao.json');
const codigo = (nome) => wf.nodes.find((n) => n.name === nome).parameters.jsCode;
const TZ = 'America/Cuiaba';
const C = 'c0000000-0000-4000-8000-000000000001', D = 'd0000000-0000-4000-8000-000000000002';
const CAROL = { id: C, nome: 'Caroline', preferencia: 0, apelidos: ['carol'] };
const DUDA = { id: D, nome: 'Duda', preferencia: 1, apelidos: ['eduarda'] };
// próximo dia da semana (1 = segunda ... 6 = sábado) daqui a 3 dias ou mais, fora de dezembro quando der
const proximo = (dow, { dezembro = false } = {}) => {
  let d = DateTime.now().setZone(TZ).startOf('day').plus({ days: 3 });
  if (dezembro && d.month !== 12) d = d.set({ month: 12, day: 1 });
  while (d.weekday !== dow) d = d.plus({ days: 1 });
  return d;
};
const SEG = proximo(1), SAB = proximo(6), QUA_DEZ = proximo(3, { dezembro: true }), QUA = proximo(3);
const iso = (d, h, m = 0) => d.set({ hour: h, minute: m }).toFormat("yyyy-LL-dd'T'HH:mm");
const ag = (prof, d, h1, h2) => ({ inicio: d.set({ hour: h1 }).toUTC().toISO(), fim: d.set({ hour: h2 }).toUTC().toISO(), status: 'agendado', profissional_id: prof });
const HF = { seg: '08:00-18:00', ter: '08:00-18:00', qua: '08:00-18:00', qui: '08:00-18:00', sex: '08:00-18:00', sab: '08:00-18:00', dom: null };
// as regras da Caroline, como ficam no banco (supabase/071)
const REGRAS = {
  ia_horas: [
    { dias: ['seg'], de: '00:00', ate: '11:00' },
    { dias: [], de: '09:00', ate: '09:30', de_dia: QUA_DEZ.set({ day: 1 }).toISODate(), ate_dia: QUA_DEZ.set({ day: 31 }).toISODate() },
  ],
  ia_periodo: { seg: { primeiro: 'tarde' }, ter: { primeiro: 'tarde' }, qua: { primeiro: 'tarde' }, qui: { primeiro: 'tarde' }, sex: { primeiro: 'tarde' },
    sab: { primeiro: 'manha', estrito: true } },
};
const cfg = (extra = REGRAS) => ({ config: { horario_funcionamento: HF, almoco: null, ...extra } });

const rodar = (pedido, { ocupados = [], daCliente = [], dela = null, config = cfg() } = {}) => {
  const no = (itens) => ({ first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })) });
  const prep = new Function('$input', 'DateTime', codigo('Preparar'))({ first: () => ({ json: { telefone: '5566999990000', ...pedido } }) }, DateTime)[0].json;
  const dados = {
    Preparar: [prep],
    'Supabase: horários ocupados': ocupados,
    'Supabase: config do salão': [config],
    'Supabase: agendamentos da cliente': daCliente,
    'Supabase: equipe': [{ profissionais: [CAROL, DUDA], da_cliente: dela }],
    'Google: horários ocupados': [],
  };
  const $ = (nome) => { if (!dados[nome]) throw new Error('nó sem dado: ' + nome); return no(dados[nome]); };
  return new Function('$', 'DateTime', '$input', codigo('Calcular'))($, DateTime, no([]))[0].json;
};
const oferta = (r) => (/OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: (.*?)\. Não mande/.exec(r.resposta) || [])[1] || '';
const inicios = (r) => (/Inícios que cabem o serviço \(de 30 em 30 min\): (.*?)\. Se ela/.exec(r.resposta) || [])[1] || '';
const consultar = (d, extra = {}, dados) => rodar({ acao: 'consultar', data: d.toISODate(), duracao_minutos: 60, ...extra }, dados);
const exato = (d, h, m = 0, dados) => rodar({ acao: 'consultar', data: iso(d, h, m), duracao_minutos: 60 }, dados);
const criar = (d, h, m = 0, dados) => rodar({ acao: 'criar', data_hora_inicio: iso(d, h, m), duracao_minutos: 60, nome: 'Ana', servico: 'Manicure' }, dados);
const horas = (txt) => [...txt.matchAll(/(\d{1,2})h(\d{2})?/g)].map((m) => +m[1] + (m[2] ? +m[2] / 60 : 0));

test('segunda: a IA não oferece nada antes das 11h (caso da Kelly, 23/11)', () => {
  const r = consultar(SEG, { periodo: 'manhã' });
  for (const h of horas(oferta(r))) assert.ok(h >= 11, 'ofereceu ' + h + 'h: ' + oferta(r));
  assert.match(r.resposta, /REGRAS DA DONA neste dia.*segunda: não começa horário antes das 11:00/);
  for (const h of horas(inicios(r))) assert.ok(h >= 11, 'início ' + h + 'h na lista: ' + inicios(r));
});

test('segunda 8h pedida pela cliente: INDISPONÍVEL por regra, e criar recusa', () => {
  assert.match(exato(SEG, 8).resposta, /^INDISPONÍVEL: .*regra da dona \(segunda: não começa horário antes das 11:00\)/);
  const c = criar(SEG, 8);
  assert.equal(c.ok, false);
  assert.match(c.resposta, /^NÃO AGENDADO: .*regra da dona/);
  // 11h pode
  assert.match(exato(SEG, 11).resposta, /^LIVRE: /);
  assert.equal(criar(SEG, 11).ok, true);
});

test('dezembro: 9h não começa, 8h e 9h30 podem', () => {
  assert.match(exato(QUA_DEZ, 9).resposta, /^INDISPONÍVEL: .*regra da dona \(todos os dias \(de 01\/12\/\d{4} até 31\/12\/\d{4}\): não começa horário das 09:00 até antes das 09:30\)/);
  assert.equal(criar(QUA_DEZ, 9).ok, false);
  assert.match(exato(QUA_DEZ, 8).resposta, /^LIVRE: /);
  assert.match(exato(QUA_DEZ, 9, 30).resposta, /^LIVRE: /);
});

test('dia de semana: oferece primeiro a tarde; manhã só se ela pedir', () => {
  const r = consultar(QUA);
  const hs = horas(oferta(r));
  assert.equal(hs.length, 2, oferta(r));
  for (const h of hs) assert.ok(h >= 12, 'ofereceu manhã sem ela pedir: ' + oferta(r));
  const m = consultar(QUA, { periodo: 'manhã' });
  for (const h of horas(oferta(m))) assert.ok(h < 12, oferta(m));
  // tarde cheia: aí vem a manhã
  const cheia = consultar(QUA, {}, { ocupados: [ag(C, QUA, 12, 18), ag(D, QUA, 12, 18)] });
  assert.ok(horas(oferta(cheia)).every((h) => h < 12), oferta(cheia));
});

test('sábado: a tarde só abre quando a manhã lota', () => {
  const r = consultar(SAB);
  for (const h of horas(oferta(r))) assert.ok(h < 12, 'ofereceu tarde com manhã livre: ' + oferta(r));
  for (const h of horas(inicios(r))) assert.ok(h < 12, 'tarde na lista de inícios: ' + inicios(r));
  // pediu a tarde: a IA conta e oferece a manhã
  const t = consultar(SAB, { periodo: 'tarde' });
  assert.match(t.resposta, /NO SÁBADO A TARDE SÓ ABRE QUANDO A MANHÃ LOTA \(regra da dona\)\. Ainda tem 8h/);
  assert.match(exato(SAB, 14).resposta, /^INDISPONÍVEL: .*sábado a tarde só abre quando a manhã lota, e ainda tem 8h/);
  const c = criar(SAB, 14);
  assert.equal(c.ok, false);
  assert.match(c.resposta, /^NÃO AGENDADO: /);
});

test('sábado com a manhã cheia (das duas): a tarde abre', () => {
  const cheia = { ocupados: [ag(C, SAB, 8, 12), ag(D, SAB, 8, 12)] };
  const r = consultar(SAB, {}, cheia);
  assert.ok(horas(oferta(r)).length > 0 && horas(oferta(r)).every((h) => h >= 12), oferta(r));
  assert.equal(criar(SAB, 14, 0, cheia).ok, true);
});

test('remarcar para segunda 8h: recusa por regra', () => {
  const meu = { id: 'a0000000-0000-4000-8000-000000000009', inicio: QUA.set({ hour: 14 }).toUTC().toISO(), fim: QUA.set({ hour: 15 }).toUTC().toISO(), profissional_id: D, servicos: { nome: 'Manicure' } };
  const r = rodar({ acao: 'remarcar', data_hora_nova: iso(SEG, 8) }, { daCliente: [meu], ocupados: [ag(D, QUA, 14, 15)] });
  assert.equal(r.ok, false);
  assert.match(r.resposta, /^NÃO REMARCADO: .*regra da dona/);
  const ok = rodar({ acao: 'remarcar', data_hora_nova: iso(SEG, 13) }, { daCliente: [meu], ocupados: [ag(D, QUA, 14, 15)] });
  assert.equal(ok.ok, true, ok.resposta);
});

test('cliente da Duda na segunda: nem a sugestão com a profissional dela fura a regra', () => {
  const r = consultar(SEG, { periodo: 'manhã' }, { dela: D, ocupados: [ag(D, SEG, 11, 12)] });
  for (const h of horas(r.resposta.split('Quadro do dia')[0])) assert.ok(h >= 11, r.resposta.slice(0, 400));
});

test('sem regras no banco: tudo como antes (8h de segunda é oferecido)', () => {
  const r = consultar(SEG, { periodo: 'manhã' }, { config: cfg({}) });
  assert.match(oferta(r), /^8h /);
  assert.doesNotMatch(r.resposta, /REGRAS DA DONA/);
  assert.equal(criar(SEG, 8, 0, { config: cfg({}) }).ok, true);
});
