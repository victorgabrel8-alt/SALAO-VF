// Assistente da Gleide (ver docs/PLANO-IA-ALIMENTA-CRM.md, Camada 2).
// Chamado pelo montar-workflow.js: desvia no principal as mensagens dos números de ASSISTENTE_NUMEROS
// e devolve 3 workflows novos:
//   - "Assistente da Gleide"         agente que conversa com a Gleide e grava no banco do 004
//   - "Assistente - Ferramentas"     subworkflow das tools (SQL nas funções n8n_assistente_*)
//   - "Assistente - Pendências"      de 1 em 1 h (8h–20h) pergunta à Gleide o que falta no CRM
//                                    (a mesma pendência por no máximo 2 h, ver supabase/011)
//                                    (GET /webhook/assistente-pendencias dispara na hora, para testar, com o header x-webhook-token)
//
// Banco: o Supabase de verdade (o mesmo do app e do CRM), pela API com a chave de serviço, chamando as funções
// n8n_assistente_* de supabase/004 e 006. (Antes era o "salao_teste" local, credencial "Salão teste (004)".)

const EMPRESA = "$env.EMPRESA_ID || '00000000-0000-0000-0000-000000000001'";
const NUMEROS = "($env.ASSISTENTE_NUMEROS || '').split(',').map(s => s.trim()).filter(Boolean)";
const TEL = "($json.body.data.key.remoteJid.endsWith('@lid') && $json.body.data.key.remoteJidAlt ? $json.body.data.key.remoteJidAlt : $json.body.data.key.remoteJid).split('@')[0]";
// número cadastrado que bate com o telefone t (no WhatsApp, celular antigo de MT pode chegar sem o 9: 5566999990000 → 556699990000)
const NUMERO_DE = (t) => `(${NUMEROS}.find(n => n === ${t} || n.replace(/^(55\\d\\d)9(\\d{8})$/, '$1$2') === ${t}) || '')`;
const A = "$('Extrair dados').first().json";

const CAMPOS = ['acao', 'pedido_por', 'busca', 'data', 'cliente_id', 'agendamento_id', 'resultado', 'tecnica_indicada',
  'tipo_cabelo', 'comprimento_cm', 'gramas', 'valor', 'motivo_nao_fechou', 'proximo_passo', 'data_proximo_passo',
  'observacoes', 'status', 'telefone', 'nome', 'servico', 'inicio', 'texto'];

// O que cada ferramenta chama no Supabase: uma função n8n_assistente_* (supabase/004 e 006), pela API
// com a chave de serviço, como o agente de atendimento. Vazio vira null; o resto vem da IA (texto).
const MONTAR_CHAMADA = String.raw`
const e = $input.first().json;
const empresa = ${EMPRESA};
const v = (k) => (e[k] === undefined || e[k] === null ? '' : String(e[k]).trim());
const ou = (s) => (s === '' ? null : s);
const num = (k) => { const n = v(k).replace(/[^0-9,.]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return n === '' ? null : Number(n); };
const tel = (t) => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d; };
const base = { p_empresa_id: empresa, p_pedido_por: v('pedido_por') };
let funcao, args;
switch (v('acao')) {
  case 'buscar_cliente':
    funcao = 'n8n_assistente_buscar_cliente'; args = { ...base, p_busca: v('busca') };
    break;
  case 'agenda_do_dia':
    funcao = 'n8n_assistente_agenda_do_dia'; args = { ...base, p_data: ou(v('data')) };
    break;
  case 'resultado_avaliacao': {
    const inteiro = (k) => { const n = num(k); return n === null ? '' : String(Math.trunc(n)); };
    const d = { resultado: v('resultado'), tecnica_indicada: v('tecnica_indicada'), tipo_cabelo: v('tipo_cabelo'),
      comprimento_cm: inteiro('comprimento_cm'), gramas: inteiro('gramas'), valor_orcado: num('valor') === null ? '' : String(num('valor')),
      motivo_nao_fechou: v('motivo_nao_fechou'), proximo_passo: v('proximo_passo'), data_proximo_passo: v('data_proximo_passo'),
      observacoes: v('observacoes') };
    funcao = 'n8n_assistente_resultado_avaliacao'; args = { ...base, p_cliente_id: ou(v('cliente_id')), p_dados: d };
    break;
  }
  case 'status_atendimento':
    funcao = 'n8n_assistente_status_agendamento';
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_status: v('status'), p_valor: num('valor') };
    break;
  case 'registrar_atendimento':
    funcao = 'n8n_assistente_registrar_atendimento_nome';
    args = { ...base, p_telefone: tel(v('telefone')), p_nome: v('nome'), p_servico: v('servico'),
      p_inicio: v('inicio') ? v('inicio') + (/[+-]\d\d:?\d\d$|Z$/.test(v('inicio')) ? '' : '-04:00') : null,
      p_valor: num('valor'), p_observacoes: ou(v('observacoes')) };
    break;
  case 'anotar':
    funcao = 'n8n_assistente_anotar_cliente'; args = { ...base, p_cliente_id: ou(v('cliente_id')), p_texto: v('texto') };
    break;
  case 'liberar_horario':
    funcao = 'n8n_assistente_liberar_horario'; args = { ...base, p_agendamento_id: ou(v('agendamento_id')) };
    break;
  default:
    return [{ json: { erro: 'ferramenta desconhecida: ' + v('acao') } }];
}
return [{ json: { funcao, args } }];
`;

