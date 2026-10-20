// ===== Código dos nós Code do subworkflow "Agenda Salão" =====
// O montar-workflow.js injeta PREPARAR e CALCULAR nos nós. Rodam dentro do n8n (Luxon = DateTime).

// Horário de funcionamento (Luxon: 1=segunda ... 7=domingo). Manter igual ao prompt-agente.md.
const CONFIG = `
const TZ = 'America/Cuiaba';
const EXPEDIENTE = {
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
const intervalos = (dia) => (EXPEDIENTE[dia.weekday] || []).map(([a, b]) => [
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
const fb = $('Google: horários ocupados').first().json;
const agora = DateTime.now().setZone(TZ);
const saida = (o) => [{ json: { acao: p.acao, ok: false, ...o } }];
const FORA = 'A agenda está fora do ar agora. Peça desculpas à cliente e use transferir_para_humano para a equipe atender.';

if (p.erro) return saida({ resposta: p.erro });
if (fb.error || !fb.calendars) return saida({ resposta: FORA });

const cal = Object.values(fb.calendars)[0] || {};
if (cal.errors) return saida({ resposta: FORA });
const ocupados = (cal.busy || []).map(b => [DateTime.fromISO(b.start).setZone(TZ), DateTime.fromISO(b.end).setZone(TZ)]);
const livre = (ini, fim) => !ocupados.some(([a, b]) => ini < b && fim > a);
const noExpediente = (ini, fim) => intervalos(ini.startOf('day')).some(([a, b]) => ini >= a && fim <= b);

// ---- agendamentos já feitos por esta cliente (achados pelo telefone na descrição do evento) ----
if (['listar', 'cancelar', 'remarcar'].includes(p.acao)) {
  const ev = $input.first().json;
  if (ev.error) return saida({ resposta: FORA });
  const evs = (ev.items || []).filter(x => x.start && x.start.dateTime && x.status !== 'cancelled')
    .map(x => ({ id: x.id, titulo: x.summary || '', ini: DateTime.fromISO(x.start.dateTime).setZone(TZ), fim: DateTime.fromISO(x.end.dateTime).setZone(TZ) }));
  const listaEvs = evs.map(x => '- ' + x.titulo + ': ' + fmt(x.ini) + ' (data_hora_inicio: ' + iso(x.ini) + ')').join('\\n');
  if (!evs.length) return saida({ resposta: 'Não encontrei nenhum agendamento futuro feito por este WhatsApp. Se ela marcou direto com a Gleide ou por outro número, use transferir_para_humano.' });
  if (p.acao === 'listar') return [{ json: { acao: 'listar', ok: true, resposta: 'Agendamentos futuros desta cliente:\\n' + listaEvs } }];

  let alvo = null;
  if (p.inicio) alvo = evs.find(x => +x.ini === +DateTime.fromISO(p.inicio).setZone(TZ));
  else if (evs.length === 1) alvo = evs[0];
  if (!alvo) return saida({ resposta: 'A cliente tem mais de um agendamento (ou o horário informado não bate). Agendamentos dela:\\n' + listaEvs + '\\nPergunte qual e chame de novo com o data_hora_inicio certo.' });

  if (p.acao === 'cancelar') return [{ json: { acao: 'cancelar', ok: true, eventId: alvo.id, de: fmt(alvo.ini) } }];

  // remarcar: mesmo evento, novo horário (mesma duração). O horário atual dela não conta como ocupado.
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
  return [{ json: { acao: 'remarcar', ok: true, eventId: alvo.id, de: fmt(alvo.ini), quando: fmt(novo),
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
  evento: {
    // título com o motivo resumido, para a Gleide bater o olho na agenda e saber o que a cliente quer
    summary: (p.servico + ' - ' + p.nome + (p.motivo ? ' | ' + p.motivo : '')).slice(0, 90),
    description: 'Cliente: ' + p.nome + '\\nTelefone: ' + p.telefone + '\\nServiço: ' + p.servico +
      '\\nO que a cliente quer: ' + (p.motivo || '(não informado)') +
      '\\n\\nAgendado pelo WhatsApp (assistente virtual).',
    start: { dateTime: ini.toISO({ suppressMilliseconds: true }), timeZone: TZ },
    end: { dateTime: fim.toISO({ suppressMilliseconds: true }), timeZone: TZ },
  },
} }];
`;

module.exports = { PREPARAR, CALCULAR };
