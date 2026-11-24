// Orquestrador: o Conferente confere a resposta da IA de atendimento antes de ela ir para a cliente.
// Regras em conferente-regras.js (só código, sem IA; testes em testes/conferente.test.js). As regras de cada loja
// vêm do cadastro (servicos, empresas.config): nada aqui é escrito loja por loja.
//
// loja.json: "conferente": "observar" ou "ligado"
//   - observar (fase A): confere e grava em conferente_registros (supabase/053) o que barraria. A resposta sai IGUAL
//     para a cliente: o Conferente fica num ramo à parte, depois do agente, e erro nele não segura a mensagem.
//   - ligado (fase B): o Conferente fica NO CAMINHO da resposta, entre o agente e o "Quebrar mensagens".
//       passou: a resposta sai igual (sem chamada extra; só o nó que confere e o que entrega a resposta);
//       barrou: o Gemini reescreve só o trecho errado (mesmo tom: seção 25 do prompt da loja), com a resposta, as
//         falhas e os dados certos (lista de preços, resultado da agenda, ficha, endereço). A reescrita é conferida
//         de novo; se ainda barrar, ou o Gemini falhar ou passar de 10 s, sai a versão segura (a resposta sem a parte
//         errada, só com código). Nunca trava a resposta e nunca manda pergunta para a dona;
//       a memória da IA (Redis) fica com o texto que saiu, para ela não achar que disse o que foi cortado;
//       tudo vai para conferente_registros (supabase/053 + 060: reescrita, texto_final, usou_segura, motivo...).
//     Os nós "Conferente: conferir", "Conferente: barrou?" e "Conferente: registrar" têm os mesmos nomes e ids nos
//     dois modos (os módulos de depois não mudam de id); os nós novos do ligado têm id próprio, fixo pelo nome.
// Chamado pelo montar-workflow.js no bloco da loja (depois do preco-pendente.js, que pôs o "Preço: ler pendência").

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { conferir, versaoSegura, montarPedido, escolher } = require('./conferente-regras.js');

// tempo máximo do Gemini na reescrita: passou disso, sai a versão segura
const TEMPO_GEMINI = 10000;

