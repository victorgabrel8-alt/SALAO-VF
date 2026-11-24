// Testes da confirmação da véspera que confere a Google da dona (lembrete-confere-google.js).
// Rodar: node --test n8n/demo-agente/testes/  (precisa do luxon: npm i luxon numa pasta e NODE_PATH para ela).
// Roda o nó "Lembrete: confere a Google" e a "Mensagem do lembrete" gerados para a Caroline, sem n8n.
const test = require('node:test');
const assert = require('node:assert');
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('lembrete confere a Google (sem o luxon)', { skip: 'sem o luxon' }, () => {}); return; }

const wf = require('../lojas/carol/workflow-faltas.json');
const codigo = (nome) => wf.nodes.find((n) => n.name === nome).parameters.jsCode;
const TZ = 'America/Cuiaba';
const utc = (s) => DateTime.fromISO(s, { zone: TZ }).toUTC();
const ev = (titulo, ini, fim) => ['BEGIN:VEVENT', 'DTSTART:' + utc(ini).toFormat("yyyyLLdd'T'HHmmss'Z'"), 'DTEND:' + utc(fim || DateTime.fromISO(ini).plus({ hours: 1 }).toISO()).toFormat("yyyyLLdd'T'HHmmss'Z'"),
  'SUMMARY:' + titulo, 'STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT'].join('\r\n');
const ics = (...evs) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...evs, 'END:VCALENDAR'].join('\r\n');
const lem = (id, nome, cli, ini) => ({ agendamento_id: id, cliente_id: cli, nome, telefone: '5566900000' + id.length, inicio: utc(ini).toISO(), servico: 'Manicure', momento: 'vespera' });

const rodar = ({ lembretes, google, app = [] }) => {
  const no = (itens) => ({ first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })) });
  const dados = {
    'Lembretes para mandar': lembretes,
    'Lembrete: ler Google': google === null ? [{ error: { message: 'timeout' } }] : [{ data: google }],
    'Lembrete: agenda do app': [...lembretes.map((l) => ({ cliente_id: l.cliente_id, inicio: l.inicio, clientes: { nome: l.nome } })), ...app],
    'Lembretes: com quem': [],
  };
  const $ = (n) => { if (!dados[n]) throw new Error('sem ' + n); return no(dados[n]); };
  const r = new Function('$', 'DateTime', '$input', codigo('Lembrete: confere a Google'))($, DateTime, no([]))[0].json;
  dados['Lembrete: confere a Google'] = [r];
  const saem = new Function('$', 'DateTime', '$input', codigo('Mensagem do lembrete'))($, DateTime, no([])).map((x) => x.json.agendamento_id);
  return { ...r, saem };
};

test('Poly: app sexta 18h, Google "Polly" quinta 18h: segura e avisa a dona', () => {
  const r = rodar({ lembretes: [lem('p', 'Poly', 'cp', '2026-12-04T18:00')], google: ics(ev('Polly', '2026-12-03T18:00')) });
  assert.deepEqual(r.segurar, ['p']);
  assert.deepEqual(r.saem, []);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0].texto, /Não mandei a confirmação da \*Poly\*: no app ela está sex 04\/12 às 18:00 .*qui 03\/12 às 18:00 \("Polly"\)/);
  assert.equal(r.avisos[0].tel, '5593991144926');
});

test('mesmo horário no app e na Google (até 30 min): sai normal', () => {
  const r = rodar({ lembretes: [lem('h', 'Helena Moreno', 'ch', '2026-11-24T13:00')], google: ics(ev('Helena moreno', '2026-11-24T13:15')) });
  assert.deepEqual(r.segurar, []);
  assert.deepEqual(r.saem, ['h']);
});

test('sobrenome diferente não é a mesma cliente (Maria Cecilia x Maria Eduarda)', () => {
  const r = rodar({ lembretes: [lem('m', 'Maria Eduarda Pereira', 'cm', '2026-12-12T08:00')], google: ics(ev('Maria cecilia', '2026-12-12T18:00')) });
  assert.deepEqual(r.saem, ['m']);
});

test('Maria Eduarda Pereira: 8h no app, 9h na Google: segura', () => {
  const r = rodar({ lembretes: [lem('m', 'Maria Eduarda Pereira', 'cm', '2026-12-12T08:00')], google: ics(ev('Maria eduarda pereira', '2026-12-12T09:00')) });
  assert.deepEqual(r.segurar, ['m']);
});

test('o evento da Google é outro horário dela no app: sai normal', () => {
  const r = rodar({ lembretes: [lem('k', 'Kelly', 'ck', '2026-12-21T15:00')], google: ics(ev('Kelly', '2026-12-22T08:00')),
    app: [{ cliente_id: 'ck', inicio: utc('2026-12-22T08:00').toISO(), clientes: { nome: 'Kelly' } }] });
  assert.deepEqual(r.saem, ['k']);
});

test('o evento da Google é de OUTRA cliente do app com o mesmo nome (outra Iara): sai normal', () => {
  const r = rodar({ lembretes: [lem('i', 'Iara Lisboa', 'ci', '2026-12-06T10:00')], google: ics(ev('Iara', '2026-12-05T10:00')),
    app: [{ cliente_id: 'outra', inicio: utc('2026-12-05T10:00').toISO(), clientes: { nome: 'iara rufatto' } }] });
  assert.deepEqual(r.saem, ['i']);
});

test('Google fora do ar ou cliente que não está na Google: sai normal', () => {
  assert.deepEqual(rodar({ lembretes: [lem('p', 'Poly', 'cp', '2026-12-04T18:00')], google: null }).saem, ['p']);
  assert.deepEqual(rodar({ lembretes: [lem('n', 'Fernanda Nova', 'cn', '2026-12-10T14:00')], google: ics(ev('Polly', '2026-12-10T14:00')) }).saem, ['n']);
});

test('evento de dia inteiro (casamento) não segura confirmação de ninguém', () => {
  const dia = ['BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20261217', 'DTEND;VALUE=DATE:20261218', 'SUMMARY:Katia', 'END:VEVENT'].join('\r\n');
  assert.deepEqual(rodar({ lembretes: [lem('k', 'Katia Satyro', 'ck', '2026-12-16T17:00')], google: ics(dia) }).saem, ['k']);
});
