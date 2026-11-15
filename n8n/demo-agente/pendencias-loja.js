// A assistente cobra menos a dona. Vale para a Gleide (12h e 18h, ligado no montar-workflow.js) e para as lojas com
// "pendencias_horas": [12, 18] no loja.json.
// 14/11/2026, Caroline: a rotina "Assistente - Pendências" pergunta "fulana veio?" na hora, +1 h e +2 h para cada
// horário sem baixa. Num sábado com 4 clientes foram 5 mensagens em 6 horas (3 só da mesma cliente), com a dona
// atendendo e depois num casamento. Pedido do Victor: "a IA está cobrando demais a Caroline".
//   1. cada pendência é perguntada UMA vez (o banco não devolve de novo o que já foi perguntado);
//   2. as perguntas saem juntas, só nas horas da lista (12h e 18h): no máximo 2 mensagens por dia.
//      "Não chegou, veio ou libera?" continua saindo na hora, porque decide o horário de outra cliente;
//   3. o texto é só a pergunta, sem "Oi! Me conta pra eu anotar aqui" nem "pode responder em áudio".
// Banco: n8n_assistente_pendencias_uma_vez (supabase/049).

module.exports = ({ pendenciasWorkflow: wf, horas }) => {
  const hs = [].concat(horas || []).map(Number);
  if (!hs.length || hs.some((h) => !Number.isInteger(h) || h < 8 || h > 19)) throw new Error('pendencias_horas: use horas inteiras entre 8 e 19 (ex.: [12, 18])');
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`pendencias_horas: não achei "${nome}"`); return n; };
  const ler = achar('Pendências novas');
  if (!String(ler.parameters.url).includes('rpc/n8n_assistente_pendencias_novas')) throw new Error('pendencias_horas: "Pendências novas" mudou');
  ler.parameters.url = ler.parameters.url.replace('rpc/n8n_assistente_pendencias_novas', 'rpc/n8n_assistente_pendencias_uma_vez');
  const corpo = String(ler.parameters.jsonBody || '');
  if (corpo.split('{ p_empresa_id:').length !== 2) throw new Error('pendencias_horas: o corpo de "Pendências novas" mudou');
  ler.parameters.jsonBody = corpo.replace('{ p_empresa_id:', `{ p_horas: ${JSON.stringify(hs)}, p_empresa_id:`);
  const msg = achar('Montar mensagem');
  const de = /const texto = 'Oi, [^']*! Me conta pra eu anotar aqui:\\n' \+ ps\.map\(linha\)\.join\('\\n'\) \+ '\\n\\nPode responder em áudio, do seu jeito 🙂';/;
  if (!de.test(msg.parameters.jsCode)) throw new Error('pendencias_horas: o texto de "Montar mensagem" mudou');
  msg.parameters.jsCode = msg.parameters.jsCode.replace(de, () =>
    "const texto = ps.length === 1 ? linha(ps[0]).replace(/^• /, '') : ps.map(linha).join('\\n'); // pendencias-loja.js: só a pergunta");
};
