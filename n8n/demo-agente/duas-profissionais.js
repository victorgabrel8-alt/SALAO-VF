// Segunda profissional na mesma agenda (só nas lojas com "segunda_profissional" no loja.json; a Gleide não passa por aqui).
// Pedido do Victor (20/11/2026, Carol): a Eduarda (Duda) atende no studio, com os mesmos dias, horários, serviços e
// preços da Caroline, numa agenda SEPARADA. A IA cuida das duas: oferece o horário livre mais cedo, de quem for,
// dizendo com quem é; cliente que pede a Caroline ouve os horários dela e, de um jeito positivo, que a Duda tem horário.
//
// Como fica a conta de horários (Calcular da agenda):
// - ocupados (Caroline): horários do app SEM a Duda (profissional da Caroline ou vazio, o que a dona marca à mão) e a
//   Google Agenda dela; ocupadosD (Duda): horários do app com o profissional_id da Duda.
// - dia bloqueado e horas bloqueadas no app fecham para as DUAS (é o studio que fecha).
// - um horário é livre se pelo menos uma está livre (ou a que a cliente pediu: campo "profissional" das ferramentas).
// - criar: grava com a profissional livre; no empate vai para a Duda (ela está com poucas clientes).
// - remarcar: tira só o horário da própria cliente da agenda da profissional DELA (nunca libera horário da outra);
//   se a dela não tem o horário novo e a outra tem, passa para a outra.
// - o quadro do dia só mostra "já tem cliente" quando as duas estão ocupadas (ou a pedida).
// - lembrete: "seu horário com a Duda" para as clientes da Duda.
// loja.json: "segunda_profissional": { "id": "<uuid em profissionais>", "nome": "Duda", "principal_id": "<uuid da dona>" }

