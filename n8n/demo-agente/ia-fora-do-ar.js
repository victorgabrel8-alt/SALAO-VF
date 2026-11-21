// A IA ficou fora do ar: o que a cliente recebe e quem é avisado (21/11/2026).
// Nesse dia o Gemini bateu o teto de gasto do mês e, das 09:10 em diante, toda cliente recebia "Desculpa, tive um
// probleminha aqui e não consegui ler sua mensagem. Pode mandar de novo? 😊" a cada mensagem: a Dienne avisou duas vezes
// que tinha chegado ao salão e recebeu o mesmo pedido duas vezes. Pedir de novo só faz sentido quando a falha é de
// momento; em laço, soa robô e não resolve.
// Agora, quando a IA falha (o "Quebrar mensagens" fica sem texto):
//   1. falha comum, primeira vez: o pedido de desculpas de sempre ("Pode mandar de novo?");
//   2. o provedor recusou (limite, teto de gasto, fora do ar) OU é a segunda falha em 1 h com a mesma cliente:
//      um recado de espera, uma vez só, e a dona é avisada pelo WhatsApp dela (número da assistente), com o que a
//      cliente escreveu, para responder ela mesma. O aviso entra na memória da assistente;
//   3. a cliente já recebeu o recado de espera nas últimas 3 h: não recebe mais nada (sem laço). O Victor continua
//      sendo avisado a cada falha (alerta-workflows.js).
// Só na Gleide por enquanto (ligado no montar-workflow.js). Os nós da dona ficam num ramo à parte, depois do
// "IA falhou? (alerta)", com onError continue: nada aqui segura a resposta nem a trava.

// Decide o que a cliente recebe. Colada no "Quebrar mensagens": nada de require nem variável de fora.
// ctx: erro (texto do erro do "Agente IA"), anteriores (últimas mensagens: direcao, conteudo, criado_em), agora (ms), dona.
function decidirFalha(ctx) {
  ctx = ctx || {};
  const erro = String(ctx.erro || '');
  const agora = Number(ctx.agora) || Date.now();
  const dona = String(ctx.dona || '').trim();
  const DESCULPA = 'Desculpa, tive um probleminha aqui e não consegui ler sua mensagem. Pode mandar de novo? 😊';
  const ESPERA = 'Recebi sua mensagem 💛 Só um instantinho que ' + (dona ? 'a ' + dona : 'a gente') + ' já te responde por aqui, tá?';
  const saidas = (Array.isArray(ctx.anteriores) ? ctx.anteriores : []).filter((m) => m && m.direcao === 'saida' && m.conteudo && m.criado_em);
  // há quantos minutos saiu a última mensagem que começa assim (Infinity = nunca, nas últimas horas)
  const minutosDesde = (comeco) => {
    let menor = Infinity;
    for (const m of saidas) {
      if (!String(m.conteudo).startsWith(comeco)) continue;
      const min = (agora - Date.parse(m.criado_em)) / 60000;
      if (min >= 0 && min < menor) menor = min;
    }
    return menor;
  };
  // o provedor recusou: pedir "manda de novo" não adianta enquanto ele não voltar
  const fora = /too many requests|quota|spend|\b429\b|rate.?limit|resource.?exhausted|overloaded|unavailable|\b503\b/i.test(erro);
  if (minutosDesde('Recebi sua mensagem 💛') <= 180) return { tipo: 'silencio', texto: '', avisarDona: false };
  if (fora || minutosDesde('Desculpa, tive um probleminha') <= 60) return { tipo: 'espera', texto: ESPERA, avisarDona: true };
  return { tipo: 'desculpa', texto: DESCULPA, avisarDona: false };
}

