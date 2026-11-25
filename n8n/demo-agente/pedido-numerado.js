// Pedido numerado (fase C do orquestrador; só nas lojas com "pedido_numerado": true no loja.json; a Gleide não passa
// por aqui). Erro 7 do relatório da Carol (docs/relatorio-ia/v2/montado/1-erros.html): a IA disse "vou confirmar com a
// Caroline" e ninguém voltou; no outro dia a cliente: "moça, puxa a conversa de ontem… você ficou de confirmar".
// Plano: docs/PLANO-CORRECOES-E-AGENDA-COLADA.md (Lote 4, item 7) e docs/PLANO-PEDIDOS-PARA-GLEIDE.md.
//
// O que muda (nenhuma mensagem nova para a dona; a regra de só perguntar caso difícil, seção 31 do prompt, continua):
//   1. Cada pergunta da IA à dona (perguntar_para_gleide) ganha um NÚMERO curto e estável (#11, #12…), guardado no
//      pedido do Redis. A mensagem ❓ mostra "Responda: 27 sim / 27 não / 27 + o que digo a ela" (o Responder citado
//      continua valendo). Os números começam no 11: "2 clientes amanhã" nunca vira resposta de pedido.
//   2. A dona escreve "27 sim", "27 R$ 30", "27 pode marcar" sem citar: o principal acha o pedido pelo número (índice
//      no Redis, só para os números da dona) e segue a mesma corrente da resposta citada (Gemini → cliente → "Avisei").
//      Número que não é de pedido aberto segue para a assistente, como antes.
//   3. Pedido aberto sem resposta entra, com o número, na mensagem das pendências (pendencias_horas; cada pedido UMA
//      vez, no primeiro horário da lista que passa 30 min depois da pergunta) e no resumo da noite (resumo_noite, só
//      se o resumo já ia sair). Sem lembrete extra.
//   4. A ficha "Sobre esta cliente" ganha a linha do pedido aberto: se a cliente cobrar, a IA diz que ainda está vendo
//      e não pergunta de novo. Trava no subworkflow: com pedido aberto da mesma cliente, perguntar_para_gleide NÃO
//      manda outra pergunta à dona (devolve JÁ PERGUNTADO). Isso só diminui perguntas.
//
// Tudo no Redis, com as chaves de pedido (prefixo da loja pelo lojas.paraLoja): pedido:{id da mensagem} (já existia,
// agora com num e criado), pedido:contador (INCR, sem prazo) e pedido:n{num} (índice → id da mensagem, 3 dias).
// Os leitores antigos de pedido:* (assistente) ignoram o contador e o índice: não têm empresa nem telefone.
// Sem migração no banco.
//
// Chamado no montar-workflow.js, dentro do "if (LOJA)", depois dos outros módulos e antes do lojas.paraLoja
// (troca "Gleide" e $env.EMPRESA_ID). Troca textos com conferência: se o código esperado mudou, para com erro.

const crypto = require('crypto');

