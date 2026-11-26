// Vídeo de apresentação depois de marcar a avaliação no salão (pedido do Victor, 25/11/2026; só na Gleide).
// Nos 30 dias até 25/11, das 32 avaliações no salão que já passaram só 11 aconteceram (8 faltas, 12 cancelamentos) e 15
// foram marcadas com menos de 24 h, sem o lembrete da véspera. A Gleide gravou um vídeo de 37 s ("antes de você vir aqui,
// eu vou te mostrar o ambiente onde você será atendida": uma cliente por vez, 20 anos, resultados, endereço) para dar
// confiança logo depois de marcar.
//
// Como funciona:
//   1. "Quebrar mensagens": se nesta resposta a IA marcou (criar_agendamento com "AGENDADO com sucesso") uma avaliação
//      que não é online nem por ligação, entra um último balão com a marca [[VIDEO_APRESENTACAO]], depois da confirmação.
//   2. No laço de envio, esse balão não vai como texto: lê empresas.config.loja.video_avaliacao, confere se a cliente já
//      recebeu o vídeo (uma vez por cliente) e manda o vídeo pela Evolution; fica no app como mensagem da IA.
// Liga e desliga no banco, sem publicar de novo: config.loja.video_avaliacao = { ligado, url, so_para: [números], legenda }.
// so_para vazio = todas as clientes. Sem config, desligado ou com erro: o balão é pulado e nada mais muda.

const MARCA = '[[VIDEO_APRESENTACAO]]';
const CONTEUDO = '🎬 Vídeo de apresentação da Gleide enviado';

