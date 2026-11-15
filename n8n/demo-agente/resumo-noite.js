// Resumo da agenda de amanhã, toda noite, para a dona (só nas lojas com "resumo_noite": "HH:MM" no loja.json;
// a Gleide não passa por aqui).
// Pedido da Caroline (13/11/2026): "me pergunta sobre a agenda pelo menos um dia antes". A assistente só fala
// quando a dona escreve; esta rotina manda sozinha, na hora marcada, a lista de amanhã (app + Google Agenda),
// o que falta (serviço não confirmado, cliente que está só na Google) e os horários que se sobrepõem.
// A mensagem sai pelo número do salão para o número da dona e entra na memória da assistente: quando ela
// responder, a assistente sabe do que se trata. Dia sem nenhuma cliente: não manda nada.
// Os nós entram no workflow "IA - Faltas e avisos" (que já fala com a dona), com um gatilho próprio.

const { LER_ICS } = require('./google-agenda.js');

const MONTAR = LER_ICS + String.raw`
const TZ = 'America/Cuiaba';
const NL = String.fromCharCode(10);
const dia = DateTime.now().setZone(TZ).plus({ days: 1 }).startOf('day'), fimDia = dia.plus({ days: 1 });
const hh = (d) => d.toFormat('HH:mm');
const primeiro = (n) => String(n || '').trim().split(/\s+/)[0].toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
const parecido = (a, b) => { a = primeiro(a); b = primeiro(b); return !!a && !!b && (a === b || a.slice(0, 4) === b.slice(0, 4)); };

// app
const doApp = $('Resumo: agenda de amanhã').all().map((i) => i.json).filter((a) => a && a.inicio)
  .map((a) => ({ ini: DateTime.fromISO(a.inicio).setZone(TZ), fim: a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : null,
    nome: (a.clientes && a.clientes.nome) || 'sem nome', servico: (a.servicos && a.servicos.nome) || '',
    semServico: !(a.servicos && a.servicos.nome) || /não confirmado/i.test(a.observacoes || '') }))
  .sort((x, y) => x.ini - y.ini);

// Google Agenda da dona (se a loja tiver o link)
let google = [], googleFalhou = false;
try {
  const links = [].concat($('Resumo: config').first().json.config?.loja?.google_agenda_ics || []).filter(Boolean);
  if (links.length) {
    const respostas = $('Resumo: ler Google').all().map((i) => i.json);
    if (!respostas.every((r) => typeof r.data === 'string' && r.data.includes('BEGIN:VCALENDAR'))) googleFalhou = true;
    else google = respostas.flatMap((r) => lerIcs(r.data)).filter(([x, y, t, todo]) => !todo && x >= dia && x < fimDia).sort((p, q) => p[0] - q[0]).map(([x, y, t]) => ({ ini: x, titulo: t }));
  }
} catch (e) { googleFalhou = true; }
// só na Google = não há ninguém no app na mesma hora com nome parecido
const soGoogle = google.filter((g) => !doApp.some((a) => Math.abs(a.ini.diff(g.ini, 'minutes').minutes) < 31 && parecido(a.nome, g.titulo)));
// evento repetido na Google (mesmo nome e hora) conta uma vez
const vistos = new Set();
const soGoogleUnicos = soGoogle.filter((g) => { const k = hh(g.ini) + primeiro(g.titulo); if (vistos.has(k)) return false; vistos.add(k); return true; });

if (!doApp.length && !soGoogleUnicos.length) return [];

const curto = (n) => { const p = String(n).trim().split(/\s+/); return p.slice(0, /^(d[aeo]s?|e)$/i.test(p[1] || '') ? 3 : 2).join(' '); };
const linhas = ['📋 *Agenda de amanhã, ' + dia.setLocale('pt-BR').toFormat("cccc dd/LL") + '*'];
for (const a of doApp) linhas.push(hh(a.ini) + (a.fim ? '–' + hh(a.fim) : '') + '  ' + curto(a.nome) + ' — ' + (a.servico || 'serviço?') + (a.semServico && a.servico ? ' (não confirmado)' : ''));
if (soGoogleUnicos.length) {
  linhas.push('', 'Só na Google (ainda não estão no app):');
  for (const g of soGoogleUnicos) linhas.push(hh(g.ini) + '  ' + g.titulo);
}
const faltas = [];
const semServ = doApp.filter((a) => a.semServico);
if (semServ.length) faltas.push('• Qual o serviço de: ' + semServ.map((a) => curto(a.nome) + ' (' + hh(a.ini) + ')').join(', ') + '?');
if (soGoogleUnicos.length) faltas.push('• Das que estão só na Google, me manda o contato e o serviço que eu passo pro app.');
for (let i = 1; i < doApp.length; i++) {
  const antes = doApp[i - 1], a = doApp[i];
  // até 15 min de encaixe é o jeito dela trabalhar (uma atrás da outra): só avisa acima disso
  if (antes.fim && antes.fim.diff(a.ini, 'minutes').minutes > 15) faltas.push('• ⚠️ ' + curto(a.nome) + ' começa às ' + hh(a.ini) + ' e ' + curto(antes.nome) + ' só termina às ' + hh(antes.fim) + '. É isso mesmo?');
}
if (googleFalhou) faltas.push('• Não consegui ler a sua Google Agenda agora: pode ter cliente lá que não está nesta lista.');
if (faltas.length) linhas.push('', '*Falta acertar:*', ...faltas, '', 'Me responde por aqui que eu acerto.');
else linhas.push('', 'Está tudo completo. Se mudar algo, me fala.');
const texto = linhas.join(NL);
const numeros = ($env.ASSISTENTE_NUMEROS || '').split(',').map((s) => s.trim()).filter(Boolean);
return numeros.map((tel) => ({ json: { tel, texto,
  memoria: JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } }) } }));
`;

