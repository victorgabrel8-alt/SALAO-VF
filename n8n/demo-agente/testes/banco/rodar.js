// Banco de testes da conversa da IA da Gleide (22/11/2026). Roda o prompt que está em prompt-agente.md contra
// trechos reais de conversa (casos.json) e dá nota a cada resposta (criterios.md): conferências automáticas e um juiz.
//
// Nada passa pelo WhatsApp nem pelo fluxo que está no ar. O script monta o prompt como o n8n monta, chama o Gemini
// direto e simula as ferramentas (agenda, pergunta para a Gleide, orçamento): nenhuma mensagem sai para ninguém.
// A chave do Gemini fica só no n8n, então a chamada passa por um fluxo temporário ("TEMP - banco de testes"),
// criado no começo e apagado no fim.
//
// Uso (na pasta n8n/demo-agente):
//   node testes/banco/rodar.js <rótulo>                 roda todos os casos
//   node testes/banco/rodar.js <rótulo> --casos a,b     só esses casos (id ou começo do id)
//   node testes/banco/rodar.js <rótulo> --vezes 3       cada caso 3 vezes (a nota é a média)
//   node testes/banco/rodar.js <rótulo> --comparar x    compara com a rodada de rótulo x (padrão: a rodada anterior)
//   node testes/banco/rodar.js <rótulo> --seco          ensaio sem Gemini (não gasta nada, não grava resultado)
//   node testes/banco/rodar.js <rótulo> --chave-das-clientes   usa a chave do Gemini das clientes (só com o ok do Victor)
// Resultado: testes/banco/resultados/AAAA-MM-DD-<rótulo>.md (para ler) e .json (para comparar).
//
// Chave: usa a credencial de teste (N8N_GEMINI_TESTE_CRED_ID no .env). Sem ela o script para, a não ser com
// --chave-das-clientes. Uma rodada completa gasta perto de 1 milhão de tokens de entrada no Flash.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');
const { conferir, nota, passou, CRITERIOS } = require('./conferir.js');

const DIR = path.resolve(__dirname, '..', '..');
const AQUI = __dirname;
const args = process.argv.slice(2);
const opc = (nome) => { const i = args.indexOf('--' + nome); return i < 0 ? null : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const rotulo = args[0] && !args[0].startsWith('--') ? args[0].replace(/[^a-z0-9-]/gi, '-') : 'teste';
const VEZES = Math.max(1, Math.min(5, Number(opc('vezes')) || 1));
const JUNTOS = 4;
const EDITOR = !!opc('editor'); // segunda passada que só arruma o jeito de falar (ver editar())
const NOVO = !!opc('novo'); // usa o prompt modular (prompt-modular/) em vez do prompt único que está no ar
const modular = require('../../prompt-modular/montar.js');
const SECO = !!opc('seco'); // ensaio sem Gemini: confere a montagem do prompt, das ferramentas e dos balões
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

const env = {};
for (const l of fs.readFileSync(path.join(DIR, '.env'), 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); }
const N8N = env.N8N_URL.replace(/\/$/, '');
const N = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };

