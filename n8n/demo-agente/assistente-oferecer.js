// Assistente oferece horário pela mesma agenda da IA (loja.json: "assistente_oferecer": true; a Gleide não passa por aqui).
// Pedido do Victor (24/11/2026, Caroline e a Stela): "a Caroline falou para a assistente o que fazer e estava simples,
// a cliente só precisava escolher o horário e a IA marcar". O que deu errado:
//   1. a assistente procurou horário com horarios_livres (função do banco que conta um serviço só, de 60 min, sem as
//      regras da agenda, sem a Duda e sem o tempo de "gel pé e mão"); ofereceu 19/12 às 14:30, que não cabia 2 h;
//   2. a IA de atendimento conferiu 14:30 com 120 min, deu INDISPONÍVEL e foi perguntar à Caroline;
//   3. a Caroline disse "não precisa pedir sinal" (permuta) e isso virou regra só da assistente: a agenda recusaria
//      marcar outro horário sem comprovante;
//   4. a assistente marcou 19/12 13:00 sem serviço, mandou "A Carol reservou ... Pode ser?" sem dizer por que mudou e
//      perguntou à Caroline o serviço numa lista numerada e "É permuta?", coisas que ela já tinha dito;
//   5. (Geisy) a assistente respondeu "Mandei ✅" quando o envio voltou NÃO ENVIADO.
// Aqui:
//   a. ferramenta horarios_para_oferecer: chama o subworkflow da agenda da IA (acao consultar), com o telefone da
//      cliente e o tempo em minutos. Devolve os mesmos 2 horários que a IA ofereceria (regras da dona, Google, Duda);
//   b. ferramenta sem_sinal (supabase/075): marca na ficha que a cliente não paga sinal; a agenda passa a conferir o
//      sinal pela n8n_sinal_conferir_v2, que deixa essa cliente marcar sem comprovante;
//   c. horário que a dona ofereceu num dia: outro horário NO MESMO DIA também sai sem sinal (a IA oferece o mais
//      perto quando o que a dona ofereceu não cabe mais);
//   d. "Envio: conferir": mensagem que diz "reservou/marcou" e termina pedindo licença ("Pode ser?") não sai;
//   e. "Conferir resposta": "mandei" quando todo envio desta resposta voltou recusado vira a verdade, com o motivo.
// O texto do prompt da loja (lojas/<slug>/prompt-assistente.txt e prompt-agente.md) é que diz quando usar.

const ID_AGENDA = 'horarios_para_oferecer';

