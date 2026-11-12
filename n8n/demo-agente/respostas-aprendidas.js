// Dúvidas que a dona já respondeu viram memória da loja (supabase/042). Vale para todas as lojas, a Gleide também.
// Antes: a IA perguntava a mesma coisa à dona a cada cliente (perguntar_para_gleide) e a resposta ia só para aquela.
//
// 1. APRENDER: quando a dona responde uma pergunta (pedidos-workflows.js, depois de avisar a cliente), o Gemini
//    decide se a resposta serve para qualquer cliente (regra do salão) ou só para aquela (exceção, favor, data).
//    Se serve, grava em ia_respostas e avisa a dona do que guardou, para ela poder mandar tirar.
//    Resposta com valor em dinheiro NÃO é guardada: preço é da tabela de serviços do app.
//    Fica no fim da corrente do pedido: se falhar, a cliente já recebeu a resposta.
// 2. USAR: o agente lê as respostas guardadas (n8n_respostas_texto) e o prompt ganha o bloco "RESPOSTAS QUE A
//    GLEIDE JÁ DEU": mesma dúvida, responde sozinho, sem perguntar de novo.
// 3. DONA: na assistente, ver_respostas, tirar_resposta e ensinar_resposta.
//
// Chamado pelo montar-workflow.js depois de montar tudo e, na loja, depois do prompt próprio da assistente e
// antes do lojas.paraLoja (que troca "Gleide" pelo nome da dona da loja).

const SUPA_H = { parameters: [
  { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
  { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
] };

module.exports = ({ node, main, GEMINI, workflow, assistenteWorkflow, ferramentasWorkflow, dicaPreco = false }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`respostas-aprendidas: não achei "${nome}"`); return n; };
  const rpc = (nome, funcao, corpo, extra = {}) => node(nome, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method: 'POST', url: `={{ $env.SUPABASE_URL }}/rest/v1/rpc/${funcao}`, sendHeaders: true, headerParameters: SUPA_H,
    sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${corpo}) }}`,
    options: { timeout: 15000, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
  }, { onError: 'continueRegularOutput', alwaysOutputData: true, ...extra });
  const ifNode = (nome, expr) => node(nome, 'n8n-nodes-base.if', 2.2, [0, 0], {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: nome, leftValue: `={{ ${expr} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    options: {},
  });
  const ramos = (sim, nao) => ({ main: [sim ? [{ node: sim, type: 'main', index: 0 }] : [], nao ? [{ node: nao, type: 'main', index: 0 }] : []] });

  // ================= 2. USAR: o agente lê as respostas guardadas =================
  const antes = 'Supabase: tabela de serviços';
  const seguinte = workflow.connections[antes];
  if (!seguinte?.main?.[0]?.length) throw new Error('respostas-aprendidas: a ligação da tabela de serviços mudou');
  const LER = 'Supabase: respostas aprendidas';
  workflow.nodes.push(rpc(LER, 'n8n_respostas_texto', '{ p_empresa_id: $env.EMPRESA_ID }', { executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 }));
  workflow.connections[antes] = main(LER);
  workflow.connections[LER] = seguinte;
  const agente = achar(workflow, 'Agente IA').parameters.options;
  agente.systemMessage += `

RESPOSTAS QUE A GLEIDE JÁ DEU (dúvidas de outras clientes que ela respondeu; valem como resposta dela)
{{ (() => { const t = $('${LER}').first().json.data; let s = ''; try { s = JSON.parse(t) || ''; } catch (e) { s = typeof t === 'string' && !t.trim().startsWith('{') ? t : ''; } return String(s).trim() || '(nenhuma ainda)'; })() }}
Se a dúvida da cliente é a mesma de uma destas, responda com essa resposta, do seu jeito e curto, sem dizer que perguntou a alguém e sem usar perguntar_para_gleide de novo. Se for só parecida, ou se o caso dela tiver algo diferente, pergunte normalmente. Não tire preço daqui: preço é só o da lista SERVIÇOS E PREÇOS.`;

  // ================= 1. APRENDER: depois que a dona respondeu e a cliente foi avisada =================
  const fim = 'Pedido: confirmar à Gleide';
  achar(workflow, fim);
  if (workflow.connections[fim]) throw new Error('respostas-aprendidas: o fim da corrente do pedido mudou');
  const PD = "$('Pedido: preparar').first().json";
  const E = "$('Extrair dados').first().json";
  const INSTRUCAO = `'Uma cliente de um salão perguntou: "' + ${PD}.pergunta + '". A dona do salão respondeu: "' + ${PD}.resposta + '".\\n' +
    'Decida se essa resposta serve para QUALQUER cliente que fizer a mesma pergunta no futuro (é uma regra ou informação do salão) ' +
    'ou se vale só para esta cliente ou este dia (exceção, favor, combinação pessoal, depende de data, de agenda ou do caso dela; pistas: "desta vez", "hoje", "pra ela", "vou ver", "depende").\\n' +
    'Responda SÓ com um JSON, sem texto em volta: {"guardar": true ou false, "tem_preco": true ou false, "pergunta": "a pergunta em forma geral, sem nome de cliente, até 15 palavras", "resposta": "a resposta da dona em forma geral, fiel ao que ela disse, sem inventar nada, até 40 palavras"}.\\n' +
    'tem_preco = true quando a resposta traz valor em dinheiro, desconto ou parcela: nesse caso guardar = false. Resposta vaga, que não responde, ou na dúvida: guardar = false.'`;
  workflow.nodes.push(
    // orçamento de cabelo é valor: nunca vira resposta guardada
    ifNode('Aprender: é pergunta?', `${PD}.tipo !== 'orcamento_cabelo'`),
    node('Aprender: avaliar (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
      sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify({ contents: [{ parts: [{ text: ${INSTRUCAO} }] }] }) }}`, options: { timeout: 30000 },
    }, { credentials: GEMINI || {}, retryOnFail: true, maxTries: 2, waitBetweenTries: 2000, onError: 'continueRegularOutput', alwaysOutputData: true }),
    node('Aprender: preparar', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: String.raw`
