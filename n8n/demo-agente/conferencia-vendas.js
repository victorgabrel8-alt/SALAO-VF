// Fase 2 do portão (21/11/2026): conferência semanal de vendas com a Gleide. Só na Gleide (ligado no montar-workflow.js).
// Em 20/11 o relatório da negociação contou como mega hair a recolocação do cabelo da própria cliente (Renata, Dienne).
// Toda segunda às 10h30 a assistente manda à Gleide, em linguagem natural, os atendimentos realizados das clientes que
// vieram pelo WhatsApp e o que ficou anotado (mega hair com cabelo novo x manutenção). Nada de número de pedido nem
// "responda sim ou não" (pedido do Victor, 21/11): ela responde do jeito dela e a assistente grava com conferir_venda.
// 10h30 e não 10h: às 10h00 saem as pendências de hora em hora, e duas mensagens juntas deixariam um "tá certo" ambíguo.
// O que ainda espera resposta entra no prompt da assistente a cada mensagem (lido do banco), porque a memória da conversa
// guarda só as últimas 20 mensagens e ela pode responder dias depois. A mensagem também entra na memória, como as pendências.
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
  const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const maiuscula = (w) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);
  const palavras = (n) => String(n || '').trim().split(/\s+/).filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w)).map(maiuscula);
  // a mesma cliente (cliente_id) pode aparecer em dois dias; clientes DIFERENTES com o mesmo primeiro nome (com ou sem
  // acento) vão com o sobrenome; nome completo igual (ou sem sobrenome) vai com o final do telefone
  const pessoa = (i) => i.cliente_id || chave(i.nome) + '|' + (i.tel_final || '');
  const porPrimeiro = {}, porCompleto = {};
  for (const i of lista) {
    const ws = palavras(i.nome);
    (porPrimeiro[chave(ws[0])] = porPrimeiro[chave(ws[0])] || new Set()).add(pessoa(i));
    (porCompleto[chave(ws.slice(0, 2).join(' '))] = porCompleto[chave(ws.slice(0, 2).join(' '))] || new Set()).add(pessoa(i));
  }
  const nome = (i) => {
    const ws = palavras(i.nome);
    const fim = i.tel_final ? ' (final ' + i.tel_final + ')' : '';
    if (!ws.length) return 'cliente' + fim;
    if (porPrimeiro[chave(ws[0])].size === 1) return ws[0];
    const dois = ws.slice(0, 2).join(' ');
    return porCompleto[chave(dois)].size === 1 && ws.length > 1 ? dois : dois + fim;
  };
  const servico = (i) => (i.sugerido === 'mega_novo' ? 'mega hair com cabelo novo' : i.sugerido === 'manutencao' ? 'manutenção'
    : (String(i.servico || 'atendimento').replace(/\s*[–-]\s*m[ãa]o de obra\s*$/i, '').trim().toLowerCase() || 'atendimento'));
  const brl = (v) => 'R$ ' + String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const valor = (i) => (Number(i.valor) > 0 ? ', ' + brl(i.valor) : '');
  const maisVelho = Math.min(...lista.map((i) => new Date(i.inicio).getTime()));
  // primeira vez (atendimentos de semanas atrás) ou semana normal
  const abre = agora - maisVelho > 8 * 86400e3
    ? 'Oi, Gleide! Organizando aqui os atendimentos das últimas semanas das clientes que vieram pelo WhatsApp'
    : 'Oi, Gleide! Fechando a semana das clientes que vieram pelo WhatsApp';
  if (lista.length === 1) {
    const i = lista[0];
    return abre + ': a *' + nome(i) + '* veio ' + quando(i.inicio) + ' e eu anotei ' + servico(i) + valor(i) +
      '. Foi isso mesmo? Se foi diferente, ou se teve mais alguém, me conta que eu acerto 🙂';
  }
  return abre + ', eu anotei assim:\n\n' +
    lista.map((i) => '• *' + nome(i) + '*, ' + quando(i.inicio) + ': ' + servico(i) + valor(i)).join('\n') +
    '\n\nTá certinho? Se alguma foi diferente (cabelo novo ou o cabelo dela mesmo), ou se teve alguém que não está aqui, me conta do seu jeito que eu acerto 🙂';
}

