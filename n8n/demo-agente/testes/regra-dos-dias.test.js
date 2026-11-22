// Testes da regra dos dias (regra-dos-dias.js, agenda-calculo.js, supabase/068). Rodar: node --test n8n/demo-agente/testes/*.test.js
// Os nós são os GERADOS de verdade (como no encaixe.test.js): o teste gera os workflows da Gleide numa pasta temporária,
// sem enviar nada, e roda o código do Preparar e do Calcular. Usa o Luxon (como o n8n): sem ele, os cenários da agenda são pulados.
// A função do banco é testada à parte, na Loja Teste, com transação desfeita.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { textoRegras, DIAS } = require('../regra-dos-dias.js');

let luxon = null;
try { luxon = require('luxon'); } catch (e) { /* sem Luxon: cenários da agenda pulados */ }
const pular = luxon ? false : 'sem o Luxon instalado';

const origem = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'regra-dias-teste-'));
for (const f of fs.readdirSync(origem)) {
  if (/\.(js|md|json|txt)$/.test(f) && !/^workflow-/.test(f) && fs.statSync(path.join(origem, f)).isFile()) fs.copyFileSync(path.join(origem, f), path.join(tmp, f));
}
fs.writeFileSync(path.join(tmp, '.env'), '');
execFileSync(process.execPath, ['montar-workflow.js'], { cwd: tmp, stdio: 'pipe' });
const wf = (f) => JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'));
const principal = wf('workflow-demo-salao.json'), agenda = wf('workflow-agenda-salao.json'), assistente = wf('workflow-assistente.json'),
  ferramentas = wf('workflow-assistente-ferramentas.json');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const no = (w, nome) => { const n = w.nodes.find((x) => x.name === nome); assert.ok(n, 'falta o nó ' + nome); return n; };
const dolar = (dados) => (nome) => {
  if (!(nome in dados)) throw new Error('nó sem dados no teste: ' + nome);
  const itens = dados[nome];
  return { first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })), isExecuted: true, item: { json: itens[0] || {} } };
};

// ---------- agenda ----------
// A ordem da Gleide em 22/11/2026: domingo nada; segunda só avaliação online, manutenção e colocação.
const DA_GLEIDE = { dom: { nao: 'tudo', em: '22/11/2026' }, seg: { so: ['avaliacao_online', 'manutencao', 'aplicacao'], em: '22/11/2026' } };
const HORARIO = { dom: '08:00-14:00', seg: '09:00-18:00', ter: '09:00-18:00', qua: '09:00-18:00', qui: '09:00-18:00', sex: '09:00-18:00', sab: '08:00-14:00' };
const config = (ia_dias) => ({ config: { horario_funcionamento: HORARIO, almoco: { inicio: '12:00', fim: '13:00' }, ...(ia_dias === undefined ? {} : { ia_dias }) } });
const TZ = 'America/Cuiaba';
// o próximo dia da semana (1 = segunda … 7 = domingo), sempre a pelo menos 2 dias de hoje (não depende da hora em que o teste roda)
const proximo = (weekday) => { let d = luxon.DateTime.now().setZone(TZ).startOf('day').plus({ days: 2 }); while (d.weekday !== weekday) d = d.plus({ days: 1 }); return d; };
const dia = (d) => d.toFormat('yyyy-LL-dd');
const hora = (d, h, m = 0) => d.set({ hour: h, minute: m }).toFormat("yyyy-LL-dd'T'HH:mm");
const rodar = (entrada, opcoes = {}) => {
  // ia_dias: undefined de propósito = config sem a chave (loja sem regra)
  const { ocupados = [], dela = [] } = opcoes, ia_dias = 'ia_dias' in opcoes ? opcoes.ia_dias : DA_GLEIDE;
  const D = luxon.DateTime;
  const prep = new Function('$input', 'DateTime', no(agenda, 'Preparar').parameters.jsCode)({ first: () => ({ json: entrada }) }, D)[0].json;
  return new Function('$', 'DateTime', no(agenda, 'Calcular').parameters.jsCode)(dolar({
    'Preparar': [prep], 'Supabase: config do salão': [config(ia_dias)], 'Supabase: horários ocupados': ocupados, 'Supabase: agendamentos da cliente': dela,
  }), D)[0].json;
};
const consultar = (d, servico, duracao, extra) => rodar({ acao: 'consultar', data: d, servico, duracao_minutos: duracao, periodo: 'qualquer' }, extra);
const criar = (quando, servico, duracao, extra, motivo) => rodar({ acao: 'criar', data_hora_inicio: quando, servico, duracao_minutos: duracao, nome: 'Teste', telefone: '5566900000000', motivo }, extra);

