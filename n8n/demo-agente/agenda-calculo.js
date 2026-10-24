// ===== Código dos nós Code do subworkflow "Agenda Salão" =====
// O montar-workflow.js injeta PREPARAR e CALCULAR nos nós. Rodam dentro do n8n (Luxon = DateTime).

// Horário de funcionamento (Luxon: 1=segunda ... 7=domingo). Vale só se o Supabase não responder:
// o normal é o CALCULAR trocar pelo horário e almoço do salão (empresas.config), os mesmos do CRM.
const CONFIG = `
const TZ = 'America/Cuiaba';
let EXPEDIENTE = {
  1: [['09:00', '12:00'], ['13:00', '18:00']], // segunda
  2: [['09:00', '12:00'], ['13:00', '18:00']], // terça
  3: [['09:00', '12:00'], ['13:00', '18:00']], // quarta
  4: [['09:00', '12:00'], ['13:00', '18:00']], // quinta
  5: [['09:00', '12:00'], ['13:00', '18:00']], // sexta
  6: [['08:00', '14:00']],                      // sábado
  7: [['08:00', '14:00']],                      // domingo
};
const PASSO_MIN = 30;        // grade de horários
const ANTECEDENCIA_MIN = 60; // não oferece horário com menos de 1h
const DIAS_BUSCA = 7;        // procura vagas até 7 dias à frente
const fmt = (d) => d.setLocale('pt-BR').toFormat("cccc, dd/LL 'às' HH:mm");
const iso = (d) => d.toFormat("yyyy-LL-dd'T'HH:mm");
const lerData = (s) => {
  s = String(s || '').trim().replace(' ', 'T');
  let d = DateTime.fromISO(s, { zone: TZ });
  if (!d.isValid) d = DateTime.fromFormat(s.slice(0, 10), 'dd/LL/yyyy', { zone: TZ });
  return d;
};
// Dias sem atender (viagem, folga...) que a Gleide bloqueia no app: empresas.config.bloqueios =
// [{ de: 'AAAA-MM-DD', ate: 'AAAA-MM-DD', motivo }]. Dia bloqueado não tem expediente: não oferece,
// não marca e não remarca para ele. O CALCULAR preenche a partir do config.
let BLOQUEIOS = [];
const bloqueado = (dia) => { const d = dia.toISODate(); return BLOQUEIOS.some((b) => d >= b.de && d <= (b.ate || b.de)); };
const intervalos = (dia) => (bloqueado(dia) ? [] : EXPEDIENTE[dia.weekday] || []).map(([a, b]) => [
  dia.set({ hour: +a.slice(0, 2), minute: +a.slice(3), second: 0, millisecond: 0 }),
  dia.set({ hour: +b.slice(0, 2), minute: +b.slice(3), second: 0, millisecond: 0 }),
]);
`;

const PREPARAR = CONFIG + `
const e = $input.first().json;
const acao = e.acao;
const dur = Math.max(15, Number(e.duracao_minutos) || 60);
const agora = DateTime.now().setZone(TZ);
let timeMin, timeMax, inicio = null, novo = null, erro = null;

if (['listar', 'cancelar', 'remarcar'].includes(acao)) {
  // agendamento atual (opcional: se a cliente só tem um, não precisa)
  if (e.data_hora_inicio) { inicio = lerData(e.data_hora_inicio); if (!inicio.isValid) inicio = null; }
  timeMin = agora; timeMax = agora.plus({ days: 1 });
  if (acao === 'remarcar') {
    novo = lerData(e.data_hora_nova);
    if (!novo.isValid) erro = 'data_hora_nova inválida. Use AAAA-MM-DDTHH:mm.';
    else { timeMin = novo.startOf('day'); timeMax = timeMin.plus({ days: 1 }); }
  }
} else if (acao === 'consultar') {
  let dia = lerData(e.data);
  if (!dia.isValid) erro = 'Data inválida. Envie no formato AAAA-MM-DD.';
  else {
    // "data" com hora (AAAA-MM-DDTHH:mm) = a cliente pediu um horário específico
    if (/T\\d{2}:\\d{2}/.test(String(e.data).replace(' ', 'T'))) inicio = dia;
    dia = dia.startOf('day');
    if (dia < agora.startOf('day')) dia = agora.startOf('day');
    timeMin = dia; timeMax = dia.plus({ days: DIAS_BUSCA });
  }
} else {
  inicio = lerData(e.data_hora_inicio);
  if (!inicio.isValid) erro = 'data_hora_inicio inválida. Use AAAA-MM-DDTHH:mm.';
  else { timeMin = inicio; timeMax = inicio.plus({ minutes: dur }); }
}

return [{ json: {
  acao, dur, erro, periodo: (e.periodo || 'qualquer').toLowerCase(),
  nome: e.nome || '', telefone: e.telefone || '', servico: e.servico || '',
  motivo: String(e.motivo || '').trim(),
  dia: timeMin ? timeMin.toISO() : null,
  inicio: inicio && inicio.isValid ? inicio.toISO() : null,
  novo: novo && novo.isValid ? novo.toISO() : null,
  agoraUtc: agora.toUTC().toISO(),
  timeMin: timeMin ? timeMin.toUTC().toISO() : null,
  timeMax: timeMax ? timeMax.toUTC().toISO() : null,
} }];
`;

