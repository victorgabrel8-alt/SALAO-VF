// Google Agenda da dona como agenda de verdade, junto com a do app (só nas lojas com "google_agenda": true no
// loja.json; a Gleide não passa por aqui). Enquanto a loja não trouxe todas as clientes para o app, o que está
// na Google Agenda dela também ocupa horário: a IA consulta a Google antes de oferecer e de gravar no app.
//
// O id da agenda fica no banco, em empresas.config.loja.google_agenda_id (o e-mail da agenda). A dona compartilha
// a agenda com a conta Google da credencial do n8n ("ver só livre/ocupado" basta). Sem id: a Google é ignorada.
// Google respondeu com erro (sem acesso, fora do ar): a IA não oferece horário e passa para a dona, para não
// marcar em cima de cliente que só está na Google.

module.exports = ({ node, agendaWorkflow, env }) => {
  const achar = (nome) => { const n = agendaWorkflow.nodes.find((x) => x.name === nome); if (!n) throw new Error(`google_agenda: não achei "${nome}"`); return n; };
  if (!env.N8N_GCAL_CRED_ID) throw new Error('google_agenda: falta N8N_GCAL_CRED_ID no .env (credencial Google Agenda do n8n)');
  const CFG = "($('Supabase: config do salão').first().json.config?.loja?.google_agenda_id || '')";
  const Pr = "$('Preparar').first().json";

  const nome = 'Google: horários ocupados';
  agendaWorkflow.nodes.push(node(nome, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method: 'POST', url: 'https://www.googleapis.com/calendar/v3/freeBusy',
    authentication: 'predefinedCredentialType', nodeCredentialType: 'googleCalendarOAuth2Api',
    sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ timeMin: DateTime.fromISO(${Pr}.timeMin || $now.toISO()).minus({ hours: 12 }).toUTC().toISO(), ` +
      `timeMax: ${Pr}.timeMax || $now.plus({ days: 8 }).toUTC().toISO(), timeZone: 'America/Cuiaba', items: [{ id: ${CFG} || 'sem-agenda' }] }) }}`,
    options: { timeout: 15000 },
  }, { credentials: { googleCalendarOAuth2Api: { id: env.N8N_GCAL_CRED_ID, name: 'Google Calendar account 2' } },
    onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 }));
  // config do salão -> Google -> agendamentos da cliente (o Calcular lê os três)
  const depois = agendaWorkflow.connections['Supabase: config do salão'];
  if (depois?.main?.[0]?.[0]?.node !== 'Supabase: agendamentos da cliente') throw new Error('google_agenda: a ligação da agenda mudou');
  agendaWorkflow.connections['Supabase: config do salão'] = { main: [[{ node: nome, type: 'main', index: 0 }]] };
  agendaWorkflow.connections[nome] = depois;

  const calc = achar('Calcular');
  const ponto = 'const livre = (ini, fim) => !ocupados.some(([a, b]) => ini < b && fim > a);';
  if (!calc.parameters.jsCode.includes(ponto)) throw new Error('google_agenda: o Calcular mudou');
  calc.parameters.jsCode = calc.parameters.jsCode.replace(ponto, `// Google Agenda da dona (google-agenda.js): o que está lá também ocupa horário
{
  const gid = ${CFG};
  if (gid) {
    const g = $('${nome}').first().json || {};
    const cal = g.calendars ? g.calendars[gid] || Object.values(g.calendars)[0] : null;
    // sem resposta da Google: não oferece nem grava horário (cancelar e ver os horários dela continuam)
    if (!cal || g.error || (cal.errors && cal.errors.length)) { if (['consultar', 'criar', 'remarcar'].includes(p.acao)) return saida({ resposta: FORA }); }
    for (const b of (cal && cal.busy) || []) {
      const ini = DateTime.fromISO(b.start).setZone(TZ), fim = DateTime.fromISO(b.end).setZone(TZ);
      if (ini.isValid && fim.isValid) ocupados.push([ini, fim]);
    }
  }
}
${ponto}`);
};
