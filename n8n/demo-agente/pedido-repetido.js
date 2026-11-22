// Pedido repetido: a IA de atendimento não manda de novo para a dona o pedido que acabou de mandar.
//
// 22/11/2026, Gleide: em 20 minutos ela recebeu 4 mensagens pela mesma cliente (Rafaela). Duas eram o mesmo orçamento
// ("2 telas, 65 cm, cabelo humano virgem (para a cliente pintar)" às 12:39 e "2 telas, 65 cm, cabelo virgem (para cliente
// pintar)" às 12:40): a cliente escreveu "vê o valor dos ambos" e depois "Ok", cada mensagem virou uma resposta da IA e
// as duas chamaram pedir_orcamento_cabelo. Nada conferia se o pedido já tinha ido.
//
// Agora o "Perguntar para a Gleide" lê os pedidos abertos (Redis pedido:*) antes de enviar e NÃO envia quando, ao mesmo
// tempo: é a mesma cliente e o mesmo tipo (pergunta ou orçamento); o pedido aberto foi enviado de verdade há menos de
// 10 minutos; os números são os mesmos e na mesma ordem; o pedido novo não traz nenhuma palavra nova e mantém quase
// todas as do aberto; e não é uma correção. A IA recebe "JÁ PEDIDO" e só tranquiliza a cliente.
// A trava é estreita de propósito: na dúvida, envia. É pior a dona não receber uma correção do que receber uma repetição.
// Continua passando: outro cabelo, outra cor, outra medida, correção, a resposta ao que a dona perguntou, pedido de
// mais de 10 minutos atrás, pedido cujo envio falhou, tipo diferente e pedido de outra cliente.
// Só na Gleide por enquanto (as lojas com pedido numerado mexem no começo deste mesmo fluxo).

const JANELA_MIN = 10;

