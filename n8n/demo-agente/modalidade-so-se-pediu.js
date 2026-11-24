// A IA de atendimento só troca a avaliação entre presencial e online se a cliente pediu (mesmo jeito do
// cancelar-so-se-pediu.js).
// 24/11/2026, Lene: tinha avaliação online; disse "hoje nesse horário não posso, só na sexta à tarde". A IA remarcou
// para sexta E chamou mudar_modalidade para presencial por conta própria, mandou o endereço e disse que a Gleide a
// esperava no salão. A equipe teve de corrigir à mão ("por ligação").
// Trava no código (não depende do modelo obedecer ao roteiro):
//   1. "Sobre esta cliente" passa a dizer se a cliente falou de modalidade nas últimas 2 horas (presencial, no salão,
//      ligação, online, não consigo ir, longe...) ou se respondeu a uma pergunta da IA sobre isso nos últimos 30 min;
//   2. a ferramenta mudar_modalidade leva esse sinal (campo pediu);
//   3. sem o pedido, o fluxo "IA - Mudar modalidade" não mexe no banco e devolve o que fazer.
// Sem o sinal (fluxo que não calcula) a troca segue como antes: a trava só bloqueia quando sabe que ela não pediu.

const PEDIDO = "(presencial|pessoalmente|no sal[aã]o|a[ií] no|ir a[ií]|ir at[eé]|liga[çc][aã]o|ligar|me liga|online|on-line|chamada|v[ií]deo|n[aã]o (consigo|posso|vou conseguir|d[aá] pra|tenho como) (ir|vir|chegar|ir a[ií]|ir at[eé])|longe|outra cidade|de fora|moro em|viajando|viagem)";
const RESPOSTA = 'NÃO MUDEI: a cliente não pediu para trocar entre presencial e online, então a avaliação CONTINUA como estava (mesma modalidade). ' +
  'Remarcar dia ou hora nunca troca a modalidade. Confirme o dia e a hora com a modalidade que ela já tinha (online = a Gleide liga por voz no WhatsApp). ' +
  'Só troque se ela pedir com as palavras dela ou aceitar uma troca que você ofereceu.';

module.exports = ({ node, workflow, modalidadeWorkflow }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`modalidade_so_se_pediu: não achei "${nome}"`); return n; };
  if (RESPOSTA.includes("'")) throw new Error('modalidade_so_se_pediu: aspas simples na resposta');
  if (modalidadeWorkflow.nodes.some((x) => x.name === 'Mudar: a cliente pediu?')) return;

  // 1. o sinal em "Sobre esta cliente" (todas as saídas do nó levam o campo). Entra DEPOIS do pediuCancelar: o
  // encaixe.js procura as saídas pelo começo "return [{ json: { pediuCancelar: "
  const sobre = achar(workflow, 'Sobre esta cliente');
  const saida = /(return \[\{ json: \{ pediuCancelar: [^\n]*?), texto: /g;
  const saidas = (sobre.parameters.jsCode.match(saida) || []).length;
  if (saidas < 1 || saidas !== sobre.parameters.jsCode.split('return [{ json: { ').length - 1) throw new Error('modalidade_so_se_pediu: as saídas de "Sobre esta cliente" mudaram (rode depois do cancelar-so-se-pediu.js)');
  if (!sobre.parameters.jsCode.includes("$('Supabase: últimas mensagens')")) throw new Error('modalidade_so_se_pediu: "Sobre esta cliente" não lê mais as últimas mensagens');
  const SINAL = "((ms) => { const pede = new RegExp(" + JSON.stringify(PEDIDO) + ", 'i'); const haMin = (m) => (Date.now() - Date.parse(m.criado_em)) / 60000; " +
    "return ms.some((m) => m.direcao === 'entrada' && haMin(m) < 120 && pede.test(String(m.conteudo || ''))) || " +
    "ms.some((m) => m.direcao === 'saida' && haMin(m) < 30 && /(presencial|liga[çc][aã]o|online|no sal[aã]o)[^?.!\\n]*\\?/i.test(String(m.conteudo || ''))); })" +
    "($('Supabase: últimas mensagens').all().map((i) => i.json).filter((m) => m && m.direcao))";
  sobre.parameters.jsCode = sobre.parameters.jsCode.replace(saida, (m, antes) => antes + ', pediuModalidade: ' + SINAL + ', texto: ');

  // 2. a ferramenta leva o sinal
  const tool = achar(workflow, 'mudar_modalidade');
  const wi = tool.parameters.workflowInputs;
  if (!wi?.value || !('para' in wi.value) || 'pediu' in wi.value) throw new Error('modalidade_so_se_pediu: a ferramenta mudar_modalidade mudou');
  wi.value.pediu = "={{ $('Sobre esta cliente').first().json.pediuModalidade === false ? 'NAO_PEDIU' : 'pediu' }}";
  wi.schema.push(Object.assign({}, wi.schema.find((s) => s.id === 'para'), { id: 'pediu', displayName: 'pediu' }));
  tool.parameters.description = tool.parameters.description.replace('Use quando ela pedir ou aceitar a troca,', 'Use SÓ quando ela pedir a troca com as palavras dela ou aceitar uma troca que você ofereceu,') +
    ' Remarcar dia ou hora nunca troca a modalidade: avaliação online continua online.';

  // 3. o fluxo confere antes de mexer no banco
  const gatilho = achar(modalidadeWorkflow, 'Recebe pedido da IA');
  gatilho.parameters.workflowInputs.values.push({ name: 'pediu' });
  if (modalidadeWorkflow.connections['Recebe pedido da IA']?.main?.[0]?.[0]?.node !== 'Mudar no banco') throw new Error('modalidade_so_se_pediu: a ligação do fluxo mudou');
  const base = achar(modalidadeWorkflow, 'Resposta');
  const nao = JSON.parse(JSON.stringify(base));
  nao.name = 'Resposta (não mudou: ela não pediu)'; nao.id = 'b7d0c3e2-5a41-4f6e-9c2d-6d0a1e3f4b57';
  nao.position = [base.position[0], base.position[1] + 160];
  nao.parameters.assignments.assignments[0].value = `={{ '${RESPOSTA}' }}`;
  modalidadeWorkflow.nodes.push(
    node('Mudar: a cliente pediu?', 'n8n-nodes-base.if', 2.2, [gatilho.position[0] + 110, gatilho.position[1] + 160], {
      conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'mp1', leftValue: "={{ String($json.pediu || '') !== 'NAO_PEDIU' }}", rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
      options: {},
    }),
    nao,
  );
  modalidadeWorkflow.connections['Recebe pedido da IA'] = { main: [[{ node: 'Mudar: a cliente pediu?', type: 'main', index: 0 }]] };
  modalidadeWorkflow.connections['Mudar: a cliente pediu?'] = { main: [[{ node: 'Mudar no banco', type: 'main', index: 0 }], [{ node: nao.name, type: 'main', index: 0 }]] };
};