// a seção do prompt da loja com o jeito de escrever ("## 25. O JEITO DA ... ESCREVER"); sem ela, um resumo
function tomDaLoja(loja) {
  const arq = path.join(__dirname, 'lojas', String(loja.slug || ''), 'prompt-agente.md');
  try {
    const md = fs.readFileSync(arq, 'utf8').replace(/\r\n/g, '\n');
    const m = md.match(/\n## \d+\. O JEITO D[AEO] [^\n]*ESCREVER[^\n]*\n([\s\S]*?)(?=\n---\n|\n## \d+\.)/);
    if (m) return m[1].trim();
  } catch (e) { /* sem prompt da loja: vale o resumo */ }
  return 'Curto, prático, simpático e sem enfeite. Mensagens curtas, de uma ideia só. Sem lista, negrito ou título. Emoji raro. ' +
    'Valor escrito como se fala ("R$ 50"). Sem frase de robô ("Fico à disposição", "Com certeza!", "Gostaria de agendar?").';
}

module.exports = ({ node, ifNode, cond, workflow: wf, loja }) => {
  const modo = loja.conferente;
  if (modo !== 'observar' && modo !== 'ligado') throw new Error(`conferente: modo "${modo}" não existe (só "observar" ou "ligado")`);
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('conferente: sem o nó ' + nome); return n; };
  // Gleide (21/11/2026): o principal dela não tem "Supabase: dados do salão" (só as lojas têm, lojas.dadosDoSalao, que também
  // mexe no prompt). No modo observar o Conferente lê o cadastro no próprio ramo ("Conferente: dados do salão"), sem tocar no
  // caminho da resposta. No ligado o nó continua obrigatório.
  const temDados = wf.nodes.some((x) => x.name === 'Supabase: dados do salão');
  if (!temDados && modo === 'ligado') achar('Supabase: dados do salão');
  const NO_DADOS = temDados ? 'Supabase: dados do salão' : 'Conferente: dados do salão';
  for (const nome of ['Agente IA', 'Supabase: tabela de serviços', 'Supabase: últimas mensagens', 'Sobre esta cliente', 'Extrair dados']) achar(nome);

  // as últimas mensagens passam a trazer quem escreveu (dona x IA): valor que a dona deu ("faz por 80") vale
  const ult = achar('Supabase: últimas mensagens');
  const sel = 'select=direcao,conteudo,wa_message_id,criado_em';
  if (!ult.parameters.url.includes(sel)) throw new Error('conferente: a consulta das últimas mensagens mudou');
  ult.parameters.url = ult.parameters.url.replace(sel, sel + ',autor');

  // o que o Conferente lê do workflow (o mesmo nos dois modos)
  const LER = [
    "const pega = (no, f) => { try { return f($(no)); } catch (e) { return undefined; } };",
    "const ag = pega('Agente IA', (n) => n.first().json) || {};",
    "const passos = (Array.isArray(ag.intermediateSteps) ? ag.intermediateSteps : []).filter(Boolean).map((p) => ({ ferramenta: p.action && p.action.tool, entrada: p.action && p.action.toolInput, resultado: p.observation }));",
    "const ctx = {",
    "  texto: ag.output || '',",
    "  passos,",
    "  servicos: pega('Supabase: tabela de serviços', (n) => n.all().map((i) => i.json).filter((s) => s && s.nome)) || [],",
    `  config: pega('${NO_DADOS}', (n) => n.first().json.config) || {},`,
    "  anteriores: pega('Supabase: últimas mensagens', (n) => n.all().map((i) => i.json).filter((m) => m && m.criado_em)) || [],",
    "  ficha: pega('Sobre esta cliente', (n) => n.first().json.texto) || '',",
    "  agora: Date.now(),",
    // a regra "nome de outra loja" foi feita para a Caroline (aponta Gleide, mega hair, Toda Bonita): na Gleide fica de fora
    `  semOutraLoja: ${loja.outra_loja === false},`,
    "};",
  ];
  const ferramentas = "passos.map((p) => ({ ferramenta: p.ferramenta, resultado: String(typeof p.resultado === 'string' ? p.resultado : JSON.stringify(p.resultado || '')).slice(0, 300) }))";
  const registrarNo = (pos, corpo) => node('Conferente: registrar', 'n8n-nodes-base.httpRequest', 4.2, pos, {
    method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/conferente_registros',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Prefer', value: 'return=minimal' },
    ] },
    sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ empresa_id: '${loja.empresa_id}', telefone: String($('Extrair dados').first().json.telefone || ''), ${corpo} }) }}`,
    options: { timeout: modo === 'ligado' ? 3000 : 10000 },
  }, { onError: 'continueRegularOutput', ...(modo === 'ligado' ? { alwaysOutputData: true } : {}) });

  if (modo === 'observar') {
    const codigo = [
      `const conferir = ${conferir.toString()};`,
      ...LER,
      "let r; try { r = conferir(ctx); } catch (e) { r = { ok: false, falhas: [{ tipo: 'erro_conferente', detalhe: String(e && e.message || e).slice(0, 200) }] }; }",
      `return [{ json: { modo: '${modo}', ok: r.ok, falhas: r.falhas, texto: ctx.texto,`,
      `  ferramentas: ${ferramentas} } }];`,
    ].join('\n');

    // sem o nó do cadastro (Gleide): ramo lá embaixo na tela (y = 9300, como o portão): com executionOrder v1 o n8n roda
    // primeiro o ramo mais alto, então a resposta sai antes e a leitura do cadastro não atrasa a cliente
    const y = temDados ? 0 : 9300;
    wf.nodes.push(
      node('Conferente: conferir', 'n8n-nodes-base.code', 2, [temDados ? 0 : 220, y], { jsCode: codigo }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
      ifNode('Conferente: barrou?', [temDados ? 0 : 440, y], [cond('c1', '={{ $json.ok === false }}', { type: 'boolean', operation: 'true', singleValue: true })]),
      registrarNo([temDados ? 0 : 660, y], 'modo: $json.modo, texto: $json.texto, falhas: $json.falhas, ferramentas: $json.ferramentas'),
    );
    if (!temDados) {
      const dados = JSON.parse(JSON.stringify(achar('Supabase: tabela de serviços')));
      Object.assign(dados, { name: 'Conferente: dados do salão', id: crypto.createHash('md5').update('conferente-dados-' + loja.slug).digest('hex').replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5'),
        position: [0, y], onError: 'continueRegularOutput', alwaysOutputData: true });
      dados.parameters.url = `={{ $env.SUPABASE_URL }}/rest/v1/empresas?select=config&id=eq.${loja.empresa_id}`;
      wf.nodes.push(dados);
    }

    // ramo à parte: o agente segue para o caminho de sempre E para o Conferente (que não volta para o caminho da resposta)
    const saida = wf.connections['Agente IA']?.main?.[0];
    if (!saida || !saida.length) throw new Error('conferente: o "Agente IA" não tem saída');
    saida.push({ node: temDados ? 'Conferente: conferir' : 'Conferente: dados do salão', type: 'main', index: 0 });
    if (!temDados) wf.connections['Conferente: dados do salão'] = { main: [[{ node: 'Conferente: conferir', type: 'main', index: 0 }]] };
    wf.connections['Conferente: conferir'] = { main: [[{ node: 'Conferente: barrou?', type: 'main', index: 0 }]] };
    wf.connections['Conferente: barrou?'] = { main: [[{ node: 'Conferente: registrar', type: 'main', index: 0 }], []] };
    return;
  }

  // ======================= ligado =======================
  const quebrar = achar('Quebrar mensagens');
  const memoria = achar('Memória (Redis)');
  const gemini = achar('Entender mídia (Gemini)');
  const chaveMemoria = memoria.parameters.sessionKey;
  if (!/^=.*memoria:/.test(chaveMemoria || '')) throw new Error('conferente: a chave da memória (Redis) mudou');
  const lerSaida = "let t = ($('Agente IA').first().json.output || '')";
  if (quebrar.parameters.jsCode.split(lerSaida).length !== 2) throw new Error('conferente: o "Quebrar mensagens" mudou (não lê mais a saída do Agente IA)');
  const saida = wf.connections['Agente IA']?.main?.[0];
  if (!saida || !saida.length) throw new Error('conferente: o "Agente IA" não tem saída');
  const depois = saida.splice(0, saida.length); // o caminho de sempre (Preço: ler pendência) passa a vir depois do Conferente

  // id fixo pelo nome (como o voucher-gel.js): os nós novos não mexem no contador de ids do montar-workflow.js
  const idFixo = (nome) => { const h = crypto.createHash('md5').update(`conferente:${nome}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
  const [x0, y0] = achar('Agente IA').position || [0, 0];
  const pos = (i, j = 0) => [x0 + 220 * i, y0 + 600 + 200 * j];
  const novo = (nome, type, typeVersion, p, parameters, extra = {}) => ({ id: idFixo(nome), name: nome, type, typeVersion, position: p, parameters, ...extra });
  const se = (nome, p, esquerda) => novo(nome, 'n8n-nodes-base.if', 2.2, p, {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'c1', leftValue: esquerda, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    options: {},
  });
  const LER_LIGADO = [
    ...LER,
    "ctx.mensagem = pega('Montar entrada', (n) => n.first().json.texto_cliente) || '';",
    `ctx.dona = ${JSON.stringify(loja.dona || '')};`,
    `ctx.nomeLoja = ${JSON.stringify(loja.nome || '')};`,
  ];
  const FUNCOES = [conferir, versaoSegura, montarPedido, escolher].map((f) => `const ${f.name} = ${f.toString()};`);

  // 1. confere; barrou: monta o pedido ao Gemini (erro só do Conferente não reescreve nada)
  const codConferir = [
    ...FUNCOES,
    `const TOM = ${JSON.stringify(tomDaLoja(loja))};`,
    ...LER_LIGADO,
    "let r; try { r = conferir(ctx); } catch (e) { r = { ok: false, falhas: [{ tipo: 'erro_conferente', detalhe: String(e && e.message || e).slice(0, 200) }] }; }",
    "const deVerdade = !r.ok && r.falhas.some((f) => f.tipo !== 'erro_conferente');",
    "let pedido = '';",
    "if (deVerdade) { try { pedido = montarPedido(ctx, r.falhas, TOM); } catch (e) { pedido = ''; } }",
    "return [{ json: { modo: 'ligado', ok: r.ok, falhas: r.falhas, texto: ctx.texto, agora: ctx.agora, reescrever: deVerdade && !!pedido, pedido,",
    `  ferramentas: ${ferramentas} } }];`,
  ].join('\n');

  // 2. decide o que sai: original (passou), reescrita (passou no Conferente) ou versão segura
  const codDecidir = [
    ...FUNCOES,
    ...LER_LIGADO,
    "const c = pega('Conferente: conferir', (n) => n.first().json) || {};",
    "if (c.agora) ctx.agora = c.agora;",
    "// passou (ou o próprio Conferente quebrou): sai a resposta como veio",
    "if (c.ok !== false || !Array.isArray(c.falhas)) return [{ json: { ok: true, texto: ctx.texto, texto_final: ctx.texto, usou: 'original' } }];",
    "const base = { modo: 'ligado', ok: false, falhas: c.falhas, texto: ctx.texto, ferramentas: c.ferramentas || [] };",
    "if (!c.falhas.some((f) => f && f.tipo !== 'erro_conferente')) return [{ json: { ...base, texto_final: ctx.texto, usou: 'original', motivo: 'erro_conferente', tempo_ms: Date.now() - (c.agora || Date.now()) } }];",
    "const g = c.reescrever ? pega('Conferente: reescrever (Gemini)', (n) => n.first().json) : undefined;",
    "const partes = (((((g || {}).candidates || [])[0] || {}).content || {}).parts || []);",
    "const reescrita = partes.filter((p) => p && !p.thought).map((p) => p.text || '').join('').trim();",
    "const erro = !c.reescrever ? 'sem pedido' : (!g ? 'sem resposta' : (g.error ? String(g.error.message || g.error).slice(0, 200) : ''));",
    "let e;",
    "try { e = escolher(ctx, c.falhas, reescrita, erro && !reescrita ? erro : ''); }",
    "catch (x) { try { const s = versaoSegura(ctx, c.falhas); e = { texto: s.texto, usou: 'segura', motivo: 'erro_escolher', falhas_reescrita: [], cortes: s.cortes, falhas_final: s.falhas }; }",
    "  catch (y) { e = { texto: ctx.texto, usou: 'original', motivo: 'erro_versao_segura: ' + String(y && y.message || y).slice(0, 150), falhas_reescrita: [] }; } }",
    "return [{ json: { ...base, reescrita: reescrita || null, texto_final: e.texto, usou: e.usou, usou_segura: e.usou === 'segura',",
    "  motivo: e.motivo || (erro && !reescrita ? erro : '') || null, falhas_reescrita: e.falhas_reescrita || [], cortes: e.cortes || [], falhas_final: e.falhas_final || [],",
    "  tempo_ms: Date.now() - (c.agora || Date.now()) } }];",
  ].join('\n');

  // 3. memória da IA: a última resposta dela passa a ser o texto que saiu (só quando mudou e a memória bate)
  const codMemoria = [
    "const d = (() => { try { return $('Conferente: decidir').first().json; } catch (e) { return {}; } })();",
    "// lista do Redis: [0] = mais nova (a memória grava com LPUSH); a resposta final do agente é a última gravada",
    "const lista = [].concat($input.first().json.memoria || []);",
    "if (!d || typeof d.texto_final !== 'string' || d.texto_final === d.texto || !lista.length) return [{ json: { trocar: false } }];",
    "let m; try { m = JSON.parse(lista[0]); } catch (e) { return [{ json: { trocar: false } }]; }",
    "if (!m || m.type !== 'ai' || !m.data || typeof m.data.content !== 'string' || m.data.content.trim() !== String(d.texto || '').trim()) return [{ json: { trocar: false } }];",
    "m.data.content = d.texto_final;",
    "return [{ json: { trocar: true, nova: JSON.stringify(m) } }];",
  ].join('\n');

  // 4. o "Quebrar mensagens" lê daqui (sem o Conferente, lê o agente como antes)
  const codResposta = [
    "const d = (() => { try { return $('Conferente: decidir').first().json; } catch (e) { return undefined; } })();",
    "const ag = (() => { try { return $('Agente IA').first().json; } catch (e) { return {}; } })();",
    "const texto = d && typeof d.texto_final === 'string' ? d.texto_final : (ag.output || '');",
    "return [{ json: { texto, usou: (d && d.usou) || 'original' } }];",
  ].join('\n');

  wf.nodes.push(
    node('Conferente: conferir', 'n8n-nodes-base.code', 2, pos(0), { jsCode: codConferir }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    ifNode('Conferente: barrou?', pos(5, -1), [cond('c1', '={{ $json.ok === false }}', { type: 'boolean', operation: 'true', singleValue: true })]),
    registrarNo(pos(6, -2), 'modo: $json.modo, texto: $json.texto, falhas: $json.falhas, ferramentas: $json.ferramentas, ' +
      'reescrita: $json.reescrita || null, texto_final: $json.texto_final, usou_segura: $json.usou_segura === true, motivo: $json.motivo || null, ' +
      'falhas_reescrita: $json.falhas_reescrita || [], tempo_ms: $json.tempo_ms || null'),
    se('Conferente: tem erro?', pos(1), '={{ $json.ok === false }}'),
    se('Conferente: reescrever?', pos(2, -1), '={{ $json.reescrever === true }}'),
    novo('Conferente: reescrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, pos(3, -2), {
      method: 'POST', url: gemini.parameters.url,
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ contents: [{ parts: [{ text: $json.pedido }] }], generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: \'low\' } } }) }}',
      options: { timeout: TEMPO_GEMINI },
    }, { ...(gemini.credentials ? { credentials: gemini.credentials } : {}), onError: 'continueRegularOutput', alwaysOutputData: true }),
    novo('Conferente: decidir', 'n8n-nodes-base.code', 2, pos(4, -1), { jsCode: codDecidir }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    novo('Conferente: memória: ler', 'n8n-nodes-base.redis', 1, pos(7, -2), { operation: 'get', key: chaveMemoria, propertyName: 'memoria', keyType: 'list', options: {} },
      { credentials: memoria.credentials, onError: 'continueRegularOutput', alwaysOutputData: true }),
    novo('Conferente: memória: trocar', 'n8n-nodes-base.code', 2, pos(8, -2), { jsCode: codMemoria }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    se('Conferente: memória: trocou?', pos(9, -2), '={{ $json.trocar === true }}'),
    novo('Conferente: memória: tirar', 'n8n-nodes-base.redis', 1, pos(10, -3), { operation: 'pop', list: chaveMemoria, tail: false, propertyName: 'tirado', options: {} },
      { credentials: memoria.credentials, onError: 'continueRegularOutput', alwaysOutputData: true }),
    novo('Conferente: memória: pôr', 'n8n-nodes-base.redis', 1, pos(11, -3), { operation: 'push', list: chaveMemoria, messageData: "={{ $('Conferente: memória: trocar').first().json.nova }}", tail: false },
      { credentials: memoria.credentials, onError: 'continueRegularOutput', alwaysOutputData: true }),
    novo('Conferente: resposta', 'n8n-nodes-base.code', 2, pos(12), { jsCode: codResposta }, { executeOnce: true }),
  );

  const liga = (de, ...para) => { wf.connections[de] = { main: para.map((p) => (p ? [{ node: p, type: 'main', index: 0 }] : [])) }; };
  saida.push({ node: 'Conferente: conferir', type: 'main', index: 0 });
  // passou: direto para a resposta (sem mais nenhum nó de código no caminho)
  liga('Conferente: conferir', 'Conferente: tem erro?');
  liga('Conferente: tem erro?', 'Conferente: reescrever?', 'Conferente: resposta');
  liga('Conferente: reescrever?', 'Conferente: reescrever (Gemini)', 'Conferente: decidir');
  liga('Conferente: reescrever (Gemini)', 'Conferente: decidir');
  liga('Conferente: decidir', 'Conferente: barrou?');
  liga('Conferente: barrou?', 'Conferente: registrar', 'Conferente: resposta');
  liga('Conferente: registrar', 'Conferente: memória: ler');
  liga('Conferente: memória: ler', 'Conferente: memória: trocar');
  liga('Conferente: memória: trocar', 'Conferente: memória: trocou?');
  liga('Conferente: memória: trocou?', 'Conferente: memória: tirar', 'Conferente: resposta');
  liga('Conferente: memória: tirar', 'Conferente: memória: pôr');
  liga('Conferente: memória: pôr', 'Conferente: resposta');
  wf.connections['Conferente: resposta'] = { main: [depois] };

  quebrar.parameters.jsCode = quebrar.parameters.jsCode.replace(lerSaida, () =>
    "// conferente.js (ligado): a resposta que sai é a do Conferente (igual, reescrita ou versão segura); sem ele, a do agente\n" +
    "let t = ((() => { try { const c = $('Conferente: resposta').first().json; if (c && typeof c.texto === 'string') return c.texto; } catch (e) {} return $('Agente IA').first().json.output; })() || '')");
};
