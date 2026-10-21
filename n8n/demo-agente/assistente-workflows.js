// Assistente da Gleide (ver docs/PLANO-IA-ALIMENTA-CRM.md, Camada 2).
// Chamado pelo montar-workflow.js: desvia no principal as mensagens dos números de ASSISTENTE_NUMEROS
// e devolve 3 workflows novos:
//   - "Assistente da Gleide"         agente que conversa com a Gleide e grava no banco do 004
//   - "Assistente - Ferramentas"     subworkflow das tools (SQL nas funções n8n_assistente_*)
//   - "Assistente - Pendências"      a cada 15 min (8h–20h) pergunta à Gleide o que falta no CRM
//                                    (GET /webhook/assistente-pendencias dispara na hora, para testar)
//
// Teste: o banco é o "salao_teste" local (recriar-banco-teste.sh), credencial "Salão teste (004)".
// Na produção troca só a credencial para o Supabase.

const EMPRESA = "$env.EMPRESA_ID || '00000000-0000-0000-0000-000000000001'";
const NUMEROS = "($env.ASSISTENTE_NUMEROS || '').split(',').map(s => s.trim()).filter(Boolean)";
const TEL = "($json.body.data.key.remoteJid.endsWith('@lid') && $json.body.data.key.remoteJidAlt ? $json.body.data.key.remoteJidAlt : $json.body.data.key.remoteJid).split('@')[0]";
// número cadastrado que bate com o telefone t (no WhatsApp, celular antigo de MT pode chegar sem o 9: 5566999990000 → 556699990000)
const NUMERO_DE = (t) => `(${NUMEROS}.find(n => n === ${t} || n.replace(/^(55\\d\\d)9(\\d{8})$/, '$1$2') === ${t}) || '')`;
const A = "$('Extrair dados').item.json";

const CAMPOS = ['acao', 'pedido_por', 'busca', 'data', 'cliente_id', 'agendamento_id', 'resultado', 'tecnica_indicada',
  'tipo_cabelo', 'comprimento_cm', 'gramas', 'valor', 'motivo_nao_fechou', 'proximo_passo', 'data_proximo_passo',
  'observacoes', 'status', 'telefone', 'nome', 'servico', 'inicio', 'texto'];

// O que cada ferramenta executa. $1 = empresa, $2 = pedido_por; o resto vem da IA (sempre texto).
const MONTAR_SQL = String.raw`
const e = $input.first().json;
const empresa = ${EMPRESA};
const v = (k) => (e[k] === undefined || e[k] === null ? '' : String(e[k]).trim());
const num = (k) => v(k).replace(/[^0-9,.]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
const tel = (t) => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d; };
let query, params;
switch (v('acao')) {
  case 'buscar_cliente':
    query = "select coalesce(json_agg(x), '[]') as resultado from (" +
      " select c.id as cliente_id, c.nome, c.telefone, c.status, f.etapa, c.ultima_visita, c.proximo_agendamento," +
      "        f.pre_resumo, f.pre_tecnica_interesse, f.valor_orcado, f.data_proximo_passo, c.observacoes" +
      "   from clientes_status c join funil_clientes f on f.cliente_id = c.id" +
      "  where c.empresa_id = $1 and (c.nome ilike '%' || $2 || '%'" +
      "     or (regexp_replace($2, '\\D', '', 'g') <> '' and c.telefone like '%' || regexp_replace($2, '\\D', '', 'g') || '%'))" +
      "  order by c.ultima_mensagem desc nulls last limit 8) x";
    params = [empresa, v('busca')];
    break;
  case 'agenda_do_dia':
    query = "select coalesce(json_agg(x order by x.inicio), '[]') as resultado from (" +
      " select a.id as agendamento_id, a.cliente_id, c.nome, to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI') as hora," +
      "        a.inicio, s.nome as servico, a.status, a.valor" +
      "   from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id" +
      "  where a.empresa_id = $1 and (a.inicio at time zone 'America/Cuiaba')::date = coalesce(nullif($2, '')::date, hoje_cuiaba())) x";
    params = [empresa, v('data')];
    break;
  case 'resultado_avaliacao': {
    const d = { resultado: v('resultado'), tecnica_indicada: v('tecnica_indicada'), tipo_cabelo: v('tipo_cabelo'),
      comprimento_cm: num('comprimento_cm').split('.')[0], gramas: num('gramas').split('.')[0], valor_orcado: num('valor'),
      motivo_nao_fechou: v('motivo_nao_fechou'), proximo_passo: v('proximo_passo'), data_proximo_passo: v('data_proximo_passo'),
      observacoes: v('observacoes') };
    query = 'select n8n_assistente_resultado_avaliacao($1, $2, $3::uuid, $4::jsonb) as resultado';
    params = [empresa, v('pedido_por'), v('cliente_id'), JSON.stringify(d)];
    break;
  }
  case 'status_atendimento':
    query = "select n8n_assistente_status_agendamento($1, $2, $3::uuid, $4, nullif($5, '')::numeric) as resultado";
    params = [empresa, v('pedido_por'), v('agendamento_id'), v('status'), num('valor')];
    break;
  case 'registrar_atendimento':
    query = "select n8n_assistente_registrar_atendimento($1, $2, $3, $4," +
      " (select id from servicos where empresa_id = $1 and ativo and nome ilike '%' || $5 || '%' order by length(nome) limit 1)," +
      " coalesce(nullif($6, '')::timestamptz, now()), nullif($7, '')::numeric, nullif($8, '')) as resultado";
    params = [empresa, v('pedido_por'), tel(v('telefone')), v('nome'), v('servico'),
      v('inicio') ? v('inicio') + (/[+-]\d\d:?\d\d$|Z$/.test(v('inicio')) ? '' : '-04:00') : '', num('valor'), v('observacoes')];
    break;
  case 'anotar':
    query = 'select n8n_assistente_anotar_cliente($1, $2, $3::uuid, $4) as resultado';
    params = [empresa, v('pedido_por'), v('cliente_id'), v('texto')];
    break;
  default:
    return [{ json: { erro: 'ferramenta desconhecida: ' + v('acao') } }];
}
return [{ json: { query, params } }];
`;

