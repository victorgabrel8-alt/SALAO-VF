// Uma voz só com a cliente (loja.json "voz_unica": true; a Gleide não passa por aqui). Pedido do Victor, 25/11/2026.
//
// Antes, duas partes escreviam para a mesma cliente: a IA de atendimento, no jeito da Caroline, e a assistente da dona
// (chamar_cliente / avisar_cliente), com texto próprio. A IA não ficava sabendo o que a assistente mandou (só um "aviso do
// salão" na ficha). Caso Gabriela, 25/11: às 9h37 a IA ofereceu sábado com a Duda às 8h; às 9h52 e 10h02 a assistente
// ofereceu sexta 13h ou 13h30.
//
// Agora, no fluxo de ferramentas da assistente, antes de gravar e mandar:
//   1. lê a ficha (cliente ou horário) e a conversa da cliente dos últimos 7 dias;
//   2. a IA de atendimento escreve a mensagem a partir do PEDIDO da Caroline (o texto que a assistente passou), no tom
//      da seção "O JEITO ..." do prompt-agente.md da loja (lido daqui, uma fonte só), sem contar o que a Caroline disse;
//   3. se a cliente já disse algo que muda o pedido, a IA responde "CONFERIR: ..." e nada sai (volta para a assistente
//      contar à Caroline);
//   4. o resto segue igual (gravar o contato, as travas do envio, mandar, registrar na conversa) e, depois de mandar, a
//      mensagem entra na memória da IA de atendimento: quando a cliente responde, a IA sabe o que foi dito.
// Texto ditado pela Caroline, endereço e chave Pix (ditado = sim) saem como estão. Se o Gemini falhar, segue o texto da
// assistente, com as mesmas travas do envio.

const fs = require('fs');
const path = require('path');

