// Resposta no ritmo da cliente (conversa da Rosângela, 31/10: a IA respondia "um passo atrás").
// Cada resposta leva ~1 min (juntar, ler, Gemini, "digitando…"); quem escreve rápido já mandou outra
// mensagem quando ela sai, e a resposta chega respondendo a pergunta anterior, repete convite etc.
//
// Fase 3 — esperar a rajada: se ainda há mensagem dela na fila (escrevendo seguido) ou se é áudio, junta
//   por 35 s em vez de 20 s antes de responder.
// Fase 1 — não mandar resposta velha: logo antes de cada balão confere se chegou mensagem nova dela depois
//   que esta resposta começou (buffer_ultima mudou). Se chegou, os balões que faltam não saem, a memória
//   da IA fica só com o que ela recebeu de fato e, se nada saiu, as mensagens desta leva voltam para a fila:
//   a próxima resposta (a da mensagem nova, que estava esperando a trava) responde tudo junto.
//   Proteção: depois de 2 descartes seguidos (descartes:<tel>, 10 min) a resposta sai assim mesmo.
//
// Chamado pelo montar-workflow.js depois de montar o fluxo principal (as chaves do Redis seguem o padrão
// dele e o lojas.js põe o prefixo da loja em "descartes:").

const PREPARAR = String.raw`
// memória: [0] = mais nova (LPUSH). Uma interação = mensagem dela (human) + resposta (ai, e ferramentas)
const lista = [].concat($('Descarte: memória ler').first().json.memoria || []);
const baloes = $('Quebrar mensagens').all().map((i) => i.json.texto);
const atual = $('Um balão por vez').first().json.texto;
const saiu = Math.max(0, baloes.indexOf(atual));
const tipo = (s) => { try { return JSON.parse(s).type; } catch (e) { return ''; } };
let manter = lista;
let devolver = [];
if (saiu === 0) {
  // nada chegou nela: esta interação sai da memória e as mensagens dela voltam para a fila
  const i = lista.findIndex((s) => tipo(s) === 'human');
  if (i >= 0) manter = lista.slice(i + 1);
  try { devolver = JSON.parse($('Montar entrada').first().json.mensagens || '[]'); } catch (e) { devolver = []; }
} else if (tipo(lista[0]) === 'ai') {
  // parte chegou: a memória fica só com os balões que ela recebeu
  const m = JSON.parse(lista[0]);
  m.data = Object.assign({}, m.data, { content: baloes.slice(0, saiu).join('\n\n') });
  manter = [JSON.stringify(m)].concat(lista.slice(1));
}
return [{ json: { saiu, mexer: lista.length > 0 && manter !== lista, manter, devolver }, pairedItem: 0 }];
`;

