// A IA de atendimento só cancela um horário se a cliente pediu (vale para a Gleide e para toda loja).
// 14/11/2026, Caroline: a dona mandou a assistente reservar um horário e avisar a cliente. A cliente respondeu
// "pode, obrigada". A IA de atendimento viu o horário já marcado, quis acrescentar um serviço, CANCELOU o horário
// para marcar de novo, não conseguiu (o bloco não cabia mais) e passou a conversa para a dona. Resultado: horário
// perdido, aviso de "cancelou" e de "verificar" para a dona, e a cliente ouvindo "vou confirmar com a Caroline"
// de um horário que a própria Caroline tinha acabado de reservar.
// Trava no código (não depende do modelo obedecer ao roteiro):
//   1. "Sobre esta cliente" passa a dizer se a cliente pediu para cancelar/desmarcar nas últimas 2 horas, ou se
//      respondeu a uma pergunta da IA sobre cancelar;
//   2. a ferramenta cancelar_agendamento leva esse sinal para a agenda;
//   3. sem o pedido, a agenda não cancela e devolve o que fazer (confirmar o horário que já está marcado).

const PEDIDO = "(cancel|desmarc|n[aã]o (vou|posso|consigo|vai dar|d[aá]|tenho como|quero)|imprevisto|desist|remarc|reagend|adiar|deix[ao]r? pra|outro dia|outra semana|pr[oó]xima semana|n[aã]o vai rolar|passando mal|doente|hospital)";
const RESPOSTA = 'NÃO CANCELADO: a cliente não pediu para cancelar nem desmarcar, então o horário dela CONTINUA MARCADO e vale. ' +
  'Nunca cancele um horário para marcar de novo. Se ela só concordou ou agradeceu (pode, ok, obrigada), responda confirmando o dia e a hora que já estão marcados, e mais nada. ' +
  'Se ela quer acrescentar ou trocar o serviço nesse mesmo horário, diga que anotou e use perguntar_para_gleide para a dona ajustar; não mexa no horário. ' +
  'Se ela realmente quer desmarcar, pergunte "Quer que eu cancele o seu horário?" e só chame cancelar_agendamento de novo depois que ela disser que sim.';

module.exports = ({ node, workflow, agendaWorkflow }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`cancelar_so_se_pediu: não achei "${nome}"`); return n; };
  if (RESPOSTA.includes("'")) throw new Error('cancelar_so_se_pediu: aspas simples na resposta');
  // já aplicado (o gerador chama para todas; uma loja pode chamar de novo): não aplica duas vezes
  if (agendaWorkflow.nodes.some((x) => x.name === 'Cancelar: a cliente pediu?')) return;

  // 1. o sinal
  const sobre = achar(workflow, 'Sobre esta cliente');
  const de = 'return [{ json: { texto: ';
  if (sobre.parameters.jsCode.split(de).length < 2) throw new Error('cancelar_so_se_pediu: o fim de "Sobre esta cliente" mudou');
  // o nó tem mais de uma saída (cliente sem ficha, cliente com ficha): todas levam o sinal, calculado na hora
  const SINAL = "((ms) => { const pede = new RegExp(" + JSON.stringify(PEDIDO) + ", 'i'); const haMin = (m) => (Date.now() - Date.parse(m.criado_em)) / 60000; " +
    "return ms.some((m) => m.direcao === 'entrada' && haMin(m) < 120 && pede.test(String(m.conteudo || ''))) || " +
    "ms.some((m) => m.direcao === 'saida' && haMin(m) < 30 && /(cancel|desmarc)[^?]*\\?/i.test(String(m.conteudo || ''))); })" +
    "($('Supabase: últimas mensagens').all().map((i) => i.json).filter((m) => m && m.direcao))";
  if (!sobre.parameters.jsCode.includes("$('Supabase: últimas mensagens')")) throw new Error('cancelar_so_se_pediu: "Sobre esta cliente" não lê mais as últimas mensagens');
  // cancelar-so-se-pediu.js: a cliente pediu para cancelar/desmarcar (2 h), ou respondeu a uma pergunta da IA sobre cancelar (30 min)?
  sobre.parameters.jsCode = sobre.parameters.jsCode.split(de).join('return [{ json: { pediuCancelar: ' + SINAL + ', texto: ');

  // 2. a ferramenta leva o sinal (o campo motivo não é usado no cancelamento)
  const tool = achar(workflow, 'cancelar_agendamento');
  const v = tool.parameters.workflowInputs?.value;
  if (!v || v.acao !== 'cancelar' || 'motivo' in v) throw new Error('cancelar_so_se_pediu: a ferramenta cancelar_agendamento mudou');
  v.motivo = "={{ $('Sobre esta cliente').first().json.pediuCancelar ? 'pediu' : 'NAO_PEDIU' }}";
  tool.parameters.description += ' O sistema só cancela se a cliente pediu para cancelar ou desmarcar; nunca use para marcar de novo o mesmo horário.';

  // 3. a agenda confere antes de cancelar
  const con = agendaWorkflow.connections['Cancelar evento?'];
  if (con?.main?.[0]?.[0]?.node !== 'Supabase: cancelar agendamento') throw new Error('cancelar_so_se_pediu: a ligação do cancelamento mudou');
  if (!String(achar(agendaWorkflow, 'Montar agendamento').parameters.jsCode).includes("$('Preparar').first().json")) throw new Error('cancelar_so_se_pediu: o nó Preparar mudou');
  const base = achar(agendaWorkflow, 'Resposta (cancelado)');
  const nao = JSON.parse(JSON.stringify(base));
  nao.name = 'Resposta (não cancelou: ela não pediu)'; nao.id = 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e31';
  nao.position = [base.position[0], base.position[1] + 160];
  nao.parameters.assignments.assignments[0].value = `={{ '${RESPOSTA}' }}`;
  agendaWorkflow.nodes.push(
    node('Cancelar: a cliente pediu?', 'n8n-nodes-base.if', 2.2, [base.position[0] - 440, base.position[1] + 160], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'cp1', leftValue: "={{ String($('Preparar').first().json.motivo || '') !== 'NAO_PEDIU' }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {},
    }),
    nao,
  );
  con.main[0] = [{ node: 'Cancelar: a cliente pediu?', type: 'main', index: 0 }];
  agendaWorkflow.connections['Cancelar: a cliente pediu?'] = { main: [[{ node: 'Supabase: cancelar agendamento', type: 'main', index: 0 }], [{ node: nao.name, type: 'main', index: 0 }]] };
};
