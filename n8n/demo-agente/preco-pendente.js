// Preço que a cliente pediu e ainda não recebeu (conversa da Lilian, 11/11: perguntou "quanto custa o mega hair?",
// a IA escreveu o valor duas vezes e nenhuma chegou; ela respondeu três perguntas, recebeu o convite sem ver
// preço e sumiu).
// Os dois cortes: 1) ela mandou outra mensagem e o balão do preço foi descartado (resposta-velha.js);
// 2) na resposta seguinte o filtro de preço do "Quebrar mensagens" só olhava a ÚLTIMA mensagem dela ("quero um
// de 75 cm"), viu que não era pergunta de preço e apagou o valor.
//
// Conserto: um lembrete no Redis (preco_pendente:<telefone>, 12 h) = "ela pediu preço e nenhum valor chegou".
//   - liga quando a mensagem dela pede preço e a resposta sai sem valor, ou quando o balão com valor é descartado;
//   - enquanto está ligado, o filtro de preço não apaga valor (vale como "ela pediu preço");
//   - desliga quando a resposta leva um valor (se esse balão for descartado, liga de novo).
// Chamado pelo montar-workflow.js depois do resposta-velha.js. Se o Redis falhar, tudo segue como antes.

const VALOR = String.raw`/R\$\s?\d|\b\d{2,}(?:\.\d{3})*(?:,\d{2})?\s*reais\b/i`;

module.exports = ({ node, REDIS, D }) => (wf) => {
  const TEL = `{{ ${D}.telefone }}`;
  const CHAVE = `=preco_pendente:${TEL}`;
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('preco-pendente: sem o nó ' + nome); return n; };
  const trocar = (no, de, para) => {
    const n = achar(no);
    if (!n.parameters.jsCode.includes(de)) throw new Error(`preco-pendente: o código de "${no}" mudou (${de.slice(0, 50)})`);
    n.parameters.jsCode = n.parameters.jsCode.replace(de, () => para);
  };

  // ---------- ler o lembrete entre o agente e o "Quebrar mensagens" ----------
  const saida = wf.connections['Agente IA']?.main?.[0];
  if (!saida || saida.length !== 1 || saida[0].node !== 'Quebrar mensagens') throw new Error('preco-pendente: esperava Agente IA -> Quebrar mensagens');
  wf.nodes.push(node('Preço: ler pendência', 'n8n-nodes-base.redis', 1, [0, 0], {
    operation: 'get', key: CHAVE, propertyName: 'pendente', keyType: 'string', options: {},
  }, { credentials: REDIS, onError: 'continueRegularOutput', alwaysOutputData: true }));
  saida[0].node = 'Preço: ler pendência';
  wf.connections['Preço: ler pendência'] = { main: [[{ node: 'Quebrar mensagens', type: 'main', index: 0 }]] };

  // o Quebrar lia a resposta da IA em $input: agora entre os dois há o nó do Redis
  const q = achar('Quebrar mensagens');
  const usos = q.parameters.jsCode.split('$input.first().json').length - 1;
  if (usos < 1) throw new Error('preco-pendente: o Quebrar mensagens não usa mais $input');
  q.parameters.jsCode = q.parameters.jsCode.split('$input.first().json').join("$('Agente IA').first().json");
  if (q.parameters.jsCode.includes('$input')) throw new Error('preco-pendente: sobrou $input no Quebrar mensagens');

  // lembrete ligado vale como pergunta de preço
  trocar('Quebrar mensagens', 'const pediuPreco = /(quanto|valor|', [
    'let precoPendente = false;',
    "try { precoPendente = String($('Preço: ler pendência').first().json.pendente || '') === '1'; } catch (e) {}",
    'const pediuPrecoAgora = /(quanto|valor|',
  ].join('\n'));
  trocar('Quebrar mensagens', "\\s*$/i.test(msgCliente);\nconst FRASES", "\\s*$/i.test(msgCliente);\nconst pediuPreco = pediuPrecoAgora || precoPendente;\nconst FRASES");
  // cada balão leva como o lembrete deve ficar depois desta resposta
  trocar('Quebrar mensagens', 'return baloes.map(({ t: texto, ref }, i) => ({ json: { jid, texto, falhou, citar', [
    `const levaValor = baloes.some((b) => ${VALOR}.test(b.t));`,
    "const precoPendenteDepois = !falhou && pediuPreco && !levaValor ? '1' : (falhou && precoPendente ? '1' : '0');",
    'return baloes.map(({ t: texto, ref }, i) => ({ json: { jid, texto, falhou, precoPendenteDepois, citar',
  ].join('\n'));

  // ---------- gravar o lembrete (ramo à parte: não entra no caminho da resposta) ----------
  const gravar = (nome, valor) => node(nome, 'n8n-nodes-base.redis', 1, [0, 0], {
    operation: 'set', key: CHAVE, keyType: 'string', value: valor, expire: true, ttl: 43200,
  }, { credentials: REDIS, executeOnce: true, onError: 'continueRegularOutput' });
  // resposta sem texto (só áudio/aceno) não tem o campo: o lembrete fica como estava
  wf.nodes.push(gravar('Preço: gravar pendência',
    "={{ $json.precoPendenteDepois ?? (String($('Preço: ler pendência').first().json.pendente || '') === '1' ? '1' : '0') }}"));
  const depois = wf.connections['Quebrar mensagens']?.main?.[0];
  if (!depois || !depois.length) throw new Error('preco-pendente: o Quebrar mensagens não tem saída');
  depois.push({ node: 'Preço: gravar pendência', type: 'main', index: 0 });

  // ---------- balão com valor descartado (resposta-velha.js): o lembrete volta ----------
  trocar('Descarte: preparar', 'return [{ json: { saiu, mexer:', [
    `const precoVolta = baloes.slice(saiu).some((b) => ${VALOR}.test(String(b || '')));`,
    'return [{ json: { precoVolta, saiu, mexer:',
  ].join('\n'));
  wf.nodes.push(gravar('Descarte: preço pendente',
    "={{ $json.precoVolta ? '1' : ($('Quebrar mensagens').first().json.precoPendenteDepois || '0') }}"));
  const dp = wf.connections['Descarte: preparar']?.main?.[0];
  if (!dp || !dp.length) throw new Error('preco-pendente: o Descarte: preparar não tem saída');
  dp.push({ node: 'Descarte: preço pendente', type: 'main', index: 0 });
};
