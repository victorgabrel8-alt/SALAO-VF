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
// semTipos (loja.json "pendencias_sem"): tipos que a assistente NÃO pergunta. 24/11/2026, Caroline: "a IA não precisa
// perguntar se a cliente veio, é a Caroline que avisa a assistente; se faltou ela fala" (Victor). O horário sem baixa
// entra no resumo da noite (resumo-noite.js), sem pergunta.

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

// Tipos que a assistente não pergunta (loja.json "pendencias_sem"). Roda DEPOIS do pedido-numerado.js, que procura a
// linha "const ps = …" sem mudança. Fora da lista também não é marcado como perguntado (os ids saem de ps): o horário
// continua sem baixa no banco e no app.
// "Não chegou, veio ou libera?" (atraso_confirmar) também sai na hora pelo fluxo de faltas, fora das pendências. Com
// "atraso_confirmar" em pendencias_sem, esse ramo sai do fluxo (24/11/2026, Victor: "pode tirar o veio ou libera
// também"). A IA continua chamando a cliente atrasada ("Atrasos para chamar"); só a pergunta à dona deixa de existir.
module.exports.semVeioOuLibera = ({ faltasWorkflow: wf }) => {
  const RAMO = ['Atrasos para confirmar', 'Mensagem veio ou libera', 'Perguntar à Gleide (atraso)', 'Guardar pergunta do atraso', 'Marcar atraso perguntado'];
  for (const n of RAMO) if (!wf.nodes.some((x) => x.name === n)) throw new Error('pendencias_sem: o ramo "veio ou libera" mudou (sem ' + n + ')');
  // ninguém mais pode apontar para o ramo (só os gatilhos do fluxo apontam para o começo dele)
  for (const [de, c] of Object.entries(wf.connections)) {
    if (RAMO.includes(de)) continue;
    for (const saida of c.main || []) {
      const resto = (saida || []).filter((l) => !RAMO.includes(l.node));
      if (resto.length !== (saida || []).length && !['Horário do salão?', 'Disparar agora (teste)'].includes(de)) throw new Error('pendencias_sem: "' + de + '" também liga no ramo "veio ou libera"');
      if (saida) saida.splice(0, saida.length, ...resto);
    }
  }
  for (const n of RAMO) delete wf.connections[n];
  wf.nodes = wf.nodes.filter((x) => !RAMO.includes(x.name));
};

module.exports.semTipos = ({ pendenciasWorkflow: wf, tipos }) => {
  const sem = [].concat(tipos || []);
  const TIPOS = ['avaliacao_sem_resultado', 'atendimento_sem_status', 'atraso_confirmar', 'pensando_vencido', 'fechou_sem_data'];
  if (!sem.length || sem.some((t) => !TIPOS.includes(t))) throw new Error('pendencias_sem: use uma lista com ' + TIPOS.join(', '));
  const msg = wf.nodes.find((x) => x.name === 'Montar mensagem');
  if (!msg) throw new Error('pendencias_sem: não achei "Montar mensagem"');
  const filtro = 'const ps = $input.all().map((i) => i.json).filter((p) => p.tipo);';
  if (msg.parameters.jsCode.split(filtro).length !== 2) throw new Error('pendencias_sem: a lista de "Montar mensagem" mudou');
  msg.parameters.jsCode = msg.parameters.jsCode.replace(filtro, () =>
    `const ps = $input.all().map((i) => i.json).filter((p) => p.tipo && !${JSON.stringify(sem)}.includes(p.tipo)); // pendencias-loja.js: pendencias_sem`);
};