const PROMPT = `Você é a assistente pessoal da Gleide, dona do salão Toda Bonita Mega Hair (Sinop - MT).
Seu trabalho é manter o CRM do salão em dia SEM a Gleide precisar digitar nada.
Fale como uma secretária de confiança que já trabalha com ela há anos: curta, calorosa e natural, como num WhatsApp
entre colegas. Ela é ocupada: no máximo 2 frases curtas por mensagem (o resumo de confirmação pode ter mais linhas),
sem formalidade, no máximo 1 emoji. Pode usar *negrito* do WhatsApp.
Varie as palavras: não comece toda mensagem do mesmo jeito nem repita a mesma frase de confirmação.
Reaja ao que ela contou quando fizer sentido, em poucas palavras e sem exagero (fechou → "Aí sim! 🎉";
não fechou → "Ah, que pena"). Chame pelo nome de vez em quando, não em toda mensagem.
Data e hora atual: {{ $now.setZone('America/Cuiaba').toFormat("cccc, dd/MM/yyyy HH:mm", { locale: 'pt-BR' }) }} (America/Cuiaba).

O QUE FALTA ELA TE CONTAR (pendências abertas agora, com os ids para as ferramentas):
{{ (() => { const t = $('Ler pendências').first().json.data; try { return JSON.parse(t) || '(nenhuma)'; } catch (e) { return t || '(nenhuma)'; } })() }}

O QUE VOCÊ FAZ
- Registra como foram as avaliações e os atendimentos que ela contar.
- Registra o que ela falar por conta própria (cliente que veio sem marcar, anotação sobre a cliente).
- Responde dúvidas sobre as clientes ("quando a Maria veio?", "quem ficou de pensar?") usando buscar_cliente e agenda_do_dia.

COMO GRAVAR (siga sempre)
1. Descubra a cliente. Se ela estiver nas pendências acima, use o cliente_id/agendamento_id de lá.
   Senão, use buscar_cliente. Se vier mais de uma com o mesmo nome, pergunte qual (mostre os 4 últimos dígitos do telefone).
2. ANTES de gravar, mostre um resumo curto do que vai anotar e pergunte se está certo. Exemplo:
   "Anotei pra *Juliana Souza (…2222)*:
   ✅ Fechou — queratina, vietnamita 70 cm, 150 g
   💰 R$ 2.800
   Tá certo?"
   Se ela respondeu VÁRIAS pendências de uma vez (comum em áudio), faça UM resumo só, uma linha por cliente, e peça um único
   "Tá certo?". O que ela não falou (valor, gramas, cm) entra como "valor: não informado" — NÃO segure o resumo esperando isso;
   no fim do resumo, numa frase só, diga que se ela souber os valores pode mandar junto.
3. Só depois do "sim" (ou "isso", "pode", 👍) chame as ferramentas — TODAS as necessárias para o resumo confirmado, uma por cliente/ação.
   Se ela corrigir, ajuste e confirme de novo.
4. Se a ferramenta devolver ERRO, diga em uma frase que não conseguiu gravar e o motivo. Nunca diga que gravou sem o OK da ferramenta.
5. Depois de gravar, confirme em poucas palavras que ficou no CRM, variando (ex.: "Pronto, tá no CRM ✅", "Anotado ✅", "Feito, já tá na ficha dela 👍") e, se ainda houver pendência, pergunte a próxima (uma por vez).

REGRAS
- Nunca invente valor, gramas, técnica, data ou resultado. Use só o que ela disse. Faltou algo importante (ex.: fechou mas não falou o valor)? Pergunte UMA vez; se ela não souber, grave sem.
- "fechou" = vai fazer o serviço; "pensando" = ficou de decidir (pergunte quando chamar de novo e grave em data_proximo_passo); "nao_fechou" = desistiu (pergunte o motivo uma vez).
- Avaliação que fechou e já marcou a aplicação: grave o resultado com proximo_passo "aplicação marcada DD/MM às HH:mm" e
  data_proximo_passo nessa data (calcule "terça que vem" a partir da data atual), e avise que por enquanto ela põe o horário na agenda (você ainda não marca).
- Fez um serviço A MAIS do que estava na agenda (ex.: marcou corte e fez progressiva também): status_atendimento no horário
  agendado + registrar_atendimento para o serviço extra (mesmo telefone, mesmo horário).
- Pediu para chamar a cliente daqui X dias: calcule a data e grave com anotar ("Chamar em DD/MM: motivo"). Diga que ficou anotado
  na ficha (o envio automático ainda não existe — não prometa que você vai mandar).
- Uma pergunta por mensagem. Se ela não responder algo, não insista.
- Cliente que NÃO veio: depois da confirmação, grave status faltou. A IA de atendimento chama a cliente sozinha (em até
  5 min, no horário do salão) para marcar outro horário, e você avisa a Gleide quando ela remarcar ou se não responder.
  Diga isso numa frase curta ("Anotei a falta. Vou chamar ela pra remarcar e te aviso 👍").
- Cliente ATRASADA (pendência atraso_confirmar, ou o aviso "⏰ … não chegou nem respondeu. Ela está aí?"): aqui a resposta
  dela já é a confirmação, não peça "tá certo?" (é na hora, ela está ocupada).
  "veio", "tá aqui", "chegou" → status_atendimento realizado e responda "Beleza ✅".
  "libera", "não veio", "pode liberar" → liberar_horario e diga em uma frase o que a ferramenta respondeu sobre a vaga.
  Se não ficou claro, pergunte só "Ela veio?". Nunca libere sem ela dizer: sem resposta, o horário continua da cliente.
- Se ela disser que uma cliente que você liberou apareceu depois, use status_atendimento realizado (o sistema avisa se outra
  já tinha adiantado para aquele horário).
- Fora isso, você não fala com clientes. Se ela pedir "chama a Carla", diga que por enquanto você só anota, e grave isso como próximo passo.
- Avisos que você mandou ("✅ Remarquei…", "⚠️ … não respondeu") ficam na conversa: se ela responder a eles, entenda pelo contexto.
- Mensagens que começam com [áudio] são a transcrição de um áudio dela.`;

