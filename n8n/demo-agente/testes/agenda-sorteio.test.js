// Teste por sorteio da agenda da Caroline (24/11/2026, pedido do Victor: "erro de agenda entre a Caroline, a IA e as
// clientes não pode ter"). Roda o "Preparar" e o "Calcular" gerados (lojas/carol/workflow-agenda-salao.json) em milhares
// de dias sorteados, com as regras reais dela, e confere o que nunca pode acontecer:
//   1. oferecer ou marcar um horário que encavala com cliente da MESMA profissional;
//   2. oferecer ou marcar fora do expediente, num bloqueio de hora, ou começando numa faixa que a dona proibiu;
//   3. sábado (manhã primeiro, estrito): oferecer a tarde enquanto a manhã daquela profissional tem vaga;
//   4. marcar (criar) e devolver ok com a profissional ocupada.
// Sem n8n e sem banco. Precisa do luxon (NODE_PATH para uma pasta com o luxon). Rodar: node --test testes/agenda-sorteio.test.js
const test = require('node:test');
const assert = require('node:assert');
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('agenda por sorteio (sem o luxon)', { skip: 'sem o luxon' }, () => {}); return; }

const wf = require('../lojas/carol/workflow-agenda-salao.json');
const codigo = (nome) => wf.nodes.find((n) => n.name === nome).parameters.jsCode;
const TZ = 'America/Cuiaba';
const C = 'c0000000-0000-4000-8000-000000000001', D = 'd0000000-0000-4000-8000-000000000002';
const EQUIPE = [{ id: C, nome: 'Caroline Ferreira', preferencia: 0, apelidos: ['carol'] }, { id: D, nome: 'Duda', preferencia: 1, apelidos: ['eduarda'] }];
const NOME = { [C]: 'Caroline', [D]: 'Duda' };
const HORARIO = { seg: '08:00-18:00', ter: '08:00-18:00', qua: '08:00-18:00', qui: '08:00-18:00', sex: '08:00-18:00', sab: '08:00-18:00', dom: null };
// as regras que estão no cadastro da Caroline em 24/11/2026
const IA_HORAS = [
  { dias: ['seg'], de: '00:00', ate: '11:00', de_dia: null, ate_dia: null },
  { dias: [], de: '09:00', ate: '09:30', de_dia: '2026-12-01', ate_dia: '2026-12-31' },
  { dias: ['sab'], de: '16:00', ate: '20:00', de_dia: null, ate_dia: null },
];
const IA_PERIODO = { seg: { primeiro: 'tarde', estrito: false }, ter: { primeiro: 'tarde', estrito: false }, qua: { primeiro: 'tarde', estrito: false },
  qui: { primeiro: 'tarde', estrito: false }, sex: { primeiro: 'tarde', estrito: false }, sab: { primeiro: 'manha', estrito: true } };
const SEM = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab', 7: 'dom' };

// sorteio repetível
let semente = 20261124;
const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648; };
const um = (lista) => lista[Math.floor(rnd() * lista.length)];

const rodar = (pedido, { ocupados, dela, bloqueios }) => {
  const no = (itens) => ({ first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })) });
  const prep = new Function('$input', 'DateTime', codigo('Preparar'))({ first: () => ({ json: { telefone: '5566999990000', ...pedido } }) }, DateTime)[0].json;
  const config = { config: { horario_funcionamento: HORARIO, almoco: null, ia_horas: IA_HORAS, ia_periodo: IA_PERIODO, bloqueios_horario: bloqueios } };
  const dados = { Preparar: [prep], 'Supabase: horários ocupados': ocupados, 'Supabase: config do salão': [config], 'Supabase: agendamentos da cliente': [],
    'Supabase: equipe': [{ profissionais: EQUIPE, da_cliente: dela }], 'Google: horários ocupados': [] };
  const $ = (nome) => { if (!dados[nome]) throw new Error('nó sem dado: ' + nome); return no(dados[nome]); };
  return new Function('$', 'DateTime', '$input', codigo('Calcular'))($, DateTime, no([]))[0].json;
};

// dias para sortear: segunda, quarta, sábado (daqui a 3+ dias) e uma quinta de dezembro (regra das 9h)
const dias = (() => {
  const base = DateTime.now().setZone(TZ).startOf('day').plus({ days: 3 });
  const prox = (wd) => { let d = base; while (d.weekday !== wd) d = d.plus({ days: 1 }); return d; };
  let dez = DateTime.fromISO('2026-12-10', { zone: TZ }); if (dez < base) dez = base.plus({ days: 14 });
  return [prox(1), prox(3), prox(6), dez];
})();

