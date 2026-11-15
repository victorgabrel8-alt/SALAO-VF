// A IA de atendimento enxerga o que o salão já mandou à cliente (só nas lojas com "contexto_saidas": true no
// loja.json; a Gleide não passa por aqui).
// 13/11/2026, Caroline: a assistente da dona mandou confirmação de horário a clientes; a resposta delas caiu na IA
// de atendimento, que não sabia da mensagem (ela não está na memória do Redis, só no banco) e respondeu que o
// horário estava ocupado. Agora as últimas mensagens que saíram pelo número do salão (12 h) entram em
// "Sobre esta cliente", com a regra de responder dentro desse assunto e nunca negar um horário que o salão confirmou.

module.exports = ({ workflow }) => {
  const n = workflow.nodes.find((x) => x.name === 'Sobre esta cliente');
  if (!n) throw new Error('contexto_saidas: não achei "Sobre esta cliente"');
  const trocar = (de, para) => {
    if (!n.parameters.jsCode.includes(de)) throw new Error('contexto_saidas: o código de "Sobre esta cliente" mudou (' + de.slice(0, 50) + ')');
    n.parameters.jsCode = n.parameters.jsCode.replace(de, () => para);
  };
  trocar('const JA_FALOU = ultimaIA ? ', [
    '// contexto-saidas.js: o que o salão já mandou a ela (assistente da dona, a própria dona ou você), mais antiga primeiro',
    "const saidas = recentes.filter((m) => m.direcao === 'saida' && m.conteudo && !/^Desculpa, tive um probleminha/.test(m.conteudo) && !/^\\[m[ií]dia\\]$/.test(m.conteudo)).slice(0, 4).reverse();",
    "const SAIDAS_TXT = saidas.length ? '\\nO QUE O SALÃO JÁ MANDOU A ELA NAS ÚLTIMAS HORAS (por você, pela assistente da dona ou pela própria dona; pode não estar no seu histórico): ' +",
    "  saidas.map((m) => '«' + String(m.conteudo).slice(0, 320) + '» (' + dia(m.criado_em).toFormat('HH:mm') + ')').join(' · ') +",
    "  '\\nSe ela está respondendo a uma dessas mensagens, continue DENTRO desse assunto. Se o salão confirmou ou ofereceu um horário a ela, esse horário vale: nunca diga que ele está ocupado, que é de outra pessoa nem peça sinal por ele. Se você não achar esse horário em ver_agendamentos, não negue: diga que vai confirmar e use perguntar_para_gleide. Não repita pergunta nem oferta que já foi feita a ela.' : '';",
    'const JA_FALOU = SAIDAS_TXT + (ultimaIA ? ',
  ].join('\n'));
  trocar("nem cumprimentar como primeiro contato.' : '';", "nem cumprimentar como primeiro contato.' : '');");
};
