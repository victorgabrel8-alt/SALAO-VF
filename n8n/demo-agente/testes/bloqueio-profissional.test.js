// Bloqueio de uma profissional só na agenda da IA (bloqueio-por-profissional.js, supabase/076 e 077). Roda o "Preparar" e o
// "Calcular" gerados para a Caroline com agendas de mentira. Precisa do luxon (NODE_PATH). Rodar: node --test testes/
const test = require('node:test');
const assert = require('node:assert');
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('bloqueio por profissional (sem o luxon)', { skip: 'sem o luxon' }, () => {}); return; }

const wf = require('../lojas/carol/workflow-agenda-salao.json');
const codigo = (nome) => wf.nodes.find((n) => n.name === nome).parameters.jsCode;
const TZ = 'America/Cuiaba';
const C = 'c0000000-0000-4000-8000-000000000001', D = 'd0000000-0000-4000-8000-000000000002';
const EQUIPE = [{ id: C, nome: 'Caroline Ferreira', preferencia: 0, apelidos: ['carol'] }, { id: D, nome: 'Duda', preferencia: 1, apelidos: ['eduarda'] }];
const DIA = (() => { let d = DateTime.now().setZone(TZ).startOf('day').plus({ days: 3 }); while (d.weekday > 5) d = d.plus({ days: 1 }); return d; })();
const H = { seg: '08:00-18:00', ter: '08:00-18:00', qua: '08:00-18:00', qui: '08:00-18:00', sex: '08:00-18:00', sab: '08:00-18:00', dom: null };

const rodar = (pedido, cfgExtra = {}, ocupados = []) => {
  const no = (itens) => ({ first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })) });
  const prep = new Function('$input', 'DateTime', codigo('Preparar'))({ first: () => ({ json: { telefone: '5566999990000', ...pedido } }) }, DateTime)[0].json;
  const dados = { Preparar: [prep], 'Supabase: horários ocupados': ocupados, 'Supabase: config do salão': [{ config: { horario_funcionamento: H, almoco: null, ...cfgExtra } }],
    'Supabase: agendamentos da cliente': [], 'Supabase: equipe': [{ profissionais: EQUIPE, da_cliente: null }], 'Google: horários ocupados': [] };
  const $ = (nome) => { if (!dados[nome]) throw new Error('nó sem dado: ' + nome); return no(dados[nome]); };
  return new Function('$', 'DateTime', '$input', codigo('Calcular'))($, DateTime, no([]))[0].json;
};
const iso = (h) => DIA.set({ hour: h }).toFormat("yyyy-LL-dd'T'HH:mm");
const consultar = (cfg, extra = {}) => rodar({ acao: 'consultar', data: DIA.toISODate(), duracao_minutos: 60, ...extra }, cfg);
const criar = (h, prof, cfg) => rodar({ acao: 'criar', data_hora_inicio: iso(h), duracao_minutos: 60, nome: 'Ana', servico: 'Manicure', profissional: prof }, cfg);
const oferta = (r) => (/OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: (.*?)\. Não mande/.exec(r.resposta) || [])[1] || '';

const SO_CAROL_DIA = { bloqueios: [{ de: DIA.toISODate(), ate: DIA.toISODate(), motivo: 'prova', profissional_id: C, profissional: 'Caroline' }] };
const STUDIO_DIA = { bloqueios: [{ de: DIA.toISODate(), ate: DIA.toISODate(), motivo: 'viagem' }] };
const SO_DUDA_HORA = { bloqueios_horario: [{ dia: DIA.toISODate(), inicio: '08:00', fim: '18:00', motivo: 'médico', profissional_id: D, profissional: 'Duda' }] };

test('dia fechado só da Caroline: a IA oferece a Duda e o dia não aparece como fechado', () => {
  const r = consultar(SO_CAROL_DIA);
  assert.doesNotMatch(r.resposta, /FECHADO/);
  assert.match(oferta(r), /com a Duda/);
  assert.doesNotMatch(oferta(r), /Caroline/);
});

test('dia fechado só da Caroline: pedir a Caroline não oferece o dia dela', () => {
  const r = consultar(SO_CAROL_DIA, { profissional: 'Carol' });
  assert.doesNotMatch(oferta(r), new RegExp(DIA.toISODate() + 'T'));
});

test('dia fechado só da Caroline: criar com a Duda marca, com a Caroline não', () => {
  const d = criar(10, 'Duda', SO_CAROL_DIA);
  assert.equal(d.acao, 'criar'); assert.notEqual(d.ok, false); assert.equal(d.profissional_id, D);
  const c = criar(10, 'Caroline', SO_CAROL_DIA);
  assert.equal(c.ok, false);
});

test('dia fechado do studio: ninguém, a IA vai para o próximo dia', () => {
  const r = consultar(STUDIO_DIA);
  assert.match(r.resposta, /FECHADO|Próximo dia com vaga/);
  assert.equal(criar(10, 'Duda', STUDIO_DIA).ok, false);
});

test('hora fechada só da Duda: a Caroline continua sendo oferecida e marcada', () => {
  const r = consultar(SO_DUDA_HORA);
  assert.match(oferta(r), /com a Caroline/);
  assert.doesNotMatch(oferta(r), /Duda/);
  assert.equal(criar(10, 'Duda', SO_DUDA_HORA).ok, false);
  assert.equal(criar(10, '', SO_DUDA_HORA).profissional_id, C);
});

test('bloqueio sem profissional continua fechando as duas (como antes)', () => {
  const r = consultar({ bloqueios_horario: [{ dia: DIA.toISODate(), inicio: '08:00', fim: '18:00', motivo: 'reforma' }] });
  assert.doesNotMatch(oferta(r), new RegExp(DIA.toISODate() + 'T'));
});
