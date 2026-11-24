// Equipe na agenda: mais de uma profissional na mesma loja, cada uma com a sua agenda (loja.json: "equipe": true).
// Entra no lugar do duas-profissionais.js (20/11/2026), que só sabia lidar com duas pessoas e trazia os nomes e os
// ids escritos no loja.json. Pedido do Victor (23/11/2026, Carol): dar preferência para a funcionária nova (Duda)
// sem prender o sistema a esta loja.
//
// Nada da equipe fica escrito aqui nem no loja.json: vem do cadastro (tabela profissionais), lido na hora pela função
// n8n_equipe_da_agenda (supabase/069). Serve para qualquer número de profissionais.
//   - a primeira do cadastro é a dona: horário sem profissional (o que ela marca à mão) e a Google Agenda são dela;
//   - dia bloqueado e horas bloqueadas no app fecham para TODAS (é o salão que fecha);
//   - um horário é livre se pelo menos uma está livre (ou a que a cliente pediu: campo "profissional" das ferramentas).
// Quem a IA oferece primeiro (a ordem):
//   1. a que a cliente pediu pelo nome: só ela;
//   2. cliente que já tem horário (marcado ou feito) com uma profissional: essa vem primeiro, ela continua com quem
//      a atende;
//   3. cliente nova: a de maior profissionais.preferencia. Os 2 horários que a IA oferece saem da agenda dela; a
//      outra só aparece quando a preferida não tem horário no dia ou período pedido, ou quando a cliente pede um
//      horário exato que só a outra tem.
//   Todas com a mesma preferência (0, o padrão): como antes, o horário mais cedo de quem for, dizendo com quem é.
// criar: grava com a primeira da ordem que está livre. remarcar: primeiro a profissional do horário atual dela (o
// horário dela só sai da agenda da profissional DELA), depois as outras pela ordem.
// lembrete: "seu horário com a <nome>" com o nome de quem atende.