// Roda dentro do n8n (nó de código): só JavaScript simples.
function pedidoRepetido(abertos, novo, empresa, agora, janelaMin) {
  const digitos = (t) => { const d = String(t || '').replace(/\D/g, ''); return /^55\d{2}[6-9]\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; };
  // só palavra que não muda o sentido ("sem", "não", "com", "ou" e "e" ficam: "sem química" não é "com química")
  const SOLTAS = ['a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'para', 'pra', 'pro', 'em', 'um', 'uma', 'que', 'ela', 'dela', 'cliente'];
  const tokens = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/(\d)([a-z])/g, '$1 $2').split(/[^a-z0-9]+/).filter(Boolean);
  const palavras = (ts) => [...new Set(ts.filter((p) => !/^\d+$/.test(p) && !SOLTAS.includes(p)))];
  const numeros = (ts) => ts.filter((p) => /^\d+$/.test(p)).join(',');
  const tel = digitos(novo && novo.telefone), tipo = (novo && novo.tipo) || 'pergunta';
  const tn = tokens(novo && novo.pergunta), pn = palavras(tn);
  if (!tel || !pn.length) return null;
  // correção nunca é repetição (prompt: "CORREÇÃO do pedido anterior (desconsiderar 60 cm): …")
  if (/corre[cç][aã]o|desconsider|substitu|na verdade|errei|troca/i.test(String((novo && novo.pergunta) || '') + ' ' + String((novo && novo.contexto) || ''))) return null;
  const limite = (Number(agora) || Date.now()) - (Number(janelaMin) || 10) * 60000;
  for (const [chave, v] of Object.entries(abertos || {})) {
    // "pedido:falhou" é o pedido que NÃO chegou à dona
    if (/falhou/.test(chave)) continue;
    let p = null;
    try { p = typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { p = null; }
    if (!p || typeof p !== 'object' || !p.pergunta) continue;
    // sem a hora do envio (pedido antigo) ou fora da janela: não dá para dizer que é repetição
    if (!(Number(p.em) >= limite)) continue;
    if (!empresa || p.empresa !== empresa) continue;
    if (digitos(p.telefone) !== tel || (p.tipo || 'pergunta') !== tipo) continue;
    const ta = tokens(p.pergunta), pa = palavras(ta);
    if (numeros(ta) !== numeros(tn)) continue;
    // nenhuma palavra nova, e no máximo uma a menos a cada cinco ("cabelo humano virgem" x "cabelo virgem")
    const novas = pn.filter((x) => !pa.includes(x)).length;
    if (!novas && pa.length - pn.length <= Math.floor(pa.length / 5)) return { pergunta: String(p.pergunta) };
  }
  return null;
}

module.exports = ({ node, perguntaWorkflow: P, REDIS }) => {
  const achar = (nome) => { const n = P.nodes.find((x) => x.name === nome); if (!n) throw new Error('pedido-repetido: não achei o nó "' + nome + '"'); return n; };
  achar('Recebe pergunta da IA'); achar('Supabase: número de alerta');
  if (P.connections['Recebe pergunta da IA']?.main?.[0]?.[0]?.node !== 'Supabase: número de alerta') throw new Error('pedido-repetido: o começo do "Perguntar" mudou');

  // o pedido guardado passa a levar a hora do envio (em): a janela de 10 minutos depende dela
  const guardar = achar('Guardar pedido').parameters;
  const DE = "tipo: $('Recebe pergunta da IA').first().json.tipo || 'pergunta', empresa: $env.EMPRESA_ID })";
  if (!String(guardar.value).includes(DE)) throw new Error('pedido-repetido: o "Guardar pedido" mudou');
  guardar.value = guardar.value.replace(DE, () => DE.replace(' })', ', em: Date.now() })'));

  P.nodes.push(
    // se o Redis falhar, segue como antes (envia): melhor repetir do que perder um pedido
    node('Repetido: pedidos abertos', 'n8n-nodes-base.redis', 1, [110, -160], { operation: 'keys', keyPattern: 'pedido:*', getValues: true },
      { credentials: REDIS, alwaysOutputData: true, onError: 'continueRegularOutput' }),
    node('Repetido: conferir', 'n8n-nodes-base.code', 2, [220, -160], { jsCode: [
      '// pedido-repetido.js: este mesmo pedido acabou de ir para a dona?',
      'const pedidoRepetido = ' + pedidoRepetido.toString() + ';',
      'let repetido = null;',
      "try { repetido = pedidoRepetido($('Repetido: pedidos abertos').first().json || {}, $('Recebe pergunta da IA').first().json || {}, $env.EMPRESA_ID, Date.now(), " + JANELA_MIN + '); } catch (e) { repetido = null; }',
      'return [{ json: { repetido: !!repetido, anterior: repetido ? repetido.pergunta : null } }];',
    ].join('\n') }),
    node('Repetido?', 'n8n-nodes-base.if', 2.2, [330, -160], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'rp1', leftValue: '={{ $json.repetido === true }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and' },
      options: {},
    }),
    node('Resposta (já pedido)', 'n8n-nodes-base.set', 3.4, [440, -260], {
      assignments: { assignments: [{ id: 'rp-resposta', name: 'resposta', type: 'string',
        value: "={{ 'JÁ PEDIDO: você mandou este mesmo pedido para a Gleide agora há pouco («' + $json.anterior + '») e ele já está com ela. NÃO mandei de novo. " +
          'Diga à cliente, com carinho e em uma frase, que o pedido já está com a Gleide e que você avisa por aqui assim que ela responder. ' +
          'Não invente valor nem prazo. Se a cliente mudou alguma coisa no pedido, chame a ferramenta de novo dizendo o que mudou ' +
          "(CORREÇÃO do pedido anterior: …), que aí o pedido vai.' }}" }] },
      options: {},
    }),
  );
  const liga = (para) => ({ main: [[{ node: para, type: 'main', index: 0 }]] });
  P.connections['Recebe pergunta da IA'] = liga('Repetido: pedidos abertos');
  P.connections['Repetido: pedidos abertos'] = liga('Repetido: conferir');
  P.connections['Repetido: conferir'] = liga('Repetido?');
  P.connections['Repetido?'] = { main: [[{ node: 'Resposta (já pedido)', type: 'main', index: 0 }], [{ node: 'Supabase: número de alerta', type: 'main', index: 0 }]] };
};

module.exports.pedidoRepetido = pedidoRepetido;
module.exports.JANELA_MIN = JANELA_MIN;
