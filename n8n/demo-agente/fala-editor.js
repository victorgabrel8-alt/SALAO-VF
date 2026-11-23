// Segunda passada de fala (23/11/2026, pedido do Victor: "a IA precisa de um tom humano", "parece roteirizado").
//
// A IA que decide o que dizer (com agenda e ferramentas) escreve um rascunho. Aqui uma segunda chamada, pequena,
// recebe só o rascunho, as últimas respostas da IA e o que a cliente escreveu, e devolve a MESMA resposta com jeito
// de gente. Ela não decide nada e não pode mudar fato: se mexer em número, horário, link, e-mail, na apresentação
// de assistente virtual, se criar pergunta nova ou cortar demais, vale o rascunho.
//
// Onde: entre o "Agente IA" e o caminho de sempre. O "Quebrar mensagens" passa a ler o texto editado quando houver;
// todos os filtros dele (preço, cumprimento, Pix) continuam valendo por cima.
// Ligado só para os telefones de `so_para` (compara os 8 últimos dígitos). Lista vazia = desligado para todo mundo.
// O que NÃO muda: a memória da IA (Redis) guarda o rascunho, e o Conferente (observar) confere o rascunho.
const crypto = require('crypto');

// ---------- funções puras (vão coladas nos nós; nada de variável de fora) ----------
function fatos(t) {
  // dia escrito por extenso também é fato: "terça" não pode virar "quarta"
  const dias = (String(t).toLowerCase().match(/segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|depois de amanh[ãa]|amanh[ãa]|hoje|janeiro|fevereiro|mar[çc]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro/g) || []);
  // "até 10x" e "a partir de R$ 150" não podem virar "10x" e "R$ 150": o limite faz parte do fato
  return (String(t).match(/https?:\/\/\S+|[\w.+-]+@[\w-]+\.[\w.]+|(?:at[ée] |a partir de )?(?:R\$ ?)?\d+[\d:.,hx]*/gi) || []).map((x) => x.toLowerCase().replace(/r\$ ?/, '').replace(/^até /, 'ate ')).map((x) => x.replace(/[.,]$/, '')).concat(dias).sort().join('|');
}

function pedidoEditor(e) {
  const iaAntes = (e.iaAntes || []).slice(-4);
  return 'Você é a editora de uma atendente de salão que conversa por WhatsApp. Reescreva o RASCUNHO para soar como uma pessoa de verdade digitando no celular, sem mudar o que ele informa.\n\n' +
    'NÃO PODE MUDAR: preços, horários, datas, endereço, links, nomes, o que foi marcado ou perguntado para a Gleide, e o sentido de cada informação. Não acrescente informação nova nem promessa. ' +
    'Marcas como [1] ou [2] e linhas com --- ficam exatamente onde estão.\n\n' +
    'O QUE TIRAR:\n' +
    '- ECO: frase que só repete ou comenta o que a cliente acabou de dizer ("Ver essa divisão dá receio mesmo", "Sentir o cabelo pesado incomoda bastante", "Arrependimento de corte acontece muito"). Corte a frase inteira. No máximo uma reação de poucas palavras, e só se a resposta anterior da atendente não começou com reação.\n' +
    '- "Entendo", "Entendo perfeitamente", "Imagino", "Pode ficar tranquila", "Fica tranquila" como abertura.\n' +
    '- "né?", "tá?", "tá bom?" no fim de frase.\n' +
    '- Comentário sobre a própria oferta: "o que ajuda muito", "uma ótima notícia", "olha que legal", "lembrando que", "aproveitando", "pra te ajudar".\n' +
    '- Superlativo e promessa: maravilhoso, incrível, perfeito, lindo demais, "devolve a autoestima na hora", "ninguém percebe".\n' +
    '- "justamente", "exatamente", listas de três, frase que serviria para qualquer cliente, fecho vazio ("vou ficar de olho!", "qualquer coisa me chama").\n' +
    '- Exclamação e emoji junto de preço, promoção ou convite.\n\n' +
    'COMO DEIXAR:\n' +
    '- A forma tem de ser DIFERENTE da resposta anterior da atendente (veja abaixo). Se a anterior foi comentário + pergunta, esta começa direto pelo conteúdo ou pela pergunta.\n' +
    '- Frases de tamanhos diferentes; pode haver uma bem curta. Primeira pessoa quando couber. "Olha," e "Então," no começo: só se nenhuma das últimas respostas da atendente começou assim.\n' +
    '- Se o rascunho traz a apresentação de assistente virtual do salão, mantenha essa frase inteira: a cliente precisa saber que fala com uma assistente virtual.\n' +
    '- Se a cliente contou algo pessoal ou triste (uma perda, um medo, uma data importante), uma frase curta de carinho fica; o que sai é repetir o que ela disse.\n' +
    '- Se o rascunho responde a uma pergunta da cliente, a resposta vem primeiro.\n' +
    '- Mantenha a pergunta do rascunho se ela for necessária para a conversa andar; não crie pergunta nova.\n' +
    '- Continua simpática e gentil. Não fique seca.\n\n' +
    '=== ÚLTIMAS RESPOSTAS DA ATENDENTE (para não repetir a forma) ===\n' + (iaAntes.join('\n') || '(nenhuma)') +
    '\n\n=== O QUE A CLIENTE ACABOU DE ESCREVER ===\n' + (e.cliente || '') +
    '\n\n=== RASCUNHO ===\n' + e.rascunho +
    '\n\nDevolva só o texto final, pronto para enviar.';
}

