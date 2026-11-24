// A confirmação da véspera confere a Google Agenda da dona antes de sair (loja.json: "lembrete_confere_google": true, só
// com "google_agenda"; a Gleide não passa por aqui). Pedido do Victor (24/11/2026, Caroline): a mesma cliente estava num
// horário no app e em outro na Google (Poly: app sex 04/12 18h, Google qui 03/12 18h; Maria Eduarda Pereira: 8h x 9h;
// Lorranny: 10h x 12h). A confirmação sai do app: a cliente ia receber o horário errado.
//
// Antes da "Mensagem do lembrete": lê a Google (link iCal do config) e a agenda do app. Para cada confirmação:
//   - acha na Google eventos com o nome da cliente (primeiro nome igual, letras dobradas não contam: "Polly" = "Poly";
//     se os dois têm sobrenome, ele também precisa bater: "Maria Cecilia" não é "Maria Eduarda") de 2 dias antes a
//     2 dias depois;
//   - tira os que batem (até 30 min) com algum horário dessa cliente no app;
//   - sobrou evento e nenhum bate com o horário da confirmação: a confirmação NÃO sai e a dona recebe um aviso (uma vez
//     por horário, 24 h no Redis) com os dois horários. Ela acerta o lado errado (app ou Google) e a confirmação sai sozinha
//     na próxima volta (de 5 em 5 min), enquanto ainda for a véspera.
//   - Google fora do ar ou cliente que não está na Google: sai como sempre.

const { LER_ICS } = require('./google-agenda.js');

const CONFERE = LER_ICS + String.raw`
const TZ = 'America/Cuiaba';
const lembretes = $('Lembretes para mandar').all().map((i) => i.json).filter((l) => l && l.agendamento_id);
const respostas = (() => { try { return $('Lembrete: ler Google').all().map((i) => i.json); } catch (e) { return []; } })();
const lida = respostas.length > 0 && respostas.every((r) => typeof r.data === 'string' && r.data.includes('BEGIN:VCALENDAR'));
if (!lembretes.length || !lida) return [{ json: { segurar: [], avisos: [], google: lida } }];
const eventos = respostas.flatMap((r) => lerIcs(r.data)).filter(([a, , , todo]) => !todo);
const doApp = (() => { try { return $('Lembrete: agenda do app').all().map((i) => i.json).filter((x) => x && x.cliente_id && x.inicio); } catch (e) { return []; } })();
// "Polly" = "Poly", "Lorrany" = "Lorranny": sem acento, sem letra dobrada, só palavras
const palavras = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ')
  .replace(/([a-z])\1+/g, '$1').trim().split(' ').filter((w) => w.length >= 2 && !['de', 'da', 'do', 'das', 'dos'].includes(w));
const mesmoNome = (cliente, titulo) => { const c = palavras(cliente), t = palavras(titulo); if (!c.length || c[0].length < 3) return false;
  const i = t.indexOf(c[0]); if (i < 0) return false; return !(c[1] && t[i + 1] && t[i + 1].slice(0, 3) !== c[1].slice(0, 3)); };
const perto = (a, b) => Math.abs(a.diff(b, 'minutes').minutes) <= 30;
const dia = (d) => ['', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'][d.weekday] + ' ' + d.toFormat("dd/LL 'às' HH:mm");
const numeros = ${'${NUMEROS}'};
const segurar = [], avisos = [];
for (const l of lembretes) {
  const ini = DateTime.fromISO(l.inicio).setZone(TZ);
  const meus = doApp.filter((x) => x.cliente_id === l.cliente_id).map((x) => DateTime.fromISO(x.inicio).setZone(TZ));
  const daGoogle = eventos.filter(([a, , titulo]) => mesmoNome(l.nome, titulo) && a >= ini.startOf('day').minus({ days: 2 }) && a < ini.startOf('day').plus({ days: 3 }));
  if (!daGoogle.length || daGoogle.some(([a]) => perto(a, ini))) continue;
  // evento da Google que é outro horário dela no app: já está certo
  const sobra = daGoogle.filter(([a]) => !meus.some((m) => perto(a, m)));
  if (!sobra.length) continue;
  segurar.push(l.agendamento_id);
  const nome = String(l.nome || 'cliente').trim().split(/\s+/).slice(0, 2).join(' ');
  const texto = '⚠️ Não mandei a confirmação da *' + nome + '*: no app ela está ' + dia(ini) + (l.servico ? ' (' + String(l.servico).toLowerCase() + ')' : '') +
    ', e na sua Google Agenda está ' + sobra.map(([a, , t]) => dia(a) + ' ("' + String(t).trim() + '")').join(' e ') + '.\n' +
    'Qual é o certo? Acerte o que estiver errado (no app eu acerto se você me disser) e a confirmação sai sozinha.';
  const memoria = JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } });
  for (const tel of numeros) avisos.push({ tel, texto, memoria, chave: 'lembrete_segurado:' + l.agendamento_id + ':' + ini.toFormat("yyyyLLdd'T'HHmm") + ':' + tel });
}
return [{ json: { segurar, avisos, google: true } }];
`;