const uuid = (nome) => {
  const h = crypto.createHash('md5').update('pedido-numerado:' + nome).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// número da dona sem o 9 da frente (o jeito que o WhatsApp manda), para comparar
const SEM9 = "((n) => { const d = String(n || '').split('@')[0].replace(/\\D/g, ''); return /^55\\d{2}9\\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d; })";
// "27 sim", "#27: pode", "27 - R$ 30" → '27'. Hora, data, quantidade ("9 horas", "30 reais", "27 de dezembro") → ''.
const NUMERO_DA_RESPOSTA = "((t) => { const m = /^\\s*#?(\\d{1,3})(?:\\s*[-–—)]\\s*|\\s*:\\s+|\\s+)(\\S[\\s\\S]*)$/.exec(String(t || '')); " +
  "if (!m) return ''; if (/^(?:[\\/:%]|(?:h|hs|hr|hrs|hora|horas|min|minuto|minutos|reais|real|dia|dias|vez|vezes|x|cm|kg|g|anos?)(?![a-zà-ú])|de\\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez))/i.test(m[2])) return ''; return m[1]; })";

module.exports = ({ workflow: W, perguntaWorkflow: P, pendenciasWorkflow: PEND, faltasWorkflow: FALTAS, assistenteWorkflow: A, loja }) => {
  if (!loja || !loja.dona) throw new Error('pedido_numerado: só para loja (loja.json)');
  const DONA = loja.dona;
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`pedido_numerado: não achei "${nome}" em ${wf.name}`); return n; };
  const trocar = (no, campo, de, para) => {
    const atual = String(no.parameters[campo] || '');
    const vezes = atual.split(de).length - 1;
    if (vezes !== 1) throw new Error(`pedido_numerado: o texto de "${no.name}" mudou (esperava 1 vez, achei ${vezes}): ${de.slice(0, 60)}`);
    no.parameters[campo] = atual.replace(de, () => para);
  };
  const liga = (wf, de, para) => { wf.connections[de] = { main: [[{ node: para, type: 'main', index: 0 }]] }; };
  const redisDe = (wf, nome) => { const r = wf.nodes.find((n) => n.type === 'n8n-nodes-base.redis' && n.credentials); if (!r) throw new Error(`pedido_numerado: sem credencial do Redis em ${nome}`); return r.credentials; };
  const redis = (wf, nome, position, parameters, extra = {}) => ({ id: uuid(wf.name + ':' + nome), name: nome, type: 'n8n-nodes-base.redis', typeVersion: 1, position, parameters,
    credentials: redisDe(wf, nome), onError: 'continueRegularOutput', ...extra });
  const LER_ABERTOS = { operation: 'keys', keyPattern: 'pedido:*', getValues: true };
  // lista de pedidos de verdade (o contador e o índice não têm empresa nem telefone)
  const PEDIDOS_DE = (o) => `Object.values(${o} || {}).map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } })` +
    ".filter((p) => p && typeof p === 'object' && p.empresa === $env.EMPRESA_ID && p.telefone && p.pergunta)";

  // =============== 1. Subworkflow "Perguntar para a Gleide": número, trava e índice ===============
  const recebe = achar(P, 'Recebe pergunta da IA');
  const alerta = achar(P, 'Supabase: número de alerta');
  const enviar = achar(P, 'Enviar pergunta à Gleide');
  const guardar = achar(P, 'Guardar pedido');
  const memoria = achar(P, 'Memória da assistente');
  achar(P, 'Resposta');
  if (P.connections['Recebe pergunta da IA']?.main?.[0]?.[0]?.node !== alerta.name) throw new Error('pedido_numerado: o começo do "Perguntar" mudou');
  if (P.connections['Supabase: número de alerta']?.main?.[0]?.[0]?.node !== enviar.name) throw new Error('pedido_numerado: "número de alerta" não leva mais ao envio');
  if (P.connections['Guardar pedido']?.main?.[0]?.[0]?.node !== memoria.name) throw new Error('pedido_numerado: "Guardar pedido" não leva mais à memória');

  const R = "$('Recebe pergunta da IA').first().json";
  const NUM = "(() => { try { const v = Number(Object.values($('Pedido nº: contador').first().json || {})[0]); return v > 0 ? v + 10 : 0; } catch (e) { return 0; } })()";
  const [rx, ry] = recebe.position;
  P.nodes.push(
    redis(P, 'Pedido nº: abertos', [rx + 110, ry + 220], LER_ABERTOS, { alwaysOutputData: true, executeOnce: true }),
    { id: uuid('P:conferir'), name: 'Pedido nº: já tem aberto?', type: 'n8n-nodes-base.code', typeVersion: 2, position: [rx + 330, ry + 220], parameters: { jsCode: [
      '// pedido-numerado.js: esta cliente já tem pergunta à dona sem resposta? Então não manda outra (a dona reclama de pergunta demais)',
      `const r = ${R};`,
      "const fim8 = (t) => String(t || '').replace(/\\D/g, '').slice(-8);",
      "const aviso = (t) => /^AVISO/i.test(String(t || ''));",
      `const meus = ${PEDIDOS_DE("$('Pedido nº: abertos').first().json")}.filter((p) => fim8(p.telefone) === fim8(r.telefone) && (p.tipo || 'pergunta') === (r.tipo || 'pergunta'))`,
      '  // AVISO não espera resposta: não segura pergunta nenhuma; só segura outro AVISO da mesma cliente nas últimas 6 h',
      '  // (o aviso "não vem" do nao-vem.js sai antes da IA responder: o AVISO dela sobre o mesmo assunto não sai repetido)',
      '  .filter((p) => (aviso(r.pergunta) ? aviso(p.pergunta) && Date.now() - (p.criado || 0) < 6 * 3600e3 : !aviso(p.pergunta)));',
      'return [{ json: { aberto: meus.sort((a, b) => (b.criado || 0) - (a.criado || 0))[0] || null } }];',
    ].join('\n') } },
    { id: uuid('P:if'), name: 'Pedido nº: perguntar?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [rx + 550, ry + 220], parameters: {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'pn1', leftValue: '={{ !$json.aberto }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {} } },
    { id: uuid('P:ja'), name: 'Pedido nº: já perguntado', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [rx + 770, ry + 400], parameters: {
      assignments: { assignments: [{ id: 'a-resposta', name: 'resposta', type: 'string', value: "={{ (() => { const p = $('Pedido nº: já tem aberto?').first().json.aberto || {}; if (/^AVISO/i.test(String(p.pergunta || ''))) return 'AVISO JÁ DADO: a " + DONA +
        " já recebeu este aviso. NÃO mandei outro. Não fale disso com a cliente; siga o atendimento normalmente.'; return 'JÁ PERGUNTADO: esta cliente já tem uma pergunta com a " + DONA +
        "' + (p.num ? ' (pedido #' + p.num + ')' : '') + ', ainda sem resposta: \"' + p.pergunta + '\". NÃO mandei outra pergunta. Diga à cliente, numa frase, que ainda está vendo isso com a " + DONA +
        " e que avisa por aqui assim que ela responder. Não invente a resposta. Se for um problema novo e sério com o atendimento, use transferir_para_humano.'; })() }}" }] },
      options: {} } },
    redis(P, 'Pedido nº: contador', [alerta.position[0] + 110, alerta.position[1] + 220], { operation: 'incr', key: "=pedido:{{ 'contador' }}", expire: false }),
    redis(P, 'Pedido nº: guardar índice', [guardar.position[0] + 110, guardar.position[1] + 220], {
      operation: 'set', key: `=pedido:{{ $('Enviar pergunta à Gleide').first().json.key?.id && ${NUM} ? 'n' + ${NUM} : 'sem-numero' }}`, expire: true, ttl: 259200,
      value: `={{ JSON.stringify({ msg: $('Enviar pergunta à Gleide').first().json.key?.id || '', num: ${NUM}, para: [...new Set([$('Supabase: número de alerta').first().json.alerta, ...String($env.ASSISTENTE_NUMEROS || '').split(',')].map(${SEM9}).filter(Boolean))] }) }}`,
    }),
  );
  liga(P, 'Recebe pergunta da IA', 'Pedido nº: abertos');
  liga(P, 'Pedido nº: abertos', 'Pedido nº: já tem aberto?');
  liga(P, 'Pedido nº: já tem aberto?', 'Pedido nº: perguntar?');
  P.connections['Pedido nº: perguntar?'] = { main: [[{ node: alerta.name, type: 'main', index: 0 }], [{ node: 'Pedido nº: já perguntado', type: 'main', index: 0 }]] };
  liga(P, 'Supabase: número de alerta', 'Pedido nº: contador');
  liga(P, 'Pedido nº: contador', enviar.name);
  liga(P, 'Guardar pedido', 'Pedido nº: guardar índice');
  liga(P, 'Pedido nº: guardar índice', memoria.name);
  // o envio vinha logo depois do "número de alerta" ($json); agora vem depois do contador
  trocar(enviar, 'jsonBody', 'number: $json.alerta,', "number: $('Supabase: número de alerta').first().json.alerta,");
  // 24/11 (Victor: "olha o tanto de texto"): a pergunta à dona fica curta, sem "Pergunta da cliente" e sem
  // "Responda: 27 sim / 27 não / 27 + o que digo a ela / (ou toque em Responder...)". Ela responde do jeito dela.
  trocar(enviar, 'jsonBody', "'❓ Pergunta da cliente '", `'❓ ' + (${NUM} ? '#' + ${NUM} + ' ' : '')`);
  trocar(enviar, 'jsonBody', "'\\n\\n↩️ Toque em Responder nesta mensagem e escreva o que digo a ela.'", "''");
  trocar(guardar, 'value', 'empresa: $env.EMPRESA_ID }) }}', `empresa: $env.EMPRESA_ID, num: ${NUM} || null, criado: $now.toMillis() }) }}`);
  trocar(memoria, 'messageData', "'Perguntei à Gleide sobre '", `'Perguntei à Gleide ' + (${NUM} ? '(pedido #' + ${NUM} + ') ' : '') + 'sobre '`);

  // =============== 2. Principal: "27 sim" sem citar ===============
  const E = "$('Extrair dados').first().json";
  achar(W, 'Extrair dados');
  const procurar = achar(W, 'Pedido: procurar');
  const preparar = achar(W, 'Pedido: preparar');
  const apagar = achar(W, 'Pedido: apagar');
  achar(W, 'Pedido: confirmar à Gleide');
  if (W.connections['Extrair dados']?.main?.[0]?.length !== 1 || W.connections['Extrair dados'].main[0][0].node !== 'Pedido: procurar') throw new Error('pedido_numerado: "Extrair dados" não leva mais a "Pedido: procurar"');
  if (W.connections['Pedido: apagar']?.main?.[0]?.[0]?.node !== 'Pedido: confirmar à Gleide') throw new Error('pedido_numerado: o fim da corrente do pedido mudou');
  // o índice só é lido para mensagem sem citação que começa com número; só vale se veio de um número da dona
  const ACHADO = `(() => { try { const i = JSON.parse($('Pedido nº: índice').first().json.indice || 'null'); return i && i.msg && [].concat(i.para || []).includes(${SEM9}(${E}.telefone)) ? i.msg : ''; } catch (e) { return ''; } })()`;
  W.nodes.push(redis(W, 'Pedido nº: índice', [procurar.position[0] - 110, procurar.position[1] - 160], {
    operation: 'get', key: `=pedido:{{ (() => { const e = ${E}; if (e.citado || e.fromMe) return 'nenhum'; const n = ${NUMERO_DA_RESPOSTA}(e.texto); return n ? 'n' + Number(n) : 'nenhum'; })() }}`,
    propertyName: 'indice', keyType: 'string', options: {},
  }));
  liga(W, 'Extrair dados', 'Pedido nº: índice');
  liga(W, 'Pedido nº: índice', 'Pedido: procurar');
  trocar(procurar, 'key', `=pedido:{{ ${E}.citado || 'nenhum' }}`, `=pedido:{{ ${E}.citado || ${ACHADO} || 'nenhum' }}`);
  trocar(apagar, 'key', `=pedido:{{ ${E}.citado }}`, `=pedido:{{ ${E}.citado || ${ACHADO} || 'nenhum' }}`);
  // "27 sim" → a resposta é "sim" (só tira o número quando é o do pedido)
  trocar(preparar, 'jsCode', "const resposta = $('Extrair dados').first().json.texto.trim();", String.raw`const resposta = (() => { // pedido-numerado.js: "27 sim" -> "sim"
  const t = $('Extrair dados').first().json.texto.trim();
  if (!p.num) return t;
  const m = new RegExp('^#?' + p.num + '(?!\\d)(?:\\s*[-–—)]\\s*|\\s*:\\s*|\\s+)').exec(t);
  return m && t.slice(m[0].length).trim() ? t.slice(m[0].length).trim() : t;
})();`);
  W.nodes.push(redis(W, 'Pedido nº: apagar índice', [apagar.position[0] + 110, apagar.position[1] + 160], {
    operation: 'delete', key: "=pedido:{{ $('Pedido: preparar').first().json.num ? 'n' + $('Pedido: preparar').first().json.num : 'nenhum' }}",
  }));
  liga(W, 'Pedido: apagar', 'Pedido nº: apagar índice');
  liga(W, 'Pedido nº: apagar índice', 'Pedido: confirmar à Gleide');

  // =============== 4. Ficha "Sobre esta cliente": pedido aberto ===============
  const sobre = achar(W, 'Sobre esta cliente');
  achar(W, 'Montar entrada');
  const antes = Object.entries(W.connections).filter(([, c]) => (c.main || []).some((s) => (s || []).some((l) => l.node === 'Sobre esta cliente')));
  if (antes.length !== 1) throw new Error(`pedido_numerado: esperava 1 nó antes de "Sobre esta cliente", achei ${antes.length}`);
  const LER_FICHA = 'Pedido nº: abertos da cliente';
  W.nodes.push(redis(W, LER_FICHA, [sobre.position[0] - 220, sobre.position[1] + 400], LER_ABERTOS, { alwaysOutputData: true, executeOnce: true }));
  for (const s of antes[0][1].main) for (const l of s || []) if (l.node === 'Sobre esta cliente') l.node = LER_FICHA;
  liga(W, LER_FICHA, 'Sobre esta cliente');
  trocar(sobre, 'jsCode', 'const JA_FALOU = RECADO_TXT + SAIDAS_TXT + (ultimaIA ? ', [
    '// pedido-numerado.js: pergunta que a IA fez à ' + DONA + ' por esta cliente e que ainda não teve resposta',
    "let PEDIDO_TXT = '';",
    'try {',
    "  const fim8 = (t) => String(t || '').replace(/\\D/g, '').slice(-8);",
    "  const eu = fim8($('Montar entrada').first().json.telefone);",
    // AVISO não é pergunta: a IA não disse à cliente que ia confirmar nada (aviso "não vem", reparo, voucher)
    `  const meus = ${PEDIDOS_DE(`$('${LER_FICHA}').first().json`)}.filter((p) => fim8(p.telefone) === eu && !/^AVISO/i.test(String(p.pergunta || ''))).sort((a, b) => (a.criado || 0) - (b.criado || 0));`,
    "  if (meus.length) PEDIDO_TXT = '\\nPERGUNTA À " + DONA.toUpperCase() + " AINDA SEM RESPOSTA: ' + meus.map((p) => (p.num ? '#' + p.num + ' ' : '') + '«' + p.pergunta + '»' +",
    "    (p.criado ? ' (perguntada em ' + DateTime.fromMillis(p.criado).setZone(TZ).toFormat(\"dd/LL 'às' HH:mm\") + ')' : '')).join(' · ') +",
    "    '\\nVocê disse a ela que ia confirmar isso com a " + DONA + ". Se ela perguntar disso ou cobrar (\"conseguiu ver?\", \"e aí?\", \"ficou de confirmar\"), diga em uma frase que ainda está vendo com a " + DONA +
      " e que avisa por aqui assim que ela responder. NÃO use perguntar_para_gleide de novo para isso, não invente a resposta e não diga que a " + DONA + " já respondeu. A resposta dela chega sozinha à cliente.';",
    '} catch (e) {}',
    'const JA_FALOU = PEDIDO_TXT + RECADO_TXT + SAIDAS_TXT + (ultimaIA ? ',
  ].join('\n'));

  // =============== 3a. Pendências (12h/18h): cada pedido uma vez ===============
  if (loja.pendencias_horas && PEND) {
    const hs = [].concat(loja.pendencias_horas).map(Number).sort((a, b) => a - b);
    const novas = achar(PEND, 'Pendências novas');
    const msg = achar(PEND, 'Montar mensagem');
    if (!String(novas.parameters.url).includes('n8n_assistente_pendencias_uma_vez')) throw new Error('pedido_numerado: aplique pendencias-loja.js antes (pendencias_horas)');
    const LER_PEND = 'Pedido nº: abertos (pendências)';
    const inicios = Object.entries(PEND.connections).filter(([, c]) => (c.main || []).some((s) => (s || []).some((l) => l.node === 'Pendências novas')));
    if (inicios.length !== 2) throw new Error(`pedido_numerado: esperava 2 começos antes de "Pendências novas", achei ${inicios.length}`);
    for (const [, c] of inicios) for (const s of c.main) for (const l of s || []) if (l.node === 'Pendências novas') l.node = LER_PEND;
    PEND.nodes.push(redis(PEND, LER_PEND, [novas.position[0] - 110, novas.position[1] + 200], LER_ABERTOS, { alwaysOutputData: true, executeOnce: true }));
    liga(PEND, LER_PEND, 'Pendências novas');
    // sem pendência no banco a leitura volta vazia: precisa seguir para os pedidos entrarem
    novas.alwaysOutputData = true;
    trocar(msg, 'jsCode', 'const ps = $input.all().map((i) => i.json).filter((p) => p.tipo);\nif (!ps.length) return [];', [
      'const ps = $input.all().map((i) => i.json).filter((p) => p.tipo);',
      `// pedido-numerado.js: pergunta da IA sem resposta entra UMA vez, no 1º horário da lista (${hs.join('h, ')}h) que passa 30 min depois dela`,
      'const PEDIDOS = (() => { try {',
      `  const HS = ${JSON.stringify(hs)};`,
      "  const agora = Date.now(); const h = new Date(agora - 4 * 3600e3).getUTCHours();",
      '  if (!HS.includes(h)) return [];',
      '  const slot = Math.floor(agora / 3600e3) * 3600e3;',
      '  const antes = HS.filter((x) => x < h);',
      '  const anterior = antes.length ? slot - (h - antes[antes.length - 1]) * 3600e3 : slot - (h + 24 - HS[HS.length - 1]) * 3600e3;',
      `  return ${PEDIDOS_DE(`$('${LER_PEND}').first().json`)}.filter((p) => p.criado && p.criado < slot - 30 * 60e3 && p.criado >= anterior - 30 * 60e3).sort((a, b) => (a.num || 0) - (b.num || 0));`,
      '} catch (e) { return []; } })();',
      'if (!ps.length && !PEDIDOS.length) return [];',
    ].join('\n'));
    trocar(msg, 'jsCode', "const texto = ps.length === 1 ? linha(ps[0]).replace(/^• /, '') : ps.map(linha).join('\\n'); // pendencias-loja.js: só a pergunta", [
      "const nomeP = (p) => String(p.nome || 'cliente').split(' ').filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w)).slice(0, 2).join(' ');",
      "const linhaPedido = (p) => '• ' + (p.num ? '*#' + p.num + '* ' : '') + '*' + nomeP(p) + '* ainda espera sua resposta: ' + p.pergunta;",
      "const LINHAS = ps.map(linha).concat(PEDIDOS.filter((p) => !/^AVISO/i.test(String(p.pergunta || ''))).map(linhaPedido));", // AVISO não espera resposta (24/11)
      "const texto = LINHAS.length === 1 ? LINHAS[0].replace(/^• /, '') : LINHAS.join('\\n'); // pendencias-loja.js: só a pergunta; pedido-numerado.js: e os pedidos",
    ].join('\n'));
  }

  // =============== 3c. Assistente: pedido respondido por ela sai da lista ===============
  // Na loja a chave é "<slug>:pedido:…" (o original só aceitava "pedido:…" no começo e o pedido ficava aberto 3 dias).
  // Conta como respondido quando a assistente, no pedido da dona:
  //   - mandou mensagem à cliente (chamar_cliente / avisar_cliente), como antes;
  //   - ou mexeu no horário ou na ficha da cliente sem mandar mensagem (25/11, Rebeca #14: a Caroline respondeu "pode
  //     reservar", a assistente regravou o horário e anotou, e o #14 foi cobrado de novo às 18h e no outro dia ao meio-dia).
  //     A cliente é achada pelos dados que as ferramentas devolveram: final do telefone e primeiro nome.
  if (A) {
    const resp = achar(A, 'Pedidos respondidos');
    if (!/if \(!tels\.length\) return \[\];/.test(resp.parameters.jsCode)) throw new Error('pedido_numerado: o "Pedidos respondidos" mudou');
    resp.parameters.jsCode = [
      "const passos = $('Agente assistente').first().json.intermediateSteps || [];",
      "const lerResposta = (o) => { const t = typeof o === 'string' ? o : JSON.stringify(o || ''); try { const j = JSON.parse(t); const x = Array.isArray(j) ? j[0] : j; if (x && typeof x.resposta === 'string') return x.resposta; } catch (e) {} return t; };",
      "const so = (t) => String(t || '').replace(/\\D/g, '');",
      "const nome1 = (t) => String(t || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().trim().split(/\\s+/)[0] || '';",
      "const ok = (s) => /^\\s*OK\\b/.test(lerResposta(s.observation));",
      "// objetos que a ferramenta devolveu depois de \"OK:\" (antes do quadro da Google, que vem depois de uma linha em branco)",
      "const objs = (s) => { const m = /^\\s*OK:\\s*([\\s\\S]*?)(?:\\n\\n|$)/.exec(lerResposta(s.observation)); if (!m) return []; try { const j = JSON.parse(m[1]); return (Array.isArray(j) ? j : [j]).filter((x) => x && typeof x === 'object'); } catch (e) { return []; } };",
      "// 1. mensagem para a cliente: o telefone vem na resposta",
      "const tels = passos.filter((s) => ['chamar_cliente', 'avisar_cliente'].includes(s.action?.tool)).map((s) => lerResposta(s.observation))",
      "  .map((r) => (/^\\s*OK\\b[^(]*\\(tel\\. (\\d+)\\)/.exec(r) || [])[1]).filter(Boolean).map((t) => so(t).slice(-8));",
      "// 2. horário ou ficha da cliente mexidos: final do telefone e primeiro nome (do que a ferramenta devolveu ou da cliente já vista nesta conversa)",
      "const vistas = passos.flatMap(objs);",
      "const MEXE = ['marcar_horario', 'reagendar', 'ajustar_duracao', 'excluir_horario', 'liberar_horario', 'anotar'];",
      "const mexidas = passos.filter((s) => MEXE.includes(s.action?.tool) && ok(s)).flatMap((s) => {",
      "  const e = s.action.toolInput || {};",
      "  const ligadas = vistas.filter((o) => (e.cliente_id && o.cliente_id === e.cliente_id) || (e.agendamento_id && o.agendamento_id === e.agendamento_id));",
      "  return [...objs(s), ...ligadas].map((o) => ({ fim: so(o.tel_final || o.telefone).slice(-4), nome: nome1(o.nome || e.cliente_nome) })).filter((x) => x.fim.length === 4);",
      "});",
      "if (!tels.length && !mexidas.length) return [];",
      "const abertos = $('Ler pedidos abertos').first().json || {};",
      "return Object.entries(abertos).filter(([k, v]) => {",
      "  try {",
      "    const p = typeof v === 'string' ? JSON.parse(v) : v;",
      "    if (!/(^|:)pedido:[^:]+$/.test(k) || !p || !p.pergunta) return false;",
      "    const t = so(p.telefone);",
      "    return tels.includes(t.slice(-8)) || mexidas.some((x) => t.endsWith(x.fim) && (!x.nome || !p.nome || x.nome === nome1(p.nome)));",
      "  } catch (e) { return false; }",
      "}).map(([k]) => ({ json: { chave: k } }));",
    ].join('\n');
  }

  // =============== 3b. Resumo da noite: pedidos ainda abertos ===============
  if (loja.resumo_noite && FALTAS) {
    const montar = achar(FALTAS, 'Resumo: montar');
    const google = achar(FALTAS, 'Resumo: ler Google');
    if (FALTAS.connections['Resumo: ler Google']?.main?.[0]?.[0]?.node !== 'Resumo: montar') throw new Error('pedido_numerado: o resumo da noite mudou');
    const LER_RES = 'Resumo: pedidos abertos';
    FALTAS.nodes.push(redis(FALTAS, LER_RES, [google.position[0] + 110, google.position[1] + 200], LER_ABERTOS, { alwaysOutputData: true, executeOnce: true }));
    liga(FALTAS, 'Resumo: ler Google', LER_RES);
    liga(FALTAS, LER_RES, 'Resumo: montar');
    trocar(montar, 'jsCode', 'if (googleFalhou) faltas.push(', [
      '// pedido-numerado.js: pergunta da IA à dona ainda sem resposta (há mais de 30 min), com o número',
      'try {',
      `  for (const p of ${PEDIDOS_DE(`$('${LER_RES}').first().json`)}.filter((p) => (!p.criado || Date.now() - p.criado > 30 * 60e3) && !/^AVISO/i.test(String(p.pergunta || ''))).sort((a, b) => (a.num || 0) - (b.num || 0)))`,
      "    faltas.push('• ' + (p.num ? '#' + p.num + ' ' : '') + curto(p.nome || 'cliente') + ' ainda espera sua resposta: ' + p.pergunta);",
      '} catch (e) {}',
      'if (googleFalhou) faltas.push(',
    ].join('\n'));
  }
};
