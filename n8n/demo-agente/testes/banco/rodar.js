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
  const sistema = montarSistema(agente.sistema, ambiente(dados, agora));
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
    texto = partes.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
    if (!chamadas.length) break;
    conteudo.push({ role: 'model', parts: partes }); // devolve como veio (inclui a assinatura de raciocínio do Gemini 3)
    conteudo.push({ role: 'user', parts: chamadas.map((p) => { usadas.push({ nome: p.functionCall.name, args: p.functionCall.args || {} }); return { functionResponse: { name: p.functionCall.name, response: { resposta: respostas[p.functionCall.name] || 'OK' } } }; }) });
  }
  const { baloes, falhou, semFiltro } = baloesDe(agente.quebrar, texto, dados, agora);
  return { baloes, bruto: texto, usadas, falhou, semFiltro };
}

const JUIZ = fs.readFileSync(path.join(AQUI, 'criterios.md'), 'utf8').split('## Conferências automáticas')[0];
async function julgar(modeloJuiz, caso, resp) {
  const conversa = caso.historico.map((m) => (m.de === 'cliente' ? 'CLIENTE: ' : 'SALÃO (IA): ') + m.texto).join('\n');
  const pedido = 'Você avalia respostas de uma atendente virtual de um salão de mega hair (Toda Bonita Mega Hair, Sinop/MT) no WhatsApp. ' +
    'Seja exigente e justo: nota 2 só quando o critério foi cumprido de verdade.\n\n' + JUIZ +
    '\nFatos do salão para o critério "fiel": mão de obra da aplicação e da manutenção R$ 150 por tela; o valor do cabelo só a Gleide passa (a IA nunca diz valor nem faixa de cabelo); a avaliação é gratuita; ' +
    'promoção em vigor: quem vai colocar o mega parcela cabelo e colocação em até 10x sem juros no cartão, e a manutenção de quem já usa não entra; a IA não diz a data final da promoção; ' +
    'endereço Rua das Papoulas, 443, Jardim Paraíso, Sinop; a IA não fala de sinal nem de multa ao marcar; quem escolhe a técnica é a Gleide, na avaliação.\n\n' +
    '=== FICHA DA CLIENTE ===\n' + (caso.ficha || 'Cliente nova, primeiro contato.') +
    '\n\n=== CONVERSA ATÉ AQUI ===\n' + conversa +
    '\n\n=== RESPOSTA A AVALIAR (cada balão é uma mensagem separada no WhatsApp) ===\n' + (resp.baloes.map((b, i) => '[balão ' + (i + 1) + '] ' + b).join('\n') || '(a IA não escreveu nada)') +
    '\n\n=== FERRAMENTAS QUE A IA USOU ===\n' + (resp.usadas.map((u) => u.nome + ' ' + JSON.stringify(u.args)).join('\n') || '(nenhuma)') +
    '\n\n=== ESPERADO NESTE CASO ===\n' + caso.esperado +
    '\n\nResponda só com JSON: {"calor":0-2,"responde":0-2,"conduz":0-2,"especifica":0-2,"fiel":0-2,"esperado":0-2,"motivo":"uma frase curta, em português, com o principal acerto ou erro"}';
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
  if (opc('chave-das-clientes')) { cred = String(env.N8N_GEMINI_CRED_ID || '').trim(); console.log('ATENÇÃO: usando a chave do Gemini das clientes (gasta do mesmo limite da IA que atende).'); }
  else if (cred && cred === String(env.N8N_GEMINI_CRED_ID || '').trim()) throw new Error('N8N_GEMINI_TESTE_CRED_ID é igual à credencial das clientes.');
  if (!cred && !SECO) throw new Error('Falta N8N_GEMINI_TESTE_CRED_ID no .env (credencial "Gemini - testes" do n8n). Com o ok do Victor, rode com --chave-das-clientes.');

  const agente = gerarAgente();
  const modeloJuiz = typeof opc('juiz') === 'string' ? opc('juiz') : agente.modelo;
  console.log('prompt:', (agente.sistema.match(/VERS[ÃA]O [\d.]+/) || ['?'])[0], '|', agente.sistema.length, 'letras | modelo', agente.modelo, '| temperatura', agente.temperatura, '| ferramentas', agente.ferramentas.length, '| casos', casos.length, 'x', VEZES);

  if (SECO) { const c = casos[0]; const ag = new Agora(Date.now()); const d = { 'Montar entrada': { nome: c.nome, telefone: '5566900000000' }, 'Sobre esta cliente': { texto: c.ficha || fixos.fichaNova }, 'Áudios disponíveis': { texto: fixos.audios }, 'Supabase: tabela de serviços': fixos.servicos, 'Supabase: respostas aprendidas': fixos.aprendidas || {} };
    const sis = montarSistema(agente.sistema, ambiente(d, ag)); if (/\{\{|undefined|\[object/.test(sis.slice(-9000))) throw new Error('o fim do prompt ficou com expressão sem resolver');
    console.log(['--- fim do prompt montado (ensaio a seco) ---', sis.slice(-2600), '--- ferramentas ---'].concat(agente.ferramentas.map((t) => t.name + '(' + Object.keys((t.parameters || {}).properties || {}).join(', ') + ')')).join(String.fromCharCode(10))); }
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
            rodadas.push({ baloes: resp.baloes, usadas: resp.usadas.map((u) => u.nome), falhas, juiz, nota: n, passou: passou(n, juiz, falhas), semFiltro: !!resp.semFiltro });
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
    L.push('Ferramentas: ' + (x.usadas.join(', ') || 'nenhuma') + '. Juiz: ' + CRITERIOS.map((k) => k + ' ' + (x.juiz[k] ?? '?')).join(', ') + '.' + (x.semFiltro ? ' (sem o filtro de balões do fluxo)' : ''), '');
  }
  L.push('', 'Tokens: ' + gasto.entrada + ' de entrada (' + gasto.cache + ' em cache), ' + gasto.saida + ' de saída, ' + gasto.chamadas + ' chamadas.');
  fs.writeFileSync(path.join(pasta, base + '.md'), L.join('\n') + '\n');
  fs.writeFileSync(path.join(pasta, base + '.json'), JSON.stringify({ resumo, resultados }, null, 1));
  console.log('\nPassaram ' + resumo.passaram + ' de ' + resumo.casos + ' | média ' + resumo.media + (antes ? ' | antes ' + antes.resumo.media : '') + ' | tokens ' + gasto.entrada + ' entrada (' + gasto.cache + ' cache), ' + gasto.saida + ' saída');
  console.log('Relatório: testes/banco/resultados/' + base + '.md');
})().catch((e) => { console.error('ERRO: ' + e.message); process.exitCode = 1; });