// O que a assistente precisa saber para entender a resposta (entra no fim do prompt dela). A lista que espera resposta vem
// do banco a cada mensagem (nó "Conferência: esperando resposta").
const REGRAS_PROMPT = `CONFERÊNCIA DA SEMANA (vendas das clientes que vieram pelo WhatsApp)
Ainda esperando a Gleide confirmar (nome, dia e o que a lista mostrou):
{{ (() => { const t = $('Conferência: esperando resposta').first().json.data; try { return JSON.parse(t) || '(nenhuma)'; } catch (e) { return t || '(nenhuma)'; } })() }}
- Toda segunda você manda à Gleide essa lista ("Fechando a semana…"): cada cliente com o dia e o que ficou anotado (mega
  hair com cabelo novo ou manutenção). Quando ela responder sobre a lista (mesmo dias depois), grave com conferir_venda, uma
  chamada por cliente, com o nome e a data (AAAA-MM-DD) que estão acima.
- tipo: mega_novo = colocou cabelo NOVO, que a cliente comprou; manutencao = mexeu no cabelo que a cliente JÁ TINHA
  (manutenção, recolocar, repor mechas, trocar de técnica, passar para fita); outro = outro serviço; nao_fez = não aconteceu.
- "Tá certo", "isso mesmo", "certinho", "é isso": grave cada cliente da lista do jeito que estava. Corrigiu uma ("a Renata
  foi o cabelo dela"): grave essa do jeito que ela disse; as outras só se ela disse que o resto está certo. Se ela falou de
  uma só, grave só essa e não cobre as outras.
- Quem diz se foi cabelo novo é ela. "Foi aplicação", "colocou o mega" ou "colocou o cabelo" NÃO dizem se o cabelo era novo
  (em 13/11 e 18/11 era o cabelo da própria cliente). Não deu para saber pelo que ela disse? Pergunte uma vez, natural
  ("A da Vitoria foi cabelo novo ou o cabelo dela mesmo?"). Nunca escolha por ela.
- A mesma cliente aparece em dois dias e ela não disse qual ("a Vitoria foi o cabelo dela")? Pergunte qual dia, natural
  ("Foi a da Vitoria do dia 4 ou a do dia 13?"). Nunca escolha o dia por ela. Duas clientes com o mesmo primeiro nome: mande o nome como
  está na lista (com o sobrenome e o "(final 1234)", se tiver).
- valor só se ela disse AGORA o valor daquela cliente; se ela só confirmou a lista, deixe vazio (mesmo que a lista mostre um valor); nunca o preço da tabela, nunca 0. Não pergunte valor. Ela disse que o valor
  que você anotou está errado e não sabe o certo: conferir_venda com desfazer = sim (apaga o valor).
- Ela falou de alguém que não estava na lista: conferir_venda com o nome e o dia que ela disse. Se a ferramenta disser que não
  achou o atendimento, ela veio sem estar na agenda: registrar_atendimento e depois conferir_venda.
- Depois responda curto, do jeito dela: "Anotado ✅ Vitoria com cabelo novo; Renata e Dienne, manutenção." Sem número, sem
  "responda sim ou não", sem falar em relatório ou comissão.
- Se ela não responder à lista, não cobre.`;

