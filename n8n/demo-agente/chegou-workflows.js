// A cliente avisou no WhatsApp que chegou ("cheguei", "tô aqui na frente"): marca o "Chegou" do horário dela
// e avisa a Gleide. Chamado pelo montar-workflow.js; encaixa um ramo no workflow principal, em paralelo ao
// atendimento (a IA responde a cliente como sempre).
//
// Por quê (12/11/2026): a cliente escreveu "to aqui na frente", a IA respondeu "a Gleide já sabe que você está
// aí" (não sabia) e, sem ninguém tocar em "Chegou" no app, o horário virou "Não atendida" depois de 1 h.
//
// Não é a IA que decide: é um filtro de palavras + a função n8n_cliente_chegou (supabase/045), que só marca
// se a cliente tem horário "agendado" começando em até 45 min ou em andamento. "Tô aqui" de quem não tem
// horário agora não vira nada. Cada horário é marcado (e avisado) uma vez só.

const EMPRESA = '$env.EMPRESA_ID';
// os mesmos números da assistente (ver assistente-workflows.js)
const NUMEROS = "($env.ASSISTENTE_NUMEROS || '5566999596740').split(',').map(s => s.trim()).filter(Boolean)";
// telefone no formato do banco (ver supabase-workflows.js)
const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;

// Mensagem curta que diz que ela JÁ está no salão. "Estou chegando", "ainda não cheguei", "quando eu chegar",
// "quero mais volume na frente" não contam.
const DISSE_QUE_CHEGOU = String.raw`={{ (() => {
  const bruto = String($('Texto da mensagem').first().json.texto || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  // áudio chega como "[áudio] cheguei"; foto e arquivo ("[foto da cliente] …") não contam
  const t = bruto.replace(/^\[audio\]\s*/, '');
  if (!t || t.length > 120 || t.startsWith('[')) return false;
  if (/\b(nao|ainda|quase|daqui|vou|chegando|quando|se eu|amanha|depois)\b/.test(t)) return false;
  return /\b(cheguei|chegamos|ja estou (aqui|ai)|estou aqui|(to|tou) aqui|to aki|(estou|to|tou) (aqui )?(na|em) (frente|porta|recepcao)|aqui (na frente|fora|na porta))\b/.test(t);
})() }}`;

const AVISO = String.raw`
const r = $input.first().json;
// "Roseli de Souza" vira "Roseli Souza"
const nome = String(r.nome || 'A cliente').split(' ').filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w)).slice(0, 2).join(' ');
const texto = '📍 *' + nome + '* avisou que chegou (' + r.hora + (r.servico ? ', ' + String(r.servico).toLowerCase() : '') + '). Já marquei "Chegou" na agenda.';
const quandoFoi = (ms) => { const d = new Date(ms - 4 * 3600e3); const p = (n) => String(n).padStart(2, '0'); return ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getUTCDay()] + ' ' + p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); };
const numeros = ${NUMEROS};
return numeros.map((tel) => ({ json: { tel, texto,
  // mesma estrutura que o nó de memória do n8n grava, para a assistente saber o que a Gleide recebeu
  memoria: JSON.stringify({ type: 'ai', data: { content: '[' + quandoFoi(Date.now()) + '] ' + texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } }) } }));
`;

module.exports = ({ node, D, workflow, REDIS }) => {
  const ifNode = (name, left) => node(name, 'n8n-nodes-base.if', 2.2, [0, 0], {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'ch-' + name.length, leftValue: left, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
      combinator: 'and' },
    options: {},
  });
  workflow.nodes.push(
    ifNode('Disse que chegou?', DISSE_QUE_CHEGOU),
    node('Supabase: cliente chegou', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_cliente_chegou',
      sendHeaders: true, headerParameters: { parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
        { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR(`${D}.telefone`)} }) }}`,
      options: { timeout: 15000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    ifNode('Marcou a chegada?', '={{ $json.marcou === true }}'),
    node('Aviso de chegada', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: AVISO }),
    node('Avisar a Gleide que chegou', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ number: $json.tel, text: $json.texto }) }}', options: {},
    }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
    node('Guardar a chegada na memória', 'n8n-nodes-base.redis', 1, [0, 0], {
      operation: 'push', list: "=assistente:{{ $('Aviso de chegada').item.json.tel }}",
      messageData: "={{ $('Aviso de chegada').item.json.memoria }}", tail: false,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
  );
  // em paralelo: o que já saía de "registrar entrada" (a pausa e o atendimento) continua igual
  const saida = workflow.connections['Supabase: registrar entrada'];
  if (!saida) throw new Error('chegou: não achei "Supabase: registrar entrada" (rode depois do supabase-workflows.js)');
  saida.main[0].push({ node: 'Disse que chegou?', type: 'main', index: 0 });
  const um = (para) => ({ main: [[{ node: para, type: 'main', index: 0 }]] });
  workflow.connections['Disse que chegou?'] = { main: [[{ node: 'Supabase: cliente chegou', type: 'main', index: 0 }], []] };
  workflow.connections['Supabase: cliente chegou'] = um('Marcou a chegada?');
  workflow.connections['Marcou a chegada?'] = { main: [[{ node: 'Aviso de chegada', type: 'main', index: 0 }], []] };
  workflow.connections['Aviso de chegada'] = um('Avisar a Gleide que chegou');
  workflow.connections['Avisar a Gleide que chegou'] = um('Guardar a chegada na memória');
};