// O aviso para a dona, em conversa normal. Colada no nó "IA fora: aviso da dona".
// ctx: nome (cadastro ou WhatsApp), telefone, mensagem (o que a cliente escreveu).
function avisoDaDona(ctx) {
  ctx = ctx || {};
  const fone = (t) => { const m = String(t || '').replace(/\D/g, '').match(/^55(\d{2})(\d{4,5})(\d{4})$/); return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : ''; };
  const dois = String(ctx.nome || '').trim().split(/\s+/).filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w)).slice(0, 2)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const final = String(ctx.telefone || '').replace(/\D/g, '').slice(-4);
  const quem = dois && !/^cliente( teste)?$/i.test(dois) && !/\d/.test(dois) ? 'a *' + dois + '*' + (final ? ' (final ' + final + ')' : '') : (fone(ctx.telefone) ? 'o número ' + fone(ctx.telefone) : 'uma cliente');
  // "[1] oi\n[2] cheguei" é a numeração do buffer: sai
  const msg = String(ctx.mensagem || '').replace(/(^|\n)\s*\[\d+\]\s*/g, '$1').replace(/\s+/g, ' ').trim();
  const corta = msg.length > 200 ? msg.slice(0, 200) + '…' : msg;
  return '⚠️ Estou com um problema aqui no sistema e não consegui responder ' + quem + (corta ? ', que escreveu agora: «' + corta + '».' : '.') +
    ' Você consegue responder ela pelo WhatsApp do salão? Eu só disse que você já responde. O Victor já foi avisado do problema.';
}