// ---------- 1. o agente como o n8n monta (prompt, modelo, ferramentas, quebra em balões) ----------
function gerarAgente() {
  execSync('node montar-workflow.js', { cwd: DIR, stdio: 'ignore' });
  const w = JSON.parse(fs.readFileSync(path.join(DIR, 'workflow-demo-salao.json'), 'utf8'));
  // montar-workflow.js regrava os arquivos gerados: devolve os que o Git conhece e tira os dois que ele não conhece
  try {
    const mexidos = execSync('git ls-files -m', { cwd: DIR }).toString().split(/\r?\n/).filter((f) => /^workflow-.*\.json$/.test(f));
    if (mexidos.length) execSync('git checkout -- ' + mexidos.map((f) => '"' + f + '"').join(' '), { cwd: DIR, stdio: 'ignore' });
    for (const f of ['workflow-modalidade.json', 'workflow-retorno.json']) {
      const p = path.join(DIR, f);
      if (fs.existsSync(p) && !execSync('git ls-files "' + f + '"', { cwd: DIR }).toString().trim()) fs.unlinkSync(p);
    }
  } catch (e) { /* fora do Git: os arquivos gerados ficam */ }
  const no = (nome) => { const n = w.nodes.find((x) => x.name === nome); if (!n) throw new Error('não achei o nó "' + nome + '"'); return n; };
  const flash = no('Gemini Flash').parameters;
  const ferramentas = Object.keys(w.connections).filter((k) => w.connections[k].ai_tool).map((nome) => {
    const p = no(nome).parameters;
    const campos = [...JSON.stringify((p.workflowInputs && p.workflowInputs.value) || {}).matchAll(/\$fromAI\('([^']+)',\s*`((?:[^`\\]|\\.)*)`(?:,\s*'(\w+)')?/g)]
      .map((m) => ({ nome: m[1], descricao: JSON.parse('"' + m[2].replace(/(?<!\\)"/g, '\\"') + '"'), tipo: (m[3] || 'string').toUpperCase() }));
    const d = { name: nome, description: String(p.description || p.toolDescription || nome) };
    if (campos.length) d.parameters = { type: 'OBJECT', properties: Object.fromEntries(campos.map((c) => [c.nome, { type: ['NUMBER', 'BOOLEAN'].includes(c.tipo) ? c.tipo : 'STRING', description: c.descricao }])), required: campos.map((c) => c.nome) };
    return d;
  });
  return { sistema: no('Agente IA').parameters.options.systemMessage.replace(/^=/, ''), quebrar: no('Quebrar mensagens').parameters.jsCode,
    modelo: String(flash.modelName).replace(/^models\//, ''), temperatura: (flash.options && flash.options.temperature) ?? 0.6, ferramentas };
}

// ---------- 2. imitação do $now e do $('nó') do n8n, para avaliar as expressões do prompt ----------
class Agora {
  constructor(ms) { this.ms = ms; this.d = new Date(ms - 4 * 3600e3); } // Cuiabá: UTC-4 o ano todo
  setZone() { return this; } setLocale() { return this; } toUTC() { return this; } toISO() { return new Date(this.ms).toISOString(); }
  get hour() { return this.d.getUTCHours(); } get minute() { return this.d.getUTCMinutes(); }
  set(o) { const d = new Date(this.d); if (o.hour != null) d.setUTCHours(o.hour); if (o.minute != null) d.setUTCMinutes(o.minute); return new Agora(d.getTime() + 4 * 3600e3); }
  plus(o) { return new Agora(this.ms + ((o.days || 0) * 24 + (o.hours || 0)) * 3600e3 + (o.minutes || 0) * 60e3); }
  minus(o) { return this.plus({ days: -(o.days || 0), hours: -(o.hours || 0), minutes: -(o.minutes || 0) }); }
  diff(o) { const h = (this.ms - o.ms) / 3600e3; return { hours: h, minutes: h * 60, days: h / 24 }; }
  toFormat(f) {
    const d = this.d; const p = (n) => String(n).padStart(2, '0');
    const dias = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    return f.replace(/cccc|yyyy|LL|dd|HH|mm/g, (t) => ({ cccc: dias[d.getUTCDay()], yyyy: d.getUTCFullYear(), LL: p(d.getUTCMonth() + 1), dd: p(d.getUTCDate()), HH: p(d.getUTCHours()), mm: p(d.getUTCMinutes()) }[t]));
  }
}
const ambiente = (dados, agora) => {
  const $ = (nome) => { const v = dados[nome]; const lista = Array.isArray(v) ? v : [v || {}]; return { first: () => ({ json: lista[0] || {} }), all: () => lista.map((json) => ({ json })), item: { json: lista[0] || {} }, isExecuted: false }; };
  return { $, $now: agora };
};
const avaliar = (expr, amb) => new Function('$', '$now', '$json', '$env', 'return (' + expr + ');')(amb.$, amb.$now, {}, {});
const montarSistema = (modelo, amb) => modelo.replace(/\{\{([\s\S]*?)\}\}/g, (_, e) => { const v = avaliar(e, amb); return v == null ? '' : String(v); });

function baloesDe(codigo, saida, dados, agora) {
  try {
    const amb = ambiente({ ...dados, 'Agente IA': { output: saida, intermediateSteps: [] }, 'Preço: ler pendência': { pendente: '' }, 'Supabase: últimas mensagens': [] }, agora);
    const itens = new Function('$', '$now', '$input', '$json', codigo)(amb.$, amb.$now, { first: () => ({ json: {} }), all: () => [] }, {});
    const b = (itens || []).map((i) => String(i.json.texto || '')).filter((t) => t.trim());
    if (b.length || !String(saida).trim()) return { baloes: b, falhou: (itens || []).some((i) => i.json.falhou) };
  } catch (e) { /* cai no corte simples abaixo */ }
  return { baloes: String(saida || '').split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean), falhou: false, semFiltro: true };
}

// ---------- 3. ferramentas de mentira: respondem como as de verdade, sem agenda, sem banco e sem WhatsApp ----------
const RESPOSTA_PADRAO = (amanha) => ({
  consultar_horarios_livres: 'HORÁRIOS LIVRES em ' + amanha + ': 09:00 (manhã) e 14:00 (tarde). Ofereça esses dois. QUADRO DO DIA: manhã com vagas, almoço fechado, tarde com vagas.',
  criar_agendamento: 'AGENDADO com sucesso no dia e hora pedidos, presencial, no salão (Rua das Papoulas, 443 - Jardim Paraíso, Sinop/MT). Confirme para a cliente o serviço, o dia, a hora e o endereço.',
  ver_agendamentos: 'Nenhum horário futuro para esta cliente.',
  remarcar_agendamento: 'REMARCADO com sucesso para o novo horário.',
  cancelar_agendamento: 'CANCELADO com sucesso.',
  mudar_modalidade: 'MODALIDADE TROCADA com sucesso, mesmo dia e hora.',
  transferir_para_humano: 'TRANSFERIDO: a Gleide recebeu o resumo no WhatsApp e vai assumir esta conversa. Responda agora numa frase gentil que passou o assunto pra Gleide e que ela responde por aqui.',
  anotar_no_crm: 'Anotado na ficha.',
  enviar_audio: 'Sem áudio pronto para esse tema: responda em texto.',
  perguntar_para_gleide: 'PERGUNTADO: a Gleide recebeu a pergunta. Diga à cliente, numa frase gentil, que vai confirmar isso com a Gleide e avisa por aqui assim que ela responder. Continue o atendimento normalmente nos outros assuntos. Não invente a resposta: quando a Gleide responder, a resposta chega à cliente automaticamente.',
  pedir_orcamento_cabelo: 'ORÇAMENTO PEDIDO: a Gleide recebeu o pedido. Diga em uma frase o que você pediu e que avisa por aqui assim que ela passar o valor. Não invente valor nem prazo: a resposta da Gleide chega à cliente automaticamente.',
});

// ---------- 4. chamada ao Gemini pelo fluxo temporário do n8n ----------
let caminho = null; const gasto = { entrada: 0, cache: 0, saida: 0, chamadas: 0 };
async function criarPonte(credId) {
  caminho = 'banco-' + crypto.randomBytes(16).toString('hex');
  const corpo = { name: 'TEMP - banco de testes (apagar)', settings: { executionOrder: 'v1', saveDataSuccessExecution: 'none' },
    connections: { Entrada: { main: [[{ node: 'Gemini', type: 'main', index: 0 }]] } },
    nodes: [
      { id: crypto.randomUUID(), name: 'Entrada', type: 'n8n-nodes-base.webhook', typeVersion: 2, position: [0, 0], webhookId: crypto.randomUUID(), parameters: { httpMethod: 'POST', path: caminho, responseMode: 'lastNode', options: {} } },
      { id: crypto.randomUUID(), name: 'Gemini', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [220, 0], onError: 'continueRegularOutput',
        credentials: { googlePalmApi: { id: credId, name: 'Gemini' } },
        parameters: { method: 'POST', url: "=https://generativelanguage.googleapis.com/v1beta/models/{{ String($json.body.modelo).replace(/[^a-z0-9.-]/gi, '') }}:generateContent",
          authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi', sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify($json.body.pedido) }}', options: { timeout: 120000 } } },
    ] };
  const r = await (await fetch(N8N + '/api/v1/workflows', { method: 'POST', headers: N, body: JSON.stringify(corpo) })).json();
  if (!r.id) throw new Error('não consegui criar o fluxo temporário: ' + JSON.stringify(r).slice(0, 300));
  const a = await fetch(N8N + '/api/v1/workflows/' + r.id + '/activate', { method: 'POST', headers: N });
  if (!a.ok) { await apagarPonte(r.id); throw new Error('não consegui ligar o fluxo temporário (' + a.status + ')'); }
  await dorme(1500);
  return r.id;
}
async function apagarPonte(id) {
  for (let k = 0; k < 5; k++) {
    try { await fetch(N8N + '/api/v1/workflows/' + id + '/deactivate', { method: 'POST', headers: N }); const r = await fetch(N8N + '/api/v1/workflows/' + id, { method: 'DELETE', headers: N }); if (r.ok || r.status === 404) return true; } catch (e) { /* tenta de novo */ }
    await dorme(3000);
  }
  return false;
}
async function gemini(modelo, pedido) {
  if (SECO) return { candidates: [{ content: { parts: [{ text: pedido.systemInstruction ? 'Oi! Tudo bem? 😊 A mão de obra é R$ 150 por tela e o cabelo é à parte.\n\nMe conta, como seu cabelo tá hoje?' : '{"calor":2,"responde":2,"conduz":2,"especifica":1,"fiel":2,"esperado":1,"motivo":"ensaio a seco"}' }] } }] };
  let ultimo = '';
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(N8N + '/webhook/' + caminho, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ modelo, pedido }) });
      const j = JSON.parse(await r.text());
      const o = Array.isArray(j) ? j[0] : j;
      if (o && o.candidates) {
        const u = o.usageMetadata || {}; gasto.chamadas++; gasto.entrada += u.promptTokenCount || 0; gasto.cache += u.cachedContentTokenCount || 0; gasto.saida += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
        return o;
      }
      ultimo = JSON.stringify(o).slice(0, 300);
      if (/API key|PERMISSION_DENIED|credential|spending cap|billing/i.test(ultimo)) throw new Error('PARAR: ' + ultimo);
    } catch (e) { if (String(e.message).startsWith('PARAR')) throw e; ultimo = e.message; }
    await dorme(4000 * (k + 1));
  }
  throw new Error('Gemini não respondeu: ' + ultimo);
}

// ---------- 5. um caso: a IA responde (com ferramentas de mentira), a resposta vira balões, o juiz dá a nota ----------
async function responder(agente, caso, fixos) {
  const agora = new Agora(caso.quando ? Date.parse(caso.quando) : Date.now());
  const h = caso.historico; let fim = h.length; while (fim > 0 && h[fim - 1].de === 'cliente') fim--;
  const ultimas = h.slice(fim).map((m) => m.texto);
  const dados = {
    'Montar entrada': { nome: caso.nome || '', telefone: '5566900000000', jid: '5566900000000@s.whatsapp.net', texto_cliente: ultimas.join('\n'), mensagens: JSON.stringify(ultimas.map((texto, i) => ({ id: 'T' + i, texto }))), msgId: 'T' + (ultimas.length - 1) },
    'Sobre esta cliente': { texto: caso.ficha || fixos.fichaNova }, 'Áudios disponíveis': { texto: fixos.audios },
    'Supabase: tabela de serviços': fixos.servicos, 'Supabase: respostas aprendidas': fixos.aprendidas || {},
  };
  let situacoes = null; let modelo = agente.sistema;
  if (NOVO) { // prompt modular: o roteador diz a situação e o prompt leva só o núcleo e os blocos dela
    const conv = h.slice(-8).map((m) => (m.de === 'cliente' ? 'CLIENTE: ' : 'SALÃO: ') + m.texto).join('\n');
    const r = await gemini(agente.modelo, { contents: [{ role: 'user', parts: [{ text: modular.pedidoRoteador(conv, caso.ficha || fixos.fichaNova) }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } });
    const t = ((r.candidates[0].content && r.candidates[0].content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    try { situacoes = JSON.parse(t.replace(/^```json\s*|\s*```$/g, '')).situacoes; } catch (e) { situacoes = []; }
    situacoes = (situacoes || []).filter((x) => modular.SITUACOES[x]).slice(0, 3);
    modelo = modular.modeloModular(situacoes);
  }
  const sistema = montarSistema(modelo, ambiente(dados, agora));
  // histórico no formato do Gemini: mensagens seguidas do mesmo lado viram uma só
  const conteudo = [];
  for (const m of h) { const role = m.de === 'cliente' ? 'user' : 'model'; const u = conteudo[conteudo.length - 1]; if (u && u.role === role) u.parts[0].text += '\n' + m.texto; else conteudo.push({ role, parts: [{ text: m.texto }] }); }
  if (conteudo[0].role === 'model') conteudo.unshift({ role: 'user', parts: [{ text: '[a conversa começa com uma mensagem que o salão mandou para a cliente]' }] });
  const respostas = { ...RESPOSTA_PADRAO(agora.plus({ days: 1 }).toFormat('dd/LL/yyyy')), ...(caso.ferramentas || {}) };
  const usadas = []; let texto = '';
  for (let volta = 0; volta < 5; volta++) {
    const r = await gemini(agente.modelo, { systemInstruction: { parts: [{ text: sistema }] }, contents: conteudo, tools: [{ functionDeclarations: agente.ferramentas }], generationConfig: { temperature: agente.temperatura } });
    const partes = (r.candidates[0].content && r.candidates[0].content.parts) || [];
    const chamadas = partes.filter((p) => p.functionCall);
    // o modelo às vezes escreve a resposta na mesma volta em que chama uma ferramenta e depois devolve vazio:
    // vale o último texto que ele escreveu
    const escrito = partes.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    if (escrito.trim() || !texto) texto = escrito;
    if (!chamadas.length) break;
    conteudo.push({ role: 'model', parts: partes }); // devolve como veio (inclui a assinatura de raciocínio do Gemini 3)
    conteudo.push({ role: 'user', parts: chamadas.map((p) => { usadas.push({ nome: p.functionCall.name, args: p.functionCall.args || {} }); return { functionResponse: { name: p.functionCall.name, response: { resposta: respostas[p.functionCall.name] || 'OK' } } }; }) });
  }
  const { baloes, falhou, semFiltro } = baloesDe(agente.quebrar, texto, dados, agora);
  let finais = baloes;
  if (EDITOR && baloes.length && !falhou) finais = await editar(agente.modelo, h, baloes);
  return { baloes: finais, rascunho: baloes, bruto: texto, usadas, falhou, semFiltro, situacoes, letras: sistema.length };
}

// ---------- 5b. o editor: segunda passada, só sobre o JEITO de falar ----------
// A IA que decide o que dizer (com agenda e ferramentas) escreve um rascunho. O editor recebe o rascunho, as últimas
// mensagens e um guia curto de fala, e devolve a mesma resposta com jeito de gente. Ele não pode mudar fato nenhum:
// se mexer em número, horário ou link, vale o rascunho.
const numeros = (t) => (String(t).match(/\d+[\d:.,hx]*|https?:\/\/\S+/g) || []).map((x) => x.replace(/[.,]$/, '')).sort().join('|');
async function editar(modelo, historico, baloes) {
  const ultCliente = []; for (let i = historico.length - 1; i >= 0 && historico[i].de === 'cliente'; i--) ultCliente.unshift(historico[i].texto);
  const iaAntes = historico.filter((m) => m.de === 'ia').slice(-4).map((m) => m.texto);
  const rascunho = baloes.join('\n\n');
  const pedido = 'Você é a editora de uma atendente de salão que conversa por WhatsApp. Reescreva o RASCUNHO para soar como uma pessoa de verdade digitando no celular, sem mudar o que ele informa.\n\n' +
    'NÃO PODE MUDAR: preços, horários, datas, endereço, links, nomes, o que foi marcado ou perguntado para a Gleide, e o sentido de cada informação. Não acrescente informação nova nem promessa.\n\n' +
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
    '- Se o rascunho traz a apresentação "Sou a assistente virtual do Toda Bonita Mega Hair, aqui em Sinop", mantenha essa frase inteira: a cliente precisa saber que fala com uma assistente virtual.\n' +
    '- Se a cliente contou algo pessoal ou triste (uma perda, um medo, uma data importante), uma frase curta de carinho fica; o que sai é repetir o que ela disse.\n' +
    '- Se o rascunho responde a uma pergunta da cliente, a resposta vem primeiro.\n' +
    '- No máximo 2 balões (separe com uma linha em branco). Mantenha a pergunta do rascunho só se ela for necessária para a conversa andar; nunca mais de uma.\n' +
    '- Continua simpática e gentil. Não fique seca.\n\n' +
    '=== ÚLTIMAS RESPOSTAS DA ATENDENTE (para não repetir a forma) ===\n' + (iaAntes.join('\n') || '(nenhuma)') +
    '\n\n=== O QUE A CLIENTE ACABOU DE ESCREVER ===\n' + ultCliente.join('\n') +
    '\n\n=== RASCUNHO ===\n' + rascunho +
    '\n\nDevolva só o texto final, pronto para enviar.';
  try {
    const r = await gemini(modelo, { contents: [{ role: 'user', parts: [{ text: pedido }] }], generationConfig: { temperature: 0.7 } });
    const t = ((r.candidates[0].content && r.candidates[0].content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    if (!t || numeros(t) !== numeros(rascunho)) return baloes; // mexeu em número, horário ou link: fica o rascunho
    return t.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean).slice(0, 3);
  } catch (e) { return baloes; }
}

const JUIZ = fs.readFileSync(path.join(AQUI, 'criterios.md'), 'utf8').split('## Conferências automáticas')[0];
async function julgar(modeloJuiz, caso, resp) {
  const conversa = caso.historico.map((m) => (m.de === 'cliente' ? 'CLIENTE: ' : 'SALÃO (IA): ') + m.texto).join('\n');
  const pedido = 'Você avalia respostas de uma atendente virtual de um salão de mega hair (Toda Bonita Mega Hair, Sinop/MT) no WhatsApp. ' +
    'Você é um avaliador duro: a maioria das respostas tem defeito e a sua função é achar. Leia a resposta procurando primeiro o que está errado em cada critério; só depois dê a nota. Não dê 2 por educação.\n\n' + JUIZ +
    '\nFatos do salão para o critério "fiel": mão de obra da aplicação e da manutenção R$ 150 por tela; o valor do cabelo só a Gleide passa (a IA nunca diz valor nem faixa de cabelo); a avaliação é gratuita; ' +
    'promoção em vigor: quem vai colocar o mega parcela cabelo e colocação em até 10x sem juros no cartão, e a manutenção de quem já usa não entra; a IA não diz a data final da promoção; ' +
    'endereço Rua das Papoulas, 443, Jardim Paraíso, Sinop; a IA não fala de sinal nem de multa ao marcar; quem escolhe a técnica é a Gleide, na avaliação.\n\n' +
    'A promoção em vigor se chama promoção de Natal e fim de ano; a Gleide recomenda manutenção em até 60 dias. ' +
    'Também são fatos: o mega hair do salão é feito com cabelo humano e a cliente cuida dele como cuida do próprio cabelo; a avaliação online é por ligação de voz no WhatsApp. ' +
    'Não são defeitos: chamar a cliente pelo nome abaixo (vem do WhatsApp); a apresentação padrão na primeira mensagem ("sou a assistente virtual do Toda Bonita Mega Hair, aqui em Sinop"); ' +
    'convidar para a avaliação já com dois horários QUANDO a cliente já contou o motivo ou o desejo dela. Na primeira mensagem de uma cliente que quase não disse nada, "especifica" vale 2 se a resposta reage ao pouco que ela disse.\n\n' +
    '=== NOME DA CLIENTE NO WHATSAPP ===\n' + (caso.nome || '(sem nome)') +
    '\n\n=== FICHA DA CLIENTE ===\n' + (caso.ficha || 'Cliente nova, primeiro contato.') +
    '\n\n=== CONVERSA ATÉ AQUI ===\n' + conversa +
    '\n\n=== RESPOSTA A AVALIAR (cada balão é uma mensagem separada no WhatsApp) ===\n' + (resp.baloes.map((b, i) => '[balão ' + (i + 1) + '] ' + b).join('\n') || '(a IA não escreveu nada)') +
    '\n\n=== FERRAMENTAS QUE A IA USOU ===\n' + (resp.usadas.map((u) => u.nome + ' ' + JSON.stringify(u.args)).join('\n') || '(nenhuma)') +
    '\n\n=== ESPERADO NESTE CASO ===\n' + caso.esperado +
    '\n\nResponda só com JSON, nesta ordem (primeiro os defeitos, depois as notas): {"defeitos":["cada defeito que você achou, citando o trecho"],"calor":0-2,"responde":0-2,"conduz":0-2,"especifica":0-2,"fiel":0-2,"esperado":0-2,"motivo":"uma frase curta, em português, com o principal erro (ou o principal acerto, se não houver erro)"}';
  const r = await gemini(modeloJuiz, { contents: [{ role: 'user', parts: [{ text: pedido }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } });
  const t = ((r.candidates[0].content && r.candidates[0].content.parts) || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  try { return JSON.parse(t.replace(/^```json\s*|\s*```$/g, '')); } catch (e) { return { motivo: 'o juiz não devolveu JSON: ' + t.slice(0, 80) }; }
}

// ---------- 6. rodada ----------
(async () => {
  const todos = JSON.parse(fs.readFileSync(path.join(AQUI, 'casos.json'), 'utf8'));
  const filtro = typeof opc('casos') === 'string' ? opc('casos').split(',') : null;
  const casos = filtro ? todos.filter((c) => filtro.some((f) => c.id === f || c.id.startsWith(f))) : todos;
  if (!casos.length) throw new Error('nenhum caso com esse nome');
  const fixos = JSON.parse(fs.readFileSync(path.join(AQUI, 'fixos.json'), 'utf8'));
  const precosDaTabela = fixos.servicos.map((s) => Number(s.preco)).filter((v) => v > 0);

  let cred = String(env.N8N_GEMINI_TESTE_CRED_ID || '').trim();
  if (opc('chave-das-clientes')) {
    // a credencial que vale é a do fluxo que está no ar (a do .env pode estar velha)
    const noAr = await (await fetch(N8N + '/api/v1/workflows/' + fs.readFileSync(path.join(DIR, '.workflow-id'), 'utf8').trim(), { headers: N })).json();
    const comChave = (noAr.nodes || []).find((n) => n.credentials && n.credentials.googlePalmApi);
    cred = String((comChave && comChave.credentials.googlePalmApi.id) || env.N8N_GEMINI_CRED_ID || '').trim(); console.log('ATENÇÃO: usando a chave do Gemini das clientes (gasta do mesmo limite da IA que atende).'); }
  else if (cred && cred === String(env.N8N_GEMINI_CRED_ID || '').trim()) throw new Error('N8N_GEMINI_TESTE_CRED_ID é igual à credencial das clientes.');
  if (!cred && !SECO) throw new Error('Falta N8N_GEMINI_TESTE_CRED_ID no .env (credencial "Gemini - testes" do n8n). Com o ok do Victor, rode com --chave-das-clientes.');

  const agente = gerarAgente();
  const modeloJuiz = typeof opc('juiz') === 'string' ? opc('juiz') : agente.modelo;
  console.log('prompt:', (agente.sistema.match(/VERS[ÃA]O [\d.]+/) || ['?'])[0], '|', agente.sistema.length, 'letras | modelo', agente.modelo, '| temperatura', agente.temperatura, '| ferramentas', agente.ferramentas.length, '| casos', casos.length, 'x', VEZES);

  if (SECO) { const c = casos[0]; const ag = new Agora(Date.now()); const d = { 'Montar entrada': { nome: c.nome, telefone: '5566900000000' }, 'Sobre esta cliente': { texto: c.ficha || fixos.fichaNova }, 'Áudios disponíveis': { texto: fixos.audios }, 'Supabase: tabela de serviços': fixos.servicos, 'Supabase: respostas aprendidas': fixos.aprendidas || {} };
    const sis = montarSistema(agente.sistema, ambiente(d, ag)); if (/\{\{|undefined|\[object/.test(sis.slice(-9000))) throw new Error('o fim do prompt ficou com expressão sem resolver');
    console.log(['--- fim do prompt montado (ensaio a seco) ---', sis.slice(-2600), '--- ferramentas ---'].concat(agente.ferramentas.map((t) => t.name + '(' + Object.keys((t.parameters || {}).properties || {}).join(', ') + ')')).join(String.fromCharCode(10))); }
  // --simular: conversas INTEIRAS. Uma cliente de mentira (personas.json) conversa com a IA por vários turnos.
  // Serve para ver a condução, que uma resposta solta não mostra. Não dá nota: é para uma pessoa ler e julgar.
  if (opc('simular')) {
    const personas = JSON.parse(fs.readFileSync(path.join(AQUI, 'personas.json'), 'utf8')).filter((p) => !filtro || filtro.some((f) => p.id.startsWith(f)));
    const TURNOS = Math.max(2, Math.min(10, Number(opc('turnos')) || 7));
    const p = await criarPonte(cred); const saida = [];
    try {
      await Promise.all(personas.map(async (per) => {
        const historico = per.abertura.map((texto) => ({ de: 'cliente', texto })); const passos = []; let fim = '';
        for (let t = 0; t < TURNOS && !fim; t++) {
          let resp;
          try { resp = await responder(agente, { nome: per.nome, ficha: per.ficha, historico }, fixos); } catch (e) { fim = 'erro: ' + e.message.slice(0, 120); break; }
          for (const b of resp.baloes) historico.push({ de: 'ia', texto: b });
          passos.push({ baloes: resp.baloes, usadas: resp.usadas.map((u) => u.nome), situacoes: resp.situacoes });
          if (resp.usadas.some((u) => u.nome === 'criar_agendamento')) { fim = 'marcou horário'; break; }
          if (!resp.baloes.length) { fim = 'a IA não respondeu'; break; }
          const conv = historico.map((m) => (m.de === 'cliente' ? 'VOCÊ: ' : 'SALÃO: ') + m.texto).join('\n');
          const pedido = 'Você vai fazer o papel de uma CLIENTE REAL conversando por WhatsApp com um salão de mega hair. Fique no papel.\n\nQUEM VOCÊ É: ' + per.nome + '. ' + per.persona +
            '\n\nCOMO VOCÊ ESCREVE: como gente escreve no WhatsApp, mensagens curtas, às vezes com erro de digitação, sem pontuação caprichada. Responda só ao que faz sentido para você. Não entregue tudo de uma vez: conte as coisas aos poucos, conforme a atendente perguntar bem. ' +
            'Se a atendente fizer algo que faria você desistir (pressão, formulário, ignorar o que você disse, pergunta que você não sabe responder repetida), responda seco ou escreva exatamente [SUMIU]. Se você decidiu não seguir agora, despeça-se e termine com [FIM]. Se aceitar um horário, diga qual.\n\n' +
            'CONVERSA ATÉ AGORA:\n' + conv + '\n\nEscreva só a sua próxima mensagem (pode ser de 1 a 3 mensagens curtas, uma por linha), sem aspas e sem "VOCÊ:".';
          const r = await gemini(agente.modelo, { contents: [{ role: 'user', parts: [{ text: pedido }] }], generationConfig: { temperature: 0.8 } });
          const fala = ((r.candidates[0].content && r.candidates[0].content.parts) || []).filter((x) => x.text && !x.thought).map((x) => x.text).join('').trim();
          if (/\[SUMIU\]/.test(fala)) { fim = 'a cliente sumiu'; break; }
          for (const linha of fala.replace(/\[FIM\]/g, '').split(/\n+/).map((s) => s.trim()).filter(Boolean).slice(0, 3)) historico.push({ de: 'cliente', texto: linha });
          if (/\[FIM\]/.test(fala)) fim = 'a cliente encerrou';
        }
        saida.push({ id: per.id, nome: per.nome, persona: per.persona, fim: fim || 'acabaram os turnos', historico, passos });
        console.log(per.id.padEnd(28), '→', fim || 'acabaram os turnos');
      }));
    } finally { await apagarPonte(p); }
    saida.sort((a, b) => personas.findIndex((x) => x.id === a.id) - personas.findIndex((x) => x.id === b.id));
    const pasta = path.join(AQUI, 'resultados'); fs.mkdirSync(pasta, { recursive: true });
    const base = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) + '-conversas-' + rotulo;
    fs.writeFileSync(path.join(pasta, base + '.json'), JSON.stringify({ rotulo, prompt: NOVO ? 'modular' : 'no ar', conversas: saida }, null, 1));
    fs.writeFileSync(path.join(pasta, base + '.md'), '# Conversas simuladas: ' + rotulo + ' (prompt ' + (NOVO ? 'modular' : 'que está no ar') + ')\n\n' + saida.map((c) => '## ' + c.id + ' — ' + c.fim + '\n\n' + c.historico.map((m) => (m.de === 'cliente' ? '**' + c.nome + ':** ' : '> ') + m.texto.replace(/\n/g, m.de === 'cliente' ? ' ' : '\n> ')).join('\n\n')).join('\n\n') + '\n');
    console.log('Conversas: testes/banco/resultados/' + base + '.md | tokens ' + gasto.entrada + ' entrada, ' + gasto.saida + ' saída');
    return;
  }
  // --calibrar: testa o JUIZ com respostas reais que sabemos que foram ruins ou boas (calibragem.json)
  if (opc('calibrar')) {
    const cal = JSON.parse(fs.readFileSync(path.join(AQUI, 'calibragem.json'), 'utf8'));
    const p = await criarPonte(cred); let erros = 0;
    try {
      for (const c of cal) {
        const resp = { baloes: c.resposta_real, usadas: (c.ferramentas_reais || []).map((nome) => ({ nome, args: {} })) };
        const falhas = conferir(resp.baloes, c, { precosDaTabela, ferramentas: c.ferramentas_reais || [] });
        const juiz = await julgar(modeloJuiz, c, resp); const n = nota(juiz, falhas);
        const certo = c.nota_maxima != null ? n <= c.nota_maxima : n >= c.nota_minima; if (!certo) erros++;
        console.log((certo ? 'ok   ' : 'ERROU') + ' nota ' + String(n).padStart(4) + ' (esperado ' + (c.nota_maxima != null ? 'até ' + c.nota_maxima : 'a partir de ' + c.nota_minima) + ')  ' + c.id);
        console.log('      ' + CRITERIOS.map((k) => k + ' ' + (juiz[k] ?? '?')).join(', ') + (falhas.length ? ' | falhas: ' + falhas.map((f) => f.regra).join('; ') : ''));
        console.log('      ' + String(juiz.motivo || '').slice(0, 200));
      }
    } finally { await apagarPonte(p); }
    console.log(erros ? 'O juiz errou ' + erros + ' de ' + cal.length + ': ajuste a régua em criterios.md.' : 'O juiz acertou as ' + cal.length + ' respostas de calibragem.');
    console.log('tokens ' + gasto.entrada + ' entrada, ' + gasto.saida + ' saída');
    return;
  }
  const ponte = SECO ? null : await criarPonte(cred);
  const resultados = [];
  try {
    const fila = casos.slice();
    const trabalhar = async () => {
      for (let caso = fila.shift(); caso; caso = fila.shift()) {
        const rodadas = [];
        for (let v = 0; v < VEZES; v++) {
          try {
            const resp = await responder(agente, caso, fixos);
            const falhas = conferir(resp.baloes, caso, { precosDaTabela, ferramentas: resp.usadas.map((u) => u.nome) });
            const juiz = await julgar(modeloJuiz, caso, resp);
            const n = nota(juiz, falhas);
            rodadas.push({ baloes: resp.baloes, usadas: resp.usadas.map((u) => u.nome), falhas, juiz, nota: n, passou: passou(n, juiz, falhas), semFiltro: !!resp.semFiltro, situacoes: resp.situacoes, letras: resp.letras });
          } catch (e) { if (String(e.message).startsWith('PARAR')) throw e; rodadas.push({ baloes: [], usadas: [], falhas: [{ regra: 'erro no teste', grave: true, detalhe: e.message.slice(0, 200) }], juiz: {}, nota: 0, passou: false, erro: true }); }
        }
        const media = Math.round((rodadas.reduce((s, r) => s + r.nota, 0) / rodadas.length) * 10) / 10;
        resultados.push({ id: caso.id, etapa: caso.etapa, origem: caso.origem, nota: media, passou: rodadas.every((r) => r.passou), rodadas });
        console.log((rodadas.every((r) => r.passou) ? 'ok   ' : 'FALHA') + ' ' + String(media).padStart(4) + '  ' + caso.id + (rodadas[0].falhas.length ? '  [' + rodadas[0].falhas.map((f) => f.regra).join('; ') + ']' : ''));
      }
    };
    await Promise.all(Array.from({ length: JUNTOS }, trabalhar));
  } finally {
    if (!SECO) console.log(await apagarPonte(ponte) ? 'fluxo temporário apagado' : 'ATENÇÃO: não consegui apagar o fluxo "TEMP - banco de testes (apagar)" no n8n; apague à mão.');
  }

  // ---------- 7. relatório ----------
  resultados.sort((a, b) => casos.findIndex((c) => c.id === a.id) - casos.findIndex((c) => c.id === b.id));
  const validos = resultados.filter((r) => !r.rodadas.every((x) => x.erro));
  const med = (lista) => (lista.length ? Math.round((lista.reduce((s, x) => s + x, 0) / lista.length) * 100) / 100 : 0);
  const resumo = { rotulo, quando: new Date().toISOString(), prompt: (agente.sistema.match(/VERS[ÃA]O [\d.]+/) || ['?'])[0], letras: agente.sistema.length, modelo: agente.modelo, juiz: modeloJuiz, vezes: VEZES,
    casos: resultados.length, passaram: resultados.filter((r) => r.passou).length, media: med(validos.map((r) => r.nota)),
    criterios: Object.fromEntries(CRITERIOS.map((k) => [k, med(validos.flatMap((r) => r.rodadas.filter((x) => !x.erro).map((x) => Number(x.juiz[k]) || 0)))])),
    falhas: {}, tokens: gasto };
  for (const r of resultados) for (const x of r.rodadas) for (const f of x.falhas) resumo.falhas[f.regra.replace(/ \(.*\)$/, '')] = (resumo.falhas[f.regra.replace(/ \(.*\)$/, '')] || 0) + 1;

  if (SECO) { console.log('ensaio a seco: ' + resultados.length + ' casos montados, nada gravado'); return; }
  const pasta = path.join(AQUI, 'resultados'); fs.mkdirSync(pasta, { recursive: true });
  const anteriores = fs.readdirSync(pasta).filter((f) => f.endsWith('.json')).sort();
  const alvo = typeof opc('comparar') === 'string' ? anteriores.filter((f) => f.endsWith('-' + opc('comparar') + '.json')).pop() : anteriores.filter((f) => !f.endsWith('-' + rotulo + '.json')).pop();
  const antes = alvo ? JSON.parse(fs.readFileSync(path.join(pasta, alvo), 'utf8')) : null;
  const base = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) + '-' + rotulo;
  const sinal = (d) => (d > 0 ? '+' : '') + (Math.round(d * 100) / 100);
  const L = [];
  L.push('# Banco de testes: ' + rotulo, '', resumo.prompt + ' (' + resumo.letras + ' letras), modelo ' + resumo.modelo + ', juiz ' + resumo.juiz + ', ' + VEZES + ' vez(es) por caso.', '');
  L.push('**Passaram ' + resumo.passaram + ' de ' + resumo.casos + '. Nota média ' + resumo.media + '.**' + (antes ? ' Rodada anterior (' + antes.resumo.rotulo + '): ' + antes.resumo.passaram + ' de ' + antes.resumo.casos + ', média ' + antes.resumo.media + ' (' + sinal(resumo.media - antes.resumo.media) + ').' : ''), '');
  L.push('| Critério (0 a 2) | Média |' + (antes ? ' Antes | Mudou |' : ''), '|---|---|' + (antes ? '---|---|' : ''));
  for (const k of CRITERIOS) L.push('| ' + k + ' | ' + resumo.criterios[k] + ' |' + (antes ? ' ' + antes.resumo.criterios[k] + ' | ' + sinal(resumo.criterios[k] - antes.resumo.criterios[k]) + ' |' : ''));
  L.push('', '| Falha automática | Vezes |' + (antes ? ' Antes |' : ''), '|---|---|' + (antes ? '---|' : ''));
  for (const k of [...new Set([...Object.keys(resumo.falhas), ...Object.keys((antes && antes.resumo.falhas) || {})])]) L.push('| ' + k + ' | ' + (resumo.falhas[k] || 0) + ' |' + (antes ? ' ' + (antes.resumo.falhas[k] || 0) + ' |' : ''));
  if (antes) {
    const era = Object.fromEntries(antes.resultados.map((r) => [r.id, r]));
    const mudou = resultados.filter((r) => era[r.id] && era[r.id].passou !== r.passou);
    L.push('', '## Casos que mudaram de lado', '', mudou.length ? mudou.map((r) => '- ' + (r.passou ? 'PASSOU A PASSAR' : 'PASSOU A FALHAR') + ': ' + r.id + ' (' + era[r.id].nota + ' → ' + r.nota + ')').join('\n') : 'Nenhum.');
  }
  L.push('', '## Caso a caso', '', '| Caso | Etapa | Nota | Passou | Falhas | Juiz |', '|---|---|---|---|---|---|');
  for (const r of resultados) { const x = r.rodadas[0]; L.push('| ' + r.id + ' | ' + r.etapa + ' | ' + r.nota + ' | ' + (r.passou ? 'sim' : '**não**') + ' | ' + (x.falhas.map((f) => f.regra + (f.detalhe ? ' ' + f.detalhe : '')).join('; ').replace(/\|/g, '/').replace(/\n/g, ' ') || '-') + ' | ' + String(x.juiz.motivo || '').replace(/\|/g, '/').replace(/\n/g, ' ') + ' |'); }
  L.push('', '## Respostas', '');
  for (const r of resultados) {
    const c = casos.find((k) => k.id === r.id); const x = r.rodadas[0];
    L.push('### ' + r.id + ' (' + r.nota + (r.passou ? '' : ', não passou') + ')', '', 'Cliente: ' + c.historico.filter((m) => m.de === 'cliente').slice(-2).map((m) => '"' + m.texto.replace(/\n/g, ' ') + '"').join(' + '), '');
    for (const b of x.baloes) L.push('> ' + b.replace(/\n/g, '\n> '), '');
    if (x.situacoes) L.push('Situação: ' + (x.situacoes.join(', ') || '(nenhuma)') + ' (' + x.letras + ' letras de prompt).', '');
    L.push('Ferramentas: ' + (x.usadas.join(', ') || 'nenhuma') + '. Juiz: ' + CRITERIOS.map((k) => k + ' ' + (x.juiz[k] ?? '?')).join(', ') + '.' + (x.semFiltro ? ' (sem o filtro de balões do fluxo)' : ''), '');
  }
  L.push('', 'Tokens: ' + gasto.entrada + ' de entrada (' + gasto.cache + ' em cache), ' + gasto.saida + ' de saída, ' + gasto.chamadas + ' chamadas.');
  fs.writeFileSync(path.join(pasta, base + '.md'), L.join('\n') + '\n');
  fs.writeFileSync(path.join(pasta, base + '.json'), JSON.stringify({ resumo, resultados }, null, 1));
  console.log('\nPassaram ' + resumo.passaram + ' de ' + resumo.casos + ' | média ' + resumo.media + (antes ? ' | antes ' + antes.resumo.media : '') + ' | tokens ' + gasto.entrada + ' entrada (' + gasto.cache + ' cache), ' + gasto.saida + ' saída');
  console.log('Relatório: testes/banco/resultados/' + base + '.md');
})().catch((e) => { console.error('ERRO: ' + e.message); process.exitCode = 1; });