// Vale editar? Resposta vazia, curta, com marca de sistema ou de quem não está na lista sai como veio.
function valeEditar(e) {
  const t = String(e.rascunho || '').trim();
  const lista = (e.so_para || []).map((x) => String(x).replace(/\D/g, '').slice(-8)).filter((x) => x.length === 8);
  if (!lista.includes(String(e.telefone || '').replace(/\D/g, '').slice(-8))) return 'fora da lista';
  if (t.replace(/\s+/g, ' ').length < 40) return 'curta';
  if (/\[\[|\[SEM TEXTO\]/i.test(t)) return 'marca de sistema';
  return '';
}

// Escolhe entre o rascunho e o texto editado. Qualquer dúvida: rascunho.
function escolherFala(rascunho, editado) {
  const r = String(rascunho || ''), t = String(editado || '').trim();
  const conta = (s, re) => (s.match(re) || []).length;
  const fica = (motivo) => ({ texto: r, usou: 'rascunho', motivo });
  if (!t) return fica('editor sem resposta');
  if (fatos(t) !== fatos(r)) return fica('mexeu em número, horário, link ou e-mail');
  if (/assistente virtual/i.test(r) && !/assistente virtual/i.test(t)) return fica('tirou a apresentação');
  if (conta(t, /\?/g) > conta(r, /\?/g)) return fica('criou pergunta');
  if (conta(t, /^[ \t]*-{3,}[ \t]*$/gm) > conta(r, /^[ \t]*-{3,}[ \t]*$/gm)) return fica('criou balão');
  if (/\[\[|\]\]|===/.test(t)) return fica('trouxe marca do pedido');
  if (t.length > r.length * 1.2 + 40) return fica('ficou mais longo');
  if (t.length < r.length * 0.35) return fica('cortou demais');
  return { texto: t, usou: 'editado', motivo: '' };
}

module.exports = ({ workflow: wf, so_para = [] }) => {
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('fala-editor: sem o nó ' + nome); return n; };
  for (const nome of ['Agente IA', 'Quebrar mensagens', 'Montar entrada', 'Supabase: últimas mensagens', 'Entender mídia (Gemini)']) achar(nome);
  const gemini = achar('Entender mídia (Gemini)');
  const quebrar = achar('Quebrar mensagens');

  // o caminho de sempre (a primeira saída do agente) passa a vir depois da edição
  const saida = wf.connections['Agente IA']?.main?.[0];
  if (!saida || !saida.length) throw new Error('fala-editor: o "Agente IA" não tem saída');
  const seguinte = saida[0].node;
  if (seguinte !== 'Preço: ler pendência') throw new Error('fala-editor: esperava Agente IA -> Preço: ler pendência, achei ' + seguinte);

  const LER = "let t = ($('Agente IA').first().json.output || '')";
  if (quebrar.parameters.jsCode.split(LER).length !== 2) throw new Error('fala-editor: o "Quebrar mensagens" mudou (não lê mais a saída do Agente IA)');
  quebrar.parameters.jsCode = quebrar.parameters.jsCode.replace(LER, () => [
    "// segunda passada de fala (fala-editor.js): se a edição passou na conferência, sai o texto editado",
    "const falaEditada = (() => { try { const d = $('Fala: decidir').first().json; return d && d.usou === 'editado' && typeof d.texto === 'string' && d.texto.trim() ? d.texto : ''; } catch (e) { return ''; } })();",
    "let t = (falaEditada || $('Agente IA').first().json.output || '')",
  ].join('\n'));

  const idFixo = (nome) => { const h = crypto.createHash('md5').update(`fala-editor:${nome}`).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`; };
  const [x0, y0] = achar('Agente IA').position || [0, 0];
  const novo = (nome, type, typeVersion, i, parameters, extra = {}) => ({ id: idFixo(nome), name: nome, type, typeVersion, position: [x0 + 220 * i, y0 - 400], parameters, ...extra });
  const seguro = { onError: 'continueRegularOutput', alwaysOutputData: true };
  const FUNCOES = [fatos, pedidoEditor, valeEditar, escolherFala].map((f) => `const ${f.name} = ${f.toString()};`);

  const codPreparar = [
    ...FUNCOES,
    "const pega = (f, padrao) => { try { const v = f(); return v === undefined ? padrao : v; } catch (e) { return padrao; } };",
    "const rascunho = pega(() => $('Agente IA').first().json.output, '') || '';",
    "const entrada = pega(() => $('Montar entrada').first().json, {}) || {};",
    `const e = { rascunho, telefone: entrada.telefone, so_para: ${JSON.stringify(so_para)}, cliente: String(entrada.texto_cliente || '').slice(0, 2000) };`,
    "let porque = 'erro';",
    "try { porque = valeEditar(e); } catch (x) {}",
    "if (porque) return [{ json: { editar: false, porque } }];",
    "// últimas respostas da IA (a consulta vem da mais nova para a mais velha)",
    "e.iaAntes = pega(() => $('Supabase: últimas mensagens').all().map((i) => i.json).filter((m) => m && m.direcao === 'saida' && (!m.autor || m.autor === 'ia')).slice(0, 4).reverse().map((m) => String(m.conteudo || '').slice(0, 600)), []);",
    "let pedido = '';",
    "try { pedido = pedidoEditor(e); } catch (x) {}",
    "return [{ json: { editar: !!pedido, pedido } }];",
  ].join('\n');

  const codDecidir = [
    ...FUNCOES,
    "const rascunho = (() => { try { return $('Agente IA').first().json.output || ''; } catch (e) { return ''; } })();",
    "const g = $input.first().json || {};",
    "const partes = (((((g || {}).candidates || [])[0] || {}).content || {}).parts || []);",
    "const editado = partes.filter((p) => p && !p.thought).map((p) => p.text || '').join('').trim();",
    "let r; try { r = escolherFala(rascunho, editado); } catch (e) { r = { texto: rascunho, usou: 'rascunho', motivo: 'erro ao escolher' }; }",
    "if (g.error && r.usou !== 'editado') r.motivo = 'erro do Gemini: ' + String(g.error.message || g.error).slice(0, 150);",
    "return [{ json: { ...r, rascunho } }];",
  ].join('\n');

  wf.nodes.push(
    novo('Fala: preparar', 'n8n-nodes-base.code', 2, 1, { jsCode: codPreparar }, seguro),
    novo('Fala: editar?', 'n8n-nodes-base.if', 2.2, 2, {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'c1', leftValue: '={{ $json.editar === true }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {},
    }),
    novo('Fala: editar (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, 3, {
      method: 'POST', url: gemini.parameters.url,
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
      sendBody: true, specifyBody: 'json',
      // raciocínio baixo: a saída (com o "pensamento") é a parte cara da conta
      jsonBody: "={{ JSON.stringify({ contents: [{ parts: [{ text: $json.pedido }] }], generationConfig: { temperature: 0.7, thinkingConfig: { thinkingLevel: 'low' } } }) }}",
      options: { timeout: 20000 },
    }, { ...(gemini.credentials ? { credentials: gemini.credentials } : {}), ...seguro }),
    novo('Fala: decidir', 'n8n-nodes-base.code', 2, 4, { jsCode: codDecidir }, seguro),
  );

  saida[0] = { node: 'Fala: preparar', type: 'main', index: 0 };
  const para = (no) => [{ node: no, type: 'main', index: 0 }];
  wf.connections['Fala: preparar'] = { main: [para('Fala: editar?')] };
  wf.connections['Fala: editar?'] = { main: [para('Fala: editar (Gemini)'), para(seguinte)] };
  wf.connections['Fala: editar (Gemini)'] = { main: [para('Fala: decidir')] };
  wf.connections['Fala: decidir'] = { main: [para(seguinte)] };
};

Object.assign(module.exports, { fatos, pedidoEditor, valeEditar, escolherFala });
