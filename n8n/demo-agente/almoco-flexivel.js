// Almoço flexível (só nas lojas com "almoco_flexivel": true no loja.json; a Gleide não passa por aqui).
// Pedido do Victor (12/11, Caroline): a IA prioriza manhã e tarde; o horário de almoço (ex.: 11h30 às 13h) não é
// oferecido por conta própria, mas se a cliente PEDIR um horário nessa faixa, a IA confere e marca.
// A faixa fica no banco, em empresas.config.loja.almoco_flexivel = { "inicio": "11:30", "fim": "13:00" }.
// Não mexe em config.almoco (o app e a assistente continuam como estão). Sem a faixa: nada muda.
//   - sugestões e quadro de horários livres: sem inícios que encavalam no almoço (se o dia só tiver vaga no
//     almoço, aí entram, para não dizer que o dia está cheio);
//   - horário exato pedido pela cliente e criar: valem normalmente (o almoço não bloqueia);
//   - a consulta avisa a IA da regra.

module.exports = ({ agendaWorkflow }) => {
  const calc = agendaWorkflow.nodes.find((n) => n.name === 'Calcular');
  if (!calc) throw new Error('almoco_flexivel: não achei o Calcular');
  const trocar = (de, para) => {
    if (!calc.parameters.jsCode.includes(de)) throw new Error('almoco_flexivel: o Calcular mudou (' + de.slice(0, 60) + ')');
    calc.parameters.jsCode = calc.parameters.jsCode.replace(de, () => para);
  };

  // faixa do almoço flexível, lida do config do salão
  trocar('if (p.erro) return saida({ resposta: p.erro });', [
    '// almoço flexível (almoco-flexivel.js): config.loja.almoco_flexivel = { inicio, fim }',
    'let ALMOCO_FLEX = null;',
    'try {',
    "  const af = $('Supabase: config do salão').first().json.config?.loja?.almoco_flexivel;",
    '  if (af && /^\\d{2}:\\d{2}$/.test(af.inicio || \'\') && /^\\d{2}:\\d{2}$/.test(af.fim || \'\') && af.inicio < af.fim) ALMOCO_FLEX = [af.inicio, af.fim];',
    '} catch (e) {}',
    "const naHora = (d, hhmm) => DateTime.fromISO(d.toFormat('yyyy-LL-dd') + 'T' + hhmm, { zone: TZ });",
    'const noAlmocoFlex = (t, f) => !!ALMOCO_FLEX && t < naHora(t, ALMOCO_FLEX[1]) && f > naHora(t, ALMOCO_FLEX[0]);',
    'if (p.erro) return saida({ resposta: p.erro });',
  ].join('\n'));

  // vagas oferecidas: primeiro sem o almoço; só se não sobrar nada no dia, com o almoço
  trocar('const vagasDoDia = (dia) => {', 'const vagasDoDia0 = (dia, comAlmoco) => {');
  trocar('if (livre(t, t.plus({ minutes: p.dur }))) v.push(t);',
    'if (livre(t, t.plus({ minutes: p.dur })) && (comAlmoco || !noAlmocoFlex(t, t.plus({ minutes: p.dur })))) v.push(t);');
  trocar('    return v;\n  };\n', '    return v;\n  };\n' +
    '  const vagasDoDia = (dia) => { const v = vagasDoDia0(dia, false); return v.length || !ALMOCO_FLEX ? v : vagasDoDia0(dia, true); };\n');

  // a IA fica sabendo da regra junto com o quadro
  trocar("'OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: '",
    "(ALMOCO_FLEX ? 'ALMOÇO ' + ALMOCO_FLEX[0] + ' às ' + ALMOCO_FLEX[1] + ': não ofereça horário nessa faixa por conta própria (os inícios abaixo já estão sem ela). Se a cliente PEDIR um horário nessa faixa, confira esse horário exato com consultar_horarios_livres: se voltar LIVRE, pode marcar. ' : '') + 'OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: '");
};
