// Bloqueio de uma profissional só (loja.json: "bloqueio_por_profissional": true, com "equipe": true; a Gleide não passa por
// aqui). Pedido do Victor (24/11/2026): quando a Caroline bloqueia um dia ou umas horas por motivo pessoal, a assistente
// pergunta se a agenda da Duda continua e mostra as clientes marcadas no dia. Se a Duda continua, o bloqueio é só da
// Caroline e a Duda segue sendo oferecida.
// Banco: supabase/076 (bloquear_*_v2 gravam "profissional_id" no bloqueio) e 077 (o fechamento confere a profissional).
// Aqui:
//   1. agenda da IA (Calcular): dia bloqueado com profissional_id não fecha o studio, ocupa o dia só dela; hora bloqueada
//      com profissional_id ocupa só a agenda dela. Bloqueio sem profissional_id fecha todas, como antes;
//   2. assistente: bloquear_dias e bloquear_horario ganham o campo "profissional" e chamam as funções _v2.
// O texto do prompt da loja diz quando perguntar (lojas/<slug>/prompt-assistente.txt).

module.exports = ({ agendaWorkflow: AG, assistenteWorkflow: A, ferramentasWorkflow: F }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('bloqueio-por-profissional: sem o nó ' + nome); return n; };
  const trocarUma = (n, campo, de, para) => {
    const t = String(n.parameters[campo] || '');
    if (t.split(de).length !== 2) throw new Error(`bloqueio-por-profissional: "${n.name}" mudou (${de.slice(0, 70)})`);
    n.parameters[campo] = t.replace(de, () => para);
  };

  // 1. agenda da IA (depois do equipe-agenda.js, que criou PROFS)
  const calc = achar(AG, 'Calcular');
  if (!String(calc.parameters.jsCode).includes('const PROFS =')) throw new Error('bloqueio-por-profissional: precisa do equipe-agenda.js antes');
  trocarUma(calc, 'jsCode', 'let BLOQUEIOS = [];', 'let BLOQUEIOS = [], BLOQ_PROF = []; // bloqueio-por-profissional.js: os de uma profissional só');
  trocarUma(calc, 'jsCode', 'if (cfg && Array.isArray(cfg.bloqueios)) BLOQUEIOS = cfg.bloqueios.filter((b) => b && b.de);',
    'if (cfg && Array.isArray(cfg.bloqueios)) { BLOQUEIOS = cfg.bloqueios.filter((b) => b && b.de && !b.profissional_id); BLOQ_PROF = cfg.bloqueios.filter((b) => b && b.de && b.profissional_id); }');
  trocarUma(calc, 'jsCode', '{ for (const x of PROFS) x.ocupados.push([ini, fim]); blocosHora.push([ini, fim]); }',
    '{ for (const x of PROFS) if (!b.profissional_id || x.id === b.profissional_id) x.ocupados.push([ini, fim]); blocosHora.push([ini, fim]); }');
  trocarUma(calc, 'jsCode', '// regras da dona (supabase/071, agenda-calculo.js): faixa em que a IA não começa vale para todas', [
    '// bloqueio-por-profissional.js: dia fechado só para uma profissional = o dia inteiro ocupado na agenda dela',
    'for (const bp of BLOQ_PROF) { const x = PROFS.find((y) => y.id === bp.profissional_id); if (!x) continue;',
    '  let d = DateTime.fromISO(bp.de, { zone: TZ }).startOf(\'day\'); const ate = DateTime.fromISO(bp.ate || bp.de, { zone: TZ }).startOf(\'day\');',
    '  for (let i = 0; d <= ate && i < 400; i++, d = d.plus({ days: 1 })) x.ocupados.push([d, d.plus({ days: 1 })]); }',
    '// regras da dona (supabase/071, agenda-calculo.js): faixa em que a IA não começa vale para todas',
  ].join('\n'));

  // 2. assistente: campo "profissional" e as funções _v2
  const ia = (c, d) => "={{ $fromAI('" + c + "', `" + d + "`, 'string') }}";
  for (const nome of ['bloquear_dias', 'bloquear_horario']) {
    const t = achar(A, nome);
    const v = t.parameters.workflowInputs.value;
    if ('profissional' in v) throw new Error('bloqueio-por-profissional: ' + nome + ' já tem profissional');
    v.profissional = ia('profissional', 'De quem é o bloqueio quando só uma para (Caroline ou Duda). VAZIO = fecha o studio para todas. Pergunte antes se a outra continua atendendo.');
    t.parameters.description = String(t.parameters.description)
      .replace(', para as duas profissionais', '')
      .replace('para as duas profissionais: ', '') +
      ' Com profissional, fecha só a agenda dela; vazio, fecha o studio todo. A resposta lista as clientes do período com "com" e "fica_fechado".';
  }
  const m = achar(F, 'Montar chamada');
  trocarUma(m, 'jsCode', "funcao = 'n8n_assistente_bloquear_dias'; args = { ...base, p_de: ou(v('data')), p_ate: ou(v('ate')), p_motivo: ou(v('texto')) };",
    "funcao = 'n8n_assistente_bloquear_dias_v2'; args = { ...base, p_de: ou(v('data')), p_ate: ou(v('ate')), p_motivo: ou(v('texto')), p_profissional_id: profDita };");
  trocarUma(m, 'jsCode', "funcao = 'n8n_assistente_bloquear_horario'; args = { ...base, p_dia: ou(v('data')), p_inicio: ou(v('hora_inicio')), p_fim: ou(v('hora_fim')), p_motivo: ou(v('texto')) };",
    "funcao = 'n8n_assistente_bloquear_horario_v2'; args = { ...base, p_dia: ou(v('data')), p_inicio: ou(v('hora_inicio')), p_fim: ou(v('hora_fim')), p_motivo: ou(v('texto')), p_profissional_id: profDita };");
  if (!String(m.parameters.jsCode).includes('const profDita')) throw new Error('bloqueio-por-profissional: sem o profDita (segunda-profissional-whatsapp.js)');
};