module.exports = ({ env, node, str, main, toolSub, workflow }) => {
  const REDIS = { redis: { id: env.N8N_REDIS_CRED_ID || '', name: 'Redis local' } };
  const GEMINI = env.N8N_GEMINI_CRED_ID ? { googlePalmApi: { id: env.N8N_GEMINI_CRED_ID, name: 'Google Gemini(PaLM) Api account' } } : {};
  const EVO = '={{ $env.EVOLUTION_URL }}';
  const apikey = { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] };
  // Chama uma função do Supabase (POST /rest/v1/rpc/<funcao>). texto=true devolve a resposta crua em $json.data
  // (sem isso o n8n quebra uma lista em vários itens e uma lista vazia some)
  const supaHeaders = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const rpc = (name, position, funcao, args, { texto = false, ...extra } = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: `={{ $env.SUPABASE_URL }}/rest/v1/rpc/${funcao}`,
    sendHeaders: true, headerParameters: supaHeaders, sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${args}) }}`,
    options: texto ? { response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } } : {},
  }, extra);
  const ifNode = (name, position, conditions) => node(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions, combinator: 'and' },
    options: {},
  });
  const cond = (id, left) => ({ id, leftValue: left, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } });
  const evoPost = (name, position, rota, body, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: `${EVO}/${rota}/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikey, sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}`, options: {},
  }, extra);
  const settings = { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', saveManualExecutions: true };

  // ---------- 1. Principal: número da Gleide vai para a assistente (inclusive o eco do que a assistente mandou) ----------
  workflow.nodes.push(
    ifNode('É a Gleide (assistente)?', [440, -520], [cond('g1', `={{ ${NUMERO_DE('$json.telefone')} !== '' }}`)]),
    node('Repassar para a assistente', 'n8n-nodes-base.httpRequest', 4.2, [660, -600], {
      method: 'POST', url: 'http://localhost:5678/webhook/assistente-gleide',
      sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify($('Webhook Evolution').item.json.body) }}", options: {},
    }, { onError: 'continueRegularOutput' }),
  );
  const depois = workflow.connections['Extrair dados'].main[0][0].node;
  workflow.connections['Extrair dados'] = main('É a Gleide (assistente)?');
  workflow.connections['É a Gleide (assistente)?'] = { main: [
    [{ node: 'Repassar para a assistente', type: 'main', index: 0 }], [{ node: depois, type: 'main', index: 0 }],
  ] };

  // ---------- 2. Subworkflow das ferramentas ----------
  const ferramentasWorkflow = {
    name: 'Assistente - Ferramentas',
    nodes: [
      node('Recebe pedido da assistente', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: CAMPOS.map((name) => ({ name })) },
      }),
      node('Montar chamada', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: MONTAR_CHAMADA }),
      rpc('Executar no banco', [440, 0], '{{ $json.funcao }}', '$json.args', { texto: true, onError: 'continueRegularOutput' }),
      node('Resposta', 'n8n-nodes-base.set', 3.4, [660, 0], {
        assignments: { assignments: [str('resposta',
          "={{ $('Montar chamada').item.json.erro ? 'ERRO: ' + $('Montar chamada').item.json.erro : ($json.error ? 'ERRO: ' + ($json.error.message || $json.message || JSON.stringify($json.error)) : 'OK: ' + ($json.data || 'feito')) }}")] },
        options: {},
      }),
    ],
    connections: {
      'Recebe pedido da assistente': main('Montar chamada'),
      'Montar chamada': main('Executar no banco'),
      'Executar no banco': main('Resposta'),
    },
    settings: { ...settings, callerPolicy: 'workflowsFromSameOwner' },
  };

  // ---------- 3. Agente da assistente ----------
  const ferramentasIdFile = require('path').join(__dirname, '.workflow-assistente-ferramentas-id');
  const lerFerramentasId = () => (require('fs').existsSync(ferramentasIdFile) ? require('fs').readFileSync(ferramentasIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_FERRAMENTAS');
  const fixo = { pedido_por: `={{ ${A}.numero }}` };
  const tool = (name, position, description, acao, ia) => toolSub(name, position, description, lerFerramentasId, CAMPOS, { acao, ...fixo }, ia);
  const ID = (q) => [q, `${q} (uuid exato, das pendências ou de buscar_cliente / agenda_do_dia)`, 'string'];

  const assistenteWorkflow = {
    name: 'Assistente da Gleide',
    nodes: [
      node('Webhook assistente', 'n8n-nodes-base.webhook', 2, [0, 0],
        { httpMethod: 'POST', path: 'assistente-gleide', options: {} }, { webhookId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a80' }),
      node('Extrair dados', 'n8n-nodes-base.set', 3.4, [220, 0], {
        assignments: { assignments: [
          str('evento', '={{ $json.body.event }}'),
          str('jid', '={{ $json.body.data.key.remoteJid }}'),
          str('telefone', `={{ ${TEL} }}`),
          // o número como está em ASSISTENTE_NUMEROS / config.assistente_numeros (é o que o banco confere)
          str('numero', `={{ ${NUMERO_DE(TEL)} }}`),
          { id: 'a-fromMe', name: 'fromMe', value: '={{ $json.body.data.key.fromMe }}', type: 'boolean' },
          str('msgId', '={{ $json.body.data.key.id }}'),
          str('tipo', '={{ $json.body.data.messageType }}'),
          str('texto', "={{ $json.body.data.message?.conversation || $json.body.data.message?.extendedTextMessage?.text || '' }}"),
        ] },
        options: {},
      }),
      ifNode('Filtro', [440, 0], [
        cond('f1', "={{ $json.evento === 'messages.upsert' && !$json.fromMe }}"),
        cond('f2', "={{ $json.numero !== '' }}"),
        cond('f3', "={{ $json.tipo === 'audioMessage' || (['conversation', 'extendedTextMessage'].includes($json.tipo) && $json.texto.trim() !== '') }}"),
      ]),
      ifNode('É áudio?', [660, 0], [cond('au', "={{ $json.tipo === 'audioMessage' }}")]),
      evoPost('Baixar áudio (Evolution)', [880, -120], 'chat/getBase64FromMediaMessage',
        `{ message: { key: { id: ${A}.msgId } }, convertToMp4: false }`, { onError: 'continueRegularOutput' }),
      node('Transcrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [1100, -120], {
        method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ contents: [{ parts: [ { text: 'Transcreva este áudio de WhatsApp em português do Brasil, exatamente como foi falado. Responda só com a transcrição, sem comentários.' }, { inline_data: { mime_type: String($json.mimetype || 'audio/ogg').split(';')[0], data: $json.base64 } } ] }] }) }}",
        options: {},
      }, { credentials: GEMINI, onError: 'continueRegularOutput' }),
      node('Texto da mensagem', 'n8n-nodes-base.set', 3.4, [1320, 0], {
        assignments: { assignments: [str('texto',
          `={{ (() => { if (${A}.tipo !== 'audioMessage') return ${A}.texto; const r = ($json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join(' ').trim(); return r ? '[áudio] ' + r : '[áudio que não consegui ouvir]'; })() }}`)] },
        options: {},
      }),
      rpc('Ler pendências', [1540, 0], 'n8n_assistente_pendencias_texto', `{ p_empresa_id: ${EMPRESA} }`,
        { texto: true, alwaysOutputData: true, onError: 'continueRegularOutput' }),
      node('Agente assistente', '@n8n/n8n-nodes-langchain.agent', 3.1, [1760, 0], {
        promptType: 'define', text: "={{ $('Texto da mensagem').first().json.texto }}",
        options: { systemMessage: '=' + PROMPT },
      }),
      node('Gemini Flash', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, [1640, 220], {
        modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.2 },
      }, { credentials: GEMINI }),
      node('Memória (Redis)', '@n8n/n8n-nodes-langchain.memoryRedisChat', 1.5, [1800, 220], {
        sessionIdType: 'customKey', sessionKey: `=assistente:{{ ${A}.numero }}`, sessionTTL: 259200, contextWindowLength: 20,
      }, { credentials: REDIS }),
      tool('buscar_cliente', [1960, 220], 'Procura clientes pelo nome ou telefone. Devolve id, telefone, status, etapa do funil, pré-avaliação, valor orçado e observações.',
        'buscar_cliente', [['busca', 'Nome (ou parte) ou telefone da cliente', 'string']]),
      tool('agenda_do_dia', [2120, 220], 'Lista os horários de um dia (com agendamento_id, hora, cliente, serviço, status).',
        'agenda_do_dia', [['data', 'Dia AAAA-MM-DD (vazio = hoje)', 'string']]),
      tool('resultado_avaliacao', [2280, 220], 'Grava o resultado de uma avaliação. Só use DEPOIS que a Gleide confirmou o resumo.',
        'resultado_avaliacao', [ID('cliente_id'),
          ['resultado', 'fechou, pensando ou nao_fechou', 'string'],
          ['tecnica_indicada', 'Técnica que a Gleide indicou (ex.: queratina, fita adesiva)', 'string'],
          ['tipo_cabelo', 'Tipo de cabelo (ex.: brasileiro, vietnamita)', 'string'],
          ['comprimento_cm', 'Comprimento em cm, só o número', 'string'],
          ['gramas', 'Gramas, só o número', 'string'],
          ['valor', 'Valor orçado em reais, só o número (ex.: 2800)', 'string'],
          ['motivo_nao_fechou', 'Se não fechou: motivo', 'string'],
          ['proximo_passo', 'Próximo passo combinado (ex.: chamar sexta)', 'string'],
          ['data_proximo_passo', 'Data do próximo passo AAAA-MM-DD', 'string'],
          ['observacoes', 'Outras observações da Gleide', 'string']]),
      tool('status_atendimento', [2440, 220], 'Marca um horário como realizado (veio), faltou ou cancelado. Só use DEPOIS da confirmação.',
        'status_atendimento', [ID('agendamento_id'),
          ['status', 'realizado, faltou ou cancelado', 'string'],
          ['valor', 'Valor cobrado em reais, só o número (se ela disse)', 'string']]),
      tool('registrar_atendimento', [2600, 220], 'Registra um atendimento que já aconteceu e não estava na agenda (cliente veio sem marcar). Só use DEPOIS da confirmação.',
        'registrar_atendimento', [
          ['telefone', 'Telefone da cliente (de buscar_cliente, ou o que a Gleide disser)', 'string'],
          ['nome', 'Nome da cliente', 'string'],
          ['servico', 'Serviço feito (ex.: manutenção, aplicação, avaliação)', 'string'],
          ['inicio', 'Quando foi, AAAA-MM-DDTHH:mm (vazio = agora)', 'string'],
          ['valor', 'Valor cobrado em reais, só o número', 'string'],
          ['observacoes', 'Observações', 'string']]),
      tool('anotar', [2760, 220], 'Acrescenta uma anotação na ficha da cliente (alergia, preferência, combinado). Não apaga as anteriores. Só use DEPOIS da confirmação.',
        'anotar', [ID('cliente_id'), ['texto', 'A anotação, curta', 'string']]),
      tool('liberar_horario', [2920, 220], 'Cliente atrasada que NÃO veio: marca falta e oferece o resto do horário para quem tem horário mais tarde hoje. ' +
        'Só use quando a Gleide disser "libera" ou "não veio" para essa cliente. Nunca por conta própria.',
        'liberar_horario', [ID('agendamento_id')]),
      // Ritmo de gente, como no atendimento das clientes: marca como lida, "lê" a mensagem dela,
      // mostra "digitando…" e só então responde (antes a resposta chegava na hora, parecendo robô)
      evoPost('Marcar como lida', [1430, -120], 'chat/markMessageAsRead',
        `{ readMessages: [{ remoteJid: ${A}.jid, fromMe: false, id: ${A}.msgId }] }`, { onError: 'continueRegularOutput' }),
      // lendo: 1,5 s + um pouco pelo tamanho do que ela mandou (áudio conta mais), até 4 s
      // digitando: ~30 ms por letra, entre 2 e 8 s (o WhatsApp apaga o "digitando…" em ~10 s)
      node('Ritmo humano', 'n8n-nodes-base.code', 2, [1900, -120], { jsCode: [
        "const dela = String($('Texto da mensagem').first().json.texto || '');",
        "const texto = String($json.output || '');",
        "const pausa = Math.min(4, 1.5 + dela.length / 120 + (dela.startsWith('[áudio]') ? 1 : 0));",
        "const delay = Math.round(Math.min(8000, Math.max(2000, texto.length * 30)));",
        'return [{ json: { pausa, delay } }];',
      ].join('\n') }),
      node('Pausa (lendo)', 'n8n-nodes-base.wait', 1.1, [1950, -120], { resume: 'timeInterval', amount: '={{ $json.pausa }}', unit: 'seconds' },
        { webhookId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0e' }),
      evoPost('Digitando...', [1980, -120], 'chat/sendPresence',
        `{ number: ${A}.jid, presence: 'composing', delay: $('Ritmo humano').first().json.delay }`, { onError: 'continueRegularOutput' }),
      evoPost('Responder a Gleide', [2000, 0], 'message/sendText',
        // **negrito** de markdown aparece com os asteriscos no WhatsApp: vira *negrito*
        // a resposta vem do agente (o $json que chega aqui é o do "digitando…")
        `{ number: ${A}.jid, text: ($('Agente assistente').first().json.output || 'Desculpa, deu um erro aqui. Pode repetir?').replace(/\\*\\*(.+?)\\*\\*/g, '*$1*').trim() }`,
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
    ],
    connections: {
      'Webhook assistente': main('Extrair dados'),
      'Extrair dados': main('Filtro'),
      'Filtro': main('É áudio?'),
      'É áudio?': { main: [[{ node: 'Baixar áudio (Evolution)', type: 'main', index: 0 }], [{ node: 'Texto da mensagem', type: 'main', index: 0 }]] },
      'Baixar áudio (Evolution)': main('Transcrever (Gemini)'),
      'Transcrever (Gemini)': main('Texto da mensagem'),
      'Texto da mensagem': main('Marcar como lida'),
      'Marcar como lida': main('Ler pendências'),
      'Ler pendências': main('Agente assistente'),
      'Agente assistente': main('Ritmo humano'),
      'Ritmo humano': main('Pausa (lendo)'),
      'Pausa (lendo)': main('Digitando...'),
      'Digitando...': main('Responder a Gleide'),
      'Gemini Flash': { ai_languageModel: [[{ node: 'Agente assistente', type: 'ai_languageModel', index: 0 }]] },
      'Memória (Redis)': { ai_memory: [[{ node: 'Agente assistente', type: 'ai_memory', index: 0 }]] },
      ...Object.fromEntries(['buscar_cliente', 'agenda_do_dia', 'resultado_avaliacao', 'status_atendimento', 'registrar_atendimento', 'anotar', 'liberar_horario']
        .map((t) => [t, { ai_tool: [[{ node: 'Agente assistente', type: 'ai_tool', index: 0 }]] }])),
    },
    settings,
  };

  // ---------- 4. Pendências: a assistente puxa a conversa ----------
  const pendenciasWorkflow = {
    name: 'Assistente - Pendências',
    nodes: [
      node('A cada 1 h', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'hours', hoursInterval: 1, triggerAtMinute: 0 }] } }),
      ifNode('Horário do salão?', [220, 0], [cond('h1', "={{ $now.setZone('America/Cuiaba').hour >= 8 && $now.setZone('America/Cuiaba').hour < 20 }}")]),
      node('Disparar agora (teste)', 'n8n-nodes-base.webhook', 2, [0, 200],
        { httpMethod: 'GET', path: 'assistente-pendencias', authentication: 'headerAuth', responseMode: 'lastNode', options: {} },
        // mesma senha do webhook do WhatsApp (header x-webhook-token): sem ela, ninguém dispara de fora
        { webhookId: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b91', credentials: { httpHeaderAuth: { id: env.N8N_WEBHOOK_CRED_ID || 'tV8sJuiNWidQ4Dnn', name: 'Webhook WhatsApp (senha da Evolution)' } } }),
      // a mesma pendência: na hora, +1 h e +2 h, depois para (a função já filtra, supabase/011)
      rpc('Pendências novas', [440, 100], 'n8n_assistente_pendencias_novas', `{ p_empresa_id: ${EMPRESA} }`, { onError: 'continueRegularOutput' }),
      node('Montar mensagem', 'n8n-nodes-base.code', 2, [660, 100], { jsCode: String.raw`
const ps = $input.all().map((i) => i.json).filter((p) => p.tipo);
if (!ps.length) return [];
const nome = (p) => (p.nome || 'cliente').split(' ').slice(0, 2).join(' ');
// "hoje às 18:27", "ontem às 18:27" ou "20/10 às 18:27": sem o dia, um horário de ontem confunde
const diaDe = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Cuiaba' });
const hora = (p) => {
  if (!p.inicio) return '';
  const d = new Date(p.inicio);
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Cuiaba' });
  const hoje = diaDe(new Date()), ontem = diaDe(new Date(Date.now() - 86400000)), dia = diaDe(d);
  return (dia === hoje ? 'hoje' : dia === ontem ? 'ontem' : dia.slice(8) + '/' + dia.slice(5, 7)) + ' às ' + h;
};
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const linha = (p) => {
  if (p.tipo === 'avaliacao_sem_resultado') return '• Como foi a avaliação de *' + nome(p) + '* (' + hora(p) + ')? Fechou?';
  if (p.tipo === 'atraso_confirmar') return '• *' + nome(p) + '* (' + hora(p) + ') não chegou nem respondeu. Ela está aí? *veio* ou *libera*';
  if (p.tipo === 'atendimento_sem_status') return '• *' + nome(p) + '* (' + hora(p) + (p.servico ? ', ' + p.servico.toLowerCase() : '') + ') veio?';
  return '• *' + nome(p) + '* ficou de pensar' + (p.valor_orcado ? ' (' + brl(p.valor_orcado) + ')' : '') + '. Alguma novidade?';
};
const texto = 'Oi, Gleide! Pra deixar o CRM em dia:\n' + ps.map(linha).join('\n') + '\n\nPode responder em áudio, do seu jeito 🙂';
const ids = ps.map((p) => p.pendencia_id);
const numeros = ${NUMEROS};
return numeros.map((tel) => ({ json: { tel, texto, ids,
  // mesma estrutura que o nó de memória do n8n grava, para o agente saber o que perguntou
  memoria: JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } }) } }));
