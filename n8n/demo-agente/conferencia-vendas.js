// Fase 2 do portão (21/11/2026): conferência semanal de vendas com a Gleide. Só na Gleide (ligado no montar-workflow.js).
// Em 20/11 o relatório da negociação contou como mega hair a recolocação do cabelo da própria cliente (Renata, Dienne).
// Toda segunda às 10h a assistente manda à Gleide, em linguagem natural, os atendimentos realizados das clientes que
// vieram pelo WhatsApp e o que ficou anotado (mega hair com cabelo novo x manutenção). Nada de número de pedido nem
// "responda sim ou não" (pedido do Victor, 21/11): ela responde do jeito dela e a assistente grava com conferir_venda.
// A mensagem entra na memória da assistente, como as pendências, para ela saber do que a Gleide está falando.
// Cada atendimento entra numa lista UMA vez (sem resposta, não cobra). Banco: supabase/066 (vendas_conferidas,
// relatorio_vendas_confirmadas: os relatórios contam só venda confirmada).

// Texto da mensagem. itens = saída de n8n_conferencia_vendas_lista. Devolve '' sem itens.
// Também é colado no n8n (nó "Conferência: montar"): nada de require nem variável de fora.
function montarConferencia(itens, agoraMs) {
  const lista = (Array.isArray(itens) ? itens : []).filter((i) => i && i.agendamento_id && i.inicio);
  if (!lista.length) return '';
  const agora = typeof agoraMs === 'number' ? agoraMs : Date.now();
  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const p2 = (n) => String(n).padStart(2, '0');
  // Cuiabá é -04:00 o ano todo
  const local = (iso) => new Date(new Date(iso).getTime() - 4 * 3600e3);
  const quando = (iso) => { const d = local(iso); return DIAS[d.getUTCDay()] + ' ' + p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1); };
  const palavras = (n) => String(n || '').trim().split(/\s+/).filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w));
  // primeiro nome; se duas clientes DIFERENTES têm o mesmo primeiro nome, vai o sobrenome também
  const nomes = {};
  for (const i of lista) { const p = (palavras(i.nome)[0] || '').toLowerCase(); (nomes[p] = nomes[p] || new Set()).add(String(i.nome || '').trim().toLowerCase()); }
  const nome = (i) => { const ws = palavras(i.nome); if (!ws.length) return 'cliente'; return nomes[ws[0].toLowerCase()].size > 1 ? ws.slice(0, 2).join(' ') : ws[0]; };
  const servico = (i) => (i.sugerido === 'mega_novo' ? 'mega hair com cabelo novo' : i.sugerido === 'manutencao' ? 'manutenção'
    : (String(i.servico || 'atendimento').replace(/\s*[–-]\s*m[ãa]o de obra\s*$/i, '').trim().toLowerCase() || 'atendimento'));
  const brl = (v) => 'R$ ' + String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const valor = (i) => (Number(i.valor) > 0 ? ', ' + brl(i.valor) : '');
  const maisVelho = Math.min(...lista.map((i) => new Date(i.inicio).getTime()));
  const periodo = agora - maisVelho > 8 * 86400e3 ? 'as últimas semanas' : 'a semana';
  if (lista.length === 1) {
    const i = lista[0];
    return 'Oi, Gleide! Fechando ' + periodo + ' das clientes que vieram pelo WhatsApp: a *' + nome(i) + '* veio ' + quando(i.inicio) +
      ' e eu anotei ' + servico(i) + valor(i) + '. Foi isso mesmo? Se foi diferente, ou se teve mais alguém, me conta que eu acerto 🙂';
  }
  return 'Oi, Gleide! Fechando ' + periodo + ' das clientes que vieram pelo WhatsApp, eu anotei assim:\n\n' +
    lista.map((i) => '• *' + nome(i) + '*, ' + quando(i.inicio) + ': ' + servico(i) + valor(i)).join('\n') +
    '\n\nTá certinho? Se alguma foi diferente (cabelo novo ou o cabelo dela mesmo), ou se teve alguém que não está aqui, me conta do seu jeito que eu acerto 🙂';
}

