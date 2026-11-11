// Google Agenda da dona como agenda de verdade, junto com a do app (só nas lojas com "google_agenda": true no
// loja.json; a Gleide não passa por aqui). Enquanto a loja não trouxe todas as clientes para o app, o que está
// na Google Agenda dela também ocupa horário: a IA consulta a Google antes de oferecer e de gravar no app.
//
// Leitura pelo "Endereço secreto no formato iCal" da agenda (Configurações › a agenda › Integrar agenda), sem
// conta Google no n8n. O link fica no banco, em empresas.config.loja.google_agenda_ics (vários: lista). Sem link:
// a Google é ignorada. Link não respondeu: a IA não oferece nem grava horário e passa para a dona, para não marcar
// em cima de cliente que só está na Google.
// Lê evento com hora (UTC ou com fuso) e de dia inteiro (ocupa o dia). Ignora evento "livre" (TRANSP:TRANSPARENT)
// e cancelado. Evento que se repete (RRULE) só ocupa a primeira data: a agenda da Caroline não tem nenhum.

// lê o .ics e devolve [[início, fim, título]] no fuso do salão (usado no Calcular e na assistente)
const LER_ICS = String.raw`
const lerIcsData = (v, tz) => {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(v || '').trim());
  if (!m) return null;
  const o = { year: +m[1], month: +m[2], day: +m[3], hour: +(m[4] || 0), minute: +(m[5] || 0), second: +(m[6] || 0) };
  const d = m[7] ? DateTime.fromObject(o, { zone: 'utc' }) : DateTime.fromObject(o, { zone: m[4] ? (tz || 'America/Cuiaba') : 'America/Cuiaba' });
  return d.isValid ? { d: d.setZone('America/Cuiaba'), diaInteiro: !m[4] } : null;
};
const lerIcs = (texto) => {
  const saida = [];
  for (const bloco of String(texto || '').replace(/\r?\n[ \t]/g, '').split('BEGIN:VEVENT').slice(1)) {
    const campo = (k) => { const m = new RegExp('^' + k + '((?:;[^:\r\n]*)?):(.*)$', 'm').exec(bloco); return m ? { par: m[1], val: m[2].trim() } : null; };
    if (/^TRANSP:TRANSPARENT/m.test(bloco) || /^STATUS:CANCELLED/m.test(bloco)) continue;
    const s = campo('DTSTART'); if (!s) continue;
    const e = campo('DTEND');
    const tz = (k) => { const m = /TZID=([^;:]+)/.exec(k ? k.par : ''); return m ? m[1] : null; };
    const ini = lerIcsData(s.val, tz(s)); if (!ini) continue;
    const fimL = e ? lerIcsData(e.val, tz(e)) : null;
    const a = ini.diaInteiro ? ini.d.startOf('day') : ini.d;
    const b = fimL ? (fimL.diaInteiro ? fimL.d.startOf('day') : fimL.d) : (ini.diaInteiro ? a.plus({ days: 1 }) : a.plus({ hours: 1 }));
    const titulo = ((campo('SUMMARY') || {}).val || 'ocupado').split(String.fromCharCode(92) + 'n').join(' ').split(String.fromCharCode(92)).join('');
    if (b > a) saida.push([a, b, titulo, ini.diaInteiro]);
  }
  return saida;
};`;