module.exports = ({ node, main, ifNode, cond, workflow }) => {
  const achar = (nome) => { const n = workflow.nodes.find((x) => x.name === nome); if (!n) throw new Error(`video_avaliacao: não achei "${nome}"`); return n; };
  for (const nome of ['Quebrar mensagens', 'Um balão por vez', 'Extrair dados', 'Supabase: registrar entrada']) achar(nome);
  if (workflow.nodes.some((n) => n.name === 'Vídeo: é o vídeo?')) return;

  // ---------- 1. o balão do vídeo, depois da confirmação ----------
  const q = achar('Quebrar mensagens');
  const FIM = '// Responder citando só quando a mensagem chegou';
  if (q.parameters.jsCode.split(FIM).length !== 2 || !q.parameters.jsCode.includes('const passos = ')) throw new Error('video_avaliacao: o "Quebrar mensagens" mudou');
  q.parameters.jsCode = q.parameters.jsCode.replace(FIM, () => [
    '// vídeo de apresentação: marcou avaliação no salão nesta resposta -> último balão (video-avaliacao.js, 25/11)',
    'const marcouAvaliacaoNoSalao = passos.some((p) => p.action?.tool === \'criar_agendamento\' && /AGENDADO com sucesso/.test(JSON.stringify(p.observation || \'\')) && (() => {',
    '  const i = p.action.toolInput || {}; const s = String(i.servico || \'\').toLowerCase(); const tudo = s + \' \' + String(i.motivo || \'\').toLowerCase();',
    '  return /avalia/.test(s) && !/online|on-line|liga[cç][aã]o|v[ií]deo|chamada/.test(tudo); })());',
    'if (marcouAvaliacaoNoSalao && baloes.length) baloes.push({ t: ' + JSON.stringify(MARCA) + ', ref: 0 });',
    FIM,
  ].join('\n'));

  // ---------- 2. no laço: o balão do vídeo sai como vídeo ----------
  const loop = workflow.connections['Um balão por vez']?.main?.[1];
  if (!loop || loop.length !== 1) throw new Error('video_avaliacao: o laço do "Um balão por vez" mudou');
  const seguir = loop[0].node; // o caminho do texto (pausa, digitando, envio)
  const SUPA_H = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const V = "($('Vídeo: config').first().json.video || {})";
  const BALAO = "$('Um balão por vez').first().json";
  const nos = [
    ifNode('Vídeo: é o vídeo?', [0, 0], [cond('va1', `={{ $json.texto === ${JSON.stringify(MARCA)} }}`, { type: 'boolean', operation: 'true', singleValue: true })]),
    node('Vídeo: config', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'GET', url: '={{ $env.SUPABASE_URL }}/rest/v1/empresas?id=eq.{{ $env.EMPRESA_ID }}&select=video:config->loja->video_avaliacao',
      sendHeaders: true, headerParameters: SUPA_H, options: { timeout: 15000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    // uma vez por cliente: quem já recebeu (marcou de novo depois de faltar, remarcou) não recebe outra vez
    node('Vídeo: já mandou?', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'GET',
      url: `={{ $env.SUPABASE_URL }}/rest/v1/mensagens?cliente_id=eq.{{ $('Supabase: registrar entrada').first().json.cliente_id }}&conteudo=eq.{{ encodeURIComponent(${JSON.stringify(CONTEUDO)}) }}&select=id&limit=1`,
      sendHeaders: true, headerParameters: SUPA_H, options: { timeout: 15000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    ifNode('Vídeo: mandar?', [0, 0], [cond('va2', `={{ (() => { try { const v = ${V}; if (v.ligado !== true || !/^https:\\/\\//.test(String(v.url || ''))) return false; ` +
      "if (!$('Supabase: registrar entrada').first().json.cliente_id || $('Vídeo: já mandou?').first().json.id) return false; " +
      "const so = [].concat(v.so_para || []).map((s) => String(s).replace(/\\D/g, '').slice(-8)).filter(Boolean); " +
      "const tel = String($('Extrair dados').first().json.telefone || '').replace(/\\D/g, '').slice(-8); " +
      'return !so.length || so.includes(tel); } catch (e) { return false; } })() }}', { type: 'boolean', operation: 'true', singleValue: true })]),
    node('Enviar vídeo', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendMedia/{{ $env.EVOLUTION_INSTANCE }}',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ number: ${BALAO}.jid, mediatype: 'video', mimetype: 'video/mp4', media: ${V}.url, fileName: 'apresentacao.mp4', caption: String(${V}.legenda || ''), delay: 1500 }) }}`,
      options: { timeout: 120000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    ifNode('Vídeo: enviou?', [0, 0], [cond('va3', '={{ !!$json.key?.id }}', { type: 'boolean', operation: 'true', singleValue: true })]),
    node('Vídeo: registrar no CRM', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_registrar_saida',
      sendHeaders: true, headerParameters: SUPA_H, sendBody: true, specifyBody: 'json',
      jsonBody: "={{ JSON.stringify({ p_empresa_id: $env.EMPRESA_ID, p_telefone: (() => { const d = String($('Extrair dados').first().json.telefone || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })(), " +
        `p_conteudo: ${JSON.stringify(CONTEUDO)}, p_autor: 'ia', p_tipo: 'outro', p_wa_message_id: $json.key.id }) }}`,
      options: { timeout: 15000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
  ];
  // posições: abaixo do laço, para a tela do n8n ficar legível
  const base = achar('Um balão por vez').position;
  nos.forEach((n, i) => { n.position = [base[0] + 220 * i, base[1] + 420]; });
  workflow.nodes.push(...nos);
  const sim = (a, b) => ({ main: [[{ node: a, type: 'main', index: 0 }], [{ node: b, type: 'main', index: 0 }]] });
  workflow.connections['Um balão por vez'].main[1] = [{ node: 'Vídeo: é o vídeo?', type: 'main', index: 0 }];
  Object.assign(workflow.connections, {
    'Vídeo: é o vídeo?': sim('Vídeo: config', seguir),
    'Vídeo: config': main('Vídeo: já mandou?'),
    'Vídeo: já mandou?': main('Vídeo: mandar?'),
    'Vídeo: mandar?': sim('Enviar vídeo', 'Um balão por vez'),
    'Enviar vídeo': main('Vídeo: enviou?'),
    'Vídeo: enviou?': sim('Vídeo: registrar no CRM', 'Um balão por vez'),
    'Vídeo: registrar no CRM': main('Um balão por vez'),
  });
};
module.exports.MARCA = MARCA;
module.exports.CONTEUDO = CONTEUDO;
