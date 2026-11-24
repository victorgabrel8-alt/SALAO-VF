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
const ANTECEDENCIA_REMARCAR_MIN = 30; // remarcar/adiantar para uma vaga que ela topou: basta 30 min
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
// Regra dos dias (ordem da dona pela assistente, supabase/068): empresas.config.ia_dias =
// { dom: { nao: 'tudo' }, seg: { so: ['avaliacao_online', 'manutencao', 'aplicacao'] }, qua: { nao: ['avaliacao_presencial'] } }.
// Vale só para o que a IA de atendimento oferece e marca (a dona marca o que quiser pelo app ou pela assistente).
// Fica no banco, não na memória da conversa: o CALCULAR lê a cada consulta e a cada marcação.
let IA_DIAS = {};
const CHAVE_DIA = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab', 7: 'dom' };
const NOME_TIPO = { avaliacao_presencial: 'avaliação presencial', avaliacao_online: 'avaliação online', manutencao: 'manutenção',
  aplicacao: 'aplicação (colocação) de mega hair', visita: 'visita para escolher cabelo', outro: 'outros serviços' };
const semAcento = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
// tipo do serviço pelo nome que a IA escreveu ("Avaliação online", "Manutenção – mão de obra"); '' = não informou.
// Na dúvida fica com o tipo mais restrito: é melhor a IA perguntar à dona do que marcar o que ela proibiu.
const tipoServico = (nome, motivo, minutos) => {
  const t = semAcento(nome), m = semAcento(motivo);
  if (!t.trim()) return '';
  if (/avalia|orcamento|consulta/.test(t)) {
    const online = /on[- ]?line|ligacao|chamada|telefone|video|distancia|remot/.test(t);
    // "avaliação presencial (não é online)", "sem ser por ligação": presencial
    return online && !/presencial|pessoalmente|(^|[^a-z])(nao|sem)([^a-z]|$)/.test(t) ? 'avaliacao_online' : 'avaliacao_presencial';
  }
  if (/visita|escolher/.test(t)) return 'visita';
  const manutencao = /manuten/.test(t);
  if (!manutencao && /remo|retir/.test(t)) return 'outro';
  const tecnica = /aplica|coloca|mega|queratina|fita|tela|ponto americano/.test(t);
  // o "Montar agendamento" lê "manutenção" no motivo quando a IA manda só a técnica no serviço ("Queratina")
  const tipo = manutencao || (tecnica && /manuten/.test(m)) ? 'manutencao' : tecnica ? 'aplicacao' : 'outro';
  // manutenção ou aplicação de menos de 1h30 é avaliação com outro nome (22/11/2026: a IA marcou "Manutenção – mão de obra"
  // de 30 min com o motivo "avaliar manutenção")
  if (tipo !== 'outro' && Number(minutos) > 0 && Number(minutos) < 90) return 'avaliacao_presencial';
  return tipo;
};
const regraDoDia = (dia) => { const r = IA_DIAS[CHAVE_DIA[dia.weekday]]; return r && typeof r === 'object' ? r : null; };
// sem serviço informado num dia com regra: não dá para saber, então não marca (a resposta pede o serviço)
const podeNoDia = (dia, tipo) => {
  const r = regraDoDia(dia);
  if (!r) return true;
  if (r.nao === 'tudo') return false;
  if (Array.isArray(r.so)) return r.so.includes(tipo);
  if (Array.isArray(r.nao)) return !!tipo && !r.nao.includes(tipo);
  return true;
};
const listaTipos = (l) => { const n = l.map((x) => NOME_TIPO[x] || x); return n.length > 1 ? n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1] : n[0] || ''; };
// texto para a IA quando o dia tem regra e o serviço pedido não entra
const avisoRegra = (dia, tipo) => {
  const r = regraDoDia(dia);
  if (!r) return '';
  const d = dia.setLocale('pt-BR').toFormat('cccc');
  if (r.nao === 'tudo') return 'REGRA DA GLEIDE: de ' + d + ' o salão não atende. Não ofereça nem marque nada para ' + d + ', nem se a cliente pedir: diga com carinho que nesse dia a Gleide não atende e ofereça outro dia.';
  const pode = Array.isArray(r.so) ? 'de ' + d + ' a Gleide só atende ' + listaTipos(r.so) : 'de ' + d + ' a Gleide não atende ' + listaTipos(r.nao || []);
  const online = (Array.isArray(r.so) ? r.so.includes('avaliacao_online') : !(r.nao || []).includes('avaliacao_online'));
  return 'REGRA DA GLEIDE: ' + pode + '. ' +
    (!tipo ? 'Você não informou o serviço: chame de novo com o campo servico preenchido para saber se ele pode nesse dia. '
      : 'O serviço pedido (' + (NOME_TIPO[tipo] || tipo) + ') NÃO pode ser marcado para ' + d + '. ') +
    (tipo === 'avaliacao_presencial' ? 'Ofereça a avaliação presencial em outro dia' + (online ? '; se a cliente só puder de ' + d + ', ofereça a avaliação online (a Gleide liga para ela no horário; ela NÃO vai ao salão) e consulte de novo com servico = "Avaliação online"' : '') + '. '
      : tipo && tipo !== 'avaliacao_online' ? 'Ofereça outro dia; se a cliente só puder de ' + d + ', use perguntar_para_gleide para a Gleide decidir: se ela aceitar, é ela quem marca esse horário (você não consegue marcar esse serviço nesse dia). ' : '') +
    'Diga com carinho, sem falar em "regra".';
};
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
  acao, dur, durInformada: Number(e.duracao_minutos) > 0, erro, periodo: (e.periodo || 'qualquer').toLowerCase(),
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
  if (cfg && cfg.ia_dias && typeof cfg.ia_dias === 'object' && !Array.isArray(cfg.ia_dias)) IA_DIAS = cfg.ia_dias;
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
// Falta (ex.: atrasou e não respondeu, supabase/011) libera o horário. Se o Supabase não respondeu, não dá
// para saber o que está livre: a IA passa para a equipe.
const falhou = (itens) => itens.some((x) => x.error || (x.code && x.message));
const doCrm = $('Supabase: horários ocupados').all().map(i => i.json);
if (falhou(doCrm)) return saida({ resposta: FORA });
const ocupados = [];
for (const a of doCrm.filter(a => a.inicio && a.status !== 'faltou')) {
  const ini = DateTime.fromISO(a.inicio).setZone(TZ);
  ocupados.push([ini, a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : ini.plus({ hours: 1 })]);
}
// Horas sem atender num dia (supabase/030): config.bloqueios_horario = [{ dia, inicio, fim, motivo }]
const blocosHora = [];
try {
  const blocos = $('Supabase: config do salão').first().json.config.bloqueios_horario;
  for (const b of Array.isArray(blocos) ? blocos : []) {
    const ini = DateTime.fromISO(b.dia + 'T' + b.inicio, { zone: TZ }), fim = DateTime.fromISO(b.dia + 'T' + b.fim, { zone: TZ });
    if (ini.isValid && fim.isValid) { ocupados.push([ini, fim]); blocosHora.push([ini, fim]); }
  }
} catch (e) {}
const livre = (ini, fim) => !ocupados.some(([a, b]) => ini < b && fim > a);
// regra dos dias: o serviço desta chamada (consultar e criar)
const tipoPedido = tipoServico(p.servico, p.motivo, p.durInformada ? p.dur : 0);
const noExpediente = (ini, fim) => intervalos(ini.startOf('day')).some(([a, b]) => ini >= a && fim <= b);