test('consultar: avaliação presencial na segunda não tem horário e a resposta manda para outro dia ou para a online', { skip: pular }, () => {
  const seg = proximo(1);
  const r = consultar(dia(seg), 'Avaliação', 30);
  assert.strictEqual(r.ok, true);
  assert.match(r.resposta, /^REGRA DA GLEIDE: de segunda-feira a Gleide só atende avaliação online, manutenção e aplicação/);
  assert.match(r.resposta, /avaliação presencial\) NÃO pode ser marcado para segunda-feira/);
  assert.match(r.resposta, /ofereça a avaliação online/);
  assert.match(r.resposta, /Próximo dia com vaga: QUADRO DO DIA — terça-feira/);
  assert.ok(!r.resposta.includes('(' + dia(seg) + ')'), 'não devolve quadro da segunda');
  assert.ok(!r.resposta.includes(dia(seg) + 'T'), 'nenhum data_hora_inicio na segunda');
});

test('consultar: hora exata de avaliação presencial na segunda não volta LIVRE', { skip: pular }, () => {
  const seg = proximo(1);
  const r = consultar(hora(seg, 13), 'Avaliação', 30);
  assert.ok(!/^LIVRE/.test(r.resposta), r.resposta);
  assert.match(r.resposta, /^REGRA DA GLEIDE/);
  assert.ok(!r.resposta.includes(dia(seg) + 'T'));
});

test('consultar: avaliação online, manutenção e aplicação seguem com horário na segunda', { skip: pular }, () => {
  const seg = proximo(1);
  for (const [servico, dur] of [['Avaliação online', 30], ['Manutenção – mão de obra', 210], ['Aplicação de mega hair – mão de obra', 240], ['avaliacao on-line', 30]]) {
    const r = consultar(dia(seg), servico, dur);
    assert.match(r.resposta, /^QUADRO DO DIA — segunda-feira/, servico + ': ' + r.resposta.slice(0, 120));
    assert.ok(r.resposta.includes(dia(seg) + 'T'), servico);
    const exata = consultar(hora(seg, 13), servico, dur);
    assert.match(exata.resposta, /^LIVRE/, servico + ': ' + exata.resposta.slice(0, 120));
  }
});

test('consultar: serviço fora da lista da segunda (selagem, visita) pede a Gleide; sem serviço, pede o serviço', { skip: pular }, () => {
  const seg = proximo(1);
  for (const servico of ['Selagem', 'Visita para escolher cabelo', 'Botox capilar']) {
    const r = consultar(dia(seg), servico, 60);
    assert.match(r.resposta, /^REGRA DA GLEIDE/, servico);
    assert.match(r.resposta, /perguntar_para_gleide/, servico);
    assert.ok(!r.resposta.includes(dia(seg) + 'T'), servico);
  }
  const sem = consultar(dia(seg), '', 30);
  assert.match(sem.resposta, /Você não informou o serviço/);
  assert.ok(!sem.resposta.includes(dia(seg) + 'T'));
  // sem o campo (IA antiga ou esqueceu): também não oferece a segunda
  const semCampo = rodar({ acao: 'consultar', data: dia(seg), duracao_minutos: 30 });
  assert.ok(!semCampo.resposta.includes(dia(seg) + 'T'));
});