module.exports = ({ workflow: W, agendaWorkflow: AG, assistenteWorkflow: A, ferramentasWorkflow: F, agendaId }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('assistente-oferecer: sem o nó ' + nome); return n; };
  const trocarUma = (n, campo, de, para) => {
    const t = String(n.parameters[campo] || '');
    if (t.split(de).length !== 2) throw new Error(`assistente-oferecer: "${n.name}" mudou (${de.slice(0, 60)})`);
    n.parameters[campo] = t.replace(de, () => para);
  };
  const ia = (c, d, tipo = 'string') => "={{ $fromAI('" + c + "', `" + d + "`, '" + tipo + "') }}";

  // a. horarios_para_oferecer: cópia da ferramenta da IA, apontando para o mesmo subworkflow da agenda
  const molde = achar(W, 'consultar_horarios_livres');
  if (A.nodes.some((x) => x.name === ID_AGENDA)) throw new Error('assistente-oferecer: a ferramenta já existe');
  const oferecer = JSON.parse(JSON.stringify(molde));
  const livres = achar(A, 'horarios_livres');
  oferecer.name = ID_AGENDA;
  oferecer.id = livres.id.slice(0, -3) + '875';
  oferecer.position = [livres.position[0], livres.position[1] + 220];
  oferecer.parameters.workflowId.value = agendaId;
  oferecer.parameters.description = 'A agenda da IA de atendimento: devolve os 2 horários que a IA ofereceria a esta cliente num dia (já com as regras da '
    + 'agenda, a Google Agenda, a agenda da Duda e o tempo do serviço). Use SEMPRE antes de oferecer ou sugerir horário a uma cliente. '
    + 'Com data AAAA-MM-DDTHH:mm confere se aquele horário exato cabe.';
  const v = oferecer.parameters.workflowInputs.value;
  if (v.acao !== 'consultar' || !('telefone' in v)) throw new Error('assistente-oferecer: a consultar_horarios_livres da IA mudou');
  oferecer.parameters.workflowInputs.value = {
    acao: 'consultar',
    data: ia('data', 'Dia AAAA-MM-DD; para conferir um horário exato, AAAA-MM-DDTHH:mm'),
    duracao_minutos: ia('duracao_minutos', 'Tempo do serviço em minutos, da lista SERVIÇOS E PREÇOS; dois serviços = a soma (gel pé e mão = 120)', 'number'),
    periodo: ia('periodo', 'manha, tarde ou qualquer (o que a Caroline ou a cliente disse; senão qualquer)'),
    profissional: ia('profissional', 'Caroline ou Duda, só se a Caroline disse com quem; senão vazio'),
    telefone: ia('telefone', 'Telefone COMPLETO da cliente, o campo telefone de buscar_cliente (ex.: 5566996990777), nunca só o final'),
  };
  A.nodes.push(oferecer);
  A.connections[ID_AGENDA] = JSON.parse(JSON.stringify(A.connections['horarios_livres']));

  // b. sem_sinal: ferramenta (molde: anotar) + chamada ao banco
  const anotar = achar(A, 'anotar');
  if (A.nodes.some((x) => x.name === 'sem_sinal')) throw new Error('assistente-oferecer: sem_sinal já existe');
  const semSinal = JSON.parse(JSON.stringify(anotar));
  semSinal.name = 'sem_sinal';
  semSinal.id = anotar.id.slice(0, -3) + '876';
  semSinal.position = [anotar.position[0], anotar.position[1] + 220];
  semSinal.parameters.description = 'Marca na ficha que a cliente NÃO paga sinal (permuta, cliente da casa, a Caroline mandou não cobrar). '
    + 'A IA de atendimento e a agenda passam a marcar os horários dela sem pedir Pix. status "tirar" desfaz.';
  const fixos = Object.fromEntries(Object.entries(semSinal.parameters.workflowInputs.value).filter(([, x]) => !String(x).includes('$fromAI(')));
  if (fixos.acao !== 'anotar') throw new Error('assistente-oferecer: a ferramenta anotar mudou');
  semSinal.parameters.workflowInputs.value = {
    ...fixos,
    acao: 'sem_sinal',
    cliente_id: anotar.parameters.workflowInputs.value.cliente_id,
    cliente_nome: anotar.parameters.workflowInputs.value.cliente_nome,
    texto: ia('texto', 'O motivo, com as palavras dela (ex.: permuta)'),
    status: ia('status', 'Vazio para marcar; "tirar" para voltar a cobrar o sinal'),
  };
  A.nodes.push(semSinal);
  A.connections['sem_sinal'] = JSON.parse(JSON.stringify(A.connections['anotar']));
  trocarUma(achar(F, 'Montar chamada'), 'jsCode', '  default:\n', [
    '  // cliente que não paga sinal (assistente-oferecer.js, supabase/075)',
    "  case 'sem_sinal':",
    "    funcao = 'n8n_assistente_sem_sinal';",
    "    args = { ...base, p_cliente_id: ou(v('cliente_id')), p_sem_sinal: !/tirar|desfaz|volta/i.test(v('status')), p_motivo: ou(v('texto')) };",
    '    break;',
    '  default:\n',
  ].join('\n'));
  // conta como gravação (registro do que já fez e conferência de "gravei" sem gravar)
  for (const n of A.nodes.filter((x) => String(x.parameters?.jsCode || '').includes('"regra_da_agenda","ensinar_resposta"'))) {
    trocarUma(n, 'jsCode', '"regra_da_agenda","ensinar_resposta"', '"regra_da_agenda","sem_sinal","ensinar_resposta"');
  }
  if (!A.nodes.some((x) => String(x.parameters?.jsCode || '').includes('"sem_sinal","ensinar_resposta"'))) throw new Error('assistente-oferecer: não achei a lista de gravações');

  // agenda: o sinal passa a ser conferido pela v2 (cliente sem_sinal marca sem comprovante)
  trocarUma(achar(AG, 'Supabase: conferir sinal'), 'url', 'rpc/n8n_sinal_conferir', 'rpc/n8n_sinal_conferir_v2');

  // c. oferta da dona: outro horário no mesmo dia oferecido também vale (a IA oferece o mais perto quando não cabe)
  trocarUma(achar(AG, 'Montar agendamento'), 'jsCode',
    'ofertaDaDona = avisos.some((t) => hora.test(t)) && !avisos.some((t) => /sinal|pix/.test(t));',
    "const diaOf = new RegExp('(^|[^0-9])0?' + ini.day + '/0?' + ini.month + '([^0-9]|$)');\n" +
    '  ofertaDaDona = avisos.some((t) => hora.test(t) || diaOf.test(t)) && !avisos.some((t) => /sinal|pix/.test(t));');

  // d. "reservou ... Pode ser?": reserva afirma; se é pergunta, não é reserva
  trocarUma(achar(F, 'Envio: conferir'), 'jsCode', 'return [{ json: { bloqueio, recado, telefone: tel,', [
    '// 7. assistente-oferecer.js (24/11, Stela): "A Carol reservou ... Pode ser?" deixa a cliente sem saber se está marcado',
    "if (!bloqueio && (afirma || /\\b(reservou|marcou|agendou|garantiu)\\b/.test(n)) && /(pode ser|tudo bem|ok|certo|combinado|consegue|fechado|beleza|serve|da certo|dá certo)\\s*\\??\\s*[\\u{1F64F}]?\\s*$/iu.test(txt.trim()) && /\\?\\s*[\\u{1F64F}]?\\s*$/u.test(txt.trim())) {",
    "  bloqueio = 'NÃO ENVIADO (nada chegou à cliente): o texto diz que está reservado e termina perguntando se pode. Reserva afirma: tire a pergunta do fim e diga \"Se não puder, me avisa por aqui\". ' +",
    "    'Se a Caroline só quer oferecer, escreva como oferta, sem dizer reservado. Se a cliente tinha outro horário combinado, diga a troca e o motivo em poucas palavras.';",
    '}',
    'return [{ json: { bloqueio, recado, telefone: tel,',
  ].join('\n'));

  // e. "mandei" quando todo envio desta resposta foi recusado
  trocarUma(achar(A, 'Conferir resposta'), 'jsCode',
    'if (afirma && !enviou && !haPouco(ENVIO, 20) && !passado) {',
    "const recusados = novos.filter((f) => ENVIO.includes(f.t) && !ok(f.r) && !/^GUARDEI COMO RECADO/i.test(f.r));\n" +
    "if (afirma && !enviou && recusados.length && !passado) { texto = '⚠️ Não mandei: ' + recusados[0].r.replace(/^N[ÃA]O ENVIADO \\(nada chegou à cliente\\):\\s*/i, '').replace(/^ERRO:\\s*/i, '').split(/(?<=\\.)\\s/)[0]; corrigida = true; }\n" +
    'else if (afirma && !enviou && !haPouco(ENVIO, 20) && !passado) {');
};

module.exports.ID_AGENDA = ID_AGENDA;