module.exports = ({ faltasWorkflow: wf, hora }) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(hora || ''));
  if (!m) throw new Error('resumo_noite: use a hora no formato "HH:MM" (ex.: "19:00")');
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`resumo_noite: não achei "${nome}"`); return n; };
  const copia = (deNome, nome, id) => { const n = JSON.parse(JSON.stringify(achar(deNome))); n.name = nome; n.id = id; return n; };
  const supaH = { parameters: [{ name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' }, { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' }] };
  const seguir = { onError: 'continueRegularOutput', alwaysOutputData: true };
  const AMANHA = "$now.setZone('America/Cuiaba').plus({ days: 1 }).startOf('day')";
  const y = 2600;

  const enviar = copia('Avisar a mudança', 'Resumo: mandar para a dona', 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e16');
  const memoria = copia('Guardar a mudança na memória', 'Resumo: guardar na memória', 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e17');
  if (!String(memoria.parameters.list).includes("$('Mensagem da mudança')")) throw new Error('resumo_noite: a memória do aviso mudou');
  memoria.parameters.list = memoria.parameters.list.split("$('Mensagem da mudança')").join("$('Resumo: montar')");
  memoria.parameters.messageData = memoria.parameters.messageData.split("$('Mensagem da mudança')").join("$('Resumo: montar')");
  enviar.position = [1400, y]; memoria.position = [1640, y];

  wf.nodes.push(
    { id: 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e10', name: 'Toda noite (resumo de amanhã)', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, y],
      parameters: { rule: { interval: [{ field: 'cronExpression', expression: `${Number(m[2])} ${Number(m[1])} * * *` }] } } },
    { id: 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e11', name: 'Resumo: agenda de amanhã', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [240, y], ...seguir,
      parameters: { method: 'GET',
        url: '={{ $env.SUPABASE_URL }}/rest/v1/agendamentos?select=inicio,fim,status,observacoes,clientes(nome),servicos(nome)&empresa_id=eq.{{ $env.EMPRESA_ID }}' +
          `&status=neq.cancelado&order=inicio&inicio=gte.{{ ${AMANHA}.toUTC().toISO() }}&inicio=lt.{{ ${AMANHA}.plus({ days: 1 }).toUTC().toISO() }}`,
        sendHeaders: true, headerParameters: supaH, options: { timeout: 15000 } } },
    { id: 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e12', name: 'Resumo: config', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [480, y], ...seguir, executeOnce: true,
      parameters: { method: 'GET', url: '={{ $env.SUPABASE_URL }}/rest/v1/empresas?select=config&id=eq.{{ $env.EMPRESA_ID }}',
        sendHeaders: true, headerParameters: supaH, options: { timeout: 15000 } } },
    { id: 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e13', name: 'Resumo: links da Google', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, y],
      parameters: { jsCode: "const links = [].concat($input.first().json.config?.loja?.google_agenda_ics || []).filter(Boolean);\nreturn links.length ? links.map((url) => ({ json: { url } })) : [{ json: { url: '' } }];" } },
    { id: 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e14', name: 'Resumo: ler Google', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [960, y], ...seguir,
      retryOnFail: true, maxTries: 2, waitBetweenTries: 1000,
      parameters: { method: 'GET', url: "={{ $json.url || 'https://calendar.google.com/sem-agenda' }}",
        options: { timeout: 15000, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } } } },
    { id: 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e15', name: 'Resumo: montar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1180, y], parameters: { jsCode: MONTAR } },
    enviar, memoria,
  );
  const liga = (de, para) => { wf.connections[de] = { main: [[{ node: para, type: 'main', index: 0 }]] }; };
  liga('Toda noite (resumo de amanhã)', 'Resumo: agenda de amanhã');
  liga('Resumo: agenda de amanhã', 'Resumo: config');
  liga('Resumo: config', 'Resumo: links da Google');
  liga('Resumo: links da Google', 'Resumo: ler Google');
  liga('Resumo: ler Google', 'Resumo: montar');
  liga('Resumo: montar', 'Resumo: mandar para a dona');
  liga('Resumo: mandar para a dona', 'Resumo: guardar na memória');
};
