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
    const lerIcs = (v, tz) => {
      const m = /^(\\d{4})(\\d{2})(\\d{2})(?:T(\\d{2})(\\d{2})(\\d{2})(Z)?)?$/.exec(String(v || '').trim());
      if (!m) return null;
      const o = { year: +m[1], month: +m[2], day: +m[3], hour: +(m[4] || 0), minute: +(m[5] || 0), second: +(m[6] || 0) };
      const d = m[7] ? DateTime.fromObject(o, { zone: 'utc' }) : DateTime.fromObject(o, { zone: m[4] ? (tz || TZ) : TZ });
      return d.isValid ? { d: d.setZone(TZ), diaInteiro: !m[4] } : null;
    };
    const desde = DateTime.now().setZone(TZ).minus({ days: 1 });
    for (const r of respostas) {
      if (typeof r.data !== 'string') continue;
      for (const bloco of r.data.replace(/\\r?\\n[ \\t]/g, '').split('BEGIN:VEVENT').slice(1)) {
        const campo = (k) => { const m = new RegExp('^' + k + '((?:;[^:\\\\r\\\\n]*)?):(.*)$', 'm').exec(bloco); return m ? { par: m[1], val: m[2].trim() } : null; };
        if (/^TRANSP:TRANSPARENT/m.test(bloco) || /^STATUS:CANCELLED/m.test(bloco)) continue;
        const s = campo('DTSTART'); if (!s) continue;
        const e = campo('DTEND');
        const tz = (k) => { const m = /TZID=([^;:]+)/.exec(k ? k.par : ''); return m ? m[1] : null; };
        const ini = lerIcs(s.val, tz(s)); if (!ini) continue;
        const fimL = e ? lerIcs(e.val, tz(e)) : null;
        const a = ini.diaInteiro ? ini.d.startOf('day') : ini.d;
        const b = fimL ? (fimL.diaInteiro ? fimL.d.startOf('day') : fimL.d) : (ini.diaInteiro ? a.plus({ days: 1 }) : a.plus({ hours: 1 }));
        if (b > desde && b > a) ocupados.push([a, b]);
      }
    }
  }
}
${ponto}`);
};
