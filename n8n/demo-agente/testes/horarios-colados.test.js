// Horários colados e o motivo de "não cabe" na agenda da Caroline (horarios-colados.js e equipe-agenda.js, 25/11/2026).
// Roda o "Preparar" e o "Calcular" gerados para a Caroline com agendas de mentira. Precisa do luxon (NODE_PATH).
const test = require('node:test');
const assert = require('node:assert');
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('horários colados (sem o luxon)', { skip: 'sem o luxon' }, () => {}); return; }

const wf = require('../lojas/carol/workflow-agenda-salao.json');
const codigo = (nome) => wf.nodes.find((n) => n.name === nome).parameters.jsCode;
const TZ = 'America/Cuiaba';
const C = 'c0000000-0000-4000-8000-000000000001', D = 'd0000000-0000-4000-8000-000000000002';
const EQUIPE = [{ id: C, nome: 'Caroline Ferreira', preferencia: 0, apelidos: ['carol'] }, { id: D, nome: 'Duda', preferencia: 1, apelidos: ['eduarda'] }];
const DIA = (() => { let d = DateTime.now().setZone(TZ).startOf('day').plus({ days: 3 }); while (d.weekday > 5) d = d.plus({ days: 1 }); return d; })();
const H = { seg: '08:00-18:00', ter: '08:00-18:00', qua: '08:00-18:00', qui: '08:00-18:00', sex: '08:00-18:00', sab: '08:00-18:00', dom: null };
// a Duda fora o dia todo: só a agenda da Caroline conta
const SO_CAROL = { bloqueios_horario: [{ dia: DIA.toISODate(), inicio: '08:00', fim: '18:00', motivo: 'folga', profissional_id: D, profissional: 'Duda' }] };
const marcado = (de, ate) => ({ inicio: DIA.set({ hour: +de.slice(0, 2), minute: +de.slice(3) }).toISO(), fim: DIA.set({ hour: +ate.slice(0, 2), minute: +ate.slice(3) }).toISO(), profissional_id: C });

const rodar = (pedido, ocupados = [], cfg = SO_CAROL) => {
  const no = (itens) => ({ first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })) });
  const prep = new Function('$input', 'DateTime', codigo('Preparar'))({ first: () => ({ json: { telefone: '5566999990000', ...pedido } }) }, DateTime)[0].json;
  const dados = { Preparar: [prep], 'Supabase: horários ocupados': ocupados, 'Supabase: config do salão': [{ config: { horario_funcionamento: H, almoco: null, ...cfg } }],
    'Supabase: agendamentos da cliente': [], 'Supabase: equipe': [{ profissionais: EQUIPE, da_cliente: null }], 'Google: horários ocupados': [] };
  const $ = (nome) => { if (!dados[nome]) throw new Error('nó sem dado: ' + nome); return no(dados[nome]); };
  return new Function('$', 'DateTime', '$input', codigo('Calcular'))($, DateTime, no([]))[0].json;
};
const oferta = (r) => (/OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: (.*?)\. Não mande/.exec(r.resposta) || [])[1] || '';

test('colado: a tarde oferece o horário que termina quando a próxima cliente chega, não o primeiro livre', () => {
  // Caroline: 08:00-10:30 e 15:00-17:30. Bloco de 150 min: à tarde cabem 12:00 (deixa 30 min de buraco antes das 15h) e 12:30 (encosta)
  const r = rodar({ acao: 'consultar', data: DIA.toISODate(), duracao_minutos: 45 }, [marcado('08:00', '10:30'), marcado('15:00', '17:30')]);
  const o = oferta(r);
  assert.match(o, /10h30 com a Caroline/, o);
  assert.match(o, /12h30 com a Caroline/, o);
  assert.doesNotMatch(o, /\b12h com/, o);
});

test('sem nenhuma cliente no dia: a abertura vem primeiro, como antes', () => {
  const o = oferta(rodar({ acao: 'consultar', data: DIA.toISODate(), duracao_minutos: 45 }));
  assert.match(o, /^8h com a Caroline/, o);
});

test('motivo: horário que não cabe antes do próximo compromisso diz a hora dele, não "ocupado"', () => {
  const r = rodar({ acao: 'consultar', data: DIA.set({ hour: 14 }).toFormat("yyyy-LL-dd'T'HH:mm"), duracao_minutos: 45, profissional: 'Caroline' }, [marcado('16:00', '17:30')]);
  assert.match(r.resposta, /não cabe: o serviço leva 150 min e às 16:00 já tem compromisso/, r.resposta);
});

test('motivo: horário com cliente marcada no começo continua "já está ocupado"', () => {
  const r = rodar({ acao: 'consultar', data: DIA.set({ hour: 10, minute: 30 }).toFormat("yyyy-LL-dd'T'HH:mm"), duracao_minutos: 45, profissional: 'Caroline' }, [marcado('10:00', '12:30')]);
  assert.match(r.resposta, /já está ocupado/, r.resposta);
});