module.exports = ({ node, ifNode, cond, ferramentasWorkflow: F, assistenteWorkflow: A, loja, GEMINI, GEMINI_HTTP }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('voz-unica: não achei "' + nome + '"'); return n; };
  const main = (...para) => ({ main: [para.map((n) => ({ node: n, type: 'main', index: 0 }))] });

  // ---------- o tom: a seção "O JEITO ..." do prompt da IA de atendimento da loja ----------
  const promptIA = fs.readFileSync(path.join(__dirname, 'lojas', loja.slug, 'prompt-agente.md'), 'utf8').replace(/\r\n/g, '\n');
  const secao = /^## \d+\. O JEITO[^\n]*\n([\s\S]*?)(?=\n## \d+\.)/m.exec(promptIA);
  if (!secao) throw new Error('voz-unica: não achei a seção "## N. O JEITO ..." no prompt-agente.md da loja');
  const TOM = secao[1].trim();

  // ---------- campo "ditado" nas duas ferramentas ----------
  const entrada = F.nodes.find((n) => /executeWorkflowTrigger/.test(n.type));
  if (!entrada?.parameters?.workflowInputs?.values) throw new Error('voz-unica: a entrada das ferramentas mudou');
  if (!entrada.parameters.workflowInputs.values.some((x) => x.name === 'ditado')) entrada.parameters.workflowInputs.values.push({ name: 'ditado' });
  const TEXTO = {
    chamar_cliente: 'O PEDIDO da Caroline para a cliente: o que dizer, com dia, hora e serviço que ela disse. Não é a mensagem pronta: quem escreve para a cliente é a IA de atendimento. Com ditado = sim, as palavras exatas dela',
    avisar_cliente: 'Vazio para horário mudado ou remarcação (a IA de atendimento escreve). Outro aviso: o PEDIDO da Caroline (o que dizer), não a mensagem pronta',
  };
  const DESC = {
    chamar_cliente: 'A IA de atendimento escreve, no jeito da Caroline, e manda pelo número do salão a mensagem que a Caroline pediu para uma cliente, sem precisar de horário. Use quando a Caroline pediu para falar com a cliente (o pedido dela já é o sim).',
    avisar_cliente: 'A IA de atendimento escreve e manda à cliente, pelo número do salão, o aviso sobre um horário dela. Use quando a Caroline pediu (o pedido dela já é o sim).',
  };
  for (const nome of ['chamar_cliente', 'avisar_cliente']) {
    const t = achar(A, nome);
    const w = t.parameters.workflowInputs;
    if (!/\$fromAI\('texto'/.test(String(w.value.texto))) throw new Error('voz-unica: o campo texto de ' + nome + ' mudou');
    w.value.texto = "={{ $fromAI('texto', `" + TEXTO[nome] + "`, 'string') }}";
    w.value.ditado = "={{ $fromAI('ditado', `sim só quando a Caroline ditou as palavras exatas, ou é o endereço ou a chave Pix; vazio no resto`, 'string') }}";
    if (!w.schema.some((x) => x.id === 'ditado')) w.schema.push({ ...w.schema.find((x) => x.id === 'texto'), id: 'ditado', displayName: 'ditado' });
    t.parameters.description = DESC[nome];
  }

  // ---------- 1 a 3: a IA escreve antes de gravar e mandar ----------
  const banco = achar(F, 'Executar no banco');
  const modeloGet = achar(F, 'Envio: conversa da cliente');
  const supaGet = (nome, url, pos) => node(nome, 'n8n-nodes-base.httpRequest', 4.2, pos, {
    method: 'GET', url, sendHeaders: true, headerParameters: modeloGet.parameters.headerParameters, options: { timeout: 15000 },
  }, { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
  const [bx, by] = banco.position;
  const ARGS = "$('Montar chamada').first().json.args";
  const NADA = '00000000-0000-0000-0000-000000000000';
  const PEDIDO_IN = "$('Recebe pedido da assistente').first().json";

  const PREPARAR = String.raw`
const TZ = 'America/Cuiaba';
const e = $('Recebe pedido da assistente').first().json;
const m = $('Montar chamada').first().json;
const q = $('Voz: quem é').first().json || {};
const cli = q.cliente || q;
const nome = String(cli.nome || '').trim().split(/\s+/)[0];
const ficha = String(cli.observacoes || '').replace(/\s+/g, ' ').trim().slice(0, 500);
const quando = (s) => DateTime.fromISO(s).setZone(TZ).setLocale('pt-BR');
const msgs = $('Voz: conversa').all().map((i) => i.json).filter((x) => x && x.criado_em).reverse();
const conversa = msgs.map((x) => quando(x.criado_em).toFormat('dd/LL HH:mm') + ' ' + (x.autor === 'cliente' ? 'ela' : 'studio') + ': ' +
  String(x.conteudo || '[' + (x.tipo || 'mensagem') + ']').replace(/\s+/g, ' ').slice(0, 300)).join('\n');
const hora = (d) => (d.minute ? d.toFormat("H'h'mm") : d.toFormat("H'h'"));
let pedido = String(m.args.p_texto || '').trim();
// avisar_cliente sem texto: o pedido sai do horário (remarcação: a Caroline não vai atender; aviso: o horário mudou)
if (!pedido && e.acao === 'avisar_cliente' && q.inicio) {
  const h = quando(q.inicio);
  const dia = h.toFormat('cccc, dd/LL') + ' às ' + hora(h);
  if (m.args.p_tipo === 'remarcacao') pedido = 'Avise que a Caroline não vai conseguir atender ' + dia + ' por um motivo pessoal e pergunte qual dia fica melhor para remarcar.';
  else {
    const de = (/.*Reagendado de (\d\d\/\d\d às \d\d:\d\d)/.exec(String(q.observacoes || '')) || [])[1];
    if (de) pedido = 'Avise que o horário dela mudou: era ' + de + ' e agora é ' + dia + '. Pergunte se fica bom para ela.';
  }
}
if (!pedido) return [{ json: { pular: true } }];
const ultima = msgs.length ? quando(msgs[msgs.length - 1].criado_em) : null;
const hoje = DateTime.now().setZone(TZ);
const instrucao = [
  'Você é a IA de atendimento do ' + ${JSON.stringify(loja.nome)} + ' no WhatsApp, e escreve como a Caroline escreve. A Caroline (dona) pediu, pela assistente dela, para mandar agora uma mensagem a esta cliente' + (nome ? ' (' + nome + ')' : '') + '. Agora é ' + hoje.setLocale('pt-BR').toFormat("cccc, dd/LL HH:mm") + '.',
  '',
  'PEDIDO DA CAROLINE (é o que dizer, escrito pela assistente; não é a mensagem pronta):',
  pedido,
  '',
  'O QUE A FICHA DIZ DELA: ' + (ficha || '(nada)'),
  '',
  'CONVERSA COM ELA NOS ÚLTIMOS 7 DIAS (mais antiga primeiro; "studio" é você ou a Caroline):',
  conversa || '(nenhuma mensagem)',
  '',
  'O JEITO DE ESCREVER (o mesmo de toda conversa com as clientes):',
  ${JSON.stringify(TOM)},
  '',
  'Nesta mensagem:',
  '- Diga o que a Caroline pediu, com os dias, horas e serviços do pedido. Preço ou valor, só se estiver no pedido. Oferecer é perguntar se dá ("Tenho sábado às 14h, dá pra você?"): não escreva "encaixei", "marquei", "reservei" nem "garantido" se o pedido não diz que já está reservado. 🙏 só quando o pedido diz que ficou marcado ou reservado.',
  '- O que a Caroline conta à assistente fica no studio: nunca diga o motivo dela (prova, compromisso, saúde, viagem, família) nem fale de outra cliente. Se ela não vai atender: diga que a Caroline não vai conseguir atender nesse horário por um motivo pessoal e ofereça remarcar.',
  '- A Caroline aparece como "a Caroline"; o studio é "a gente". Nunca escreva como se fosse ela ("eu não vou conseguir", "minha prova").',
  '- ' + (ultima && ultima.hasSame(hoje, 'day') ? 'A conversa de hoje já começou: sem cumprimento.' : 'Comece com o cumprimento do jeito dela, uma vez, com ' + (hoje.hour < 12 ? 'bom dia' : hoje.hour < 18 ? 'boa tarde' : 'boa noite') + '.'),
  '- Leve em conta a conversa: não repita o que ela já recebeu e não ofereça o que ela já recusou. Se ela já disse algo que muda o pedido (avisou que não pode nesse dia, já marcou outro horário, pediu para não receber mensagem), não escreva a mensagem: responda só "CONFERIR: " e o que ela disse, em uma frase.',
  '- Não diga que é IA, sistema, robô ou assistente.',
  'Responda só com a mensagem (ou com o CONFERIR).',
].join('\n');
return [{ json: { pular: false, instrucao, pedido } }];`;

  const PRONTA = String.raw`
const m = $('Montar chamada').first().json;
const args = { ...m.args };
const g = $input.first().json || {};
let t = String((g.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('') || '').trim();
t = t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^["“«]+|["”»]+$/g, '').trim();
const conferir = /^CONFERIR\s*:?\s*/i.exec(t);
if (conferir) return [{ json: { args, escrita: false, bloqueio: 'NÃO ENVIADO (nada chegou à cliente): a conversa com ela muda o pedido: ' +
  (t.slice(conferir[0].length).trim() || 'ela já respondeu algo sobre isso') + ' Conte isso à Caroline em uma linha e pergunte o que ela quer fazer.' } }];
// sem resposta do Gemini: segue com o texto da assistente (as travas do envio continuam valendo)
if (t) args.p_texto = t;
return [{ json: { args, escrita: !!t } }];`;

  const QUEM_URL = `={{ $env.SUPABASE_URL }}/rest/v1/{{ ${ARGS}.p_cliente_id ? 'clientes?select=id,nome,telefone,observacoes&id=eq.' + ${ARGS}.p_cliente_id : 'agendamentos?select=inicio,status,observacoes,cliente:clientes(id,nome,telefone,observacoes)&id=eq.' + (${ARGS}.p_agendamento_id || '${NADA}') }}`;
  const CONVERSA_URL = "={{ $env.SUPABASE_URL }}/rest/v1/mensagens?select=autor,tipo,conteudo,criado_em&empresa_id=eq.{{ $env.EMPRESA_ID }}" +
    `&cliente_id=eq.{{ (($('Voz: quem é').first().json.cliente || $('Voz: quem é').first().json).id) || '${NADA}' }}` +
    "&criado_em=gte.{{ $now.minus(7, 'days').toUTC().toISO() }}&order=criado_em.desc&limit=12";

  F.nodes.push(
    ifNode('Voz: escrever?', [bx - 1320, by + 420], [cond('vz1',
      `={{ ['chamar_cliente', 'avisar_cliente'].includes(${PEDIDO_IN}.acao) && !/^s/i.test(String(${PEDIDO_IN}.ditado || '')) && !!$('Montar chamada').first().json.args && !$('Montar chamada').first().json.erro && !$('Montar chamada').first().json.pergunte }}`,
      { type: 'boolean', operation: 'true', singleValue: true })]),
    supaGet('Voz: quem é', QUEM_URL, [bx - 1100, by + 320]),
    supaGet('Voz: conversa', CONVERSA_URL, [bx - 880, by + 320]),
    node('Voz: preparar', 'n8n-nodes-base.code', 2, [bx - 660, by + 320], { jsCode: PREPARAR }),
    ifNode('Voz: tem pedido?', [bx - 440, by + 320], [cond('vz2', '={{ !$json.pular }}', { type: 'boolean', operation: 'true', singleValue: true })]),
    node('Voz: escrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [bx - 220, by + 220], {
      method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent', ...GEMINI_HTTP,
      sendBody: true, specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ contents: [{ parts: [{ text: $json.instrucao }] }], generationConfig: { temperature: 0.5, thinkingConfig: { thinkingLevel: 'low' } } }) }}",
      options: { timeout: 30000 },
    }, { credentials: GEMINI, onError: 'continueRegularOutput', alwaysOutputData: true }),
    node('Voz: pronta', 'n8n-nodes-base.code', 2, [bx, by + 220], { jsCode: PRONTA }),
    ifNode('Voz: conferir com a Caroline?', [bx + 220, by + 220], [cond('vz3', '={{ !!$json.bloqueio }}', { type: 'boolean', operation: 'true', singleValue: true })]),
  );
  // quem chegava no "Executar no banco" passa antes pela voz
  let ligadas = 0;
  for (const [de, c] of Object.entries(F.connections)) for (const saida of c.main || []) for (const l of saida || []) if (l.node === 'Executar no banco') { l.node = 'Voz: escrever?'; ligadas++; }
  if (!ligadas) throw new Error('voz-unica: nada chegava no "Executar no banco"');
  F.connections['Voz: escrever?'] = { main: [[{ node: 'Voz: quem é', type: 'main', index: 0 }], [{ node: 'Executar no banco', type: 'main', index: 0 }]] };
  F.connections['Voz: quem é'] = main('Voz: conversa');
  F.connections['Voz: conversa'] = main('Voz: preparar');
  F.connections['Voz: preparar'] = main('Voz: tem pedido?');
  F.connections['Voz: tem pedido?'] = { main: [[{ node: 'Voz: escrever (Gemini)', type: 'main', index: 0 }], [{ node: 'Executar no banco', type: 'main', index: 0 }]] };
  F.connections['Voz: escrever (Gemini)'] = main('Voz: pronta');
  F.connections['Voz: pronta'] = main('Voz: conferir com a Caroline?');
  F.connections['Voz: conferir com a Caroline?'] = { main: [[{ node: 'Resposta', type: 'main', index: 0 }], [{ node: 'Executar no banco', type: 'main', index: 0 }]] };

  // o banco grava o texto que a IA escreveu (é esse que sai e que fica no contato)
  const corpo = "={{ JSON.stringify($('Montar chamada').first().json.args) }}";
  if (banco.parameters.jsonBody !== corpo) throw new Error('voz-unica: o corpo do "Executar no banco" mudou');
  banco.parameters.jsonBody = "={{ JSON.stringify((() => { try { if ($('Voz: pronta').isExecuted) return $('Voz: pronta').first().json.args; } catch (e) {} return $('Montar chamada').first().json.args; })()) }}";

  // a resposta para a assistente: o "CONFERIR" vem primeiro
  const resp = achar(F, 'Resposta');
  const ar = (resp.parameters.assignments?.assignments || []).find((x) => x.name === 'resposta');
  const inicio = '={{ (() => { try { if ($(\'Envio: conferir\').isExecuted)';
  if (!ar || !String(ar.value).startsWith(inicio)) throw new Error('voz-unica: a Resposta das ferramentas mudou');
  ar.value = '={{ (() => { try { if ($(\'Voz: pronta\').isExecuted && $(\'Voz: pronta\').first().json.bloqueio) return $(\'Voz: pronta\').first().json.bloqueio; } catch (e) {} ' +
    'try { if ($(\'Envio: conferir\').isExecuted)' + String(ar.value).slice(inicio.length);

  // ---------- 4. depois de mandar: a mensagem entra na memória da IA de atendimento ----------
  const reg = achar(F, 'Registrar na conversa');
  if (F.connections['Registrar na conversa']?.main?.[0]?.[0]?.node !== 'Resposta') throw new Error('voz-unica: o "Registrar na conversa" não vai mais para a Resposta');
  const REDIS = F.nodes.find((n) => n.type === 'n8n-nodes-base.redis' && n.credentials)?.credentials;
  if (!REDIS) throw new Error('voz-unica: sem credencial do Redis nas ferramentas');
  const TEL = "String(JSON.parse($('Executar no banco').first().json.data).telefone || '').replace(/\\D/g, '')";
  const [rx, ry] = reg.position;
  F.nodes.push(
    node('Voz: memória da cliente', 'n8n-nodes-base.redis', 1, [rx + 220, ry], {
      operation: 'keys', keyPattern: `=memoria:{{ ${TEL}.slice(0, 4) }}*{{ ${TEL}.slice(-8) }}`, getValues: false,
    }, { credentials: REDIS, onError: 'continueRegularOutput', alwaysOutputData: true }),
    node('Voz: guardar na memória da IA', 'n8n-nodes-base.redis', 1, [rx + 440, ry], {
      operation: 'push', tail: false,
      // a chave que já existe (com ou sem o 9); sem nenhuma, a do jeito que o WhatsApp manda (sem o 9)
      list: `={{ (() => { const j = $('Voz: memória da cliente').first().json || {}; const ks = [].concat(j.keys || Object.keys(j)).map(String).filter((k) => /memoria:/.test(k)); const t = ${TEL}; return ks[0] || 'memoria:' + t.replace(/^(55\\d{2})9(\\d{8})$/, '$1$2'); })() }}`,
      messageData: "={{ JSON.stringify({ type: 'ai', data: { content: JSON.parse($('Executar no banco').first().json.data).mensagem, tool_calls: [], invalid_tool_calls: [], additional_kwargs: {}, response_metadata: {} } }) }}",
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
  );
  F.connections['Registrar na conversa'] = main('Voz: memória da cliente');
  F.connections['Voz: memória da cliente'] = main('Voz: guardar na memória da IA');
  F.connections['Voz: guardar na memória da IA'] = main('Resposta');
};
