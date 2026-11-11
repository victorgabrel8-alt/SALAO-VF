// Catálogo em PDF da loja (só nas lojas com "catalogo_pdf" no loja.json; a Gleide não passa por aqui).
// Troca o subworkflow de fotos de cabelo (catalogo-workflows.js) por um envio simples do PDF e liga a tool
// enviar_catalogo no agente. O PDF fica no bucket privado "catalogos" do Storage, em <empresa_id>/catalogo.pdf.
// A Evolution baixa por uma URL assinada de 1 h, como nas fotos. A resposta usa "FOTOS ENVIADAS" porque é o
// que o agente reconhece como "já respondi com arquivo, posso não escrever nada" (montar-workflow.js).

const fs = require('fs');

module.exports = ({ node, str, toolSub, main, workflow, enviarWorkflow, idFile, loja, organizar }) => {
  // catalogo_link (loja.json): em vez do PDF, manda o link do catálogo do WhatsApp Business (wa.me/c/...)
  const link = loja.catalogo_link || null;
  const { arquivo, nome } = loja.catalogo_pdf || {};
  if (!link && (!arquivo || !nome)) throw new Error('catalogo_pdf: precisa de "arquivo" e "nome" (ou catalogo_link)');
  if (link && !/^https:\/\/wa\.me\/c\/\d+$/.test(link)) throw new Error('catalogo_link: use o link https://wa.me/c/<número>');
  const E = "$('Recebe pedido da IA').first().json";
  const SUPA_H = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const ifNode = (name, cond) => node(name, 'n8n-nodes-base.if', 2.2, [0, 0], {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: name, leftValue: `={{ ${cond} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    options: {},
  });
  const resposta = (name, texto) => node(name, 'n8n-nodes-base.set', 3.4, [0, 0], {
    assignments: { assignments: [str('resposta', texto)] }, options: {},
  });
  const ramos = (sim, nao) => ({ main: [[{ node: sim, type: 'main', index: 0 }], [{ node: nao, type: 'main', index: 0 }]] });

  enviarWorkflow.name = 'Catálogo - Enviar PDF';
  enviarWorkflow.nodes = [
    node('Recebe pedido da IA', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
      workflowInputs: { values: [{ name: 'telefone' }, { name: 'jid' }] },
    }),
    node('URL assinada', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: `={{ $env.SUPABASE_URL }}/storage/v1/object/sign/catalogos/${arquivo}`,
      sendHeaders: true, headerParameters: SUPA_H, sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ expiresIn: 3600 }) }}', options: { timeout: 15000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 }),
    ifNode('Gerou URL?', '!!$json.signedURL'),
    node('Enviar PDF', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendMedia/{{ $env.EVOLUTION_INSTANCE }}',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ number: ${E}.jid, mediatype: 'document', mimetype: 'application/pdf', media: $env.SUPABASE_URL + '/storage/v1' + $json.signedURL, fileName: ${JSON.stringify(nome)}, delay: 1500 }) }}`,
      options: { timeout: 60000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 }),
    ifNode('Enviou?', '!!$json.key?.id'),
    node('Registrar no CRM', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_registrar_saida',
      sendHeaders: true, headerParameters: SUPA_H, sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ p_empresa_id: $env.EMPRESA_ID, p_telefone: (() => { const d = String(${E}.telefone || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })(), p_conteudo: '📄 Catálogo em PDF enviado', p_autor: 'ia', p_tipo: 'outro', p_wa_message_id: $json.key.id }) }}`,
      options: { timeout: 15000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true }),
    resposta('Resposta (enviado)', 'FOTOS ENVIADAS: a cliente acabou de receber o catálogo em PDF, com serviços, preços, formatos de alongamento, formas de pagamento e endereço. NÃO repita nem resuma o conteúdo e NÃO pergunte automaticamente de agendamento. Se a mensagem dela tiver outras perguntas, responda só essas; se não tiver, não escreva nada (resposta vazia).'),
    resposta('Resposta (falhou)', 'CATÁLOGO NÃO ENVIADO (falha no envio). Diga em uma frase curta que não conseguiu mandar o arquivo agora, sem prometer mandar depois. Não ofereça horário nem elogie o trabalho para compensar: se ela perguntou preço, passe o preço em texto; se não, espere o que ela disser.'),
  ];
  enviarWorkflow.connections = {
    'Recebe pedido da IA': main('URL assinada'),
    'URL assinada': main('Gerou URL?'),
    'Gerou URL?': ramos('Enviar PDF', 'Resposta (falhou)'),
    'Enviar PDF': main('Enviou?'),
    'Enviou?': ramos('Registrar no CRM', 'Resposta (falhou)'),
    'Registrar no CRM': main('Resposta (enviado)'),
  };
  if (link) {
    // link do catálogo do WhatsApp: uma mensagem de texto (o WhatsApp mostra o cartão do catálogo)
    const texto = 'Aqui está o catálogo do studio:\n' + link;
    enviarWorkflow.name = 'Catálogo - Enviar link';
    enviarWorkflow.nodes = enviarWorkflow.nodes.filter((n) => !['URL assinada', 'Gerou URL?', 'Enviar PDF'].includes(n.name));
    enviarWorkflow.nodes.splice(1, 0, node('Enviar link', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
      method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ number: ${E}.jid, text: ${JSON.stringify(texto)}, linkPreview: true, delay: 1500 }) }}`,
      options: { timeout: 60000 },
    }, { onError: 'continueRegularOutput', alwaysOutputData: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 }));
    const reg = enviarWorkflow.nodes.find((n) => n.name === 'Registrar no CRM');
    reg.parameters.jsonBody = reg.parameters.jsonBody.replace("p_conteudo: '📄 Catálogo em PDF enviado'", `p_conteudo: ${JSON.stringify(texto).replace(/"/g, "'")}`);
    if (!reg.parameters.jsonBody.includes(link)) throw new Error('catalogo_link: o registro no CRM mudou');
    const ok = enviarWorkflow.nodes.find((n) => n.name === 'Resposta (enviado)').parameters.assignments.assignments[0];
    ok.value = 'FOTOS ENVIADAS: a cliente acabou de receber o link do catálogo do studio no WhatsApp, com os serviços e fotos. NÃO repita o link nem resuma o catálogo e NÃO pergunte automaticamente de agendamento. Se a mensagem dela tiver outras perguntas, responda só essas; se não tiver, não escreva nada (resposta vazia).';
    const falhou = enviarWorkflow.nodes.find((n) => n.name === 'Resposta (falhou)').parameters.assignments.assignments[0];
    falhou.value = falhou.value.replace('mandar o arquivo', 'mandar o catálogo');
    enviarWorkflow.connections = {
      'Recebe pedido da IA': main('Enviar link'),
      'Enviar link': main('Enviou?'),
      'Enviou?': ramos('Registrar no CRM', 'Resposta (falhou)'),
      'Registrar no CRM': main('Resposta (enviado)'),
    };
  }
  organizar(enviarWorkflow, enviarWorkflow.name, link ? 'Chamado pelo agente (enviar_catalogo) quando a cliente pede o catálogo: manda o link do catálogo do WhatsApp do studio.'
    : 'Chamado pelo agente (enviar_catalogo) quando a cliente pede o catálogo: gera uma URL assinada do PDF no Storage e manda pela Evolution como documento.', 1);

  // a tool de fotos fica fora do agente (fotosIndividuais: false): aqui entra a do PDF
  const lerId = () => (fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : 'ID_DO_WORKFLOW_CATALOGO');
  const M = "$('Montar entrada').first().json";
  workflow.nodes.push(toolSub('enviar_catalogo', [3800, 400],
    (link ? 'Manda para a cliente o link do catálogo do studio no WhatsApp, com os serviços e fotos dos trabalhos. '
      : 'Manda para a cliente o catálogo do estúdio em PDF, com serviços, preços, formatos de alongamento, formas de pagamento e endereço. ') +
    (link ? 'Use quando ela pedir o catálogo, fotos de trabalhos ou a lista de serviços. Preço você responde em texto. '
      : 'Use quando ela pedir o catálogo, fotos de trabalhos, a lista de serviços ou a tabela de preços. Para o preço de um serviço só, responda em texto. ') +
    'A resposta diz se foi enviado (FOTOS ENVIADAS / CATÁLOGO NÃO ENVIADO).',
    lerId, ['telefone', 'jid'], { telefone: `={{ ${M}.telefone }}`, jid: `={{ ${M}.jid }}` }, []));
  workflow.connections.enviar_catalogo = { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] };
};
