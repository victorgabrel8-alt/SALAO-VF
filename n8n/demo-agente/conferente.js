// Orquestrador, fase A: o Conferente confere a resposta da IA de atendimento antes de ela ir para a cliente.
// Regras em conferente-regras.js (só código, sem IA; testes em testes/conferente.test.js). As regras de cada loja
// vêm do cadastro (servicos, empresas.config): nada aqui é escrito loja por loja.
//
// loja.json: "conferente": "observar"
//   - observar: confere e grava em conferente_registros (supabase/053) o que barraria. A resposta sai IGUAL para a
//     cliente: o Conferente fica num ramo à parte, depois do agente, e erro nele não segura a mensagem.
//   - ligado (fase seguinte, ainda não existe): barrou, o Gemini reescreve só o erro.
// Chamado pelo montar-workflow.js no bloco da loja (depois do preco-pendente.js, que pôs o "Preço: ler pendência").

const { conferir } = require('./conferente-regras.js');

module.exports = ({ node, ifNode, cond, workflow: wf, loja }) => {
  const modo = loja.conferente;
  if (modo !== 'observar') throw new Error(`conferente: modo "${modo}" não existe ainda (só "observar")`);
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('conferente: sem o nó ' + nome); return n; };
  for (const nome of ['Agente IA', 'Supabase: tabela de serviços', 'Supabase: dados do salão', 'Supabase: últimas mensagens', 'Sobre esta cliente', 'Extrair dados']) achar(nome);

  // as últimas mensagens passam a trazer quem escreveu (dona x IA): valor que a dona deu ("faz por 80") vale
  const ult = achar('Supabase: últimas mensagens');
  const sel = 'select=direcao,conteudo,wa_message_id,criado_em';
  if (!ult.parameters.url.includes(sel)) throw new Error('conferente: a consulta das últimas mensagens mudou');
  ult.parameters.url = ult.parameters.url.replace(sel, sel + ',autor');

  const codigo = [
    `const conferir = ${conferir.toString()};`,
    "const pega = (no, f) => { try { return f($(no)); } catch (e) { return undefined; } };",
    "const ag = $('Agente IA').first().json || {};",
    "const passos = (ag.intermediateSteps || []).map((p) => ({ ferramenta: p.action && p.action.tool, entrada: p.action && p.action.toolInput, resultado: p.observation }));",
    "const ctx = {",
    "  texto: ag.output || '',",
    "  passos,",
    "  servicos: pega('Supabase: tabela de serviços', (n) => n.all().map((i) => i.json).filter((s) => s && s.nome)) || [],",
    "  config: pega('Supabase: dados do salão', (n) => n.first().json.config) || {},",
    "  anteriores: pega('Supabase: últimas mensagens', (n) => n.all().map((i) => i.json).filter((m) => m && m.criado_em)) || [],",
    "  ficha: pega('Sobre esta cliente', (n) => n.first().json.texto) || '',",
    "  agora: Date.now(),",
    "};",
    'const r = conferir(ctx);',
    `return [{ json: { modo: '${modo}', ok: r.ok, falhas: r.falhas, texto: ctx.texto,`,
    "  ferramentas: passos.map((p) => ({ ferramenta: p.ferramenta, resultado: String(typeof p.resultado === 'string' ? p.resultado : JSON.stringify(p.resultado || '')).slice(0, 300) })) } }];",
  ].join('\n');

  wf.nodes.push(
    node('Conferente: conferir', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: codigo }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    ifNode('Conferente: barrou?', [0, 0], [cond('c1', '={{ $json.ok === false }}', { type: 'boolean', operation: 'true', singleValue: true })]),
    node('Conferente: registrar', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/conferente_registros',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
        { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
        { name: 'Prefer', value: 'return=minimal' },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ empresa_id: '${loja.empresa_id}', telefone: String($('Extrair dados').first().json.telefone || ''), modo: $json.modo, texto: $json.texto, falhas: $json.falhas, ferramentas: $json.ferramentas }) }}`,
      options: { timeout: 10000 },
    }, { onError: 'continueRegularOutput' }),
  );

  // ramo à parte: o agente segue para o caminho de sempre E para o Conferente (que não volta para o caminho da resposta)
  const saida = wf.connections['Agente IA']?.main?.[0];
  if (!saida || !saida.length) throw new Error('conferente: o "Agente IA" não tem saída');
  saida.push({ node: 'Conferente: conferir', type: 'main', index: 0 });
  wf.connections['Conferente: conferir'] = { main: [[{ node: 'Conferente: barrou?', type: 'main', index: 0 }]] };
  wf.connections['Conferente: barrou?'] = { main: [[{ node: 'Conferente: registrar', type: 'main', index: 0 }], []] };
};