const PROMPT = `Você é a assistente pessoal da Gleide, dona do salão Toda Bonita Mega Hair (Sinop - MT).
Seu trabalho é manter o CRM do salão em dia SEM a Gleide precisar digitar nada.
Ela é ocupada: mensagens curtíssimas, sem formalidade, no máximo 1 emoji. Pode usar *negrito* do WhatsApp.
Data e hora atual: {{ $now.setZone('America/Cuiaba').toFormat("cccc, dd/MM/yyyy HH:mm", { locale: 'pt-BR' }) }} (America/Cuiaba).

O QUE FALTA ELA TE CONTAR (pendências abertas agora, com os ids para as ferramentas):
{{ $('Ler pendências').first().json.pendencias }}

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
5. Depois de gravar, responda só "Pronto, tá no CRM ✅" e, se ainda houver pendência, pergunte a próxima (uma por vez).

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
- Você não fala com clientes. Se ela pedir "chama a Carla", diga que por enquanto você só anota, e grave isso como próximo passo.
- Mensagens que começam com [áudio] são a transcrição de um áudio dela.`;

module.exports = ({ env, node, str, main, toolSub, workflow }) => {
  const PG = { postgres: { id: env.N8N_ASSISTENTE_PG_CRED_ID || '', name: 'Salão teste (004)' } };
  const REDIS = { redis: { id: env.N8N_REDIS_CRED_ID || '', name: 'Redis local' } };
  const GEMINI = env.N8N_GEMINI_CRED_ID ? { googlePalmApi: { id: env.N8N_GEMINI_CRED_ID, name: 'Google Gemini(PaLM) Api account' } } : {};
  const EVO = '={{ $env.EVOLUTION_URL }}';
  const apikey = { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] };
  const sql = (name, position, query, params, extra = {}) => node(name, 'n8n-nodes-base.postgres', 2.5, position, {
    operation: 'executeQuery', query, options: { queryReplacement: `={{ ${params} }}` },
  }, { credentials: PG, ...extra });
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
      node('Montar SQL', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: MONTAR_SQL }),
      sql('Executar no banco', [440, 0], '={{ $json.query }}', '$json.params', { onError: 'continueRegularOutput' }),
      node('Resposta', 'n8n-nodes-base.set', 3.4, [660, 0], {
        assignments: { assignments: [str('resposta',
          "={{ $('Montar SQL').item.json.erro ? 'ERRO: ' + $('Montar SQL').item.json.erro : ($json.error ? 'ERRO: ' + ($json.error.message || $json.message || JSON.stringify($json.error)) : 'OK: ' + JSON.stringify($json.resultado)) }}")] },
        options: {},
      }),
    ],
    connections: {
      'Recebe pedido da assistente': main('Montar SQL'),
      'Montar SQL': main('Executar no banco'),
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
      sql('Ler pendências', [1540, 0],
        `select coalesce(string_agg(format('- [%s] %s (…%s)%s%s — cliente_id=%s%s',
           tipo, nome, right(telefone, 4),
           case when inicio is not null then ' ' || to_char(inicio at time zone 'America/Cuiaba', 'DD/MM HH24:MI') else '' end,
           case when servico is not null then ', ' || servico else '' end ||
           case when valor_orcado is not null then ', orçado R$ ' || valor_orcado else '' end ||
           case when proximo_passo is not null then ', próximo passo: ' || proximo_passo else '' end,
           cliente_id, case when agendamento_id is not null then ', agendamento_id=' || agendamento_id else '' end),
           E'\\n' order by inicio nulls last), '(nenhuma)') as pendencias
   from pendencias_gleide where empresa_id = $1`,
        `[ ${EMPRESA} ]`, { alwaysOutputData: true }),
      node('Agente assistente', '@n8n/n8n-nodes-langchain.agent', 3.1, [1760, 0], {
        promptType: 'define', text: "={{ $('Texto da mensagem').item.json.texto }}",
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
      evoPost('Responder a Gleide', [2000, 0], 'message/sendText',
        // **negrito** de markdown aparece com os asteriscos no WhatsApp: vira *negrito*
        `{ number: ${A}.jid, text: ($json.output || 'Desculpa, deu um erro aqui. Pode repetir?').replace(/\\*\\*(.+?)\\*\\*/g, '*$1*').trim() }`,
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
    ],
    connections: {
      'Webhook assistente': main('Extrair dados'),
      'Extrair dados': main('Filtro'),
      'Filtro': main('É áudio?'),
      'É áudio?': { main: [[{ node: 'Baixar áudio (Evolution)', type: 'main', index: 0 }], [{ node: 'Texto da mensagem', type: 'main', index: 0 }]] },
      'Baixar áudio (Evolution)': main('Transcrever (Gemini)'),
      'Transcrever (Gemini)': main('Texto da mensagem'),
      'Texto da mensagem': main('Ler pendências'),
      'Ler pendências': main('Agente assistente'),
      'Agente assistente': main('Responder a Gleide'),
      'Gemini Flash': { ai_languageModel: [[{ node: 'Agente assistente', type: 'ai_languageModel', index: 0 }]] },
      'Memória (Redis)': { ai_memory: [[{ node: 'Agente assistente', type: 'ai_memory', index: 0 }]] },
      ...Object.fromEntries(['buscar_cliente', 'agenda_do_dia', 'resultado_avaliacao', 'status_atendimento', 'registrar_atendimento', 'anotar']
        .map((t) => [t, { ai_tool: [[{ node: 'Agente assistente', type: 'ai_tool', index: 0 }]] }])),
    },
    settings,
  };

  // ---------- 4. Pendências: a assistente puxa a conversa ----------
  const pendenciasWorkflow = {
    name: 'Assistente - Pendências',
    nodes: [
      node('A cada 15 min', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'minutes', minutesInterval: 15 }] } }),
      ifNode('Horário do salão?', [220, 0], [cond('h1', "={{ $now.setZone('America/Cuiaba').hour >= 8 && $now.setZone('America/Cuiaba').hour < 20 }}")]),
      node('Disparar agora (teste)', 'n8n-nodes-base.webhook', 2, [0, 200],
        { httpMethod: 'GET', path: 'assistente-pendencias', responseMode: 'lastNode', options: {} }, { webhookId: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b91' }),
      // não pergunta de novo sobre a mesma pendência por 3h
      sql('Pendências novas', [440, 100],
        `select * from pendencias_gleide where empresa_id = $1
    and (perguntado_em is null or perguntado_em < now() - interval '3 hours') order by inicio nulls last`,
        `[ ${EMPRESA} ]`),
      node('Montar mensagem', 'n8n-nodes-base.code', 2, [660, 100], { jsCode: String.raw`
const ps = $input.all().map((i) => i.json).filter((p) => p.tipo);
if (!ps.length) return [];
const nome = (p) => (p.nome || 'cliente').split(' ').slice(0, 2).join(' ');
const hora = (p) => (p.inicio ? new Date(p.inicio).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Cuiaba' }) : '');
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const linha = (p) => {
  if (p.tipo === 'avaliacao_sem_resultado') return '• Como foi a avaliação da *' + nome(p) + '* (' + hora(p) + ')? Fechou?';
  if (p.tipo === 'atendimento_sem_status') return '• A *' + nome(p) + '* (' + hora(p) + (p.servico ? ', ' + p.servico.toLowerCase() : '') + ') veio?';
  return '• A *' + nome(p) + '* ficou de pensar' + (p.valor_orcado ? ' (' + brl(p.valor_orcado) + ')' : '') + '. Alguma novidade?';
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
      sql('Marcar como perguntado', [1320, 100], 'select n8n_assistente_marcar_perguntado($1, $2, $3::uuid[])',
        `[ ${EMPRESA}, $('Montar mensagem').item.json.tel, '{' + $('Montar mensagem').item.json.ids.join(',') + '}' ]`),
    ],
    connections: {
      'A cada 15 min': main('Horário do salão?'),
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
