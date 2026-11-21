// Portão de ações, fase 1 (modo observar): depois que a IA responde, um ramo à parte lê as ferramentas que ela usou
// (intermediateSteps), confere cada ação que grava ou manda contra a fala de quem pediu (portao-regras.js) e registra em
// portao_registros (supabase/065). Nada é barrado aqui: a resposta e as gravações seguem o caminho de sempre, e erro
// neste ramo não segura nada (onError continue). Mesmo jeito do Conferente da Caroline (conferente.js, modo observar).
//
// Chamado pelo montar-workflow.js para a IA de atendimento (agente "Agente IA") e para a assistente da dona
// (agente "Agente assistente"). Os nós ficam lá embaixo na tela (y = 9000): com executionOrder v1 o n8n roda primeiro o
// ramo mais alto, então o caminho da resposta vem antes e o portão não atrasa a resposta.

const { conferirAcoes } = require('./portao-regras.js');

module.exports = ({ node, ifNode, cond, workflow: wf, agente, agenteNo, fala, ficha, telefone, empresa, pediuCancelar = 'undefined' }) => {
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('portão: sem o nó ' + nome); return n; };
  achar(agenteNo);
  if (wf.nodes.some((n) => n.name === 'Portão: conferir')) throw new Error('portão: já montado neste workflow');

  const codigo = [
    `const conferirAcoes = ${conferirAcoes.toString()};`,
    "const pega = (f) => { try { return f(); } catch (e) { return undefined; } };",
    `const ag = pega(() => $('${agenteNo}').first().json) || {};`,
    "const passos = (Array.isArray(ag.intermediateSteps) ? ag.intermediateSteps : []).filter(Boolean)",
    "  .map((p) => ({ ferramenta: p.action && p.action.tool, entrada: p.action && p.action.toolInput, resultado: p.observation }));",
    `const ctx = { agente: '${agente}', passos, fala: String(pega(() => ${fala}) || ''), ficha: String(pega(() => ${ficha}) || ''), pediuCancelar: pega(() => ${pediuCancelar}) };`,
    "let r; try { r = conferirAcoes(ctx); } catch (e) { r = { acoes: [{ ferramenta: 'erro_portao', entrada: '', resultado: String(e && e.message || e).slice(0, 200), falhas: [] }], n_falhas: 0 }; }",
    "return [{ json: { acoes: r.acoes, n_falhas: r.n_falhas, fala: ctx.fala.slice(0, 2000), telefone: String(pega(() => " + telefone + ") || '') } }];",
  ].join('\n');

  wf.nodes.push(
    node('Portão: conferir', 'n8n-nodes-base.code', 2, [0, 9000], { jsCode: codigo }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    ifNode('Portão: teve ação?', [220, 9000], [cond('p1', '={{ Array.isArray($json.acoes) && $json.acoes.length > 0 }}', { type: 'boolean', operation: 'true', singleValue: true })]),
    node('Portão: registrar', 'n8n-nodes-base.httpRequest', 4.2, [440, 9000], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/portao_registros',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
        { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
        { name: 'Prefer', value: 'return=minimal' },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ empresa_id: ${empresa}, agente: '${agente}', modo: 'observar', telefone: $json.telefone, fala: $json.fala, acoes: $json.acoes, n_falhas: $json.n_falhas }) }}`,
      options: { timeout: 5000 },
    }, { onError: 'continueRegularOutput' }),
  );

  // ramo à parte: o agente segue para o caminho de sempre E para o portão (que não volta para o caminho da resposta)
  const saida = wf.connections[agenteNo]?.main?.[0];
  if (!saida || !saida.length) throw new Error('portão: o "' + agenteNo + '" não tem saída');
  saida.push({ node: 'Portão: conferir', type: 'main', index: 0 });
  wf.connections['Portão: conferir'] = { main: [[{ node: 'Portão: teve ação?', type: 'main', index: 0 }]] };
  wf.connections['Portão: teve ação?'] = { main: [[{ node: 'Portão: registrar', type: 'main', index: 0 }], []] };
};