module.exports = ({ node, faltasWorkflow: wf, NUMEROS, REDIS }) => {
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('lembrete-confere-google: sem o nó ' + nome); return n; };
  const msg = achar('Mensagem do lembrete');
  const lembrar = achar('Lembrar a cliente');
  // quem entra na "Mensagem do lembrete" (depende dos módulos ligados: o "Lembretes para mandar" ou o "Lembretes: com quem")
  const antes = Object.entries(wf.connections).filter(([, c]) => (c.main || []).some((saida) => (saida || []).some((x) => x.node === msg.name)));
  if (antes.length !== 1 || antes[0][1].main.length !== 1 || antes[0][1].main[0].length !== 1) throw new Error('lembrete-confere-google: a entrada da "Mensagem do lembrete" mudou');
  const anterior = antes[0][0];
  const codigoMsg = String(msg.parameters.jsCode);
  const DE = ".filter((l) => l.agendamento_id)";
  if (codigoMsg.split(DE).length !== 2 || !codigoMsg.includes("$('Lembretes para mandar').all()")) throw new Error('lembrete-confere-google: a "Mensagem do lembrete" mudou');
  // a mensagem só sai para quem não foi segurado
  msg.parameters.jsCode = codigoMsg.replace(DE, () => ".filter((l) => l.agendamento_id && !SEGURAR.has(l.agendamento_id))");
  msg.parameters.jsCode = "// lembrete-confere-google.js: horário diferente no app e na Google: a confirmação espera a dona acertar\n" +
    "const SEGURAR = new Set((() => { try { return $('Lembrete: confere a Google').first().json.segurar || []; } catch (e) { return []; } })());\n" + msg.parameters.jsCode;

  const [x, y] = msg.position;
  const SUPA = [{ name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' }, { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' }];
  const evo = lembrar.parameters;
  wf.nodes.push(
    node('Lembrete: config', 'n8n-nodes-base.httpRequest', 4.2, [x - 60, y + 260], {
      method: 'GET', url: '={{ $env.SUPABASE_URL }}/rest/v1/empresas?select=config&id=eq.{{ $env.EMPRESA_ID }}',
      sendHeaders: true, headerParameters: { parameters: SUPA }, options: { timeout: 15000 },
    }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' }),
    node('Lembrete: links', 'n8n-nodes-base.code', 2, [x + 160, y + 260], { jsCode:
      "const links = [].concat($input.first().json.config?.loja?.google_agenda_ics || []).filter(Boolean);\n" +
      "return links.length ? links.map((url) => ({ json: { url } })) : [{ json: { url: '' } }];" }, { executeOnce: true }),
    node('Lembrete: ler Google', 'n8n-nodes-base.httpRequest', 4.2, [x + 380, y + 260], {
      method: 'GET', url: "={{ $json.url || 'https://calendar.google.com/sem-agenda' }}",
      options: { timeout: 15000, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 }),
    node('Lembrete: agenda do app', 'n8n-nodes-base.httpRequest', 4.2, [x + 600, y + 260], {
      method: 'GET',
      url: "={{ $env.SUPABASE_URL }}/rest/v1/agendamentos?select=cliente_id,inicio&empresa_id=eq.{{ $env.EMPRESA_ID }}&status=eq.agendado&inicio=gte.{{ $now.minus({ days: 4 }).toUTC().toISO() }}&inicio=lt.{{ $now.plus({ days: 8 }).toUTC().toISO() }}",
      sendHeaders: true, headerParameters: { parameters: SUPA }, options: { timeout: 15000 },
    }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' }),
    node('Lembrete: confere a Google', 'n8n-nodes-base.code', 2, [x + 820, y + 260], { jsCode: CONFERE.split('${NUMEROS}').join(NUMEROS) }, { executeOnce: true }),
    node('Lembrete segurado: avisos', 'n8n-nodes-base.code', 2, [x + 1040, y + 480], { jsCode: "return ($input.first().json.avisos || []).map((a) => ({ json: a }));" }),
    node('Lembrete segurado: já avisei?', 'n8n-nodes-base.redis', 1, [x + 1260, y + 480], {
      operation: 'get', key: '={{ $json.chave }}', propertyName: 'avisado', keyType: 'string', options: {},
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('Lembrete segurado: novo?', 'n8n-nodes-base.if', 2.2, [x + 1480, y + 480], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'ls1', leftValue: '={{ !$json.error && !$json.avisado && !!$json.tel }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {},
    }),
    node('Avisar a Gleide (lembrete segurado)', 'n8n-nodes-base.httpRequest', 4.2, [x + 1700, y + 480], {
      method: evo.method, url: evo.url, sendHeaders: true, headerParameters: JSON.parse(JSON.stringify(evo.headerParameters)),
      sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify({ number: $('Lembrete segurado: avisos').item.json.tel, text: $('Lembrete segurado: avisos').item.json.texto }) }}", options: {},
    }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
    node('Lembrete segurado: anotar', 'n8n-nodes-base.redis', 1, [x + 1920, y + 480], {
      operation: 'set', key: "={{ $('Lembrete segurado: avisos').item.json.chave }}", value: '1', expire: true, ttl: 86400,
    }, { credentials: REDIS }),
    node('Lembrete segurado: memória', 'n8n-nodes-base.redis', 1, [x + 2140, y + 480], {
      operation: 'push', list: "=assistente:{{ $('Lembrete segurado: avisos').item.json.tel }}",
      messageData: "={{ $('Lembrete segurado: avisos').item.json.memoria }}", tail: false,
    }, { credentials: REDIS }),
  );
  const ir = (para) => ({ main: [[{ node: para, type: 'main', index: 0 }]] });
  wf.connections[anterior] = ir('Lembrete: config');
  wf.connections['Lembrete: config'] = ir('Lembrete: links');
  wf.connections['Lembrete: links'] = ir('Lembrete: ler Google');
  wf.connections['Lembrete: ler Google'] = ir('Lembrete: agenda do app');
  wf.connections['Lembrete: agenda do app'] = ir('Lembrete: confere a Google');
  wf.connections['Lembrete: confere a Google'] = { main: [[{ node: msg.name, type: 'main', index: 0 }, { node: 'Lembrete segurado: avisos', type: 'main', index: 0 }]] };
  wf.connections['Lembrete segurado: avisos'] = ir('Lembrete segurado: já avisei?');
  wf.connections['Lembrete segurado: já avisei?'] = ir('Lembrete segurado: novo?');
  wf.connections['Lembrete segurado: novo?'] = { main: [[{ node: 'Avisar a Gleide (lembrete segurado)', type: 'main', index: 0 }], []] };
  wf.connections['Avisar a Gleide (lembrete segurado)'] = ir('Lembrete segurado: anotar');
  wf.connections['Lembrete segurado: anotar'] = ir('Lembrete segurado: memória');
};
module.exports.CONFERE = CONFERE;