module.exports = ({ node, main, ifNode, cond, workflow, EVO, apikeyHeader, REDIS, dona = 'Gleide' }) => {
  const achar = (nome) => { const n = workflow.nodes.find((x) => x.name === nome); if (!n) throw new Error(`ia-fora-do-ar: não achei "${nome}"`); return n; };
  for (const nome of ['Agente IA', 'Supabase: últimas mensagens', 'Supabase: ficha da cliente', 'Montar entrada', 'Extrair dados', 'IA falhou? (alerta)']) achar(nome);
  if (workflow.nodes.some((n) => n.name === 'IA fora: avisa a dona?')) throw new Error('ia-fora-do-ar: já montado');
  const sim = { type: 'boolean', operation: 'true', singleValue: true };

  // ---------- 1. o que a cliente recebe ----------
  const quebrar = achar('Quebrar mensagens');
  const ANTES = "if (falhou) paragrafos = [{ t: 'Desculpa, tive um probleminha aqui e não consegui ler sua mensagem. Pode mandar de novo? 😊', ref: 0 }];";
  if (quebrar.parameters.jsCode.split(ANTES).length !== 2) throw new Error('ia-fora-do-ar: o "Quebrar mensagens" mudou (a linha do pedido de desculpas)');
  quebrar.parameters.jsCode = quebrar.parameters.jsCode.replace(ANTES, () => [
    '// ia-fora-do-ar.js: pedido de desculpas, recado de espera (e a dona é avisada) ou silêncio',
    'if (falhou) {',
    `  const decidirFalha = ${decidirFalha.toString()};`,
    "  let erroIA = ''; try { const x = $('Agente IA').first().json.error; erroIA = !x ? '' : typeof x === 'string' ? x : String(x.message || JSON.stringify(x)); } catch (e) {}",
    "  let anterioresIA = []; try { anterioresIA = $('Supabase: últimas mensagens').all().map((i) => i.json).filter((m) => m && m.criado_em); } catch (e) {}",
    '  let falha;',
    `  try { falha = decidirFalha({ erro: erroIA, anteriores: anterioresIA, agora: Date.now(), dona: ${JSON.stringify(dona)} }); }`,
    "  catch (e) { falha = { tipo: 'desculpa', texto: 'Desculpa, tive um probleminha aqui e não consegui ler sua mensagem. Pode mandar de novo? 😊' }; }",
    '  // já recebeu o recado de espera: não manda nada (segue pelo caminho de "sem texto", que libera a trava)',
    "  if (!falha.texto) return [{ json: { jid, semTexto: true, falhou: true, falha: falha.tipo } }];",
    '  paragrafos = [{ t: falha.texto, ref: 0 }];',
    '}',
  ].join('\n'));

  // ---------- 2. a dona é avisada quando saiu o recado de espera ----------
  const [x0, y0] = achar('IA falhou? (alerta)').position || [3180, -240];
  const NUMEROS = "($env.ASSISTENTE_NUMEROS || '5566999596740').split(',').map(s => s.trim()).filter(Boolean)";
  workflow.nodes.push(
    ifNode('IA fora: avisa a dona?', [x0 + 220, y0 - 220], [
      cond('fd1', "={{ $json.falhou === true && String($json.texto || '').startsWith('Recebi sua mensagem 💛') }}", sim)]),
    node('IA fora: aviso da dona', 'n8n-nodes-base.code', 2, [x0 + 440, y0 - 220], { jsCode: [
      `const avisoDaDona = ${avisoDaDona.toString()};`,
      "const pega = (f) => { try { return f(); } catch (e) { return undefined; } };",
      "const nome = pega(() => $('Supabase: ficha da cliente').first().json.nome) || pega(() => $('Extrair dados').first().json.nome) || '';",
      "const telefone = pega(() => $('Montar entrada').first().json.telefone) || '';",
      "const mensagem = pega(() => $('Montar entrada').first().json.texto_cliente) || '';",
      'const texto = avisoDaDona({ nome, telefone, mensagem });',
      "const memoria = JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } });",
      `return ${NUMEROS}.map((tel) => ({ json: { tel, texto, memoria } }));`,
    ].join('\n') }, { onError: 'continueRegularOutput', executeOnce: true }),
    node('IA fora: avisar a dona', 'n8n-nodes-base.httpRequest', 4.2, [x0 + 660, y0 - 220], {
      method: 'POST', url: `${EVO}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}`, sendHeaders: true, headerParameters: apikeyHeader,
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ number: $json.tel, text: $json.texto }) }}', options: {},
    }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
    node('IA fora: memória da assistente', 'n8n-nodes-base.redis', 1, [x0 + 880, y0 - 220], {
      operation: 'push', list: "=assistente:{{ $('IA fora: aviso da dona').item.json.tel }}",
      messageData: "={{ $('IA fora: aviso da dona').item.json.memoria }}", tail: false,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
  );
  // sai do lado "sim" do "IA falhou? (alerta)", junto com o aviso do Victor
  const saida = workflow.connections['IA falhou? (alerta)']?.main?.[0];
  if (!saida || !saida.length) throw new Error('ia-fora-do-ar: o "IA falhou? (alerta)" não tem saída');
  saida.push({ node: 'IA fora: avisa a dona?', type: 'main', index: 0 });
  workflow.connections['IA fora: avisa a dona?'] = { main: [[{ node: 'IA fora: aviso da dona', type: 'main', index: 0 }], []] };
  workflow.connections['IA fora: aviso da dona'] = main('IA fora: avisar a dona');
  workflow.connections['IA fora: avisar a dona'] = main('IA fora: memória da assistente');

  // ---------- 3. o aviso do Victor diz o que a cliente recebeu ----------
  const victor = achar('Avisar Victor (IA falhou)');
  const DE = "'⚠️ A IA falhou e mandou o pedido de desculpas para ' + $('Montar entrada').first().json.telefone + ': «' + String($('Montar entrada').first().json.texto_cliente || '').slice(0, 200) + '».'";
  if (String(victor.parameters.jsonBody).split(DE).length !== 2) throw new Error('ia-fora-do-ar: o texto do "Avisar Victor (IA falhou)" mudou');
  victor.parameters.jsonBody = victor.parameters.jsonBody.replace(DE, () =>
    "'⚠️ A IA falhou com ' + $('Montar entrada').first().json.telefone + ', que escreveu: «' + String($('Montar entrada').first().json.texto_cliente || '').slice(0, 200) + '».' + " +
    "($json.semTexto ? ' Ela NÃO recebeu resposta agora (já tinha recebido o recado de espera).' : String($json.texto || '').startsWith('Recebi sua mensagem') ? ' Ela recebeu o recado de espera e a dona foi avisada.' : ' Ela recebeu o pedido de desculpas (\"pode mandar de novo?\").')");
};
module.exports.decidirFalha = decidirFalha;
module.exports.avisoDaDona = avisoDaDona;