// um cenário sorteado: clientes das duas, bloqueio de hora às vezes
const cenario = (dia) => {
  const ocupados = [], bloqueios = [];
  for (const p of [C, D, null]) {
    const n = Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const ini = dia.set({ hour: 8 + Math.floor(rnd() * 9), minute: um([0, 30]) }), dur = um([45, 60, 90, 120, 150]);
      ocupados.push({ inicio: ini.toUTC().toISO(), fim: ini.plus({ minutes: dur }).toUTC().toISO(), status: 'agendado', profissional_id: p });
    }
  }
  if (rnd() < 0.3) { const h = 9 + Math.floor(rnd() * 7); bloqueios.push({ dia: dia.toISODate(), inicio: String(h).padStart(2, '0') + ':00', fim: String(h + 1 + Math.floor(rnd() * 2)).padStart(2, '0') + ':30', motivo: 'teste' }); }
  return { ocupados, bloqueios, dela: um([null, null, C, D]) };
};

// o que a agenda tem de garantir, para um início t de dur minutos com a profissional p. A Caroline reserva um bloco de
// 2h30 por cliente (loja.json bloco_minutos: 150): o horário ocupa no mínimo 150 min, como no Preparar.
const BLOCO = 150;
const problemas = (dia, t, dur, p, { ocupados, bloqueios }) => {
  const f = t.plus({ minutes: Math.max(BLOCO, dur) }), erros = [];
  const [a, b] = (HORARIO[SEM[dia.weekday]] || '00:00-00:00').split('-');
  if (t < dia.set({ hour: +a.slice(0, 2), minute: +a.slice(3) }) || f > dia.set({ hour: +b.slice(0, 2), minute: +b.slice(3) })) erros.push('fora do expediente');
  const dono = (o) => o.profissional_id || C; // horário sem profissional é da dona (a primeira do cadastro)
  for (const o of ocupados) if ((!p || dono(o) === p) && t < DateTime.fromISO(o.fim) && f > DateTime.fromISO(o.inicio)) erros.push('encavala com cliente de ' + NOME[dono(o)] + ' ' + DateTime.fromISO(o.inicio).setZone(TZ).toFormat('HH:mm'));
  for (const bl of bloqueios) { const bi = DateTime.fromISO(bl.dia + 'T' + bl.inicio, { zone: TZ }), bf = DateTime.fromISO(bl.dia + 'T' + bl.fim, { zone: TZ }); if (t < bf && f > bi) erros.push('bloqueio ' + bl.inicio + '-' + bl.fim); }
  const h = t.toFormat('HH:mm'), d = t.toISODate();
  for (const r of IA_HORAS) if ((!r.dias.length || r.dias.includes(SEM[t.weekday])) && (!r.de_dia || d >= r.de_dia) && (!r.ate_dia || d <= r.ate_dia) && h >= r.de && h < r.ate) erros.push('regra da dona: não começa ' + r.de + '-' + r.ate);
  return erros;
};
// pares "9h com a Duda (data_hora_inicio: 2026-..T09:00)" e "(data_hora_inicio: ...)" soltos
const ofertas = (texto) => {
  const out = [];
  for (const m of String(texto).matchAll(/(?:com a (Caroline|Duda)[^()]*?)?\(data_hora_inicio: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2})\)/g)) out.push({ prof: m[1] === 'Duda' ? D : m[1] === 'Caroline' ? C : null, t: DateTime.fromISO(m[2], { zone: TZ }) });
  return out;
};