module.exports = ({ node, main, ifNode, cond, REDIS, D }) => (wf) => {
  const TEL = `{{ ${D}.telefone }}`;
  const MEMORIA = wf.nodes.find((n) => n.name === 'Memória (Redis)').parameters.sessionKey;
  const P = "$('Descarte: preparar').first().json";
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('resposta-velha: sem o nó ' + nome); return n; };
  const ligacao = (de, para) => { const c = wf.connections[de]?.main?.[0]?.[0]?.node; if (c !== para) throw new Error(`resposta-velha: esperava ${de} -> ${para}, achei ${c}`); };

  // ---------- Fase 3: espera maior quando ela está mandando seguido ou é áudio ----------
  ligacao('Buffer: marcar última', 'Aguardar (juntar mensagens)');
  wf.nodes.push(node('Rajada: ler fila', 'n8n-nodes-base.redis', 1, [0, 0], {
    operation: 'get', key: `=buffer:${TEL}`, propertyName: 'rajada', keyType: 'list', options: {},
  }, { credentials: REDIS, onError: 'continueRegularOutput' }));
  wf.connections['Buffer: marcar última'] = main('Rajada: ler fila');
  wf.connections['Rajada: ler fila'] = main('Aguardar (juntar mensagens)');
  // a fila já tem esta mensagem: 2 ou mais = ela mandou outra que ainda não foi respondida
  achar('Aguardar (juntar mensagens)').parameters.amount =
    `={{ (${D}.tipo === 'audioMessage' || [].concat($json.rajada || []).length >= 2) ? 35 : 20 }}`;

  // ---------- Fase 1: antes de cada balão, chegou mensagem nova dela? ----------
  ligacao('Digitando...', 'Enviar mensagem');
  const nos = [
    node('Resposta velha: ler fila', 'n8n-nodes-base.redis', 1, [0, 0], {
      operation: 'get', key: `=buffer_ultima:${TEL}`, propertyName: 'ultimaAgora', keyType: 'string', options: {},
    }, { credentials: REDIS, executeOnce: true, onError: 'continueRegularOutput' }),
    node('Resposta velha: descartes', 'n8n-nodes-base.redis', 1, [0, 0], {
      operation: 'get', key: `=descartes:${TEL}`, propertyName: 'descartes', keyType: 'string', options: {},
    }, { credentials: REDIS, executeOnce: true, onError: 'continueRegularOutput' }),
    ifNode('Resposta velha?', [0, 0], [
      // o get do Redis devolve só a chave lida (não soma ao item anterior): a última vem do nó que a leu
      cond('rv1', `={{ (() => { const u = $('Resposta velha: ler fila').first().json.ultimaAgora; return !!u && u !== ${D}.msgId && Number($json.descartes || 0) < 2; })() }}`,
        { type: 'boolean', operation: 'true', singleValue: true }),
    ]),
    node('Descarte: contar', 'n8n-nodes-base.redis', 1, [0, 0], {
      operation: 'set', key: `=descartes:${TEL}`, keyType: 'string', value: '={{ String(Number($json.descartes || 0) + 1) }}', expire: true, ttl: 600,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('Descarte: memória ler', 'n8n-nodes-base.redis', 1, [0, 0], {
      operation: 'get', key: MEMORIA, propertyName: 'memoria', keyType: 'list', options: {},
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    node('Descarte: preparar', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: PREPARAR.trim() }),
    ifNode('Descarte: mexer na memória?', [0, 0], [
      cond('dm1', '={{ $json.mexer }}', { type: 'boolean', operation: 'true', singleValue: true }),
    ]),
    node('Descarte: memória apagar', 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'delete', key: MEMORIA }, { credentials: REDIS }),
    ifNode('Descarte: sobrou memória?', [0, 0], [
      cond('dm2', `={{ ${P}.manter.length > 0 }}`, { type: 'boolean', operation: 'true', singleValue: true }),
    ]),
    // da mais antiga para a mais nova: cada LPUSH põe a próxima na frente (igual ao memoria-janela.js)
    node('Descarte: memória itens', 'n8n-nodes-base.code', 2, [0, 0], {
      jsCode: `return [].concat(${P}.manter || []).reverse().map((m) => ({ json: { m }, pairedItem: 0 }));` }),
    node('Descarte: memória regravar', 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'push', list: MEMORIA, messageData: '={{ $json.m }}', tail: false },
      { credentials: REDIS }),
    node('Descarte: memória pronta', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: 'return [{ json: {}, pairedItem: 0 }];' }, { executeOnce: true }),
    ifNode('Descarte: devolver mensagens?', [0, 0], [
      cond('dd1', `={{ ${P}.devolver.length > 0 }}`, { type: 'boolean', operation: 'true', singleValue: true }),
    ]),
    // voltam para a FRENTE da fila, na ordem original: a mensagem nova (já na fila) fica por último
    node('Descarte: fila itens', 'n8n-nodes-base.code', 2, [0, 0], {
      jsCode: `return [].concat(${P}.devolver || []).reverse().map((m) => ({ json: { m: JSON.stringify({ id: m.id || '', texto: m.texto || '' }) }, pairedItem: 0 }));` }),
    node('Descarte: fila devolver', 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'push', list: `=buffer:${TEL}`, messageData: '={{ $json.m }}', tail: false },
      { credentials: REDIS }),
    node('Descarte: fila pronta', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: 'return [{ json: {}, pairedItem: 0 }];' }, { executeOnce: true }),
    // resposta inteira enviada: zera o contador de descartes
    node('Descarte: zerar', 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'delete', key: `=descartes:${TEL}` },
      { credentials: REDIS, onError: 'continueRegularOutput' }),
  ];
  wf.nodes.push(...nos);
  const sim = (a, b) => ({ main: [[{ node: a, type: 'main', index: 0 }], [{ node: b, type: 'main', index: 0 }]] });
  Object.assign(wf.connections, {
    'Digitando...': main('Resposta velha: ler fila'),
    'Resposta velha: ler fila': main('Resposta velha: descartes'),
    'Resposta velha: descartes': main('Resposta velha?'),
    'Resposta velha?': sim('Descarte: contar', 'Enviar mensagem'),
    'Descarte: contar': main('Descarte: memória ler'),
    'Descarte: memória ler': main('Descarte: preparar'),
    'Descarte: preparar': main('Descarte: mexer na memória?'),
    'Descarte: mexer na memória?': sim('Descarte: memória apagar', 'Descarte: devolver mensagens?'),
    'Descarte: memória apagar': main('Descarte: sobrou memória?'),
    'Descarte: sobrou memória?': sim('Descarte: memória itens', 'Descarte: memória pronta'),
    'Descarte: memória itens': main('Descarte: memória regravar'),
    'Descarte: memória regravar': main('Descarte: memória pronta'),
    'Descarte: memória pronta': main('Descarte: devolver mensagens?'),
    'Descarte: devolver mensagens?': sim('Descarte: fila itens', 'Trava: liberar'),
    'Descarte: fila itens': main('Descarte: fila devolver'),
    'Descarte: fila devolver': main('Descarte: fila pronta'),
    'Descarte: fila pronta': main('Trava: liberar'),
    'Descarte: zerar': main('Trava: liberar'),
  });
  // fim do laço de balões (saída 0 = "done") passa a zerar o contador antes de liberar a trava
  const fimDoLaco = wf.connections['Um balão por vez'].main[0];
  if (fimDoLaco.length !== 1 || fimDoLaco[0].node !== 'Trava: liberar') throw new Error('resposta-velha: fim do laço mudou');
  fimDoLaco[0].node = 'Descarte: zerar';
};