module.exports = ({ assistenteWorkflow: ag, pendenciasWorkflow: pe, clientesDesde = '2026-10-28', cron = '30 10 * * 1' }) => {
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
    cliente_nome: ia('cliente_nome', 'Nome da cliente exatamente como está na lista da conferência (com o sobrenome e o "(final 1234)", se a lista tiver) ou como a Gleide disse'),
    data: ia('data', 'Dia do atendimento AAAA-MM-DD, o da lista da conferência (vazio se não souber)'),
    tipo: ia('tipo', 'mega_novo (cabelo NOVO que a cliente comprou), manutencao (cabelo que ela já tinha: manutenção, recolocar, repor, trocar de técnica), outro ou nao_fez. Só o que a Gleide disse ou confirmou; "aplicação" sozinha não diz se o cabelo é novo'),
    valor: ia('valor', 'Valor em reais, só o número, SÓ se a Gleide disse agora o valor desta cliente; se ela só confirmou a lista, vazio (nunca 0, nunca o preço da tabela)'),
    desfazer: ia('desfazer', '"sim" só se a Gleide disse que o valor anotado desta cliente está errado e não sabe o certo (apaga o valor); senão vazio'),
    observacoes: ia('observacoes', 'O que a Gleide disse sobre esta cliente, com as palavras dela'),
  };
  ag.nodes.push(tool);
  ag.connections.conferir_venda = { ai_tool: [[{ node: 'Agente assistente', type: 'ai_tool', index: 0 }]] };

  // o que espera resposta, lido do banco a cada mensagem (entre "Ler pendências" e o nó seguinte)
  const ler = achar(ag, 'Ler pendências');
  if (!String(ler.parameters.url).includes('rpc/n8n_assistente_pendencias_texto')) throw new Error('conferência: "Ler pendências" mudou');
  const esperando = copia(ag, 'Ler pendências', 'Conferência: esperando resposta', 'c0f3e1a0-0066-4a00-8000-000000000002', [ler.position[0] + 30, (ler.position[1] || 0) - 120]);
  esperando.parameters.url = ler.parameters.url.replace('rpc/n8n_assistente_pendencias_texto', 'rpc/n8n_conferencia_vendas_pendente_texto');
  const depois = ag.connections['Ler pendências']?.main?.[0];
  if (!depois || depois.length !== 1) throw new Error('conferência: "Ler pendências" não tem uma saída só');
  ag.nodes.push(esperando);
  ag.connections['Conferência: esperando resposta'] = { main: [depois.slice()] };
  ag.connections['Ler pendências'] = { main: [[{ node: 'Conferência: esperando resposta', type: 'main', index: 0 }]] };

  const agente = achar(ag, 'Agente assistente');
  agente.parameters.options.systemMessage += '\n\n' + REGRAS_PROMPT;

  // ---------- mensagem da semana (no workflow das pendências, que já fala com a Gleide) ----------
  const y = 500;
  const lista = copia(pe, 'Pendências novas', 'Conferência: lista', 'c0f3e1a0-0066-4a00-8000-000000000011', [440, y]);
  const PEND = /rpc\/n8n_assistente_pendencias_(novas|uma_vez)/;
  if (!PEND.test(String(lista.parameters.url))) throw new Error('conferência: "Pendências novas" mudou');
  const empresa = (String(lista.parameters.jsonBody).match(/p_empresa_id: ([^}]+?) \}/) || [])[1];
  if (!empresa) throw new Error('conferência: não achei a empresa em "Pendências novas"');
  lista.parameters.url = lista.parameters.url.replace(PEND, 'rpc/n8n_conferencia_vendas_lista');
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
      // banco fora: erro de verdade, para o "Alerta de erro" avisar o Victor (antes passava calado)
      "const ent = $input.first().json || {};",
      "if (ent.error) throw new Error('conferência: não consegui ler a lista (' + String(ent.error.message || JSON.stringify(ent.error)).slice(0, 200) + ')');",
      "let itens = []; try { const d = ent.data; itens = typeof d === 'string' ? JSON.parse(d) : (d || []); } catch (e) { throw new Error('conferência: resposta da lista não é JSON'); }",
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

  // envio falhou (depois das tentativas): o ramo para e nada é marcado (sai na próxima). Memória falhou: segue e marca
  // (a lista que espera resposta vem do banco). Marcar falhou: erro de verdade, o "Alerta de erro" avisa.
  const mandar = copia(pe, 'Mandar para a Gleide', 'Conferência: mandar para a Gleide', 'c0f3e1a0-0066-4a00-8000-000000000013', [880, y]);
  const memoria = copia(pe, 'Guardar na memória do agente', 'Conferência: guardar na memória', 'c0f3e1a0-0066-4a00-8000-000000000014', [1100, y]);
  for (const k of ['list', 'messageData']) {
    if (!String(memoria.parameters[k]).includes("$('Montar mensagem')")) throw new Error('conferência: a memória das pendências mudou');
    memoria.parameters[k] = memoria.parameters[k].split("$('Montar mensagem')").join("$('Conferência: montar')");
  }
  memoria.onError = 'continueRegularOutput';
  const marcar = copia(pe, 'Marcar como perguntado', 'Conferência: marcar perguntado', 'c0f3e1a0-0066-4a00-8000-000000000015', [1320, y]);
  if (!String(marcar.parameters.url).includes('rpc/n8n_assistente_marcar_perguntado')) throw new Error('conferência: "Marcar como perguntado" mudou');
  marcar.parameters.url = marcar.parameters.url.replace('rpc/n8n_assistente_marcar_perguntado', 'rpc/n8n_conferencia_vendas_marcar');
  marcar.parameters.jsonBody = `={{ JSON.stringify({ p_empresa_id: ${empresa}, p_ids: $('Conferência: montar').first().json.ids }) }}`;
  marcar.executeOnce = true;
  delete marcar.onError;
  marcar.retryOnFail = true; marcar.maxTries = 3; marcar.waitBetweenTries = 3000;

  pe.nodes.push(
    { id: 'c0f3e1a0-0066-4a00-8000-000000000010', name: 'Conferência: toda segunda 10h30', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
      position: [0, y], parameters: { rule: { interval: [{ field: 'cronExpression', expression: cron }] } } },
    lista, montarNo, mandar, memoria, marcar,
  );
  liga(pe, 'Conferência: toda segunda 10h30', 'Conferência: lista');
  liga(pe, 'Conferência: lista', 'Conferência: montar');
  liga(pe, 'Conferência: montar', 'Conferência: mandar para a Gleide');
  liga(pe, 'Conferência: mandar para a Gleide', 'Conferência: guardar na memória');
  liga(pe, 'Conferência: guardar na memória', 'Conferência: marcar perguntado');
};
module.exports.montarConferencia = montarConferencia;
module.exports.REGRAS_PROMPT = REGRAS_PROMPT;