test('consultar: domingo não tem horário para nada, nem online, e a busca pula domingo e segunda', { skip: pular }, () => {
  const dom = proximo(7);
  for (const servico of ['Avaliação', 'Avaliação online', 'Manutenção – mão de obra', '']) {
    const r = consultar(dia(dom), servico, 30);
    assert.match(r.resposta, /^REGRA DA GLEIDE: de domingo o salão não atende/, servico);
    assert.ok(!r.resposta.includes(dia(dom) + 'T'), servico);
  }
  // avaliação presencial pedida para domingo: o próximo dia com vaga é terça (segunda também não entra)
  const r = consultar(dia(dom), 'Avaliação', 30);
  assert.match(r.resposta, /Próximo dia com vaga: QUADRO DO DIA — terça-feira/);
  // sábado lotado: a busca dos próximos dias não cai no domingo
  const sab = dom.minus({ days: 1 });
  const lotado = [{ inicio: sab.set({ hour: 8 }).toISO(), fim: sab.set({ hour: 14 }).toISO(), status: 'agendado' }];
  const s = consultar(dia(sab), 'Avaliação', 30, { ocupados: lotado });
  assert.match(s.resposta, /Próximo dia com vaga: QUADRO DO DIA — terça-feira/, s.resposta.slice(0, 200));
  const on = consultar(dia(sab), 'Avaliação online', 30, { ocupados: lotado });
  assert.match(on.resposta, /Próximo dia com vaga: QUADRO DO DIA — segunda-feira/, on.resposta.slice(0, 200));
});

test('criar: a agenda recusa no código o que a regra não deixa, mesmo se a IA tentar', { skip: pular }, () => {
  const seg = proximo(1), dom = proximo(7), ter = proximo(2);
  const a = criar(hora(seg, 13), 'Avaliação', 30);
  assert.strictEqual(a.ok, false);
  assert.match(a.resposta, /^NÃO AGENDADO: REGRA DA GLEIDE/);
  assert.strictEqual(a.evento, undefined);
  for (const servico of ['Avaliação', 'Avaliação online', 'Manutenção – mão de obra', 'Selagem']) {
    const d = criar(hora(dom, 9), servico, 30);
    assert.strictEqual(d.ok, false, servico);
    assert.match(d.resposta, /^NÃO AGENDADO: REGRA DA GLEIDE: de domingo/, servico);
  }
  assert.strictEqual(criar(hora(seg, 13), '', 30).ok, false, 'sem serviço na segunda não marca');
  assert.strictEqual(criar(hora(seg, 13), 'Selagem', 180).ok, false);
  assert.strictEqual(criar(hora(seg, 13, 30), 'orçamento', 30).ok, false, '"orçamento" é avaliação presencial');
  // o que pode
  for (const [servico, dur, motivo] of [['Avaliação online', 30], ['Manutenção – mão de obra', 210], ['Aplicação de mega hair – mão de obra', 240], ['Queratina', 210, 'manutenção queratina']]) {
    const ok = criar(hora(seg, 13), servico, dur, undefined, motivo);
    assert.strictEqual(ok.ok, true, servico + ': ' + ok.resposta);
    assert.strictEqual(ok.acao, 'criar');
  }
  assert.strictEqual(criar(hora(ter, 13), 'Avaliação', 30).ok, true, 'terça segue normal');
});

test('remarcar: não leva avaliação presencial para segunda nem nada para domingo; manutenção para segunda pode', { skip: pular }, () => {
  const seg = proximo(1), dom = proximo(7), qua = proximo(3);
  const horario = (servico, min = 30) => [{ id: 'ag-1', inicio: qua.set({ hour: 9 }).toISO(), fim: qua.set({ hour: 9 }).plus({ minutes: min }).toISO(), observacoes: null, servicos: servico ? { nome: servico } : null }];
  const remarcar = (para, servico, min) => { const d = horario(servico, min); return rodar({ acao: 'remarcar', telefone: '5566900000000', data_hora_nova: para }, { dela: d, ocupados: [{ inicio: d[0].inicio, fim: d[0].fim, status: 'agendado' }] }); };
  const a = remarcar(hora(seg, 14), 'Avaliação');
  assert.strictEqual(a.ok, false);
  assert.match(a.resposta, /^NÃO REMARCADO: REGRA DA GLEIDE/);
  assert.match(a.resposta, /continua valendo/);
  assert.strictEqual(remarcar(hora(dom, 9), 'Manutenção – mão de obra', 210).ok, false);
  assert.strictEqual(remarcar(hora(seg, 14), null).ok, false, 'horário sem serviço não vai para dia com regra');
  const ok = remarcar(hora(seg, 14), 'Avaliação online');
  assert.strictEqual(ok.ok, true, ok.resposta);
  assert.strictEqual(remarcar(hora(seg, 13), 'Manutenção – mão de obra', 210).ok, true);
  assert.strictEqual(remarcar(hora(qua, 15), 'Avaliação').ok, true, 'outro dia segue normal');
});

