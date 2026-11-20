// O horário que já é da cliente nunca aparece para ela como "ocupado" (só nas lojas com "vaga_da_propria_cliente": true
// no loja.json; a Gleide não passa por aqui).
// 13/11/2026 e 17/11/2026, Caroline: a dona (pela assistente) marcou a Iara às 13h de segunda. A Iara respondeu "Tá bem",
// a IA de atendimento tentou marcar de novo as 13h e a agenda respondeu "Esse horário acabou de ser ocupado": a IA disse à
// cliente que o horário DELA tinha sido ocupado e ofereceu outros, e ainda pediu sinal. O mesmo com a Lorranny (13/11).
// O Calcular conta todos os horários marcados como ocupados, inclusive o da própria cliente.
//
// O que muda no Calcular da agenda:
// - criar: se o horário pedido encosta num horário que JÁ É desta cliente (app), não cria de novo e diz à IA que o
//   horário dela já está garantido (ela confirma à cliente em vez de dizer que foi ocupado);
// - consultar um horário exato: se ele já é dela, a resposta é "JÁ É DELA", não "INDISPONÍVEL".
// Os horários dela vêm do "Supabase: agendamentos da cliente" (status agendado, pelo telefone), que já roda antes do
// Calcular em todas as ações.

module.exports = ({ agendaWorkflow }) => {
  const calc = agendaWorkflow.nodes.find((n) => n.name === 'Calcular');
  if (!calc) throw new Error('vaga-da-propria-cliente: não achei o Calcular');
  if (agendaWorkflow.connections['Supabase: agendamentos da cliente']?.main?.[0]?.[0]?.node !== 'Calcular') throw new Error('vaga-da-propria-cliente: "Supabase: agendamentos da cliente" não liga mais no Calcular');
  const trocar = (de, para) => {
    if (!calc.parameters.jsCode.includes(de)) throw new Error('vaga-da-propria-cliente: o Calcular mudou (' + de.slice(0, 60) + ')');
    calc.parameters.jsCode = calc.parameters.jsCode.replace(de, () => para);
  };

  // 1. horários futuros desta cliente (os do app), lidos uma vez
  const PONTO = 'const noExpediente = (ini, fim) => intervalos(ini.startOf(\'day\')).some(([a, b]) => ini >= a && fim <= b);';
  trocar(PONTO, PONTO + String.raw`
// vaga-da-propria-cliente.js: o horário que já é dela não é "ocupado" para ela
const vagasDela = (() => { try {
  return $('Supabase: agendamentos da cliente').all().map((i) => i.json).filter((x) => x && x.id && x.inicio).map((x) => {
    const a = DateTime.fromISO(x.inicio).setZone(TZ);
    return { a, b: x.fim ? DateTime.fromISO(x.fim).setZone(TZ) : a.plus({ hours: 1 }), nome: (x.servicos && x.servicos.nome) || 'horário' };
  });
} catch (e) { return []; } })();
const daCliente = (ini, fim) => vagasDela.find((v) => ini < v.b && fim > v.a);
const jaEDela = (v) => 'ESTE HORÁRIO JÁ É DESTA CLIENTE: ela já tem ' + v.nome + ' marcado ' + fmt(v.a) + ' (data_hora_inicio: ' + iso(v.a) + '). ' +
  'NÃO diga que o horário foi ocupado nem que é de outra pessoa, NÃO marque de novo e NÃO peça sinal por ele: diga a ela, com carinho, que esse horário já está garantido no nome dela. ' +
  'Se ela quer outro horário, use remarcar_agendamento; se quer acrescentar um serviço nesse mesmo horário, diga que anotou e use perguntar_para_gleide para a Caroline ver se o tempo dá.';`);

  // 2. consultar um horário exato que já é dela
  trocar("    else if (!livre(t, f)) motivo = 'já está ocupado';",
    "    else if (daCliente(t, f)) return [{ json: { acao: 'consultar', ok: true, resposta: 'JÁ É DELA: ' + jaEDela(daCliente(t, f)) } }];\n" +
    "    else if (!livre(t, f)) motivo = 'já está ocupado';");

  // 3. criar em cima do horário dela
  trocar("if (!livre(ini, fim)) return saida({ resposta: 'Esse horário acabou de ser ocupado.",
    "{ const v = daCliente(ini, fim); if (v) return saida({ resposta: jaEDela(v) }); }\n" +
    "if (!livre(ini, fim)) return saida({ resposta: 'Esse horário acabou de ser ocupado.");
};