module.exports = ({ node, workflow, agendaWorkflow: A, faltasWorkflow: FW, loja }) => {
  const sp = loja.segunda_profissional;
  if (!sp || !sp.id || !sp.nome || !sp.principal_id) throw new Error('duas-profissionais: falta id, nome ou principal_id em segunda_profissional');
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('duas-profissionais: sem o nó ' + nome); return n; };
  const trocarEm = (alvo, campo, onde) => (de, para) => {
    if (!alvo[campo].includes(de)) throw new Error(`duas-profissionais: "${onde}" mudou (${de.slice(0, 60)})`);
    alvo[campo] = alvo[campo].split(de).join(para);
  };
  const ID2 = JSON.stringify(sp.id), NOME2 = JSON.stringify(sp.nome), ID1 = JSON.stringify(sp.principal_id), DONA = JSON.stringify(loja.dona);

  // ---------- agenda: leituras com a profissional ----------
  const ocup = achar(A, 'Supabase: horários ocupados').parameters;
  trocarEm(ocup, 'url', 'horários ocupados')('select=inicio,fim,status&', 'select=inicio,fim,status,profissional_id&');
  const daCli = achar(A, 'Supabase: agendamentos da cliente').parameters;
  trocarEm(daCli, 'url', 'agendamentos da cliente')('select=id,inicio,fim,observacoes,', 'select=id,inicio,fim,observacoes,profissional_id,');

  // campo novo "profissional" do agente até o Preparar
  const gat = achar(A, 'Recebe pedido do agente').parameters.workflowInputs.values;
  if (!gat.some((v) => v.name === 'profissional')) gat.push({ name: 'profissional' });
  const prep = achar(A, 'Preparar').parameters;
  trocarEm(prep, 'jsCode', 'Preparar')("  motivo: String(e.motivo || '').trim(),", "  motivo: String(e.motivo || '').trim(),\n  profissional: String(e.profissional || '').trim(),");

  // ---------- Calcular ----------
  const calc = achar(A, 'Calcular').parameters;
  const t = trocarEm(calc, 'jsCode', 'Calcular');
  t('const ocupados = [];', [
    '// duas-profissionais.js: ocupados = ' + loja.dona + ' (e Google dela); ocupadosD = ' + sp.nome,
    'const ocupados = [];',
    'const ocupadosD = [];',
    'const PROF2_ID = ' + ID2 + ', PROF2_NOME = ' + NOME2 + ', PROF1_ID = ' + ID1 + ', DONA_NOME = ' + DONA + ';',
  ].join('\n'));
  t('  ocupados.push([ini, a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : ini.plus({ hours: 1 })]);',
    '  (a.profissional_id === PROF2_ID ? ocupadosD : ocupados).push([ini, a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : ini.plus({ hours: 1 })]);');
  t('{ ocupados.push([ini, fim]); blocosHora.push([ini, fim]); }', '{ ocupados.push([ini, fim]); ocupadosD.push([ini, fim]); blocosHora.push([ini, fim]); }');
  t('const livre = (ini, fim) => !ocupados.some(([a, b]) => ini < b && fim > a);', [
    'const livreDe = (lista, ini, fim) => !lista.some(([a, b]) => ini < b && fim > a);',
    "const QUER = String(p.profissional || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase();",
    'const querD = /dud|eduard/.test(QUER), querC = !querD && /carol/.test(QUER);',
    "// quem está livre no horário: 'D' (" + sp.nome + ") e/ou 'C' (" + loja.dona + "); no empate a " + sp.nome + ' vem primeiro',
    "const quem = (ini, fim) => [...(!querC && livreDe(ocupadosD, ini, fim) ? ['D'] : []), ...(!querD && livreDe(ocupados, ini, fim) ? ['C'] : [])];",
    'const livre = (ini, fim) => quem(ini, fim).length > 0;',
    "const nomeDe = (k) => (k === 'D' ? PROF2_NOME : DONA_NOME);",
    "const comQuem = (ini, fim) => { const q = quem(ini, fim); return q.length === 2 ? 'a ' + DONA_NOME + ' ou a ' + PROF2_NOME : q.length ? 'a ' + nomeDe(q[0]) : ''; };",
    '// o quadro do dia: "já tem cliente" só quando as duas estão ocupadas (ou a que a cliente pediu)',
    'const ocupadosQuadro = () => { if (querD) return ocupadosD; if (querC) return ocupados; const r = [];',
    '  for (const [a, b] of ocupados) for (const [c, d] of ocupadosD) { const x = a > c ? a : c, y = b < d ? b : d; if (x < y) r.push([x, y]); }',
    '  return r; };',
  ].join('\n'));
  // listar/remarcar: de quem é o horário dela
  t("    return { agendamentoId: x.id, obs: x.observacoes || '', titulo: (x.servicos && x.servicos.nome) || 'Horário',",
    "    return { agendamentoId: x.id, obs: x.observacoes || '', prof: x.profissional_id || null, titulo: ((x.servicos && x.servicos.nome) || 'Horário') + (x.profissional_id === PROF2_ID ? ' com a ' + PROF2_NOME : ' com a ' + DONA_NOME),");
  t("  if (semEle.some(([a, b]) => novo < b && fimNovo > a)) return saida({ resposta: 'O novo horário está ocupado. Consulte os horários livres e ofereça outro.' });", [
    '  // duas-profissionais.js: o horário dela só sai da agenda da profissional DELA; a outra continua como está',
    '  const daD = alvo.prof === PROF2_ID;',
    '  const tirarEle = (lista) => { const s = []; for (const [a, b] of lista) { if (b <= alvo.ini || a >= alvo.fim) { s.push([a, b]); continue; }',
    '    if (a < alvo.ini) s.push([a, alvo.ini]); if (b > alvo.fim) s.push([alvo.fim, b]); } s.push(...blocosHora); return s; };',
    "  const listaDe = (k) => ((k === 'D') === daD ? tirarEle(daD ? ocupadosD : ocupados) : (k === 'D' ? ocupadosD : ocupados));",
    "  const ordem = querD ? ['D'] : querC ? ['C'] : daD ? ['D', 'C'] : ['C', 'D'];",
    '  const novaProf = ordem.find((k) => !listaDe(k).some(([a, b]) => novo < b && fimNovo > a));',
    "  if (!novaProf) return saida({ resposta: 'O novo horário está ocupado' + (querC || querD ? ' com a ' + (querD ? PROF2_NOME : DONA_NOME) : '') + '. Consulte os horários livres e ofereça outro.' });",
  ].join('\n'));
  t("  return [{ json: { acao: 'remarcar', ok: true, agendamentoId: alvo.agendamentoId, observacoes, de: fmt(alvo.ini), quando: fmt(novo),",
    "  return [{ json: { acao: 'remarcar', ok: true, agendamentoId: alvo.agendamentoId, observacoes, de: fmt(alvo.ini), quando: fmt(novo) + ' com a ' + nomeDe(novaProf), profissional_id: novaProf === 'D' ? PROF2_ID : PROF1_ID,");
  // consultar: cada horário diz com quem é
  t(".map((x) => hm(x) + ' (data_hora_inicio: ' + iso(x) + ')').join(' ou ');",
    ".map((x) => hm(x) + ' com ' + comQuem(x, x.plus({ minutes: p.dur })) + ' (data_hora_inicio: ' + iso(x) + ')').join(' ou ');");
  t('const res = ocupados.filter(([x, y]) => x < b && y > a)', 'const res = ocupadosQuadro().filter(([x, y]) => x < b && y > a)');
  t("    else if (!livre(t, f)) motivo = 'já está ocupado';",
    "    else if (!livre(t, f)) motivo = querC && livreDe(ocupadosD, t, f) ? 'a ' + DONA_NOME + ' já tem cliente nesse horário, MAS a ' + PROF2_NOME + ' está livre nele: diga isso de um jeito positivo (\"a ' + PROF2_NOME + ' tem esse horário\") e ofereça'" +
    " : querD && livreDe(ocupados, t, f) ? 'a ' + PROF2_NOME + ' já tem cliente nesse horário, MAS a ' + DONA_NOME + ' está livre nele: diga isso de um jeito positivo e ofereça' : 'já está ocupado';");
  // criar com a profissional pedida ocupada: avisa se a outra está livre
  t("if (!livre(ini, fim)) return saida({ resposta: 'Esse horário acabou de ser ocupado. Consulte os horários livres de novo e ofereça outras opções.' });",
    "if (!livre(ini, fim)) return saida({ resposta: (querC && livreDe(ocupadosD, ini, fim) ? 'NÃO AGENDADO: a ' + DONA_NOME + ' já tem cliente nesse horário, mas a ' + PROF2_NOME + ' está livre nele. Ofereça a ' + PROF2_NOME + ' de um jeito positivo; se a cliente aceitar, chame de novo com profissional = ' + PROF2_NOME + '.'" +
    " : querD && livreDe(ocupados, ini, fim) ? 'NÃO AGENDADO: a ' + PROF2_NOME + ' já tem cliente nesse horário, mas a ' + DONA_NOME + ' está livre nele. Ofereça a ' + DONA_NOME + '; se a cliente aceitar, chame de novo com profissional = ' + DONA_NOME + '.'" +
    " : 'Esse horário acabou de ser ocupado. Consulte os horários livres de novo e ofereça outras opções.') });");
  t("resposta: 'LIVRE: ' + fmt(t) + ' está disponível para '", "resposta: 'LIVRE: ' + fmt(t) + ' com ' + comQuem(t, f) + ' está disponível para '");
  // criar: grava com a profissional livre
  t("return [{ json: {\n  acao: 'criar', ok: true,\n  quando: fmt(ini),", [
    'const escolhida = quem(ini, fim)[0];',
    "return [{ json: {\n  acao: 'criar', ok: true,\n  quando: fmt(ini) + ' com a ' + nomeDe(escolhida),",
    "  profissional_id: escolhida === 'D' ? PROF2_ID : PROF1_ID,",
  ].join('\n'));

  // gravar e remarcar com a profissional que o Calcular escolheu
  const montar = achar(A, 'Montar agendamento').parameters;
  trocarEm(montar, 'jsCode', 'Montar agendamento')('  profissional_id: prof[0] ? prof[0].id : null,',
    "  profissional_id: $('Calcular').first().json.profissional_id || (prof[0] ? prof[0].id : null),");
  const rem = achar(A, 'Supabase: remarcar agendamento').parameters;
  trocarEm(rem, 'jsonBody', 'remarcar agendamento')("fim: $('Calcular').item.json.patch.end.dateTime, ",
    "fim: $('Calcular').item.json.patch.end.dateTime, ...($('Calcular').item.json.profissional_id ? { profissional_id: $('Calcular').item.json.profissional_id } : {}), ");

  // ---------- ferramentas do agente: campo "profissional" ----------
  const DESC = {
    consultar_horarios_livres: 'Só se a cliente pediu uma profissional: "' + loja.dona + '" ou "' + sp.nome + '". Sem preferência, deixe vazio (vêm os horários das duas, cada um dizendo com quem é)',
    criar_agendamento: 'Com quem a cliente escolheu: "' + loja.dona + '" ou "' + sp.nome + '", como veio em consultar_horarios_livres. Vazio se ela não escolheu',
    remarcar_agendamento: 'Só se a cliente pediu uma profissional para o novo horário: "' + loja.dona + '" ou "' + sp.nome + '". Senão vazio',
  };
  for (const [nome, desc] of Object.entries(DESC)) {
    const n = achar(workflow, nome).parameters.workflowInputs;
    n.value.profissional = "={{ $fromAI('profissional', `" + desc + "`, 'string') }}";
    if (!n.schema.some((s) => s.id === 'profissional')) n.schema.push({ id: 'profissional', displayName: 'profissional', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false });
  }

  // ---------- lembrete: "com a Duda" para as clientes dela ----------
  if (FW && FW.nodes.some((x) => x.name === 'Mensagem do lembrete')) {
    const ler = achar(FW, 'Lembretes para mandar');
    const msg = achar(FW, 'Mensagem do lembrete');
    if (FW.connections['Lembretes para mandar']?.main?.[0]?.[0]?.node !== 'Mensagem do lembrete') throw new Error('duas-profissionais: a ligação do lembrete mudou');
    FW.nodes.push(node('Lembretes: horários da ' + sp.nome, 'n8n-nodes-base.httpRequest', 4.2, [ler.position[0] + 150, ler.position[1] + 200], {
      method: 'GET',
      url: "={{ $env.SUPABASE_URL }}/rest/v1/agendamentos?select=id&empresa_id=eq." + loja.empresa_id + '&profissional_id=eq.' + sp.id + "&status=eq.agendado&inicio=gte.{{ $now.minus({ hours: 2 }).toUTC().toISO() }}",
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
        { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
      ] },
      options: { timeout: 10000 },
    }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' }));
    FW.connections['Lembretes para mandar'] = { main: [[{ node: 'Lembretes: horários da ' + sp.nome, type: 'main', index: 0 }]] };
    FW.connections['Lembretes: horários da ' + sp.nome] = { main: [[{ node: 'Mensagem do lembrete', type: 'main', index: 0 }]] };
    const m = trocarEm(msg.parameters, 'jsCode', 'Mensagem do lembrete');
    m('return $input.all().map((i) => i.json).filter((l) => l.agendamento_id).map((l) => {', [
      "const DA2 = new Set($('Lembretes: horários da " + sp.nome + "').all().map((i) => i.json && i.json.id).filter(Boolean));",
      "return $('Lembretes para mandar').all().map((i) => i.json).filter((l) => l.agendamento_id).map((l) => {",
      '  const comQuem = DA2.has(l.agendamento_id) ? ' + NOME2 + ' : DONA;',
    ].join('\n'));
    m("' Lembrando do seu horário com a ' + DONA + ' '", "' Lembrando do seu horário com a ' + comQuem + ' '");
    m("'. Passando para confirmar o seu horário com a ' + DONA + ' '", "'. Passando para confirmar o seu horário com a ' + comQuem + ' '");
  }
};