module.exports = ({ node, workflow, agendaWorkflow: A, faltasWorkflow: FW, loja }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('equipe-agenda: sem o nó ' + nome); return n; };
  const trocarEm = (alvo, campo, onde) => (de, para) => {
    if (!alvo[campo].includes(de)) throw new Error(`equipe-agenda: "${onde}" mudou (${de.slice(0, 60)})`);
    alvo[campo] = alvo[campo].split(de).join(para);
  };

  // ---------- agenda: leituras com a profissional ----------
  const ocup = achar(A, 'Supabase: horários ocupados').parameters;
  trocarEm(ocup, 'url', 'horários ocupados')('select=inicio,fim,status&', 'select=inicio,fim,status,profissional_id&');
  const daCli = achar(A, 'Supabase: agendamentos da cliente');
  trocarEm(daCli.parameters, 'url', 'agendamentos da cliente')('select=id,inicio,fim,observacoes,', 'select=id,inicio,fim,observacoes,profissional_id,');

  // a equipe e a profissional desta cliente, lidas na hora (supabase/069), logo antes do Calcular
  if (A.connections['Supabase: agendamentos da cliente']?.main?.[0]?.[0]?.node !== 'Calcular') throw new Error('equipe-agenda: a ligação até o Calcular mudou');
  A.nodes.push(node('Supabase: equipe', 'n8n-nodes-base.httpRequest', 4.2, [daCli.position[0] + 150, daCli.position[1] + 200], {
    method: 'POST',
    url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_equipe_da_agenda',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
    ] },
    sendBody: true,
    specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ p_empresa_id: '" + loja.empresa_id + "', p_telefone: String($('Preparar').first().json.telefone || '') }) }}",
    options: { timeout: 10000 },
  }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' }));
  A.connections['Supabase: agendamentos da cliente'] = { main: [[{ node: 'Supabase: equipe', type: 'main', index: 0 }]] };
  A.connections['Supabase: equipe'] = { main: [[{ node: 'Calcular', type: 'main', index: 0 }]] };

  // campo novo "profissional" do agente até o Preparar
  const gat = achar(A, 'Recebe pedido do agente').parameters.workflowInputs.values;
  if (!gat.some((v) => v.name === 'profissional')) gat.push({ name: 'profissional' });
  const prep = achar(A, 'Preparar').parameters;
  trocarEm(prep, 'jsCode', 'Preparar')("  motivo: String(e.motivo || '').trim(),", "  motivo: String(e.motivo || '').trim(),\n  profissional: String(e.profissional || '').trim(),");

  // ---------- Calcular ----------
  const calc = achar(A, 'Calcular').parameters;
  const t = trocarEm(calc, 'jsCode', 'Calcular');
  t('const ocupados = [];', [
    '// equipe-agenda.js: a equipe vem do cadastro (supabase/069); cada profissional tem a sua lista de horários ocupados',
    "const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim();",
    'const EQUIPE = (() => { try {',
    "  const r = $('Supabase: equipe').first().json;",
    '  const lista = (r && Array.isArray(r.profissionais) ? r.profissionais : []).filter((x) => x && x.id && x.nome);',
    '  return lista.length ? { lista, dela: r.da_cliente || null } : null;',
    '} catch (e) { return null; } })();',
    '// sem a equipe não dá para saber de quem é cada horário: não oferece nem grava (ver os horários dela e cancelar continuam)',
    "if (!EQUIPE && ['consultar', 'criar', 'remarcar'].includes(p.acao)) return saida({ resposta: FORA });",
    'const PROFS = (EQUIPE ? EQUIPE.lista : [{ id: null, nome: ' + JSON.stringify(loja.dona) + ' }]).map((x, i, todas) => { const partes = String(x.nome).trim().split(/\\s+/);',
    '  // duas com o mesmo primeiro nome (Ana Paula e Ana Clara): cada uma sai com dois nomes',
    '  const repetido = todas.some((y, j) => j !== i && semAcento(String(y.nome).trim().split(/\\s+/)[0]) === semAcento(partes[0]));',
    "  const nome = repetido && partes[1] ? partes[0] + ' ' + partes[1] : partes[0];",
    "  const chaves = [repetido ? partes[1] || '' : partes[0], nome, partes.join(' '), ...(Array.isArray(x.apelidos) ? x.apelidos : [])].map((k) => semAcento(k).replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);",
    '  return { id: x.id, nome, pref: Number(x.preferencia) || 0, chaves, ocupados: [] }; });',
    '// a primeira do cadastro é a dona: horário sem profissional e a Google Agenda são dela',
    'const DONA_P = PROFS[0];',
    'const porId = (id) => PROFS.find((x) => x.id === id) || DONA_P;',
    'const ocupados = DONA_P.ocupados;',
  ].join('\n'));
  t('  ocupados.push([ini, a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : ini.plus({ hours: 1 })]);',
    '  porId(a.profissional_id).ocupados.push([ini, a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : ini.plus({ hours: 1 })]);');
  t('{ ocupados.push([ini, fim]); blocosHora.push([ini, fim]); }', '{ for (const x of PROFS) x.ocupados.push([ini, fim]); blocosHora.push([ini, fim]); }');
  t('const livre = (ini, fim) => !ocupados.some(([a, b]) => ini < b && fim > a);', [
    'const livreDe = (lista, ini, fim) => !lista.some(([a, b]) => ini < b && fim > a);',
    '// a profissional que a cliente pediu pelo nome ("carol" acha a Caroline; apelidos do cadastro também valem, e apelido',
    '// curto vale como começo: "dud" acha "dudinha"). Veio mais de um nome ("Caroline ou Duda"): ela não escolheu, é sem pedido',
    '// Nome ou apelido inteiro ganha de "começa com" ("Anabela" não é a Ana) e o mais comprido ganha do mais curto.',
    "const PEDIDA = (() => { const txt = ' ' + semAcento(p.profissional).replace(/[^a-z0-9]+/g, ' ').trim() + ' ';",
    "  const pal = txt.trim().split(' ').filter((w) => w.length >= 3);",
    "  const inteiro = PROFS.map((x) => [x, x.chaves.filter((k) => txt.includes(' ' + k + ' ')).sort((m, n) => n.length - m.length)[0]]).filter((m) => m[1]);",
    '  // "ana clara" contém "ana": vale só a do nome mais comprido; nomes diferentes ("Caroline ou a Duda") = ela não escolheu',
    "  if (inteiro.length) { const com = inteiro.filter((m) => !inteiro.some((o) => o[1] !== m[1] && (' ' + o[1] + ' ').includes(' ' + m[1] + ' '))); return com.length === 1 ? com[0][0] : null; }",
    "  const achadas = PROFS.filter((x) => x.chaves.some((k) => !k.includes(' ') && pal.some((w) => w.length >= 4 && (k.startsWith(w) || (k.length >= 3 && w.startsWith(k))))));",
    '  return achadas.length === 1 ? achadas[0] : null; })();',
    '// a profissional desta cliente (último horário marcado ou feito): ela continua com quem a atende',
    'const DELA = EQUIPE && EQUIPE.dela ? PROFS.find((x) => x.id === EQUIPE.dela) || null : null;',
    '// ordem de quem a IA oferece: a pedida (só ela); senão a da cliente, depois a de maior preferência',
    'const peso = (x) => (DELA && x.id === DELA.id ? 1000000 : 0) + x.pref;',
    'const ORDEM = PEDIDA ? [PEDIDA] : PROFS.map((x, i) => [x, i]).sort((m, n) => peso(n[0]) - peso(m[0]) || m[1] - n[1]).map((m) => m[0]);',
    '// quem está livre no horário, na ordem',
    'const quem = (ini, fim) => ORDEM.filter((x) => livreDe(x.ocupados, ini, fim));',
    'const livre = (ini, fim) => quem(ini, fim).length > 0;',
    '// com quem é o horário: a primeira da ordem que está livre; empate de preferência diz todas as empatadas',
    "const comQuem = (ini, fim) => { const q = quem(ini, fim); const iguais = q.filter((x) => peso(x) === peso(q[0])).map((x) => 'a ' + x.nome);",
    "  return iguais.length > 1 ? iguais.slice(0, -1).join(', ') + ' ou ' + iguais[iguais.length - 1] : iguais[0] || ''; };",
    '// a outra que está livre quando a pedida não está (para a IA oferecer de um jeito positivo)',
    'const outraLivre = (ini, fim) => (PEDIDA ? [...PROFS].sort((m, n) => peso(n) - peso(m)).find((x) => x.id !== PEDIDA.id && livreDe(x.ocupados, ini, fim)) || null : null);',
    '// as preferidas (as primeiras da ordem, empatadas): os 2 horários oferecidos saem da agenda delas quando elas têm',
    'const TOPO = ORDEM.filter((x) => peso(x) === peso(ORDEM[0]));',
    '// (a preferida com um horário só: ele e mais um das outras, para a cliente ter duas opções)',
    'const daPreferida = (v, dur) => { const w = v.filter((x) => TOPO.some((k) => livreDe(k.ocupados, x, x.plus({ minutes: dur }))));',
    '  if (w.length !== 1 || v.length === 1) return w.length ? w : v;',
    "  const resto = v.filter((x) => +x !== +w[0]);",
    "  const outro = resto.find((x) => (x.hour < 12) !== (w[0].hour < 12)) || resto.find((x) => Math.abs(x.diff(w[0], 'minutes').minutes) >= 120) || resto[0];",
    '  return [w[0], outro].sort((m, n) => m - n); };',
    '// A cliente já é atendida por uma profissional (DELA) e o que a consulta achou é com outra: a IA diz isso e dá as duas',
    '// opções (outro horário com a dela, ou o horário achado com a outra). Sem isso a cliente da Duda ia para a Caroline calada.',
    'const livresDela = (dia) => { for (let i = 0; i < DIAS_BUSCA; i++) { const d = dia.plus({ days: i }), v = [];',
    '  for (const [a, b] of intervalos(d)) for (let h = a; h.plus({ minutes: p.dur }) <= b; h = h.plus({ minutes: PASSO_MIN })) {',
    '    if (h < agora.plus({ minutes: ANTECEDENCIA_MIN }) || noAlmocoFlex(h, h.plus({ minutes: p.dur }))) continue;',
    '    if (livreDe(DELA.ocupados, h, h.plus({ minutes: p.dur }))) v.push(h); }',
    '  if (v.length) return v; } return []; };',
    'const notaDela = (dia, horarios) => { if (!DELA || PEDIDA || !horarios.length) return \'\';',
    '  if (horarios.some((h) => livreDe(DELA.ocupados, h, h.plus({ minutes: p.dur })))) return \'\';',
    '  const v = livresDela(dia.startOf(\'day\'));',
    '  const dois = v.length ? [v[0], v.find((x) => (x.hour < 12) !== (v[0].hour < 12)) || v[1]].filter(Boolean) : [];',
    "  return ' ATENÇÃO: esta cliente é atendida pela ' + DELA.nome + ', e a ' + DELA.nome + ' não tem o horário acima. Diga isso a ela e dê as duas opções, sem escolher por ela: ' +",
    "    (dois.length ? 'com a ' + DELA.nome + ', ' + dois.map((x) => fmt(x) + ' (data_hora_inicio: ' + iso(x) + ')').join(' ou ') : 'esperar a ' + DELA.nome + ', que não tem horário nos próximos ' + DIAS_BUSCA + ' dias') +",
    "    '; ou o horário acima com a outra profissional.'; };",
    '// o quadro do dia: "já tem cliente" só quando todas estão ocupadas (ou a que a cliente pediu)',
    'const ocupadosQuadro = () => ORDEM.slice(1).reduce((r, x) => { const s = [];',
    '  for (const [a, b] of r) for (const [c, d] of x.ocupados) { const i = a > c ? a : c, f = b < d ? b : d; if (i < f) s.push([i, f]); }',
    '  return s; }, ORDEM[0].ocupados);',
  ].join('\n'));
  // listar/remarcar: de quem é o horário dela
  t("    return { agendamentoId: x.id, obs: x.observacoes || '', titulo: (x.servicos && x.servicos.nome) || 'Horário',",
    "    return { agendamentoId: x.id, obs: x.observacoes || '', prof: porId(x.profissional_id), titulo: ((x.servicos && x.servicos.nome) || 'Horário') + ' com a ' + porId(x.profissional_id).nome,");
  t("  if (semEle.some(([a, b]) => novo < b && fimNovo > a)) return saida({ resposta: 'O novo horário está ocupado. Consulte os horários livres e ofereça outro.' });", [
    '  // equipe-agenda.js: o horário dela só sai da agenda da profissional DELA; as outras continuam como estão',
    '  const tirarEle = (lista) => { const s = []; for (const [a, b] of lista) { if (b <= alvo.ini || a >= alvo.fim) { s.push([a, b]); continue; }',
    '    if (a < alvo.ini) s.push([a, alvo.ini]); if (b > alvo.fim) s.push([alvo.fim, b]); } s.push(...blocosHora); return s; };',
    '  const listaDe = (x) => (x.id === alvo.prof.id ? tirarEle(x.ocupados) : x.ocupados);',
    '  // primeiro a profissional do horário atual, depois as outras pela ordem',
    '  const ordemR = PEDIDA ? [PEDIDA] : [alvo.prof, ...ORDEM.filter((x) => x.id !== alvo.prof.id)];',
    '  const novaProf = ordemR.find((x) => !listaDe(x).some(([a, b]) => novo < b && fimNovo > a));',
    '  // ela já tem OUTRO horário dela nessa hora (com qualquer profissional): não fica com dois na mesma hora',
    '  { const meu = vagasDela.find((v) => +v.a !== +alvo.ini && novo < v.b && fimNovo > v.a);',
    "    if (meu) return saida({ resposta: 'NÃO REMARCADO: nesse horário ela já tem outro horário dela (' + meu.nome + ', ' + fmt(meu.a) + '). Diga isso a ela e ofereça outro horário.' }); }",
    '  if (!novaProf) { const o = PEDIDA ? [...PROFS].sort((m, n) => peso(n) - peso(m)).find((x) => x.id !== PEDIDA.id && !listaDe(x).some(([a, b]) => novo < b && fimNovo > a)) : null;',
    "    return saida({ resposta: o ? 'NÃO REMARCADO: a ' + PEDIDA.nome + ' já tem cliente nesse horário, mas a ' + o.nome + ' está livre nele. Ofereça a ' + o.nome + ' de um jeito positivo; se a cliente aceitar, chame de novo com profissional = ' + o.nome + '.'",
    "      : 'O novo horário está ocupado' + (PEDIDA ? ' com a ' + PEDIDA.nome : '') + '. Consulte os horários livres e ofereça outro.' }); }",
  ].join('\n'));
  t("  return [{ json: { acao: 'remarcar', ok: true, agendamentoId: alvo.agendamentoId, observacoes, de: fmt(alvo.ini), quando: fmt(novo),",
    "  return [{ json: { acao: 'remarcar', ok: true, agendamentoId: alvo.agendamentoId, observacoes, de: fmt(alvo.ini), quando: fmt(novo) + ' com a ' + novaProf.nome, profissional_id: novaProf.id,");
  // consultar: os 2 horários oferecidos são os da preferida (quando ela tem) e cada um diz com quem é
  t('    const m = v.find((t) => t.hour < 12), t = v.find((x) => x.hour >= 12);',
    '    v = daPreferida(v, p.dur);\n    const m = v.find((t) => t.hour < 12), t = v.find((x) => x.hour >= 12);');
  t(".map((x) => hm(x) + ' (data_hora_inicio: ' + iso(x) + ')').join(' ou ');",
    ".map((x) => hm(x) + ' com ' + comQuem(x, x.plus({ minutes: p.dur })) + ' (data_hora_inicio: ' + iso(x) + ')').join(' ou ');");
  t('const res = ocupados.filter(([x, y]) => x < b && y > a)', 'const res = ocupadosQuadro().filter(([x, y]) => x < b && y > a)');
  t("    else if (!livre(t, f)) motivo = 'já está ocupado';",
    "    else if (!livre(t, f)) { const o = outraLivre(t, f); motivo = o ? 'a ' + PEDIDA.nome + ' já tem cliente nesse horário, MAS a ' + o.nome + ' está livre nele: diga isso de um jeito positivo (\"a ' + o.nome + ' tem esse horário\") e ofereça' : 'já está ocupado'; }");
  // criar com a profissional pedida ocupada: avisa se outra está livre
  t("if (!livre(ini, fim)) return saida({ resposta: 'Esse horário acabou de ser ocupado. Consulte os horários livres de novo e ofereça outras opções.' });",
    "if (!livre(ini, fim)) { const o = outraLivre(ini, fim); return saida({ resposta: o ? 'NÃO AGENDADO: a ' + PEDIDA.nome + ' já tem cliente nesse horário, mas a ' + o.nome + ' está livre nele. Ofereça a ' + o.nome + ' de um jeito positivo; se a cliente aceitar, chame de novo com profissional = ' + o.nome + '.'" +
    " : 'Esse horário acabou de ser ocupado. Consulte os horários livres de novo e ofereça outras opções.' }); }");
  // a pedida sem horário no dia e outra com: a IA conta, de um jeito positivo, em vez de dizer que o dia está cheio
  t("    ' Próximo dia com vaga: ' + quadro(diaAlternativo, opcoes);", [
    "    (() => { if (!PEDIDA || fechado) return '';",
    '      for (const [a, b] of intervalos(pedido)) for (let h = a; h.plus({ minutes: p.dur }) <= b; h = h.plus({ minutes: PASSO_MIN })) {',
    "        if (h < agora.plus({ minutes: ANTECEDENCIA_MIN }) || (p.periodo.startsWith('manh') && h.hour >= 12) || (p.periodo.startsWith('tard') && h.hour < 12) || noAlmocoFlex(h, h.plus({ minutes: p.dur }))) continue;",
    '        const o = outraLivre(h, h.plus({ minutes: p.dur }));',
    "        if (o) return ' Isso vale para a ' + PEDIDA.nome + ', que ela pediu. Nesse dia a ' + o.nome + ' tem horário (ex.: ' + hm(h) + ', data_hora_inicio: ' + iso(h) + '): diga isso de um jeito positivo e deixe a cliente escolher entre esse horário com a ' + o.nome + ' ou esperar a ' + PEDIDA.nome + '.';",
    "      } return ''; })() +",
    "    ' Próximo dia com vaga' + (PEDIDA ? ' com a ' + PEDIDA.nome : '') + ': ' + quadro(diaAlternativo, opcoes);",
  ].join('\n'));
  t("resposta: 'LIVRE: ' + fmt(t) + ' está disponível para '", "resposta: 'LIVRE: ' + fmt(t) + ' com ' + comQuem(t, f) + ' está disponível para '");
  t("'). Pode oferecer à cliente.' } }];", "'). Pode oferecer à cliente.' + notaDela(t, [t]) } }];");
  // dia inteiro: os horários achados são todos de outra profissional
  t("  return [{ json: { acao: 'consultar', ok: true, resposta } }];",
    "  return [{ json: { acao: 'consultar', ok: true, resposta: resposta + (opcoes.length ? notaDela(diaAlternativo || pedido, opcoes) : '') } }];");
  // criar: grava com a primeira da ordem que está livre
  t("return [{ json: {\n  acao: 'criar', ok: true,\n  quando: fmt(ini),", [
    'const escolhida = quem(ini, fim)[0];',
    "return [{ json: {\n  acao: 'criar', ok: true,\n  quando: fmt(ini) + ' com a ' + escolhida.nome,",
    '  profissional_id: escolhida.id,',
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
    consultar_horarios_livres: 'Só se a cliente pediu uma profissional pelo nome: o primeiro nome dela. Sem pedido da cliente, deixe vazio (cada horário já vem dizendo com quem é)',
    criar_agendamento: 'O primeiro nome de quem atende o horário que a cliente escolheu, como veio em consultar_horarios_livres. Vazio se o horário veio com mais de um nome e ela não escolheu',
    remarcar_agendamento: 'Só se a cliente pediu uma profissional pelo nome para o novo horário: o primeiro nome dela. Senão vazio',
  };
  for (const [nome, desc] of Object.entries(DESC)) {
    const n = achar(workflow, nome).parameters.workflowInputs;
    n.value.profissional = "={{ $fromAI('profissional', `" + desc + "`, 'string') }}";
    if (!n.schema.some((s) => s.id === 'profissional')) n.schema.push({ id: 'profissional', displayName: 'profissional', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false });
  }
  // a consulta também leva o telefone: é por ele que a agenda sabe com quem a cliente já tem horário (sem isso a
  // cliente antiga era tratada como nova na hora de oferecer; achado no teste de conversa de 23/11)
  const consulta = achar(workflow, 'consultar_horarios_livres').parameters.workflowInputs;
  if (!consulta.schema.some((s) => s.id === 'telefone')) throw new Error('equipe-agenda: consultar_horarios_livres sem o campo telefone');
  consulta.value.telefone = achar(workflow, 'criar_agendamento').parameters.workflowInputs.value.telefone;
  if (!consulta.value.telefone) throw new Error('equipe-agenda: criar_agendamento sem telefone para copiar');

  // ---------- lembrete: "com a <nome>" de quem atende ----------
  if (FW && FW.nodes.some((x) => x.name === 'Mensagem do lembrete')) {
    const ler = achar(FW, 'Lembretes para mandar');
    const msg = achar(FW, 'Mensagem do lembrete');
    if (FW.connections['Lembretes para mandar']?.main?.[0]?.[0]?.node !== 'Mensagem do lembrete') throw new Error('equipe-agenda: a ligação do lembrete mudou');
    FW.nodes.push(node('Lembretes: com quem', 'n8n-nodes-base.httpRequest', 4.2, [ler.position[0] + 150, ler.position[1] + 200], {
      method: 'GET',
      url: '={{ $env.SUPABASE_URL }}/rest/v1/agendamentos?select=id,profissionais(nome)&empresa_id=eq.' + loja.empresa_id + "&profissional_id=not.is.null&status=eq.agendado&inicio=gte.{{ $now.minus({ hours: 2 }).toUTC().toISO() }}",
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
        { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
      ] },
      options: { timeout: 10000 },
    }, { executeOnce: true, alwaysOutputData: true, onError: 'continueRegularOutput' }));
    FW.connections['Lembretes para mandar'] = { main: [[{ node: 'Lembretes: com quem', type: 'main', index: 0 }]] };
    FW.connections['Lembretes: com quem'] = { main: [[{ node: 'Mensagem do lembrete', type: 'main', index: 0 }]] };
    const m = trocarEm(msg.parameters, 'jsCode', 'Mensagem do lembrete');
    m('return $input.all().map((i) => i.json).filter((l) => l.agendamento_id).map((l) => {', [
      "const COM = new Map($('Lembretes: com quem').all().map((i) => i.json).filter((x) => x && x.id && x.profissionais && x.profissionais.nome).map((x) => [x.id, primeiro(x.profissionais.nome)]));",
      "return $('Lembretes para mandar').all().map((i) => i.json).filter((l) => l.agendamento_id).map((l) => {",
      '  const comQuem = COM.get(l.agendamento_id) || DONA;',
    ].join('\n'));
    m("' Lembrando do seu horário com a ' + DONA + ' '", "' Lembrando do seu horário com a ' + comQuem + ' '");
    m("'. Passando para confirmar o seu horário com a ' + DONA + ' '", "'. Passando para confirmar o seu horário com a ' + comQuem + ' '");
  }
};