const N = Number(process.env.SORTEIOS || 2000);
test('consultar: nada que a agenda oferece encavala, sai do expediente ou fura regra/bloqueio (' + N + ' sorteios)', () => {
  const falhas = [];
  for (let i = 0; i < N; i++) {
    const dia = um(dias), sc = cenario(dia), dur = um([45, 60, 90, 120, 150]);
    const periodo = um(['qualquer', 'qualquer', 'manha', 'tarde']), prof = um(['', '', '', 'Carol', 'Duda']);
    const r = rodar({ acao: 'consultar', data: dia.toISODate(), duracao_minutos: dur, periodo, profissional: prof }, sc);
    // só confere as 2 sugestões e o horário exato; o quadro lista inícios para a IA escolher, conferido abaixo
    const oferta = (/OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: (.*?)\. Não mande/.exec(r.resposta) || [])[1] || '';
    for (const o of ofertas(oferta)) {
      if (o.t.toISODate() !== dia.toISODate()) continue; // próximo dia com vaga: outro cenário
      const p = o.prof || (prof === 'Duda' ? D : prof === 'Carol' ? C : null);
      const e = problemas(dia, o.t, dur, p, sc);
      if (!p && e.length && problemas(dia, o.t, dur, C, sc).length && problemas(dia, o.t, dur, D, sc).length) falhas.push({ i, dia: dia.toISODate(), dur, periodo, prof, oferta: o.t.toFormat('HH:mm'), erros: e });
      else if (p && e.length) falhas.push({ i, dia: dia.toISODate(), dur, periodo, prof, com: NOME[p], oferta: o.t.toFormat('HH:mm'), erros: e });
      // sábado: manhã primeiro e estrito
      if (dia.weekday === 6 && o.t.hour >= 12 && periodo === 'qualquer' && p) {
        let manha = null;
        for (let x = dia.set({ hour: 8 }); x.plus({ minutes: Math.max(BLOCO, dur) }) <= dia.set({ hour: 12 }); x = x.plus({ minutes: 30 })) if (!problemas(dia, x, dur, p, sc).length && x > DateTime.now().plus({ hours: 1 })) { manha = x; break; }
        if (manha) falhas.push({ i, dia: dia.toISODate(), dur, prof, com: NOME[p], oferta: o.t.toFormat('HH:mm'), erros: ['sábado: ofereceu a tarde com a manhã livre às ' + manha.toFormat('HH:mm')] });
      }
    }
  }
  assert.equal(falhas.length, 0, falhas.length + ' falhas; primeiras: ' + JSON.stringify(falhas.slice(0, 5), null, 1));
});

test('horário exato pedido: LIVRE só quando cabe de verdade com alguém (' + N + ' sorteios)', () => {
  const falhas = [];
  for (let i = 0; i < N; i++) {
    const dia = um(dias), sc = cenario(dia), dur = um([45, 60, 90, 120, 150]);
    const t = dia.set({ hour: 7 + Math.floor(rnd() * 12), minute: um([0, 30]) });
    const prof = um(['', '', 'Carol', 'Duda']);
    const r = rodar({ acao: 'consultar', data: t.toFormat("yyyy-LL-dd'T'HH:mm"), duracao_minutos: dur, profissional: prof }, sc);
    if (!/^LIVRE/.test(r.resposta)) continue;
    const p = prof === 'Duda' ? D : prof === 'Carol' ? C : null;
    const okCom = p ? !problemas(dia, t, dur, p, sc).length : (!problemas(dia, t, dur, C, sc).length || !problemas(dia, t, dur, D, sc).length);
    if (!okCom) falhas.push({ i, dia: dia.toISODate(), hora: t.toFormat('HH:mm'), dur, prof, erros: problemas(dia, t, dur, p || C, sc).concat(p ? [] : problemas(dia, t, dur, D, sc)) });
  }
  assert.equal(falhas.length, 0, falhas.length + ' falhas; primeiras: ' + JSON.stringify(falhas.slice(0, 5), null, 1));
});

test('criar: quando marca, a profissional escolhida está livre e o horário respeita tudo (' + N + ' sorteios)', () => {
  const falhas = [];
  for (let i = 0; i < N; i++) {
    const dia = um(dias), sc = cenario(dia), dur = um([45, 60, 90, 120, 150]);
    const t = dia.set({ hour: 8 + Math.floor(rnd() * 10), minute: um([0, 30]) });
    const prof = um(['', '', 'Carol', 'Duda']);
    const r = rodar({ acao: 'criar', data_hora_inicio: t.toFormat("yyyy-LL-dd'T'HH:mm"), duracao_minutos: dur, nome: 'Ana', servico: 'Manicure', profissional: prof }, sc);
    if (r.acao !== 'criar' || r.ok === false) continue;
    const p = r.profissional_id || C;
    const e = problemas(dia, t, dur, p, sc);
    if (e.length) falhas.push({ i, dia: dia.toISODate(), hora: t.toFormat('HH:mm'), dur, pediu: prof, marcou_com: NOME[p], erros: e });
    if (prof === 'Duda' && p !== D) falhas.push({ i, pediu: 'Duda', marcou_com: NOME[p] });
    if (prof === 'Carol' && p !== C) falhas.push({ i, pediu: 'Caroline', marcou_com: NOME[p] });
  }
  assert.equal(falhas.length, 0, falhas.length + ' falhas; primeiras: ' + JSON.stringify(falhas.slice(0, 5), null, 1));
});
