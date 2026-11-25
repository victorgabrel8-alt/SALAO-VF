// Horários colados (loja.json: "horarios_colados": true, com "equipe": true; a Gleide não passa por aqui).
// A Caroline pediu "uma atrás da outra" em 13/11, 17/11, 24/11 e de novo em 25/11 ("sempre agenda subsequente os
// horários"). Virou três regras guardadas na assistente, mas quem escolhe os horários oferecidos é a agenda da IA (a
// assistente usa a mesma, por horarios_para_oferecer), e ela pegava o primeiro horário livre de cada período, deixando
// buraco no meio da tarde.
// Agora, nos 2 horários sugeridos, vêm primeiro os inícios que não deixam buraco na agenda de quem vai atender:
// encostam numa cliente marcada (logo depois ou logo antes, com até um passo de folga) ou começam na abertura / na volta
// do almoço (as 8h e 13h que ela citou). Terminar no fechamento não conta: deixaria o buraco no meio da tarde.
// Sem nenhum assim no dia, a sugestão é a de antes. O quadro do dia não muda.

module.exports = ({ agendaWorkflow: AG }) => {
  const calc = AG.nodes.find((n) => n.name === 'Calcular');
  if (!calc) throw new Error('horarios-colados: sem o nó Calcular');
  const trocar = (de, para) => {
    const vezes = calc.parameters.jsCode.split(de).length - 1;
    if (vezes !== 1) throw new Error(`horarios-colados: o Calcular mudou (esperava 1 vez, achei ${vezes}): ${de.slice(0, 60)}`);
    calc.parameters.jsCode = calc.parameters.jsCode.replace(de, () => para);
  };
  // precisa da agenda por profissional (equipe-agenda.js): quem(ini, fim) diz quem está livre, na ordem de quem atende
  if (!calc.parameters.jsCode.includes('const quem = (ini, fim) =>')) throw new Error('horarios-colados: precisa da equipe (equipe-agenda.js) antes');
  trocar('  const sugestao = (v) => {', [
    '  // horarios-colados.js: o início que não deixa buraco na agenda de quem vai atender vem primeiro',
    '  const encosta = (x) => {',
    '    const f = x.plus({ minutes: p.dur });',
    '    const perto = (a, b) => { const d = a.diff(b, \'minutes\').minutes; return d >= 0 && d < PASSO_MIN; };',
    "    if (intervalos(x.startOf('day')).some(([a]) => perto(x, a))) return true;",
    '    const prof = quem(x, f)[0];',
    '    return !!prof && prof.ocupados.some(([a, b]) => perto(x, b) || perto(a, f));',
    '  };',
    '  const colarPrimeiro = (v) => { const sim = v.filter(encosta); return sim.length ? [...sim, ...v.filter((x) => !encosta(x))] : v; };',
    '  const sugestao = (v) => {',
  ].join('\n'));
  trocar('    v = preferirPeriodo(v);', '    v = colarPrimeiro(preferirPeriodo(v));');
};