// O que a assistente precisa saber para entender a resposta (entra no fim do prompt dela).
const REGRAS_PROMPT = `CONFERÊNCIA DA SEMANA (vendas das clientes que vieram pelo WhatsApp)
- Toda segunda você manda à Gleide a lista dos atendimentos ("Fechando a semana…"): cada cliente com o dia e o que ficou
  anotado (mega hair com cabelo novo ou manutenção). Quando ela responder sobre essa lista, grave com conferir_venda, uma
  chamada por cliente, com o primeiro nome e o dia (data AAAA-MM-DD) que estavam na lista.
- tipo: mega_novo = colocou cabelo NOVO, que a cliente comprou; manutencao = mexeu no cabelo que a cliente JÁ TINHA
  (manutenção, recolocar, repor mechas, trocar de técnica, passar para fita); outro = outro serviço; nao_fez = não aconteceu.
- "Tá certo", "isso mesmo", "certinho", "é isso": grave cada cliente da lista do jeito que estava. Corrigiu uma ("a Renata
  foi o cabelo dela"): grave essa do jeito que ela disse; as outras só se ela disse que o resto está certo. Se ela falou de
  uma só, grave só essa e não cobre as outras.
- Quem diz se foi cabelo novo é ela. Não deu para saber pelo que ela disse? Pergunte uma vez, natural ("A da Vitoria foi
  cabelo novo ou o cabelo dela mesmo?"). Nunca escolha por ela.
- valor só se ela disse o valor daquela cliente; nunca o preço da tabela, nunca 0. Não pergunte valor.
- Ela falou de alguém que não estava na lista: conferir_venda com o nome e o dia que ela disse. Se a ferramenta disser que não
  achou o atendimento, ela veio sem estar na agenda: registrar_atendimento e depois conferir_venda.
- Depois responda curto, do jeito dela: "Anotado ✅ Vitoria com cabelo novo; Renata e Dienne, manutenção." Sem número, sem
  "responda sim ou não", sem falar em relatório ou comissão.
- Se ela não responder à lista, não cobre.`;