test('remarcar dentro do mesmo dia continua valendo para quem já estava marcada num dia com regra', { skip: pular }, () => {
  const seg = proximo(1);
  const dela = [{ id: 'ag-2', inicio: seg.set({ hour: 13 }).toISO(), fim: seg.set({ hour: 13, minute: 30 }).toISO(), observacoes: null, servicos: { nome: 'Avaliação' } }];
  const r = rodar({ acao: 'remarcar', telefone: '5566900000000', data_hora_nova: hora(seg, 15) }, { dela, ocupados: [{ inicio: dela[0].inicio, fim: dela[0].fim, status: 'agendado' }] });
  assert.strictEqual(r.ok, true, r.resposta);
  // listar e cancelar não mudam
  assert.strictEqual(rodar({ acao: 'listar', telefone: '5566900000000' }, { dela }).ok, true);
  assert.strictEqual(rodar({ acao: 'cancelar', telefone: '5566900000000' }, { dela }).ok, true);
});

test('sem regra gravada (outras lojas, ou depois de liberar) a agenda fica como era', { skip: pular }, () => {
  const seg = proximo(1), dom = proximo(7);
  for (const ia_dias of [undefined, {}, null, [], 'x', { seg: null }]) {
    assert.match(consultar(dia(seg), 'Avaliação', 30, { ia_dias }).resposta, /^QUADRO DO DIA — segunda-feira/, JSON.stringify(ia_dias));
    assert.match(consultar(dia(dom), '', 30, { ia_dias }).resposta, /^QUADRO DO DIA — domingo/, JSON.stringify(ia_dias));
    assert.strictEqual(criar(hora(dom, 9), 'Avaliação', 30, { ia_dias }).ok, true, JSON.stringify(ia_dias));
  }
});

test('regra do tipo "não marca": só o serviço citado fica de fora', { skip: pular }, () => {
  const qua = proximo(3);
  const ia_dias = { qua: { nao: ['avaliacao_presencial'] } };
  assert.match(consultar(dia(qua), 'Avaliação', 30, { ia_dias }).resposta, /^REGRA DA GLEIDE: de quarta-feira a Gleide não atende avaliação presencial/);
  assert.match(consultar(dia(qua), 'Selagem', 180, { ia_dias }).resposta, /^QUADRO DO DIA — quarta-feira/);
  assert.strictEqual(criar(hora(qua, 13), 'Avaliação', 30, { ia_dias }).ok, false);
  assert.strictEqual(criar(hora(qua, 13), 'Avaliação online', 30, { ia_dias }).ok, true);
});

test('nomes de serviço que tentavam passar pela regra (achados do testador)', { skip: pular }, () => {
  const seg = proximo(1), qui = proximo(4);
  // avaliação com "online" no nome, mas presencial
  for (const servico of ['Avaliação online presencial', 'avaliação (não online)', 'Avaliação presencial (não é online)', 'Avaliação sem ser por ligação', 'consulta', 'Avaliação gratuita']) {
    assert.strictEqual(criar(hora(seg, 14), servico, 30).ok, false, servico);
    assert.match(consultar(hora(seg, 14), servico, 30).resposta, /^REGRA DA GLEIDE/, servico);
  }
  // avaliação marcada com nome de manutenção ou de aplicação (30 min): em 22/11 a IA marcou assim
  for (const [servico, motivo] of [['Manutenção – mão de obra', 'avaliar manutenção, 3 telas'], ['Mega hair', 'avaliar técnica'], ['Colocação', 'avaliar técnica'], ['Aplicação de mega hair – mão de obra', '']]) {
    const r = criar(hora(seg, 14), servico, 30, undefined, motivo);
    assert.strictEqual(r.ok, false, servico);
    assert.match(r.resposta, /avaliação presencial\) NÃO pode/, servico);
  }
  // "manutenção" só no motivo não transforma outro serviço em manutenção
  assert.strictEqual(criar(hora(seg, 14), 'Selagem', 180, undefined, 'selagem depois da manutenção').ok, false);
  assert.strictEqual(criar(hora(seg, 14), 'Conversa', 30, undefined, 'quer saber de manutenção').ok, false);
  assert.strictEqual(criar(hora(seg, 13), 'Remoção de mega hair', 180).ok, false);
  // remarcar: avaliação gravada como manutenção de 30 min, e horário sem serviço com "online" negado na observação
  const dela = (servico, obs, min) => [{ id: 'ag-3', inicio: qui.set({ hour: 9 }).toISO(), fim: qui.set({ hour: 9 }).plus({ minutes: min }).toISO(), observacoes: obs, servicos: servico ? { nome: servico } : null }];
  const remarcar = (d) => rodar({ acao: 'remarcar', telefone: '5566900000000', data_hora_nova: hora(seg, 13) }, { dela: d, ocupados: [{ inicio: d[0].inicio, fim: d[0].fim, status: 'agendado' }] });
  assert.strictEqual(remarcar(dela('Manutenção – mão de obra', 'avaliar manutenção, 3 telas', 30)).ok, false);
  assert.strictEqual(remarcar(dela(null, 'avaliação, não quis online', 30)).ok, false);
  assert.strictEqual(remarcar(dela('Manutenção – mão de obra', 'manutenção 3 telas', 210)).ok, true, 'manutenção de verdade continua podendo');
  // o que continua passando
  assert.strictEqual(criar(hora(seg, 14), 'avaliacao on line', 30).ok, true);
  assert.strictEqual(criar(hora(seg, 13), 'Queratina', 210, undefined, 'manutenção queratina').ok, true);
});

