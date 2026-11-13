// A assistente da dona marca sem inventar tempo (só nas lojas com "assistente_marcar": true e "bloco_minutos" no
// loja.json; a Gleide não passa por aqui).
// 13/11/2026, Caroline: ela mandou marcar sem dizer o serviço nem o tempo e a assistente gravou "Manicure, 1 h" por
// conta própria. Pedido do Victor: sem tempo dito, o horário ocupa o bloco da loja (2h30); o serviço fica como
// "não confirmado" até a Caroline dizer.
//   1. marcar_horario sem serviço dito: o banco usa o serviço da última vez da cliente; sem histórico, reserva
//      bloco_minutos, anota "Serviço não confirmado." e devolve as opções numeradas para a assistente perguntar;
//   2. reagendar passa por n8n_assistente_reagendar_confirma (supabase/045): quando a dona informa o serviço,
//      a marca "serviço não confirmado" sai das observações e o resumo da noite para de cobrar.

module.exports = ({ assistenteWorkflow, ferramentasWorkflow, minutos }) => {
  const N = Number(minutos);
  if (!Number.isInteger(N) || N < 30 || N > 480) throw new Error('assistente_marcar: precisa de bloco_minutos na loja');
  const montar = ferramentasWorkflow.nodes.find((x) => x.name === 'Montar chamada');
  if (!montar) throw new Error('assistente_marcar: não achei "Montar chamada"');
  const trocar = (de, para) => {
    if (!montar.parameters.jsCode.includes(de)) throw new Error('assistente_marcar: "Montar chamada" mudou (' + de.slice(0, 50) + ')');
    montar.parameters.jsCode = montar.parameters.jsCode.replace(de, () => para);
  };
  // sem serviço dito, quem decide é o banco (supabase/045): o serviço da última vez dessa cliente ou, sem histórico,
  // o bloco da loja com "Serviço não confirmado." e as opções numeradas para a assistente perguntar
  trocar("funcao = 'n8n_assistente_marcar_horario_v2';", "funcao = 'n8n_assistente_marcar_horario_c';");
  trocar("p_duracao_min: num('minutos') === null || num('minutos') <= 0 ? null : Math.round(num('minutos')) };",
    `p_duracao_min: num('minutos') === null || num('minutos') <= 0 ? null : Math.round(num('minutos')), p_bloco_min: ${N} };`);
  trocar("funcao = 'n8n_assistente_reagendar';", "funcao = 'n8n_assistente_reagendar_confirma';");
  // a Google continua sendo consultada no reagendar
  const g = ferramentasWorkflow.nodes.find((x) => x.name === 'Precisa da Google?');
  if (g) {
    const c = g.parameters.conditions.conditions[0];
    if (!c.leftValue.includes('"n8n_assistente_reagendar"')) throw new Error('assistente_marcar: "Precisa da Google?" mudou');
    c.leftValue = c.leftValue.replace('"n8n_assistente_reagendar"', '"n8n_assistente_reagendar_confirma"');
  }
  // descrição do campo minutos na ferramenta
  const t = assistenteWorkflow.nodes.find((x) => x.name === 'marcar_horario');
  if (!t) throw new Error('assistente_marcar: não achei a ferramenta marcar_horario');
  const s = JSON.stringify(t.parameters), de = 'senão vazio (vale o tempo do cadastro)';
  if (!s.includes(de)) throw new Error('assistente_marcar: a descrição de minutos mudou');
  t.parameters = JSON.parse(s.split(de).join(`senão deixe VAZIO (vale o tempo do serviço). Nunca escolha um número por conta própria`));
};
