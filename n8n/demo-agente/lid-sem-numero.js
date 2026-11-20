// Mensagem que chega só com o código interno do WhatsApp (@lid) e sem o número é cópia: a IA de atendimento não
// responde (só nas lojas com "ignorar_lid_sem_numero": true no loja.json; a Gleide não passa por aqui).
//
// 19/11/2026, Caroline: a Evolution às vezes entrega a MESMA mensagem duas vezes, com 2 segundos de diferença:
// primeiro com remoteJid = "<código>@lid" e SEM remoteJidAlt (sem o número), depois com o número em remoteJidAlt.
// A IA tratava as duas. Resultado, de 13 a 18/11:
// - a própria Caroline, escrevendo para a assistente ("Manda o lembrete da tays", "Essa é a Rafaela minha cliente..."),
//   recebia resposta da IA de atendimento como se fosse cliente ("não encontrei nenhum horário marcado no seu nome");
// - Andreia ("Sim"), Taise ("Gel") e Marcia (👆🏻👆🏻) receberam duas respostas para a mesma mensagem.
// Nos 10 dias analisados (1.640 mensagens), todas as 6 mensagens sem número tinham a cópia com número logo depois.
// Sem número a IA também não acha a ficha, não grava no app e responde para o código, não para o número.
//
// Como: o "Extrair dados" já calcula telefone = número do remoteJidAlt (ou o próprio remoteJid). Quando o remoteJid é
// @lid e não veio o número, o telefone fica igual ao código do lid: o Filtro passa a barrar esse caso.

module.exports = ({ workflow }) => {
  const f = workflow.nodes.find((n) => n.name === 'Filtro');
  if (!f || !Array.isArray(f.parameters?.conditions?.conditions)) throw new Error('lid-sem-numero: não achei o Filtro');
  if (f.parameters.conditions.combinator !== 'and') throw new Error('lid-sem-numero: o Filtro não é mais "e"');
  const ex = workflow.nodes.find((n) => n.name === 'Extrair dados');
  const tel = ex?.parameters?.assignments?.assignments?.find((a) => a.name === 'telefone');
  if (!tel || !String(tel.value).includes("remoteJid.endsWith('@lid') && $json.body.data.key.remoteJidAlt")) throw new Error('lid-sem-numero: o telefone do "Extrair dados" mudou');
  f.parameters.conditions.conditions.push({
    id: 'lid1',
    leftValue: "={{ !(String($json.jid || '').endsWith('@lid') && String($json.telefone || '') === String($json.jid || '').split('@')[0]) }}",
    rightValue: '',
    operator: { type: 'boolean', operation: 'true', singleValue: true },
  });
};