test('achados da revisão: duração não informada, encaixe no mesmo dia, horário sem serviço, nada nos próximos dias', { skip: pular }, () => {
  const seg = proximo(1), qui = proximo(4);
  // manutenção consultada sem a duração (o padrão de 60 min não pode virar "avaliação")
  const semDur = rodar({ acao: 'consultar', data: dia(seg), servico: 'Manutenção – mão de obra', periodo: 'qualquer' });
  assert.match(semDur.resposta, /^QUADRO DO DIA — segunda-feira/, semDur.resposta.slice(0, 160));
  // encaixe na falta: a hora dentro do encaixe oferecido passa pela consulta mesmo em dia com regra
  const sinal = JSON.stringify({ encaixe: true, ag: 'ag-x', de: seg.set({ hour: 13 }).toUTC().toISO(), ate: seg.set({ hour: 15 }).toUTC().toISO() });
  const enc = rodar({ acao: 'consultar', data: hora(seg, 13, 30), servico: 'Avaliação', duracao_minutos: 30, motivo: sinal });
  assert.match(enc.resposta, /^ENCAIXE:/, enc.resposta.slice(0, 160));
  // fora do encaixe continua barrado
  const fora = rodar({ acao: 'consultar', data: hora(seg, 16), servico: 'Avaliação', duracao_minutos: 30, motivo: sinal });
  assert.match(fora.resposta, /^REGRA DA GLEIDE/);
  // remarcar horário sem serviço e sem observação: o texto diz o motivo real
  const d = [{ id: 'ag-4', inicio: qui.set({ hour: 9 }).toISO(), fim: qui.set({ hour: 9, minute: 30 }).toISO(), observacoes: null, servicos: null }];
  const r = rodar({ acao: 'remarcar', telefone: '5566900000000', data_hora_nova: hora(seg, 13) }, { dela: d, ocupados: [{ inicio: d[0].inicio, fim: d[0].fim, status: 'agendado' }] });
  assert.strictEqual(r.ok, false);
  assert.match(r.resposta, /sem serviço cadastrado/);
  assert.match(r.resposta, /continua valendo/);
  // regra em todos os dias: não manda pedir encaixe à dona
  const tudo = Object.fromEntries(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'].map((k) => [k, { nao: 'tudo' }]));
  const nada = consultar(dia(seg), 'Avaliação', 30, { ia_dias: tudo });
  assert.match(nada.resposta, /^REGRA DA GLEIDE/);
  assert.ok(!/transferir_para_humano|encaixe/.test(nada.resposta), nada.resposta);
});

// ---------- IA de atendimento ----------
test('a consulta de horários leva o serviço e o prompt lê a regra do banco', () => {
  const v = no(principal, 'consultar_horarios_livres').parameters.workflowInputs.value;
  assert.match(v.servico, /\$fromAI\('servico'/);
  assert.strictEqual(v.acao, 'consultar');
  const prompt = no(principal, 'Agente IA').parameters.options.systemMessage;
  assert.match(prompt, /DIAS COM REGRA DA GLEIDE/);
  assert.ok(prompt.includes("{{ $('Regra dos dias').first().json.texto }}"));
  // o nó "Regra dos dias" fica no caminho antes do agente, logo depois da leitura do config
  assert.strictEqual(principal.connections['Supabase: áudios do salão'].main[0][0].node, 'Regra dos dias');
  let at = 'Regra dos dias'; const caminho = [];
  while (at && !caminho.includes(at)) { caminho.push(at); at = principal.connections[at]?.main?.[0]?.[0]?.node; }
  assert.ok(caminho.includes('Agente IA'), 'Regra dos dias não chega ao Agente IA: ' + caminho.join(' > '));
  // o código do nó, rodado como o n8n roda
  const rodarExpr = (cfg) => new Function('$', no(principal, 'Regra dos dias').parameters.jsCode)(cfg === 'erro' ? () => { throw new Error('nó sem dados'); } : dolar({ 'Supabase: áudios do salão': [cfg] }))[0].json.texto;
  const texto = rodarExpr({ config: { ia_dias: DA_GLEIDE } });
  assert.strictEqual(texto, '- domingo: a Gleide NÃO atende. Não ofereça nem marque nada para domingo.\n' +
    '- segunda-feira: SÓ pode marcar avaliação online (por ligação, a cliente não vai ao salão), manutenção e aplicação (colocação) de mega hair. Qualquer outro serviço fica para outro dia.');
  assert.match(rodarExpr('erro'), /^\(não consegui ler/);
  assert.match(rodarExpr({ config: {} }), /^\(nenhuma/);
  assert.match(rodarExpr({}), /^\(nenhuma/);
  assert.strictEqual(textoRegras({ qua: { nao: ['avaliacao_presencial'] } }, DIAS), '- quarta-feira: NÃO pode marcar avaliação presencial. O resto segue normal.');
});

// ---------- assistente ----------
test('assistente: a ferramenta regra_do_dia chama a função do banco e o prompt mostra o que está valendo', () => {
  const t = no(assistente, 'regra_do_dia').parameters;
  assert.strictEqual(t.workflowInputs.value.acao, 'regra_do_dia');
  for (const c of ['data', 'tipo', 'extras', 'texto']) assert.match(t.workflowInputs.value[c], /\$fromAI/);
  assert.strictEqual(assistente.connections.regra_do_dia.ai_tool[0][0].node, 'Agente assistente');
  assert.strictEqual(assistente.connections['Ler regras'].main[0][0].node, 'Ler regra dos dias');
  assert.strictEqual(assistente.connections['Ler regra dos dias'].main[0][0].node, 'Ler pedidos abertos');
  assert.match(no(assistente, 'Ler regra dos dias').parameters.url, /rpc\/n8n_assistente_regra_dias_texto$/);
  const prompt = no(assistente, 'Agente assistente').parameters.options.systemMessage;
  assert.match(prompt, /\$\('Ler regra dos dias'\)/);
  assert.match(prompt, /NUNCA use guardar_regra para isso/);
  // o "Montar chamada" das ferramentas monta a chamada certa
  const montar = (e) => new Function('$input', '$env', no(ferramentas, 'Montar chamada').parameters.jsCode)({ first: () => ({ json: e }) }, { EMPRESA_ID: 'emp' })[0].json;
  const r = montar({ acao: 'regra_do_dia', pedido_por: '5566999596740', data: 'seg', tipo: 'so', extras: 'avaliacao_online, manutencao, aplicacao', texto: 'na segunda só avaliação online' });
  assert.strictEqual(r.funcao, 'n8n_assistente_regra_dia');
  assert.strictEqual(r.args.p_dia, 'seg');
  assert.strictEqual(r.args.p_regra, 'so');
  assert.strictEqual(r.args.p_servicos, 'avaliacao_online, manutencao, aplicacao');
  assert.strictEqual(r.args.p_fala, 'na segunda só avaliação online');
  assert.strictEqual(r.args.p_pedido_por, '5566999596740');
  const nada = montar({ acao: 'regra_do_dia', pedido_por: '5566999596740', data: 'dom', tipo: 'nada', extras: '', texto: '' });
  assert.strictEqual(nada.args.p_servicos, null);
  // o registro "o que você já fez" guarda a regra gravada
  assert.match(no(assistente, 'Conferir resposta').parameters.jsCode, /"regra_do_dia"/);
});
