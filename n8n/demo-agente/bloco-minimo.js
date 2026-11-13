// Espaçamento mínimo por cliente (só nas lojas com "bloco_minutos" no loja.json; a Gleide não passa por aqui).
// Pedido do Victor (13/11/2026, Caroline): cada cliente ocupa 2h30 na agenda, para a IA não marcar uma em cima
// da outra (a Caroline atende sozinha e os atendimentos passam do tempo da tabela).
//   - horário novo marcado pela IA de atendimento: reserva pelo menos bloco_minutos, mesmo com serviço mais curto;
//   - horário que já está no app: ocupa pelo menos bloco_minutos a partir do início;
//   - evento da Google Agenda (google-agenda.js): no lugar de 90 min, ocupa pelo menos bloco_minutos.
// Não mexe no que a dona marca pela assistente nem pelo app: ela continua podendo encaixar como quiser.

module.exports = ({ agendaWorkflow, ferramentasWorkflow, minutos }) => {
  const N = Number(minutos);
  if (!Number.isInteger(N) || N < 30 || N > 480) throw new Error('bloco_minutos: use um número de minutos entre 30 e 480');
  const trocar = (wf, noNome, de, para) => {
    const n = wf.nodes.find((x) => x.name === noNome);
    if (!n) throw new Error(`bloco_minutos: não achei "${noNome}"`);
    if (!n.parameters.jsCode.includes(de)) throw new Error(`bloco_minutos: o código de "${noNome}" mudou (${de.slice(0, 50)})`);
    n.parameters.jsCode = n.parameters.jsCode.split(de).join(para);
  };
  // 1. horário novo: reserva pelo menos N minutos
  const prep = agendaWorkflow.nodes.find((x) => String(x.parameters?.jsCode || '').includes('const dur = Math.max(15, Number(e.duracao_minutos) || 60);'));
  if (!prep) throw new Error('bloco_minutos: não achei o cálculo da duração');
  trocar(agendaWorkflow, prep.name, 'const dur = Math.max(15, Number(e.duracao_minutos) || 60);', `const dur = Math.max(${N}, Number(e.duracao_minutos) || 60); // bloco_minutos da loja`);
  // 2. horário que já está no app: ocupa pelo menos N minutos
  trocar(agendaWorkflow, 'Calcular',
    'ocupados.push([ini, a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : ini.plus({ hours: 1 })]);',
    `ocupados.push([ini, DateTime.max(a.fim ? DateTime.fromISO(a.fim).setZone(TZ) : ini.plus({ hours: 1 }), ini.plus({ minutes: ${N} }))]); // bloco_minutos da loja`);
  // 3. evento da Google: N no lugar dos 90 min
  const google = 'if (!ini.diaInteiro && b < a.plus({ minutes: 90 })) b = a.plus({ minutes: 90 });';
  const googleN = `if (!ini.diaInteiro && b < a.plus({ minutes: ${N} })) b = a.plus({ minutes: ${N} });`;
  trocar(agendaWorkflow, 'Calcular', google, googleN);
  if (ferramentasWorkflow) trocar(ferramentasWorkflow, 'Google: eventos do dia', google, googleN);
};
