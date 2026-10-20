// CRM da demo: ficha por cliente no Postgres (banco "crm", tabela "clientes" — ver crm-schema.sql).
// Chamado pelo montar-workflow.js: encaixa os nós de CRM nos workflows existentes e devolve 2 workflows novos
// (subworkflow da tool "anotar_no_crm" e o painel web em /webhook/crm).
//
// Etapas: novo → conversa → agendado → humano → atendido / perdido
//   novo/conversa  = automático a cada mensagem      agendado = criar/remarcar na agenda deu certo
//   humano         = IA transferiu                    atendido/perdido = a Gleide marca no painel

const ETAPAS = [
  ['novo', 'Novo', '#64748b'], ['conversa', 'Em conversa', '#2563eb'], ['agendado', 'Agendado', '#16a34a'],
  ['humano', 'Com humano', '#dc2626'], ['atendido', 'Atendido', '#7c3aed'], ['perdido', 'Perdido', '#9ca3af'],
];

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
    "[ $('Preparar').item.json.telefone, $('Google: cancelar evento').item.json.error ? 'falhou' : 'ok' ]"),
  'Resposta (cancelado)');
  trocar(agendaWorkflow, 'Resposta (cancelado)', '$json.error', "$('Google: cancelar evento').item.json.error");

  inserirEntre(agendaWorkflow, 'Google: remarcar evento', sql('CRM: remarcado',
    `UPDATE clientes SET etapa = 'agendado', agendamento = $2::timestamptz, atualizado_em = now()
WHERE telefone = $1 AND $3 = 'ok'`,
    "[ $('Preparar').item.json.telefone, $('Calcular').item.json.patch.start.dateTime, $('Google: remarcar evento').item.json.id ? 'ok' : 'falhou' ]"),
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

  // ---------- 5. Painel web (GET /webhook/crm  ·  POST /webhook/crm-salvar) ----------
  const HTML = `
const ETAPAS = ${JSON.stringify(ETAPAS)};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (d, f) => d ? DateTime.fromISO(new Date(d).toISOString()).setZone('America/Cuiaba').setLocale('pt-BR').toFormat(f) : '';
const tel = (t) => String(t).replace(/^55(\\d{2})(\\d{4,5})(\\d{4})$/, '($1) $2-$3');
const rows = $input.all().map((i) => i.json).filter((r) => r.telefone);
const col = (k) => rows.filter((r) => r.etapa === k);
const card = (r) => \`<div class="card">
  <div class="top"><b>\${esc(r.nome || 'Sem nome')}</b><a href="https://wa.me/\${esc(r.telefone)}" target="_blank">\${esc(tel(r.telefone))}</a></div>
  \${r.interesse ? \`<div class="int">\${esc(r.interesse)}</div>\` : ''}
  \${r.agendamento ? \`<div class="ag">📅 \${fmt(r.agendamento, "ccc dd/LL 'às' HH'h'mm")}\${r.servico_agendado ? ' · ' + esc(r.servico_agendado) : ''}</div>\` : ''}
  \${r.resumo ? \`<div class="res">\${esc(r.resumo)}</div>\` : ''}
  <div class="meta">Último contato \${fmt(r.ultimo_contato, "dd/LL HH'h'mm")} · \${r.total_mensagens} msg</div>
  <form method="post" action="/webhook/crm-salvar">
    <input type="hidden" name="telefone" value="\${esc(r.telefone)}">
    <select name="etapa">\${ETAPAS.map(([k, n]) => \`<option value="\${k}"\${k === r.etapa ? ' selected' : ''}>\${n}</option>\`).join('')}</select>
    <textarea name="observacoes" placeholder="Anotações da Gleide…">\${esc(r.observacoes)}</textarea>
    <button>Salvar</button>
  </form>
</div>\`;
const html = \`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CRM Toda Bonita</title><style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,Segoe UI,Arial;background:#f4f1ee;color:#1f2937}
header{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:14px 18px;background:#3b2a25;color:#fff;flex-wrap:wrap}
header h1{font-size:18px;margin:0}header .n{font-size:13px;opacity:.85}header a{color:#fff;background:#ffffff22;padding:6px 12px;border-radius:8px;text-decoration:none;font-size:13px}
.board{display:flex;gap:12px;padding:14px;overflow-x:auto;align-items:flex-start}
.col{min-width:270px;max-width:300px;flex:1;background:#ebe5df;border-radius:12px;padding:10px}
.col h2{font-size:14px;margin:2px 4px 10px;display:flex;justify-content:space-between}.col h2 span{border-radius:10px;padding:0 8px;color:#fff;font-size:12px;line-height:20px}
.card{background:#fff;border-radius:10px;padding:10px;margin-bottom:10px;box-shadow:0 1px 2px #0001;font-size:13px}
.top{display:flex;justify-content:space-between;gap:8px;margin-bottom:6px}.top a{color:#16a34a;text-decoration:none;white-space:nowrap}
.int{background:#fdf2e9;border-radius:6px;padding:4px 6px;margin-bottom:6px}.ag{font-weight:600;margin-bottom:6px}
.res{color:#4b5563;margin-bottom:6px}.meta{color:#9ca3af;font-size:11px;margin-bottom:6px}
form{display:grid;gap:6px}select,textarea,button{font:inherit;font-size:12px;border:1px solid #ddd;border-radius:6px;padding:5px}
textarea{min-height:34px;resize:vertical}button{background:#3b2a25;color:#fff;border:0;cursor:pointer}
.vazio{color:#9ca3af;font-size:12px;text-align:center;padding:12px}
</style></head><body>
<header><div><h1>CRM · Toda Bonita Mega Hair</h1><div class="n">\${rows.length} \${rows.length === 1 ? 'cliente' : 'clientes'} · atualizado \${fmt(new Date(), "dd/LL HH'h'mm")}</div></div><a href="/webhook/crm">↻ Atualizar</a></header>
<div class="board">\${ETAPAS.map(([k, n, c]) => \`<section class="col"><h2>\${n}<span style="background:\${c}">\${col(k).length}</span></h2>\${col(k).map(card).join('') || '<div class="vazio">—</div>'}</section>\`).join('')}</div>
</body></html>\`;
return [{ json: { html } }];`;

  const painelWorkflow = {
    name: 'CRM - Painel',
    nodes: [
      node('Abrir painel', 'n8n-nodes-base.webhook', 2, [0, 0], { httpMethod: 'GET', path: 'crm', responseMode: 'responseNode', options: {} },
        { webhookId: '4e5f6071-8293-4a4b-8c3d-f40516273849' }),
      sql('Ler clientes', `SELECT * FROM clientes WHERE telefone NOT LIKE 'teste-%' ORDER BY COALESCE(agendamento, ultimo_contato) DESC`, '[]', { alwaysOutputData: true }),
      node('Montar painel', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: HTML.trim() }),
      node('Responder painel', 'n8n-nodes-base.respondToWebhook', 1.1, [0, 0], {
        respondWith: 'text', responseBody: '={{ $json.html }}',
        options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }] } },
      }),
      node('Salvar ficha (form)', 'n8n-nodes-base.webhook', 2, [0, 300], { httpMethod: 'POST', path: 'crm-salvar', responseMode: 'responseNode', options: {} },
        { webhookId: '5f607182-93a4-4b5c-9d4e-051627384950' }),
      sql('Salvar etapa e anotações',
        `UPDATE clientes SET etapa = $2, observacoes = NULLIF($3, ''), atualizado_em = now() WHERE telefone = $1`,
        "[ $json.body.telefone, $json.body.etapa, $json.body.observacoes || '' ]"),
      // volta ao painel com GET (o "redirect" do n8n usa 307 e repetiria o POST)
      node('Voltar ao painel', 'n8n-nodes-base.respondToWebhook', 1.1, [0, 300], {
        respondWith: 'text',
        responseBody: '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/webhook/crm"><p style="font-family:sans-serif">Salvo! Voltando ao painel…</p>',
        options: { responseHeaders: { entries: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }] } },
      }),
    ],
    connections: {},
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all' },
  };
  ligar(painelWorkflow, 'Abrir painel', 'Ler clientes');
  ligar(painelWorkflow, 'Ler clientes', 'Montar painel');
  ligar(painelWorkflow, 'Montar painel', 'Responder painel');
  ligar(painelWorkflow, 'Salvar ficha (form)', 'Salvar etapa e anotações');
  ligar(painelWorkflow, 'Salvar etapa e anotações', 'Voltar ao painel');

  // posições (visual)
  const pos = (wf, p) => wf.nodes.forEach((n) => { if (p[n.name]) n.position = p[n.name]; });
  pos(crmWorkflow, { 'Recebe pedido do agente': [0, 0], 'Anotar na ficha': [220, 0], 'Resposta': [440, 0] });
  pos(painelWorkflow, {
    'Abrir painel': [0, 0], 'Ler clientes': [220, 0], 'Montar painel': [440, 0], 'Responder painel': [660, 0],
    'Salvar ficha (form)': [0, 300], 'Salvar etapa e anotações': [220, 300], 'Voltar ao painel': [440, 300],
  });

  return { crmWorkflow, painelWorkflow };
};