module.exports = ({ node, agendaWorkflow }) => {
  const achar = (nome) => { const n = agendaWorkflow.nodes.find((x) => x.name === nome); if (!n) throw new Error(`google_agenda: não achei "${nome}"`); return n; };
  const LINKS = "[].concat($('Supabase: config do salão').first().json.config?.loja?.google_agenda_ics || []).filter(Boolean)";

  // uma chamada por link (Split): cada item traz o texto do .ics em "data"
  const lista = 'Google: links da agenda';
  const nome = 'Google: horários ocupados';
  agendaWorkflow.nodes.push(
    node(lista, 'n8n-nodes-base.code', 2, [0, 0], { jsCode: `const links = ${LINKS};\nreturn links.length ? links.map((url) => ({ json: { url } })) : [{ json: { url: '' } }];` }),
    node(nome, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'GET', url: "={{ $json.url || 'https://calendar.google.com/sem-agenda' }}",
      options: { timeout: 15000, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 }),
  );
  // config do salão -> links -> Google -> agendamentos da cliente (o Calcular lê os três)
  const depois = agendaWorkflow.connections['Supabase: config do salão'];
  if (depois?.main?.[0]?.[0]?.node !== 'Supabase: agendamentos da cliente') throw new Error('google_agenda: a ligação da agenda mudou');
  agendaWorkflow.connections['Supabase: config do salão'] = { main: [[{ node: lista, type: 'main', index: 0 }]] };
  agendaWorkflow.connections[lista] = { main: [[{ node: nome, type: 'main', index: 0 }]] };
  agendaWorkflow.connections[nome] = depois;
  // agendamentos da cliente roda uma vez só (vários links = vários itens chegando)
  achar('Supabase: agendamentos da cliente').executeOnce = true;

  const calc = achar('Calcular');
  const ponto = 'const livre = (ini, fim) => !ocupados.some(([a, b]) => ini < b && fim > a);';
  if (!calc.parameters.jsCode.includes(ponto)) throw new Error('google_agenda: o Calcular mudou');
  // função no replace: o texto tem $' (que no replace com texto vira outra coisa)
  calc.parameters.jsCode = calc.parameters.jsCode.replace(ponto, () => `// Google Agenda da dona pelo link iCal (google-agenda.js): o que está lá também ocupa horário
{
  const links = ${LINKS};
  if (links.length) {
    const respostas = $('${nome}').all().map((i) => i.json);
    const ok = respostas.length >= links.length && respostas.every((r) => typeof r.data === 'string' && r.data.includes('BEGIN:VCALENDAR'));
    // sem a Google: não oferece nem grava horário (cancelar e ver os horários dela continuam)
    if (!ok && ['consultar', 'criar', 'remarcar'].includes(p.acao)) return saida({ resposta: FORA });
${LER_ICS}
    const desde = DateTime.now().setZone(TZ).minus({ days: 1 });
    for (const r of respostas) {
      if (typeof r.data !== 'string') continue;
      for (const [a, b] of lerIcs(r.data)) if (b > desde) ocupados.push([a, b]);
    }
  }
}
${ponto}`);
};

