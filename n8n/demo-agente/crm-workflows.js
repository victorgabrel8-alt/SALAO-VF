// CRM da demo: ficha por cliente no Postgres (banco "crm", tabela "clientes" — ver crm-schema.sql).
// Chamado pelo montar-workflow.js: encaixa os nós de CRM nos workflows existentes e devolve 2 workflows novos
// (subworkflow da tool "anotar_no_crm"). O painel web antigo (/webhook/crm) foi removido: o CRM é o app em crm/.
//
// Etapas: novo → conversa → agendado → humano → atendido / perdido
//   novo/conversa  = automático a cada mensagem      agendado = criar/remarcar na agenda deu certo
//   humano         = IA transferiu                    atendido/perdido = (era no painel antigo, removido)

module.exports = ({ env, node, str, main, D, toolSub, workflow, agendaWorkflow, pausaWorkflow, lerCrmId }) => {
  const PG = { postgres: { id: env.N8N_CRM_CRED_ID || '', name: 'CRM Postgres' } };
  // Postgres "executar SQL" com parâmetros $1, $2... (array = valores com vírgula não quebram)
  const sql = (name, query, params, extra = {}) => node(name, 'n8n-nodes-base.postgres', 2.5, [0, 0], {
    operation: 'executeQuery', query, options: { queryReplacement: `={{ ${params} }}` },
  }, { credentials: PG, onError: 'continueRegularOutput', ...extra });
  const ligar = (wf, de, para) => { wf.connections[de] = main(para); };
  const inserirEntre = (wf, de, novo, para) => { wf.nodes.push(novo); wf.connections[de] = main(novo.name); wf.connections[novo.name] = main(para); };
  const trocar = (wf, nome, de, para) => {
    const n = wf.nodes.find((x) => x.name === nome); const a = n.parameters.assignments.assignments[0];
    if (!a.value.includes(de)) throw new Error(`CRM: não achei "${de}" em ${nome}`);
    a.value = a.value.split(de).join(para);
  };

  // ---------- 1. Principal: cada conversa cria/atualiza a ficha ----------
  workflow.nodes.push(sql('CRM: registrar contato',
    `INSERT INTO clientes (telefone, nome, etapa, total_mensagens) VALUES ($1, NULLIF($2, ''), 'novo', 1)
ON CONFLICT (telefone) DO UPDATE SET
  nome = COALESCE(NULLIF(clientes.nome, ''), EXCLUDED.nome),
  total_mensagens = clientes.total_mensagens + 1,
  ultimo_contato = now(), atualizado_em = now(),
  etapa = CASE WHEN clientes.etapa IN ('novo', 'atendido', 'perdido') THEN 'conversa' ELSE clientes.etapa END`,
    "[ $('Montar entrada').item.json.telefone, $('Montar entrada').item.json.nome || '' ]"));
  // ramo paralelo: Montar entrada → (Marcar como lida, CRM: registrar contato)
  workflow.connections['Montar entrada'].main[0].push({ node: 'CRM: registrar contato', type: 'main', index: 0 });

  workflow.nodes.push(toolSub('anotar_no_crm', [0, 0],
    'Anota na ficha da cliente (CRM do salão) o que ela quer e um resumo curto da conversa. Use assim que descobrir o interesse ' +
    'dela (serviço, tipo de cabelo, química, orçamento) ou algo importante (objeção de preço, prazo, evento). Não avisa a cliente.',
    lerCrmId, ['telefone', 'nome', 'interesse', 'resumo'],
    { telefone: "={{ $('Montar entrada').item.json.telefone }}" },
    [
      ['interesse', 'O que ela quer, curto (ex.: "mega hair queratina, cabelo vietnamita 60 cm", "progressiva")', 'string'],
      ['resumo', 'Resumo de 1-2 frases da conversa até agora (ex.: "Achou caro, quer parcelar em 6x. Casamento em dezembro.")', 'string'],
      ['nome', 'Nome da cliente, se ela disse (senão deixe vazio)', 'string'],
    ]));
  workflow.connections.anotar_no_crm = { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] };

  // ---------- 2. Agenda: etapa acompanha criar / cancelar / remarcar (só se o Google confirmou) ----------
  inserirEntre(agendaWorkflow, 'Google: criar evento', sql('CRM: agendado',
    `INSERT INTO clientes (telefone, nome, etapa, agendamento, servico_agendado, interesse)
SELECT $1, NULLIF($2, ''), 'agendado', $3::timestamptz, $4, NULLIF($5, '') WHERE $6 = 'ok'
ON CONFLICT (telefone) DO UPDATE SET
  etapa = 'agendado', agendamento = EXCLUDED.agendamento, servico_agendado = EXCLUDED.servico_agendado,
  interesse = COALESCE(EXCLUDED.interesse, clientes.interesse),
  nome = COALESCE(NULLIF(clientes.nome, ''), EXCLUDED.nome), atualizado_em = now()`,
    "[ $('Preparar').item.json.telefone, $('Preparar').item.json.nome, $('Calcular').item.json.evento.start.dateTime, $('Preparar').item.json.servico, $('Preparar').item.json.motivo, $('Google: criar evento').item.json.id ? 'ok' : 'falhou' ]"),
  'Resposta (agendado)');
  trocar(agendaWorkflow, 'Resposta (agendado)', '$json.id', "$('Google: criar evento').item.json.id");

  inserirEntre(agendaWorkflow, 'Google: cancelar evento', sql('CRM: cancelado',
    `UPDATE clientes SET etapa = 'conversa', agendamento = NULL, servico_agendado = NULL, atualizado_em = now()
WHERE telefone = $1 AND $2 = 'ok'`,
    // sem evento no Google (marcado pelo app), o nó do Google não roda
    "[ $('Preparar').item.json.telefone, !$('Google: cancelar evento').isExecuted || $('Google: cancelar evento').item.json.error ? 'falhou' : 'ok' ]"),
  'Resposta (cancelado)');
  trocar(agendaWorkflow, 'Resposta (cancelado)', '$json.error', "$('Google: cancelar evento').item.json.error");

  inserirEntre(agendaWorkflow, 'Google: remarcar evento', sql('CRM: remarcado',
    `UPDATE clientes SET etapa = 'agendado', agendamento = $2::timestamptz, atualizado_em = now()
WHERE telefone = $1 AND $3 = 'ok'`,
    // remarcação só no Supabase (horário marcado pelo app, sem evento no Google): o nó do Google não roda
    "[ $('Preparar').item.json.telefone, $('Calcular').item.json.patch.start.dateTime, $('Google: remarcar evento').isExecuted && $('Google: remarcar evento').item.json.id ? 'ok' : 'falhou' ]"),
  'Resposta (remarcado)');
  trocar(agendaWorkflow, 'Resposta (remarcado)', '$json.id', "$('Google: remarcar evento').item.json.id");

  // ---------- 3. Pausa/transferência: etapa "Com humano" ----------
  inserirEntre(pausaWorkflow, 'Gravar pausa (12h)', sql('CRM: com humano',
    `INSERT INTO clientes (telefone, etapa, resumo) VALUES ($1, 'humano', 'Transferido: ' || $2)
ON CONFLICT (telefone) DO UPDATE SET etapa = 'humano',
  resumo = 'Transferido: ' || $2 || COALESCE(' | ' || clientes.resumo, ''), atualizado_em = now()`,
    "[ $('Recebe pedido do agente').item.json.telefone, $('Recebe pedido do agente').item.json.motivo || 'pediu atendimento humano' ]"),
  'Resposta');

  // ---------- 4. Subworkflow da tool anotar_no_crm ----------
  const crmWorkflow = {
    name: 'CRM (anotações do agente)',
    nodes: [
      node('Recebe pedido do agente', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: ['telefone', 'nome', 'interesse', 'resumo'].map((name) => ({ name })) },
      }),
      sql('Anotar na ficha',
        `INSERT INTO clientes (telefone, nome, etapa, interesse, resumo) VALUES ($1, NULLIF($4, ''), 'conversa', NULLIF($2, ''), NULLIF($3, ''))
ON CONFLICT (telefone) DO UPDATE SET
  interesse = COALESCE(NULLIF($2, ''), clientes.interesse),
  resumo = COALESCE(NULLIF($3, ''), clientes.resumo),
  nome = COALESCE(NULLIF($4, ''), clientes.nome), atualizado_em = now()`,
        "[ $json.telefone, $json.interesse || '', $json.resumo || '', $json.nome || '' ]"),
      node('Resposta', 'n8n-nodes-base.set', 3.4, [0, 0], {
        assignments: { assignments: [str('resposta', 'ANOTADO na ficha da cliente. Continue a conversa normalmente (não comente isso com ela).')] }, options: {},
      }),
    ],
    connections: {},
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', callerPolicy: 'workflowsFromSameOwner' },
  };
  ligar(crmWorkflow, 'Recebe pedido do agente', 'Anotar na ficha');
  ligar(crmWorkflow, 'Anotar na ficha', 'Resposta');

  // posições (visual)
  const pos = (wf, p) => wf.nodes.forEach((n) => { if (p[n.name]) n.position = p[n.name]; });
  pos(crmWorkflow, { 'Recebe pedido do agente': [0, 0], 'Anotar na ficha': [220, 0], 'Resposta': [440, 0] });

  return { crmWorkflow };
};