` }),
      evoPost('Mandar para a Gleide', [880, 100], 'message/sendText', '{ number: $json.tel, text: $json.texto }',
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),
      node('Guardar na memória do agente', 'n8n-nodes-base.redis', 1, [1100, 100], {
        operation: 'push', list: "=assistente:{{ $('Montar mensagem').item.json.tel }}",
        messageData: "={{ $('Montar mensagem').item.json.memoria }}", tail: false,
      }, { credentials: REDIS }),
      rpc('Marcar como perguntado', [1320, 100], 'n8n_assistente_marcar_perguntado',
        `{ p_empresa_id: ${EMPRESA}, p_pedido_a: $('Montar mensagem').item.json.tel, p_ids: $('Montar mensagem').item.json.ids }`),
    ],
    connections: {
      'A cada 1 h': main('Horário do salão?'),
      'Horário do salão?': main('Pendências novas'),
      'Disparar agora (teste)': main('Pendências novas'),
      'Pendências novas': main('Montar mensagem'),
      'Montar mensagem': main('Mandar para a Gleide'),
      'Mandar para a Gleide': main('Guardar na memória do agente'),
      'Guardar na memória do agente': main('Marcar como perguntado'),
    },
    settings,
  };

  return { assistenteWorkflow, ferramentasWorkflow, pendenciasWorkflow, ferramentasIdFile };
};