// Regras da agenda que a dona deu à assistente (supabase/071; 24/11/2026, Caroline). Sem as chaves, nada muda.
//   config.ia_horas = [{ dias: ['seg'], de: '00:00', ate: '11:00', de_dia, ate_dia }]: a IA não COMEÇA horário nessa faixa;
//   config.ia_periodo = { sab: { primeiro: 'manha', estrito: true } }: esse período vem primeiro; estrito = o outro só
//   abre quando o primeiro lota.
const SEMANA_REGRA = { 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sab', 7: 'dom' };
const NOME_DIA_REGRA = { seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado', dom: 'domingo' };
let REGRAS_HORA = [], PERIODO_DIA = {};
try {
  const cfgR = $('Supabase: config do salão').first().json.config || {};
  if (Array.isArray(cfgR.ia_horas)) REGRAS_HORA = cfgR.ia_horas.filter((r) => r && /^\\d{2}:\\d{2}$/.test(r.de || '') && /^\\d{2}:\\d{2}$/.test(r.ate || ''));
  if (cfgR.ia_periodo && typeof cfgR.ia_periodo === 'object') PERIODO_DIA = cfgR.ia_periodo;
} catch (e) {}
const hmRegra = (d) => (d.minute ? d.toFormat("H'h'mm") : d.toFormat("H'h'"));
const regraQueBarra = (t) => { const d = t.toISODate(), k = SEMANA_REGRA[t.weekday], h = t.toFormat('HH:mm');
  return REGRAS_HORA.find((r) => (!Array.isArray(r.dias) || !r.dias.length || r.dias.includes(k)) && (!r.de_dia || d >= r.de_dia) &&
    (!r.ate_dia || d <= r.ate_dia) && h >= r.de && h < r.ate) || null; };
const podeComecar = (t) => !regraQueBarra(t);
// o horário que já é da cliente (vaga-da-propria-cliente.js, quando ligado) não é recusado pela regra
const jaDaCliente = (ini, fim) => typeof daCliente === 'function' && !!daCliente(ini, fim);
const textoRegra = (r) => (Array.isArray(r.dias) && r.dias.length ? r.dias.map((k) => NOME_DIA_REGRA[k] || k).join(', ') : 'todos os dias') +
  (r.de_dia || r.ate_dia ? ' (de ' + (r.de_dia || 'hoje').split('-').reverse().join('/') + ' até ' + (r.ate_dia || 'sempre').split('-').reverse().join('/') + ')' : '') +
  ': não começa horário ' + (r.de === '00:00' ? 'antes das ' + r.ate : r.ate >= '24:00' ? 'a partir das ' + r.de : 'das ' + r.de + ' até antes das ' + r.ate);
const motivoRegra = (t) => 'é regra da dona (' + textoRegra(regraQueBarra(t)) + ')';
// o primeiro início livre de um período (manhã = antes das 12h) num dia, com as mesmas regras de quem oferece
const primeiroLivreDoPeriodo = (dia, manha) => { for (const [a, b] of intervalos(dia.startOf('day'))) {
  for (let x = a; x.plus({ minutes: p.dur }) <= b; x = x.plus({ minutes: PASSO_MIN })) {
    if ((x.hour < 12) !== manha || x < agora.plus({ minutes: ANTECEDENCIA_MIN }) || !podeComecar(x)) continue;
    if (typeof noAlmocoFlex === 'function' && noAlmocoFlex(x, x.plus({ minutes: p.dur }))) continue;
    if (livre(x, x.plus({ minutes: p.dur }))) return x;
  } } return null; };
// dia com período estrito: início no OUTRO período é fechado enquanto o primeiro tiver vaga (devolve essa vaga)
const periodoFechado = (t) => { const r = PERIODO_DIA[SEMANA_REGRA[t.weekday]];
  if (!r || !r.estrito || !['manha', 'tarde'].includes(r.primeiro) || (t.hour < 12) === (r.primeiro === 'manha')) return null;
  return primeiroLivreDoPeriodo(t, r.primeiro === 'manha'); };
const motivoPeriodo = (t) => { const x = periodoFechado(t), r = PERIODO_DIA[SEMANA_REGRA[t.weekday]];
  return 'é regra da dona: ' + NOME_DIA_REGRA[SEMANA_REGRA[t.weekday]] + ' a ' + (r.primeiro === 'manha' ? 'tarde' : 'manhã') + ' só abre quando a ' +
    (r.primeiro === 'manha' ? 'manhã' : 'tarde') + ' lota, e ainda tem ' + hmRegra(x) + ' (data_hora_inicio: ' + iso(x) + '): diga isso de um jeito simples e ofereça esse horário'; };
// na sugestão de 2 horários: o período que a dona quer primeiro, quando a cliente não pediu período e ele tem vaga
const preferirPeriodo = (v) => { if (p.periodo !== 'qualquer' || !v.length) return v; const r = PERIODO_DIA[SEMANA_REGRA[v[0].weekday]];
  if (!r || !['manha', 'tarde'].includes(r.primeiro)) return v; const w = v.filter((x) => (x.hour < 12) === (r.primeiro === 'manha')); return w.length ? w : v; };
// o que vale no dia, para a IA ler junto do quadro (os inícios do quadro já respeitam)
const regrasDoDia = (dia) => { const k = SEMANA_REGRA[dia.weekday], d = dia.toISODate();
  const hs = REGRAS_HORA.filter((r) => (!Array.isArray(r.dias) || !r.dias.length || r.dias.includes(k)) && (!r.de_dia || d >= r.de_dia) && (!r.ate_dia || d <= r.ate_dia)).map(textoRegra);
  const r = PERIODO_DIA[k]; if (r && ['manha', 'tarde'].includes(r.primeiro)) hs.push('primeiro a ' + (r.primeiro === 'manha' ? 'manhã' : 'tarde') + (r.estrito ? ', a outra só quando ela lota' : ''));
  return hs.length ? '\\nREGRAS DA DONA neste dia (já aplicadas nos inícios abaixo; nunca ofereça início fora deles, nem se a cliente insistir): ' + hs.join('; ') + '.' : ''; };
// a cliente pediu o período que está fechado: a IA conta e oferece o que tem
const notaPeriodo = (dia) => { if (p.periodo === 'qualquer') return ''; const r = PERIODO_DIA[SEMANA_REGRA[dia.weekday]];
  if (!r || !r.estrito || !['manha', 'tarde'].includes(r.primeiro) || p.periodo.startsWith('manh') === (r.primeiro === 'manha')) return '';
  const x = primeiroLivreDoPeriodo(dia, r.primeiro === 'manha');
  return x ? 'NO ' + NOME_DIA_REGRA[SEMANA_REGRA[dia.weekday]].toUpperCase() + ' A ' + (r.primeiro === 'manha' ? 'TARDE' : 'MANHÃ') + ' SÓ ABRE QUANDO A ' + (r.primeiro === 'manha' ? 'MANHÃ' : 'TARDE') +
    ' LOTA (regra da dona). Ainda tem ' + hmRegra(x) + ' (data_hora_inicio: ' + iso(x) + '): diga isso de um jeito simples e ofereça esse horário. ' : ''; };

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
  if (!evs.length) return saida({ resposta: 'Não encontrei nenhum horário futuro marcado para esta cliente. Diga isso a ela e pergunte se marcou por outro número ou nome; não invente horário. Só use transferir_para_humano se ela confirmar que marcou.' });
  if (p.acao === 'listar') return [{ json: { acao: 'listar', ok: true, resposta: 'Agendamentos futuros desta cliente:\\n' + listaEvs } }];

  let alvo = null;
  // compara até o minuto: a IA manda "HH:mm" e o horário gravado pode ter segundos
  if (p.inicio) alvo = evs.find(x => +x.ini.startOf('minute') === +DateTime.fromISO(p.inicio).setZone(TZ).startOf('minute'));
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
  // o horário atual dela libera o que era dela, nunca um período que a Gleide bloqueou
  semEle.push(...blocosHora);
  { const tipoAlvo = tipoServico(alvo.titulo === 'Horário' ? alvo.obs : alvo.titulo, '', dur);
    if (!novo.hasSame(alvo.ini, 'day') && !podeNoDia(novo.startOf('day'), tipoAlvo)) return saida({ resposta: 'NÃO REMARCADO: ' +
      (tipoAlvo ? avisoRegra(novo.startOf('day'), tipoAlvo) : 'o novo dia tem regra da Gleide sobre o que pode ser marcado e este horário está sem serviço cadastrado, então não dá para saber se ele pode ir para esse dia. Ofereça outro dia ou use perguntar_para_gleide.') +
      ' O horário dela de ' + fmt(alvo.ini) + ' continua valendo.' }); }
  if (novo < agora.plus({ minutes: ANTECEDENCIA_REMARCAR_MIN })) return saida({ resposta: 'O novo horário já passou ou está muito em cima da hora. Ofereça outro.' });
  if (!noExpediente(novo, fimNovo)) return saida({ resposta: 'O novo horário fica fora do expediente (ou o serviço não cabe antes do almoço/fechamento). Consulte os horários livres e ofereça outro.' });
  if (!podeComecar(novo)) return saida({ resposta: 'NÃO REMARCADO: o novo horário ' + motivoRegra(novo) + '. Consulte os horários livres e ofereça outro.' });
  if (periodoFechado(novo)) return saida({ resposta: 'NÃO REMARCADO: o novo horário ' + motivoPeriodo(novo) + '.' });
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
    if (!podeNoDia(dia, tipoPedido)) return v; // regra dos dias
    for (const [a, b] of intervalos(dia)) {
      for (let t = a; t.plus({ minutes: p.dur }) <= b; t = t.plus({ minutes: PASSO_MIN })) {
        if (t < agora.plus({ minutes: ANTECEDENCIA_MIN })) continue;
        if (p.periodo.startsWith('manh') && t.hour >= 12) continue;
        if (p.periodo.startsWith('tard') && t.hour < 12) continue;
        // regras da dona (supabase/071): faixa em que a IA não começa e período que só abre quando o outro lota
        if (!podeComecar(t) || periodoFechado(t)) continue;
        if (livre(t, t.plus({ minutes: p.dur }))) v.push(t);
      }
    }
    return v;
  };
  // "9h", "9h30": como a cliente lê no WhatsApp
  const hm = (d) => (d.minute ? d.toFormat("H'h'mm") : d.toFormat("H'h'"));
  // agrupa horários seguidos em faixas: "9h às 10h; 14h30 às 16h; 17h30"
  const faixas = (v) => {
    const out = [];
    for (const t of v) {
      const f = out[out.length - 1];
      if (f && t.diff(f[1], 'minutes').minutes === PASSO_MIN) f[1] = t; else out.push([t, t]);
    }
    return out.map(([a, b]) => (+a === +b ? hm(a) : hm(a) + ' às ' + hm(b))).join('; ');
  };
  // Pedido do Victor (03/11): para a cliente vão só 2 horários (um de manhã e um de tarde, quando há); o quadro
  // do dia por período fica só para a IA: se a cliente pedir outros horários, ela oferece 1 ou 2 inícios novos (prompt v7.1).
  // Sem nome de cliente: só o horário reservado.
  const sugestao = (v) => {
    v = preferirPeriodo(v);
    const m = v.find((t) => t.hour < 12), t = v.find((x) => x.hour >= 12);
    const dois = m && t ? [m, t] : [v[0], v.find((x) => x.diff(v[0], 'minutes').minutes >= 120) || v[v.length - 1]];
    return dois.filter((x, i) => x && (i === 0 || +x !== +dois[0])).map((x) => hm(x) + ' (data_hora_inicio: ' + iso(x) + ')').join(' ou ');
  };
  const quadro = (dia, v) => {
    const ints = intervalos(dia).filter(([a, b]) =>
      !(p.periodo.startsWith('manh') && a.hour >= 12) && !(p.periodo.startsWith('tard') && b.hour <= 12));
    const inicioHoje = agora.plus({ minutes: ANTECEDENCIA_MIN });
    const linhas = [];
    intervalos(dia).forEach(([a, b], k, todos) => {
      if (!ints.some(([x]) => +x === +a)) return;
      const nome = todos.length === 1 ? 'Expediente' : k === 0 ? 'Manhã' : 'Tarde';
      // pedaços do período: reservado (alguém sendo atendida) ou vago
      const res = ocupados.filter(([x, y]) => x < b && y > a).map(([x, y]) => [x < a ? a : x, y > b ? b : y]).sort((m, n) => m[0] - n[0]);
      const juntos = [];
      for (const r of res) { const u = juntos[juntos.length - 1]; if (u && r[0] <= u[1]) { if (r[1] > u[1]) u[1] = r[1]; } else juntos.push([...r]); }
      const partes = [];
      let t = a;
      const vago = (x, y) => {
        // hoje: o que já passou (ou está a menos de 1 h) não conta
        if (y <= inicioHoje) return;
        if (x < inicioHoje) { x = inicioHoje; const m = x.minute % PASSO_MIN; if (m || x.second) x = x.plus({ minutes: PASSO_MIN - m }).startOf('minute'); }
        // regras da dona (supabase/071): o trecho livre começa no primeiro início que a regra deixa
        while (x < y && (!podeComecar(x) || periodoFechado(x))) x = x.plus({ minutes: PASSO_MIN });
        if (x >= y) return;
        const cabe = y.diff(x, 'minutes').minutes >= p.dur;
        partes.push((cabe ? 'livre das ' : 'vago das ') + hm(x) + ' às ' + hm(y) + (cabe ? '' : ' (não cabe o serviço de ' + p.dur + ' min)'));
      };
      for (const [x, y] of juntos) { if (x > t) vago(t, x); if (y > inicioHoje) partes.push('das ' + hm(x) + ' às ' + hm(y) + ' já tem cliente marcada'); t = y; }
      if (t < b) vago(t, b);
      linhas.push(nome + ' (' + hm(a) + ' às ' + hm(b) + '): ' + (partes.length ? partes.join('; ') : 'nada disponível (já passou)') + '.');
      if (todos[k + 1] && nome === 'Manhã' && ints.length > 1) linhas.push('Almoço: ' + hm(b) + ' às ' + hm(todos[k + 1][0]) + ' (fechado).');
    });
    return 'QUADRO DO DIA — ' + dia.setLocale('pt-BR').toFormat('cccc, dd/LL') + ' (' + dia.toFormat('yyyy-LL-dd') + '), serviço de ' + p.dur + ' min:\\n' +
      'OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: ' + sugestao(v) + '. Não mande o quadro abaixo de cara.\\n' +
      'Quadro do dia (só para você, não mande à cliente nem comente se a agenda está aberta ou cheia; se ela perguntar se tem outros horários, ofereça 1 ou 2 inícios NOVOS e exatos tirados daqui):\\n' +
      linhas.join('\\n') + regrasDoDia(dia) + '\\nInícios que cabem o serviço (de 30 em 30 min): ' + faixas(v) +
      '. Se ela disser outro horário, confira esse horário exato com consultar_horarios_livres antes de marcar; se estiver livre e ela já escolheu, pode marcar.';
  };
  const pedido = DateTime.fromISO(p.dia).setZone(TZ).startOf('day');
  // dia bloqueado no app (folga, viagem) também é "fechado": senão a IA dizia "não temos mais vaga"
  const fechado = !(EXPEDIENTE[pedido.weekday]) || bloqueado(pedido);
  // regra dos dias: o dia pedido não aceita este serviço (a resposta explica e já traz o próximo dia que aceita)
  let noEncaixe = false;
  try { const je = JSON.parse(p.motivo || ''); noEncaixe = !!(je && je.encaixe === true && p.inicio && Date.parse(p.inicio) >= Date.parse(je.de) - 60000 && Date.parse(p.inicio) < Date.parse(je.ate)); } catch (e) {}
  const barrado = !fechado && !noEncaixe && !podeNoDia(pedido, tipoPedido);

  // Horário específico pedido pela cliente
  if (p.inicio && !fechado && !barrado) {
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
    // regras da dona (supabase/071), antes do "ocupado"; o horário que já é da cliente segue o caminho dele
    else if (!podeComecar(t) && !jaDaCliente(t, f)) motivo = motivoRegra(t);
    else if (periodoFechado(t) && !jaDaCliente(t, f)) motivo = motivoPeriodo(t);
    else if (!livre(t, f)) motivo = 'já está ocupado';
    if (!motivo) return [{ json: { acao: 'consultar', ok: true, resposta: 'LIVRE: ' + fmt(t) + ' está disponível para ' + p.dur + ' min (data_hora_inicio: ' + iso(t) + '). Pode oferecer à cliente.' } }];
    const alt = vagasDoDia(pedido);
    return [{ json: { acao: 'consultar', ok: true, resposta: 'INDISPONÍVEL: ' + fmt(t) + ' ' + motivo + '.' +
      (alt.length ? ' Quadro completo do dia: ' + quadro(pedido, alt) + ' Ofereça no máximo 2 horários livres, os mais próximos do que ela pediu.' : ' Não há outro horário livre nesse dia; consulte outro dia.') } }];
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
  if (!opcoes.length && barrado) resposta = avisoRegra(pedido, tipoPedido) + ' Também não há horário livre para esse serviço nos próximos ' + DIAS_BUSCA + ' dias: diga isso à cliente e pergunte se pode ser mais para frente.';
  else if (!opcoes.length) resposta = 'Sem horários livres para ' + p.dur + ' min nos próximos ' + DIAS_BUSCA + ' dias. Diga isso à cliente e use transferir_para_humano para a equipe ver um encaixe.';
  else if (diaAlternativo) resposta = notaPeriodo(pedido) + (barrado ? avisoRegra(pedido, tipoPedido) : fechado ? 'O salão está FECHADO em ' + nomeDia + '.' : 'Não há horário livre em ' + nomeDia + (p.periodo !== 'qualquer' ? ' no período da ' + p.periodo : '') + '.') +
    ' Próximo dia com vaga: ' + quadro(diaAlternativo, opcoes);
  else resposta = quadro(pedido, opcoes);
  return [{ json: { acao: 'consultar', ok: true, resposta } }];
}

// criar
const ini = DateTime.fromISO(p.inicio).setZone(TZ);
const fim = ini.plus({ minutes: p.dur });
if (ini < agora) return saida({ resposta: 'Esse horário já passou. Consulte os horários livres de novo.' });
if (!podeNoDia(ini.startOf('day'), tipoPedido)) return saida({ resposta: 'NÃO AGENDADO: ' + avisoRegra(ini.startOf('day'), tipoPedido) });
if (!noExpediente(ini, fim)) return saida({ resposta: 'Esse horário está fora do horário de funcionamento (ou não cabe a duração do serviço). Consulte os horários livres de novo.' });
// regras da dona (supabase/071): não marca nem se a cliente insistir (antes do "ocupado"; o horário que já é dela segue o caminho dele)
if (!podeComecar(ini) && !jaDaCliente(ini, fim)) return saida({ resposta: 'NÃO AGENDADO: esse horário ' + motivoRegra(ini) + '. Diga isso à cliente de um jeito simples e consulte os horários livres para oferecer outro.' });
if (periodoFechado(ini) && !jaDaCliente(ini, fim)) return saida({ resposta: 'NÃO AGENDADO: esse horário ' + motivoPeriodo(ini) + '.' });
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