// Assistente da dona: agenda_do_dia, horarios_livres, marcar_horario e reagendar trazem junto o que está na Google
// Agenda daquele dia (a função do banco só enxerga o app). Antes de chamar o banco: config -> links -> .ics -> eventos.
module.exports.assistente = ({ node, ferramentasWorkflow: wf }) => {
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`google_agenda (assistente): não achei "${nome}"`); return n; };
  const ACOES = ['agenda_do_dia', 'horarios_livres', 'marcar_horario', 'reagendar'];
  const M = "$('Montar chamada').first().json";
  const banco = achar('Executar no banco');
  for (const k of ['url', 'jsonBody']) {
    if (!banco.parameters[k].includes('$json.')) throw new Error('google_agenda (assistente): o Executar no banco mudou');
    banco.parameters[k] = banco.parameters[k].replace(/\$json\./g, `${M}.`);
  }
  banco.executeOnce = true;
  wf.nodes.push(
    node('Precisa da Google?', 'n8n-nodes-base.if', 2.2, [0, 0], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'g1', leftValue: `={{ ${JSON.stringify(ACOES.map((a) => 'n8n_assistente_' + a))}.includes($json.funcao) && !$json.erro }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {},
    }),
    node('Google: config', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'GET', url: '={{ $env.SUPABASE_URL }}/rest/v1/empresas?select=config&id=eq.{{ $env.EMPRESA_ID }}',
      sendHeaders: true, headerParameters: { parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' }, { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' }] },
      options: { timeout: 15000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    node('Google: links', 'n8n-nodes-base.code', 2, [0, 0], { jsCode:
      "const links = [].concat($input.first().json.config?.loja?.google_agenda_ics || []).filter(Boolean);\nreturn links.length ? links.map((url) => ({ json: { url } })) : [{ json: { url: '' } }];" }),
    node('Google: ler agenda', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'GET', url: "={{ $json.url || 'https://calendar.google.com/sem-agenda' }}",
      options: { timeout: 15000, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 }),
    node('Google: eventos do dia', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: `${LER_ICS}
const m = ${M};
const NL = String.fromCharCode(10);
const a = m.args || {};
const links = [].concat($('Google: config').first().json.config?.loja?.google_agenda_ics || []).filter(Boolean);
if (!links.length) return [{ json: { texto: '' } }];
const respostas = $input.all().map((i) => i.json);
const dataTxt = String(a.p_data || a.p_inicio || '').slice(0, 10);
const dia = dataTxt ? DateTime.fromISO(dataTxt, { zone: 'America/Cuiaba' }) : DateTime.now().setZone('America/Cuiaba');
if (!respostas.every((r) => typeof r.data === 'string' && r.data.includes('BEGIN:VCALENDAR')))
  return [{ json: { texto: NL + NL + 'ATENÇÃO: não consegui ler a Google Agenda da dona agora. O resultado acima é só da agenda do app: avise que pode ter cliente marcada na Google que você não está vendo.' } }];
const ini = dia.startOf('day'), fim = ini.plus({ days: 1 });
const eventos = respostas.flatMap((r) => lerIcs(r.data)).filter(([x, y]) => x < fim && y > ini).sort((p, q) => p[0] - q[0]);
const hh = (d) => d.toFormat('HH:mm');
const lista = eventos.map(([x, y, t, todo]) => '- ' + (todo ? 'dia inteiro' : hh(x) + ' às ' + hh(y)) + ': ' + t).join(NL);
return [{ json: { texto: NL + NL + 'GOOGLE AGENDA DA DONA em ' + ini.setLocale('pt-BR').toFormat('cccc, dd/LL') + ' (clientes que ainda não estão no app; conta como ocupado, junto com o app):' + NL +
  (lista || '- nada marcado na Google neste dia') + NL +
  'Não diga que um horário está livre olhando só o app: confira esta lista. Não marque nem ofereça horário que bata com ela sem a dona confirmar.' } }];
` }),
  );
  const depois = wf.connections['Montar chamada'];
  if (depois?.main?.[0]?.[0]?.node !== 'Executar no banco') throw new Error('google_agenda (assistente): a ligação mudou');
  wf.connections['Montar chamada'] = { main: [[{ node: 'Precisa da Google?', type: 'main', index: 0 }]] };
  wf.connections['Precisa da Google?'] = { main: [[{ node: 'Google: config', type: 'main', index: 0 }], [{ node: 'Executar no banco', type: 'main', index: 0 }]] };
  wf.connections['Google: config'] = { main: [[{ node: 'Google: links', type: 'main', index: 0 }]] };
  wf.connections['Google: links'] = { main: [[{ node: 'Google: ler agenda', type: 'main', index: 0 }]] };
  wf.connections['Google: ler agenda'] = { main: [[{ node: 'Google: eventos do dia', type: 'main', index: 0 }]] };
  wf.connections['Google: eventos do dia'] = { main: [[{ node: 'Executar no banco', type: 'main', index: 0 }]] };
  // a resposta da ferramenta leva a lista da Google junto
  const r = achar('Resposta').parameters.assignments.assignments[0];
  const m = /^=\{\{ ([\s\S]*) \}\}$/.exec(r.value);
  if (!m) throw new Error('google_agenda (assistente): a Resposta mudou');
  r.value = `={{ (${m[1]}) + ($('Google: eventos do dia').isExecuted ? $('Google: eventos do dia').first().json.texto : '') }}`;
};