module.exports = ({ assistenteWorkflow: ag, pendenciasWorkflow: pe, clientesDesde = '2026-10-28', cron = '0 10 * * 1' }) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clientesDesde)) throw new Error('conferência: clientesDesde no formato AAAA-MM-DD');
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`conferência: não achei "${nome}" em ${wf.name}`); return n; };
  const copia = (wf, deNome, nome, id, position) => { const n = JSON.parse(JSON.stringify(achar(wf, deNome))); n.name = nome; n.id = id; n.position = position; return n; };
  const liga = (wf, de, para) => { wf.connections[de] = { main: [[{ node: para, type: 'main', index: 0 }]] }; };
  if (ag.nodes.some((n) => n.name === 'conferir_venda')) throw new Error('conferência: já montada');

  // ---------- ferramenta da assistente ----------
  const modelo = achar(ag, 'status_atendimento');
  const valores = modelo.parameters?.workflowInputs?.value || {};
  if (!valores.pedido_por || !valores.acao) throw new Error('conferência: a ferramenta status_atendimento mudou');
  const ia = (c, d) => `={{ $fromAI('${c}', \`${d}\`, 'string') }}`;
  const tool = JSON.parse(JSON.stringify(modelo));
  tool.name = 'conferir_venda'; tool.id = 'c0f3e1a0-0066-4a00-8000-000000000001'; tool.position = [3080, 220];
  tool.parameters.description = 'Grava o que a Gleide confirmou ou corrigiu na conferência da semana: se o atendimento da cliente foi mega hair com ' +
    'cabelo novo, manutenção (cabelo que a cliente já tinha), outro serviço ou não aconteceu. Uma chamada por cliente; gravar de novo corrige.';
  tool.parameters.workflowInputs.value = {
    acao: 'conferir_venda', pedido_por: valores.pedido_por, pode_forcar: valores.pode_forcar,
    cliente_nome: ia('cliente_nome', 'Primeiro nome da cliente, como estava na lista ou como a Gleide disse'),
    data: ia('data', 'Dia do atendimento AAAA-MM-DD, o que estava na lista (vazio se não souber)'),
    tipo: ia('tipo', 'mega_novo (cabelo NOVO que a cliente comprou), manutencao (cabelo que ela já tinha: manutenção, recolocar, repor, trocar de técnica), outro ou nao_fez. Só o que a Gleide disse ou confirmou'),
    valor: ia('valor', 'Valor em reais, só o número, SÓ se a Gleide disse o valor desta cliente; senão vazio (nunca 0, nunca o preço da tabela)'),
    observacoes: ia('observacoes', 'O que a Gleide disse sobre esta cliente, com as palavras dela'),
  };
  ag.nodes.push(tool);
  ag.connections.conferir_venda = { ai_tool: [[{ node: 'Agente assistente', type: 'ai_tool', index: 0 }]] };
  const agente = achar(ag, 'Agente assistente');
  agente.parameters.options.systemMessage += '\n\n' + REGRAS_PROMPT;

  // ---------- mensagem da semana (no workflow das pendências, que já fala com a Gleide) ----------
  const y = 500;
  const lista = copia(pe, 'Pendências novas', 'Conferência: lista', 'c0f3e1a0-0066-4a00-8000-000000000011', [440, y]);
  const PEND = /rpc\/n8n_assistente_pendencias_(novas|uma_vez)/;
  if (!PEND.test(String(lista.parameters.url))) throw new Error('conferência: "Pendências novas" mudou');
  const empresa = (String(lista.parameters.jsonBody).match(/p_empresa_id: ([^}]+?) \}/) || [])[1];
  if (!empresa) throw new Error('conferência: não achei a empresa em "Pendências novas"');
  lista.parameters.url = lista.parameters.url.replace(PEND,'rpc/n8n_conferencia_vendas_lista');
  lista.parameters.jsonBody = `={{ JSON.stringify({ p_empresa_id: ${empresa}, p_dias: 30, p_clientes_desde: '${clientesDesde}', p_limite: 12 }) }}`;
  // resposta crua: sem isso o n8n quebra a lista em vários itens e uma lista vazia some
  lista.parameters.options = { response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } };
  lista.alwaysOutputData = true;

  const montar = achar(pe, 'Montar mensagem');
  const numeros = (String(montar.parameters.jsCode).match(/const numeros = (.+);\n/) || [])[1];
  if (!numeros) throw new Error('conferência: não achei os números da Gleide em "Montar mensagem"');
  const montarNo = { id: 'c0f3e1a0-0066-4a00-8000-000000000012', name: 'Conferência: montar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [660, y],
    parameters: { jsCode: [
      `const montarConferencia = ${montarConferencia.toString()};`,
      "let itens = []; try { const d = $input.first().json.data; itens = typeof d === 'string' ? JSON.parse(d) : (d || []); } catch (e) { itens = []; }",
      "if (!Array.isArray(itens) || !itens.length) return [];",
      'const texto = montarConferencia(itens, Date.now());',
      "if (!texto) return [];",
      "const d = new Date(Date.now() - 4 * 3600e3); const p = (n) => String(n).padStart(2, '0');",
      "const quando = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getUTCDay()] + ' ' + p(d.getUTCDate()) + '/' + p(d.getUTCMonth() + 1) + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());",
      'const ids = itens.map((i) => i.agendamento_id);',
      `const numeros = ${numeros};`,
      "return numeros.map((tel) => ({ json: { tel, texto, ids,",
      "  memoria: JSON.stringify({ type: 'ai', data: { content: '[' + quando + '] ' + texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } }) } }));",
    ].join('\n') } };

  const mandar = copia(pe, 'Mandar para a Gleide', 'Conferência: mandar para a Gleide', 'c0f3e1a0-0066-4a00-8000-000000000013', [880, y]);
  const memoria = copia(pe, 'Guardar na memória do agente', 'Conferência: guardar na memória', 'c0f3e1a0-0066-4a00-8000-000000000014', [1100, y]);
  for (const k of ['list', 'messageData']) {
    if (!String(memoria.parameters[k]).includes("$('Montar mensagem')")) throw new Error('conferência: a memória das pendências mudou');
    memoria.parameters[k] = memoria.parameters[k].split("$('Montar mensagem')").join("$('Conferência: montar')");
  }
  const marcar = copia(pe, 'Marcar como perguntado', 'Conferência: marcar perguntado', 'c0f3e1a0-0066-4a00-8000-000000000015', [1320, y]);
  if (!String(marcar.parameters.url).includes('rpc/n8n_assistente_marcar_perguntado')) throw new Error('conferência: "Marcar como perguntado" mudou');
  marcar.parameters.url = marcar.parameters.url.replace('rpc/n8n_assistente_marcar_perguntado', 'rpc/n8n_conferencia_vendas_marcar');
  marcar.parameters.jsonBody = `={{ JSON.stringify({ p_empresa_id: ${empresa}, p_ids: $('Conferência: montar').first().json.ids }) }}`;
  marcar.executeOnce = true;
  marcar.onError = 'continueRegularOutput';

  pe.nodes.push(
    { id: 'c0f3e1a0-0066-4a00-8000-000000000010', name: 'Conferência: toda segunda 10h', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [0, y], parameters: { rule: { interval: [{ field: 'cronExpression', expression: cron }] } } },
    lista, montarNo, mandar, memoria, marcar,
  );
  liga(pe, 'Conferência: toda segunda 10h', 'Conferência: lista');
  liga(pe, 'Conferência: lista', 'Conferência: montar');
  liga(pe, 'Conferência: montar', 'Conferência: mandar para a Gleide');
  liga(pe, 'Conferência: mandar para a Gleide', 'Conferência: guardar na memória');
  liga(pe, 'Conferência: guardar na memória', 'Conferência: marcar perguntado');
};
module.exports.montarConferencia = montarConferencia;
module.exports.REGRAS_PROMPT = REGRAS_PROMPT;
