// Cópia ao Victor de toda dúvida e todo erro da IA de uma loja (loja.json: "copia_victor": "<número com DDI>"; a Gleide
// não passa por aqui). Pedido do Victor (24/11/2026, Caroline): "qualquer erro ou indecisão da IA, além de consultar a
// Caroline, me consulta também, para eu ficar em cima".
// Sai pelo mesmo WhatsApp da loja que já manda o "Alerta de erro" ao Victor. Quatro casos:
//   1. a IA de atendimento perguntou à dona (perguntar_para_gleide): a mesma pergunta, para o Victor;
//   2. a IA passou a conversa para humano (transferir_para_humano): o mesmo aviso;
//   3. o Conferente barrou uma resposta da IA (ia sair errada para a cliente): o que ela ia dizer, o que saiu e por quê;
//   4. a assistente da dona errou: não respondeu (Gemini fora), disse que fez sem ter feito, ou uma ferramenta voltou
//      ERRO / NÃO MARQUEI / NÃO ENVIADO.
// Tudo em ramo à parte, com erro que segue (a cópia nunca segura a mensagem da cliente nem a da dona).
module.exports = ({ workflow: W, perguntaWorkflow: P, pausaWorkflow: Z, assistenteWorkflow: A, numero }) => {
  if (!/^\d{12,13}$/.test(String(numero || ''))) throw new Error('copia-victor: número inválido');
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('copia-victor: sem o nó ' + nome); return n; };
  // copia um nó que já manda WhatsApp pela loja (a URL e a instância ficam iguais) e troca só o corpo
  const copiaDe = (wf, molde, nome, idFim, texto, dy) => {
    if (wf.nodes.some((x) => x.name === nome)) throw new Error('copia-victor: ' + nome + ' já existe');
    const m = achar(wf, molde);
    if (!/sendText/.test(String(m.parameters.url))) throw new Error('copia-victor: ' + molde + ' não manda texto');
    const n = JSON.parse(JSON.stringify(m));
    n.name = nome;
    n.id = m.id.slice(0, -3) + idFim;
    n.position = [m.position[0], m.position[1] + (dy || 200)];
    n.parameters.jsonBody = "={{ JSON.stringify({ number: '" + numero + "', text: " + texto + ' }) }}';
    n.onError = 'continueRegularOutput';
    delete n.retryOnFail; delete n.maxTries; delete n.waitBetweenTries; delete n.executeOnce;
    wf.nodes.push(n);
    return n;
  };
  const ligarJunto = (wf, de, para, saida = 0) => {
    const c = wf.connections[de];
    if (!c || !c.main || !c.main[saida]) throw new Error('copia-victor: ' + de + ' sem a saída ' + saida);
    c.main[saida].push({ node: para, type: 'main', index: 0 });
  };
  // texto que a Evolution devolve de uma mensagem enviada
  const enviado = (no) => "(() => { const m = ($('" + no + "').first().json || {}).message || {}; return m.conversation || (m.extendedTextMessage || {}).text || ''; })()";

  // 1. pergunta à dona
  const perg = (P.nodes.find((x) => /^Enviar pergunta à /.test(x.name)) || {}).name;
  if (!perg) throw new Error('copia-victor: sem o envio da pergunta');
  copiaDe(P, perg, 'Cópia ao Victor (pergunta)', 'a91',
    "'👀 Cópia: a IA perguntou à dona\\n\\n' + (" + enviado(perg) + " || JSON.stringify($('Recebe pergunta da IA').first().json).slice(0, 500))");
  ligarJunto(P, perg, 'Cópia ao Victor (pergunta)');

  // 2. passou para humano
  const pausa = (Z.nodes.find((x) => /^Avisar a .* \(WhatsApp\)$/.test(x.name)) || {}).name;
  if (!pausa) throw new Error('copia-victor: sem o aviso da pausa');
  copiaDe(Z, pausa, 'Cópia ao Victor (pausa)', 'a92', "'👀 Cópia: a IA passou a conversa para humano\\n\\n' + " + enviado(pausa));
  ligarJunto(Z, pausa, 'Cópia ao Victor (pausa)');

  // 3. Conferente barrou (ramo verdadeiro do "Conferente: barrou?")
  achar(W, 'Conferente: barrou?');
  const molde = (W.nodes.find((x) => x.type === 'n8n-nodes-base.httpRequest' && /sendText/.test(String(x.parameters.url))) || {}).name;
  if (!molde) throw new Error('copia-victor: sem nó de envio no fluxo da IA');
  copiaDe(W, molde, 'Cópia ao Victor (Conferente)', 'a93',
    "'👀 O Conferente barrou uma resposta da IA\\nCliente: ' + ($('Extrair dados').first().json.nome || '') + ' (' + String($('Extrair dados').first().json.telefone || '').slice(-4) + ')' + " +
    "'\\nIa dizer: «' + String($json.texto || '').slice(0, 300) + '»' + " +
    "'\\nMotivo: ' + (Array.isArray($json.falhas) ? $json.falhas.map((f) => f.tipo + (f.detalhe ? ' (' + String(f.detalhe).slice(0, 80) + ')' : '')).join('; ') : '-') + " +
    "'\\nSaiu: «' + String($json.texto_final || '').slice(0, 300) + '»'", 260);
  ligarJunto(W, 'Conferente: barrou?', 'Cópia ao Victor (Conferente)', 0);

  // 4. erro da assistente da dona: um nó que decide e a cópia
  if (A.nodes.some((x) => x.name === 'Victor: erro da assistente?')) throw new Error('copia-victor: já existe');
  const conf = achar(A, 'Conferir resposta');
  A.nodes.push({
    id: conf.id.slice(0, -3) + 'a94', name: 'Victor: erro da assistente?', type: 'n8n-nodes-base.code', typeVersion: 2,
    position: [conf.position[0] + 220, conf.position[1] + 380], onError: 'continueRegularOutput',
    parameters: { jsCode: [
      "const c = $('Conferir resposta').first().json || {};",
      "const ag = $('Agente assistente').first().json || {};",
      "let pedido = ''; try { pedido = String($('Juntar mensagens').first().json.texto || ''); } catch (e) {}",
      "const num = String($('Extrair dados').first().json.numero || '');",
      "const ler = (o) => { const t = typeof o === 'string' ? o : JSON.stringify(o || ''); try { const j = JSON.parse(t); const x = Array.isArray(j) ? j[0] : j; if (x && typeof x.resposta === 'string') return x.resposta; if (x && x.error) return 'ERRO: ' + x.error; } catch (e) {} return t; };",
      "const passos = Array.isArray(ag.intermediateSteps) ? ag.intermediateSteps : [];",
      "const falhas = passos.map((s) => ({ t: s.action && s.action.tool, r: ler(s.observation) })).filter((f) => /^\\s*(ERRO|N[ÃA]O (MARQUEI|REAGENDEI|MUDEI|ENVIADO|SALVO|AGENDADO|PERGUNTADO)|Received tool input)/i.test(f.r));",
      "let motivo = '';",
      "if (!String(ag.output || '').trim()) motivo = 'a assistente não conseguiu responder (Gemini fora ou erro); ela recebeu: «' + String(c.texto || '').slice(0, 120) + '»';",
      "else if (c.corrigida) motivo = 'ia dizer que fez sem ter feito: «' + String(c.original || '').slice(0, 200) + '». Ela recebeu: «' + String(c.texto || '').slice(0, 160) + '»';",
      "else if (falhas.length) motivo = falhas.map((f) => f.t + ': ' + String(f.r).replace(/\\s+/g, ' ').slice(0, 180)).join(' | ') + '\\nResposta à dona: «' + String(c.texto || '').slice(0, 200) + '»';",
      "const regras = passos.filter((s) => ['guardar_regra', 'regra_da_agenda', 'tirar_regra'].includes(s.action && s.action.tool) && /^\s*OK/i.test(ler(s.observation)));",
      "if (!motivo && regras.length) motivo = '📝 regra nova da dona (levar para a IA de atendimento): ' + regras.map((s) => s.action.tool + ' ' + JSON.stringify(s.action.toolInput || {}).slice(0, 200)).join(' | ');",
      "if (!motivo) return [];",
      "return [{ json: { texto: '👀 Assistente da loja · pedido de ' + num.slice(-4) + ': «' + pedido.replace(/\\s+/g, ' ').slice(0, 300) + '»\\n⚠️ ' + motivo } }];",
    ].join('\n') },
  });
  ligarJunto(A, 'Conferir resposta', 'Victor: erro da assistente?');
  const resp = (A.nodes.find((x) => /^Responder a /.test(x.name) && /sendText/.test(String(x.parameters.url))) || {}).name;
  if (!resp) throw new Error('copia-victor: sem o Responder da assistente');
  copiaDe(A, resp, 'Cópia ao Victor (assistente)', 'a95', '$json.texto', 380);
  A.connections['Victor: erro da assistente?'] = { main: [[{ node: 'Cópia ao Victor (assistente)', type: 'main', index: 0 }]] };
};