// lê o JSON do Gemini; qualquer coisa fora do esperado = não guarda
const VALOR = /R\$\s?\d|\b\d{2,}(?:\.\d{3})*(?:,\d{2})?\s*reais\b/i;
let o = {};
try {
  const t = String($input.first().json.candidates?.[0]?.content?.parts?.filter((x) => !x.thought).map((x) => x.text || '').join('') || '');
  const m = t.match(/\{[\s\S]*\}/);
  if (m) o = JSON.parse(m[0]);
} catch (e) { o = {}; }
const pergunta = String(o.pergunta || '').trim(), resposta = String(o.resposta || '').trim();
const original = String($('Pedido: preparar').first().json.resposta || '');
const temPreco = o.tem_preco === true || VALOR.test(resposta) || VALOR.test(original);
const guardar = o.guardar === true && !temPreco && pergunta.length >= 5 && resposta.length >= 2;
return [{ json: { guardar, temPreco, pergunta, resposta } }];
` }),
    ifNode('Aprender: guardar?', '$json.guardar'),
    rpc('Aprender: guardar', 'n8n_resposta_aprender', "{ p_empresa_id: $env.EMPRESA_ID, p_pergunta: $json.pergunta, p_resposta: $json.resposta, p_origem: 'dona_respondeu' }"),
    ifNode('Aprender: guardou?', "(() => { try { return !!JSON.parse($json.data).id; } catch (e) { return false; } })()"),
    node('Aprender: avisar a Gleide', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ number: ${E}.jid, text: '📌 Guardei essa resposta para responder sozinha da próxima vez:\\n' + $('Aprender: preparar').first().json.pergunta + '\\n→ ' + $('Aprender: preparar').first().json.resposta + '\\n\\nSe não é para valer sempre, me escreve (sem citar esta mensagem): esquece a resposta sobre…' }) }}`,
      options: { timeout: 30000 },
    }, { onError: 'continueRegularOutput', executeOnce: true }),
  );
  workflow.connections[fim] = main('Aprender: é pergunta?');
  workflow.connections['Aprender: é pergunta?'] = ramos('Aprender: avaliar (Gemini)', null);
  workflow.connections['Aprender: avaliar (Gemini)'] = main('Aprender: preparar');
  workflow.connections['Aprender: preparar'] = main('Aprender: guardar?');
  workflow.connections['Aprender: guardar'] = main('Aprender: guardou?');
  workflow.connections['Aprender: guardou?'] = ramos('Aprender: avisar a Gleide', null);
  if (dicaPreco) {
    // loja que fala preço: a resposta com valor não é guardada, mas a dona fica sabendo como resolver de vez
    workflow.nodes.push(
      ifNode('Aprender: era preço?', '$json.temPreco'),
      node('Aprender: dica do preço', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
        method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
        sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ number: ${E}.jid, text: '💡 Essa resposta tem valor, então não guardei: preço eu só passo pela lista de serviços. Se esse serviço entrar em Serviços e preços no app, eu respondo sozinha da próxima vez.' }) }}`,
        options: { timeout: 30000 },
      }, { onError: 'continueRegularOutput', executeOnce: true }),
    );
    workflow.connections['Aprender: guardar?'] = ramos('Aprender: guardar', 'Aprender: era preço?');
    workflow.connections['Aprender: era preço?'] = ramos('Aprender: dica do preço', null);
  } else {
    workflow.connections['Aprender: guardar?'] = ramos('Aprender: guardar', null);
  }

  // ================= 3. DONA: ver, tirar e ensinar pela assistente =================
  const montar = achar(ferramentasWorkflow, 'Montar chamada');
  const padrao = "  default:\n    return [{ json: { erro: 'ferramenta desconhecida: ' + v('acao') } }];";
  if (!montar.parameters.jsCode.includes(padrao)) throw new Error('respostas-aprendidas: o Montar chamada da assistente mudou');
  montar.parameters.jsCode = montar.parameters.jsCode.replace(padrao, () => [
    '  // dúvidas que a dona já respondeu para a IA de atendimento (supabase/042)',
    "  case 'ver_respostas':",
    "    funcao = 'n8n_assistente_ver_respostas'; args = { ...base };",
    '    break;',
    "  case 'tirar_resposta':",
    "    funcao = 'n8n_assistente_tirar_resposta'; args = { ...base, p_qual: v('texto') };",
    '    break;',
    "  case 'ensinar_resposta':",
    "    funcao = 'n8n_assistente_ensinar_resposta'; args = { ...base, p_pergunta: v('busca'), p_resposta: v('texto') };",
    '    break;',
    padrao,
  ].join('\n'));

  // as ferramentas novas são cópias de tirar_regra (mesmo subworkflow e mesmos campos fixos)
  const modelo = achar(assistenteWorkflow, 'tirar_regra');
  const ia = (campo, desc) => `={{ $fromAI('${campo}', \`${desc}\`, 'string') }}`;
  const nova = (nome, descricao, campos) => {
    const n = JSON.parse(JSON.stringify(modelo));
    n.name = nome;
    n.id = '00000000-0000-4000-8000-0000000004' + String(assistenteWorkflow.nodes.length).padStart(2, '0').slice(-2);
    n.position = [0, 0];
    n.parameters.description = descricao;
    const fixos = Object.fromEntries(Object.entries(n.parameters.workflowInputs.value).filter(([, val]) => !String(val).includes('$fromAI')));
    n.parameters.workflowInputs.value = { ...fixos, acao: nome, ...Object.fromEntries(campos.map(([c, d]) => [c, ia(c, d)])) };
    assistenteWorkflow.nodes.push(n);
    assistenteWorkflow.connections[nome] = { ai_tool: [[{ node: 'Agente assistente', type: 'ai_tool', index: 0 }]] };
  };
  nova('ver_respostas', 'Lista as dúvidas de clientes que a Gleide já respondeu e que a IA de atendimento responde sozinha (numeradas). Use quando ela perguntar o que a IA aprendeu, o que está guardado, ou antes de tirar uma.', []);
  nova('tirar_resposta', 'Tira uma resposta guardada: a IA de atendimento volta a perguntar à Gleide quando alguma cliente tiver essa dúvida. Use quando ela disser "esquece a resposta sobre…", "isso não vale mais", "apaga essa".',
    [['texto', 'O número da resposta na lista (1, 2…) ou um pedaço da pergunta ou da resposta', 'string']]);
  nova('ensinar_resposta', 'Guarda uma resposta para a IA de atendimento usar com as clientes ("quando perguntarem X, responde Y", "pode avisar que…"). Só informação e regra do salão; NÃO use para preço (preço fica em Serviços e preços no app).',
    [['busca', 'A dúvida da cliente em forma de pergunta, curta e geral (ex.: Pode levar acompanhante?)', 'string'],
      ['texto', 'A resposta, fiel ao que ela disse (ex.: Pode sim, uma pessoa por cliente)', 'string']]);

  return {
    // chamado por último no prompt da assistente (na loja o prompt próprio substitui o padrão)
    promptAssistente: () => {
      const ag = achar(assistenteWorkflow, 'Agente assistente').parameters.options;
      ag.systemMessage += `

DÚVIDAS QUE A IA DE ATENDIMENTO JÁ SABE RESPONDER
- Quando a Gleide responde uma pergunta de cliente, a resposta que serve para todas fica guardada e a IA de atendimento responde sozinha da próxima vez. Ela recebe um aviso "📌 Guardei essa resposta…" cada vez que isso acontece.
- "O que a IA aprendeu?", "o que está guardado?": ver_respostas e mostre numerado, curto.
- "Esquece a resposta sobre…", "isso não vale mais", "apaga a 2": tirar_resposta. Confirme em uma frase o que tirou.
- "Quando perguntarem X, responde Y", "pode avisar as clientes que…": ensinar_resposta. Confirme em uma frase o que guardou. Se for preço, não guarde: diga que preço fica em Serviços e preços no app.`;
    },
  };
};