const CALCULAR = CONFIG + `
const p = $('Preparar').first().json;
const agora = DateTime.now().setZone(TZ);
const saida = (o) => [{ json: { acao: p.acao, ok: false, ...o } }];
const FORA = 'A agenda está fora do ar agora. Peça desculpas à cliente e use transferir_para_humano para a equipe atender.';

// Horário e almoço do salão vêm do CRM (empresas.config.horario_funcionamento = {"ter": "09:00-19:00",
// "seg": null, ...} e config.almoco, padrão 11:00-13:00 como no app; almoco = null desliga).
try {
  const cfg = $('Supabase: config do salão').first().json.config;
  if (cfg && Array.isArray(cfg.bloqueios)) BLOQUEIOS = cfg.bloqueios.filter((b) => b && b.de);
  if (cfg && cfg.horario_funcionamento) {
    const DIAS = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab', 7: 'dom' };
    const alm = cfg.almoco === null ? null : (cfg.almoco && cfg.almoco.inicio ? cfg.almoco : { inicio: '11:00', fim: '13:00' });
    const doSalao = {};
    for (const [n, k] of Object.entries(DIAS)) {
      const faixa = cfg.horario_funcionamento[k];
      if (!faixa) continue;
      const [abre, fecha] = faixa.split('-');
      doSalao[n] = alm && alm.inicio > abre && alm.fim < fecha ? [[abre, alm.inicio], [alm.fim, fecha]] : [[abre, fecha]];
    }
    EXPEDIENTE = doSalao;
  }
} catch (e) {}

if (p.erro) return saida({ resposta: p.erro });
// A agenda é a do app (Supabase): o que a IA e a Gleide marcaram ocupa o horário. Sem fim gravado, conta 1 h.
// Se o Supabase não respondeu, não dá para saber o que está livre: a IA passa para a equipe.
const falhou = (itens) => itens.some((x) => x.error || (x.code && x.message));
const doCrm = $('Supabase: horários ocupados').all().map(i => i.json);
if (falhou(doCrm)) return saida({ resposta: FORA });
const ocupados = [];
for (const a of doCrm.filter(a => a.inicio)) {
  const ini = DateTime.fromISO(a.inicio).setZone(TZ);
  ocupados.push([ini, a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : ini.plus({ hours: 1 })]);
}
const livre = (ini, fim) => !ocupados.some(([a, b]) => ini < b && fim > a);
const noExpediente = (ini, fim) => intervalos(ini.startOf('day')).some(([a, b]) => ini >= a && fim <= b);

// ---- horários futuros desta cliente ----
// Do app (Supabase): os marcados pela IA E pela Gleide, só os que ainda vão acontecer.
if (['listar', 'cancelar', 'remarcar'].includes(p.acao)) {
  const itens = $('Supabase: agendamentos da cliente').all().map(i => i.json);
  if (falhou(itens)) return saida({ resposta: FORA });
  const evs = itens.filter(x => x.id).map(x => {
    const ini = DateTime.fromISO(x.inicio).setZone(TZ);
    return { agendamentoId: x.id, obs: x.observacoes || '', titulo: (x.servicos && x.servicos.nome) || 'Horário',
      ini, fim: x.fim ? DateTime.fromISO(x.fim).setZone(TZ) : ini.plus({ hours: 1 }) };
  });
  // "HOJE"/"AMANHÃ" escrito na lista: a IA errava o dia relativo fazendo a conta de cabeça
  const relativo = (d) => { const n = Math.round(d.startOf('day').diff(agora.startOf('day'), 'days').days); return n === 0 ? 'HOJE, ' : n === 1 ? 'AMANHÃ, ' : ''; };
  const listaEvs = evs.map(x => '- ' + x.titulo + ': ' + relativo(x.ini) + fmt(x.ini) + ' (data_hora_inicio: ' + iso(x.ini) + ')').join('\\n');
  if (!evs.length) return saida({ resposta: 'Não encontrei nenhum horário futuro marcado para esta cliente. Se ela diz que marcou, pode ter sido por outro número: use transferir_para_humano.' });
  if (p.acao === 'listar') return [{ json: { acao: 'listar', ok: true, resposta: 'Agendamentos futuros desta cliente:\\n' + listaEvs } }];

  let alvo = null;
  if (p.inicio) alvo = evs.find(x => +x.ini === +DateTime.fromISO(p.inicio).setZone(TZ));
  else if (evs.length === 1) alvo = evs[0];
  if (!alvo) return saida({ resposta: 'A cliente tem mais de um agendamento (ou o horário informado não bate). Agendamentos dela:\\n' + listaEvs + '\\nPergunte qual e chame de novo com o data_hora_inicio certo.' });

  if (p.acao === 'cancelar') return [{ json: { acao: 'cancelar', ok: true, agendamentoId: alvo.agendamentoId, de: fmt(alvo.ini) } }];

  // remarcar: mesmo agendamento, novo horário (mesma duração). O horário atual dela não conta como ocupado.
  const novo = DateTime.fromISO(p.novo).setZone(TZ);
  const dur = alvo.fim.diff(alvo.ini, 'minutes').minutes;
  const fimNovo = novo.plus({ minutes: dur });
  const semEle = [];
  for (const [a, b] of ocupados) {
    if (b <= alvo.ini || a >= alvo.fim) { semEle.push([a, b]); continue; }
    if (a < alvo.ini) semEle.push([a, alvo.ini]);
    if (b > alvo.fim) semEle.push([alvo.fim, b]);
  }
  if (novo < agora.plus({ minutes: ANTECEDENCIA_MIN })) return saida({ resposta: 'O novo horário já passou ou está muito em cima da hora. Ofereça outro.' });
  if (!noExpediente(novo, fimNovo)) return saida({ resposta: 'O novo horário fica fora do expediente (ou o serviço não cabe antes do almoço/fechamento). Consulte os horários livres e ofereça outro.' });
  if (semEle.some(([a, b]) => novo < b && fimNovo > a)) return saida({ resposta: 'O novo horário está ocupado. Consulte os horários livres e ofereça outro.' });
  // mesma anotação do CRM ("Reagendado de 20/10 às 13:00"): o app mostra o horário antigo
  const observacoes = [alvo.obs, 'Reagendado de ' + alvo.ini.toFormat('dd/LL') + ' às ' + alvo.ini.toFormat('HH:mm')].filter(Boolean).join('\\n');
  return [{ json: { acao: 'remarcar', ok: true, agendamentoId: alvo.agendamentoId, observacoes, de: fmt(alvo.ini), quando: fmt(novo),
    patch: { start: { dateTime: novo.toISO({ suppressMilliseconds: true }), timeZone: TZ }, end: { dateTime: fimNovo.toISO({ suppressMilliseconds: true }), timeZone: TZ } } } }];
}

if (p.acao === 'consultar') {
  // TODOS os horários de início livres do dia (sem amostragem: a IA precisa do quadro completo
  // para não "mudar" as opções a cada pergunta)
  const vagasDoDia = (dia) => {
    const v = [];
    for (const [a, b] of intervalos(dia)) {
      for (let t = a; t.plus({ minutes: p.dur }) <= b; t = t.plus({ minutes: PASSO_MIN })) {
        if (t < agora.plus({ minutes: ANTECEDENCIA_MIN })) continue;
        if (p.periodo.startsWith('manh') && t.hour >= 12) continue;
        if (p.periodo.startsWith('tard') && t.hour < 12) continue;
        if (livre(t, t.plus({ minutes: p.dur }))) v.push(t);
      }
    }
    return v;
  };
  // agrupa horários seguidos em faixas: "09:00 às 10:00; 14:30 às 16:00; 17:30"
  const faixas = (v) => {
    const out = [];
    for (const t of v) {
      const f = out[out.length - 1];
      if (f && t.diff(f[1], 'minutes').minutes === PASSO_MIN) f[1] = t; else out.push([t, t]);
    }
    return out.map(([a, b]) => (+a === +b ? a.toFormat('HH:mm') : a.toFormat('HH:mm') + ' às ' + b.toFormat('HH:mm'))).join('; ');
  };
  const quadro = (dia, v) => dia.setLocale('pt-BR').toFormat('cccc, dd/LL') + ' (' + dia.toFormat('yyyy-LL-dd') + ') — horários de INÍCIO livres para ' + p.dur +
    ' min, de 30 em 30 min: ' + faixas(v) + '. Qualquer horário dentro dessas faixas está livre; fora delas, não.';
  const pedido = DateTime.fromISO(p.dia).setZone(TZ).startOf('day');
  const fechado = !(EXPEDIENTE[pedido.weekday]);

  // Horário específico pedido pela cliente
  if (p.inicio && !fechado) {
    const t = DateTime.fromISO(p.inicio).setZone(TZ);
    const f = t.plus({ minutes: p.dur });
    let motivo = null;
    if (t < agora.plus({ minutes: ANTECEDENCIA_MIN })) motivo = 'já passou ou está muito em cima da hora';
    else if (!noExpediente(t, f)) {
      const ints = intervalos(pedido);
      const noAlmoco = ints.some(([, fimA], k) => ints[k + 1] && t >= fimA && t < ints[k + 1][0]);
      const comeca = ints.some(([a, b]) => t >= a && t < b);
      motivo = noAlmoco ? 'é horário de almoço do salão (' + ints[0][1].toFormat('HH:mm') + ' às ' + ints[1][0].toFormat('HH:mm') + ')'
        : comeca ? 'o serviço (' + p.dur + ' min) não termina antes do almoço/fechamento'
        : 'fica fora do horário de funcionamento';
    }
    else if (!livre(t, f)) motivo = 'já está ocupado';
    if (!motivo) return [{ json: { acao: 'consultar', ok: true, resposta: 'LIVRE: ' + fmt(t) + ' está disponível para ' + p.dur + ' min (data_hora_inicio: ' + iso(t) + '). Pode oferecer à cliente.' } }];
    const alt = vagasDoDia(pedido);
    return [{ json: { acao: 'consultar', ok: true, resposta: 'INDISPONÍVEL: ' + fmt(t) + ' ' + motivo + '.' +
      (alt.length ? ' Quadro completo do dia: ' + quadro(pedido, alt) + ' Ofereça os horários livres mais próximos do que ela pediu.' : ' Não há outro horário livre nesse dia; consulte outro dia.') } }];
  }
  let opcoes = vagasDoDia(pedido);
  let diaAlternativo = null;
  for (let i = 1; !opcoes.length && i < DIAS_BUSCA; i++) {
    const d = pedido.plus({ days: i });
    const o = vagasDoDia(d);
    if (o.length) { opcoes = o; diaAlternativo = d; }
  }
  const nomeDia = pedido.setLocale('pt-BR').toFormat('cccc, dd/LL');
  let resposta;
  if (!opcoes.length) resposta = 'Sem horários livres para ' + p.dur + ' min nos próximos ' + DIAS_BUSCA + ' dias. Diga isso à cliente e use transferir_para_humano para a equipe ver um encaixe.';
  else if (diaAlternativo) resposta = (fechado ? 'O salão está FECHADO em ' + nomeDia + '.' : 'Não há horário livre em ' + nomeDia + (p.periodo !== 'qualquer' ? ' no período da ' + p.periodo : '') + '.') +
    ' Próximo dia com vaga: ' + quadro(diaAlternativo, opcoes);
  else resposta = quadro(pedido, opcoes);
  return [{ json: { acao: 'consultar', ok: true, resposta } }];
}

// criar
const ini = DateTime.fromISO(p.inicio).setZone(TZ);
const fim = ini.plus({ minutes: p.dur });
if (ini < agora) return saida({ resposta: 'Esse horário já passou. Consulte os horários livres de novo.' });
if (!noExpediente(ini, fim)) return saida({ resposta: 'Esse horário está fora do horário de funcionamento (ou não cabe a duração do serviço). Consulte os horários livres de novo.' });
if (!livre(ini, fim)) return saida({ resposta: 'Esse horário acabou de ser ocupado. Consulte os horários livres de novo e ofereça outras opções.' });
return [{ json: {
  acao: 'criar', ok: true,
  quando: fmt(ini),
  // início e fim do novo horário (o "Montar agendamento" grava no app)
  evento: {
    start: { dateTime: ini.toISO({ suppressMilliseconds: true }), timeZone: TZ },
    end: { dateTime: fim.toISO({ suppressMilliseconds: true }), timeZone: TZ },
  },
} }];
`;

module.exports = { PREPARAR, CALCULAR };
