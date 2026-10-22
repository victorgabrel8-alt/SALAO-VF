// Memória do agente sem começo quebrado.
// A memória (Redis) só manda para o Gemini as últimas contextWindowLength × 2 mensagens. Numa conversa longa
// esse corte pode cair no meio de uma ferramenta: o histórico começa com "a IA chamou X" ou com a resposta
// da ferramenta, sem a mensagem da cliente antes, e o Gemini recusa tudo ("function call turn comes
// immediately after a user turn"). A cliente fica sem resposta (aconteceu em 22/10, execução 1340).
// Antes do agente: lê a lista; se o corte cairia num desses, regrava a lista já começando num ponto bom.
// Chamado pelo montar-workflow.js para o agente de atendimento e o da assistente.

const CONFERIR = (janela) => String.raw`
// lista do Redis: [0] = mais nova (a memória grava com LPUSH)
const lista = [].concat($input.first().json.memoria || []);
const quebra = (s) => { try { const m = JSON.parse(s); return m.type === 'tool' || (m.type === 'ai' && (m.data?.tool_calls || []).length > 0); } catch (e) { return false; } };
let fim = Math.min(lista.length, ${janela});
if (!fim || !quebra(lista[fim - 1])) return [{ json: { cortar: false }, pairedItem: 0 }];
// recua até uma mensagem dela: o histórico começa como uma conversa normal
const dela = (s) => { try { return JSON.parse(s).type === 'human'; } catch (e) { return false; } };
while (fim > 0 && !dela(lista[fim - 1])) fim--;
// toda interação começa com a mensagem dela, então sempre há um ponto bom; sem ele, não mexe
if (!fim) return [{ json: { cortar: false }, pairedItem: 0 }];
return [{ json: { cortar: true, de: lista.length, para: fim, manter: lista.slice(0, fim) }, pairedItem: 0 }];
`;

module.exports = ({ node, main }) => (wf, agente, REDIS) => {
  const memoria = wf.nodes.find((n) => n.type.endsWith('memoryRedisChat') && wf.connections[n.name]?.ai_memory?.[0]?.[0]?.node === agente);
  if (!memoria) throw new Error(`memoria-janela: "${agente}" não tem memória Redis`);
  const chave = memoria.parameters.sessionKey;
  const janela = (memoria.parameters.contextWindowLength || 5) * 2;
  const p = (nome) => `${nome} (${agente})`;
  const N = { ler: p('Memória: ler'), conferir: p('Memória: conferir'), cortar: p('Memória: cortar?'), apagar: p('Memória: apagar'),
    itens: p('Memória: regravar itens'), regravar: p('Memória: regravar'), pronta: p('Memória: pronta') };
  wf.nodes.push(
    node(N.ler, 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'get', key: chave, propertyName: 'memoria', keyType: 'list', options: {} },
      { credentials: REDIS, onError: 'continueRegularOutput' }),
    node(N.conferir, 'n8n-nodes-base.code', 2, [0, 0], { jsCode: CONFERIR(janela).trim() }),
    node(N.cortar, 'n8n-nodes-base.if', 2.2, [0, 0], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'mj1', leftValue: '={{ $json.cortar }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and' },
      options: {},
    }),
    node(N.apagar, 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'delete', key: chave }, { credentials: REDIS }),
    // da mais antiga para a mais nova: cada LPUSH põe a próxima na frente, e a lista volta à ordem original
    node(N.itens, 'n8n-nodes-base.code', 2, [0, 0], { jsCode:
      `return [].concat($('${N.conferir}').first().json.manter || []).reverse().map((m) => ({ json: { m }, pairedItem: 0 }));` }),
    node(N.regravar, 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'push', list: chave, messageData: '={{ $json.m }}', tail: false },
      { credentials: REDIS }),
    node(N.pronta, 'n8n-nodes-base.code', 2, [0, 0], { jsCode: 'return [{ json: {}, pairedItem: 0 }];' }, { executeOnce: true }),
  );
  // o que entrava no agente agora passa antes pela conferência
  for (const [de, c] of Object.entries(wf.connections)) {
    for (const saida of c.main || []) for (const l of saida || []) if (l.node === agente) l.node = N.ler;
  }
  wf.connections[N.ler] = main(N.conferir);
  wf.connections[N.conferir] = main(N.cortar);
  wf.connections[N.cortar] = { main: [[{ node: N.apagar, type: 'main', index: 0 }], [{ node: agente, type: 'main', index: 0 }]] };
  wf.connections[N.apagar] = main(N.itens);
  wf.connections[N.itens] = main(N.regravar);
  wf.connections[N.regravar] = main(N.pronta);
  wf.connections[N.pronta] = main(agente);
};
