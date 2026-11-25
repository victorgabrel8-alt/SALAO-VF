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

  // tempo do marcar_horario e do ajustar_duracao: a descrição antiga proibia número escolhido por ela, o que barrava a soma
  // de dois serviços; e o campo é texto (24/11, teste: 120 em número derrubou a ferramenta). Troca a descrição inteira.
  const tempo = (nome, de, para) => {
    const n = achar(A, nome); const val = String(n.parameters.workflowInputs.value.minutos || '');
    if (!val.includes(de)) throw new Error('assistente-oferecer: o campo minutos do ' + nome + ' mudou');
    n.parameters.workflowInputs.value.minutos = ia('minutos', para);
  };
  tempo('marcar_horario', 'Nunca escolha um número por conta própria',
    'Quanto tempo vai levar, em minutos, ESCRITO COMO TEXTO (ex.: "90"): o que a Caroline disse ("uma hora e meia" = "90") ou, em dois serviços na mesma cliente, a soma da lista ("120" no gel pé e mão). Um serviço só e nada dito: vazio (vale o tempo do serviço)');
  tempo('ajustar_duracao', 'Quanto tempo vai levar, em minutos',
    'Quanto tempo vai levar, em minutos, ESCRITO COMO TEXTO (ex.: "90")');
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

  // c. regra do Victor (24/11): a Caroline mandou agendar com a cliente = sem sinal, em QUALQUER horário que a cliente
  // escolher (não só a hora do recado); se o recado fala em sinal ou Pix, cobra. Cliente que chega sozinha segue pagando.
  // O recado vale por 15 dias (a Shirley respondeu 4 dias depois; antes eram 72 h).
  trocarUma(achar(AG, 'Supabase: oferta da dona'), 'url', '$now.minus({ hours: 72 })', '$now.minus({ days: 15 })');
  trocarUma(achar(AG, 'Montar agendamento'), 'jsCode',
    'ofertaDaDona = avisos.some((t) => hora.test(t)) && !avisos.some((t) => /sinal|pix/.test(t));',
    'ofertaDaDona = avisos.some((t) => hora.test(t) || /hor[aá]rio|agend|marc|reserv|vaga|encaix/.test(t)) && !avisos.some((t) => /sinal|pix/.test(t));');

  // d. "reservou ... Pode ser?": reserva afirma; se é pergunta, não é reserva
  trocarUma(achar(F, 'Envio: conferir'), 'jsCode', 'return [{ json: { bloqueio, recado, telefone: tel,', [
    '// 7. assistente-oferecer.js (24/11, Stela): "A Carol reservou ... Pode ser?" deixa a cliente sem saber se está marcado',
    "if (!bloqueio && (afirma || /\\b(reservou|marcou|agendou|garantiu)\\b/.test(n)) && /(pode ser|tudo bem|ok|certo|combinado|consegue|fechado|beleza|serve|da certo|dá certo)\\s*\\??\\s*[\\u{1F64F}]?\\s*$/iu.test(txt.trim()) && /\\?\\s*[\\u{1F64F}]?\\s*$/u.test(txt.trim())) {",
    "  bloqueio = 'NÃO ENVIADO (nada chegou à cliente): o texto diz que está reservado e termina perguntando se pode. Reserva afirma: tire a pergunta do fim e diga \"Se não puder, me avisa por aqui\". ' +",
    "    'Se a Caroline só quer oferecer, escreva como oferta, sem dizer reservado. Se a cliente tinha outro horário combinado, diga a troca e o motivo em poucas palavras.';",
    '}',
    'return [{ json: { bloqueio, recado, telefone: tel,',
  ].join('\n'));

  // f. WhatsApp que não enviou: em vez do erro cru da Evolution ("400 - {\"status\":400...}"), uma frase que a dona entende
  // (24/11, teste do Victor: "Não mandei: o WhatsApp não enviou a mensagem (400 - ...)")
  {
    const resp = achar(F, 'Resposta');
    const a = (resp.parameters.assignments?.assignments || []).find((x) => x.name === 'resposta');
    const de = "if (!r || !r.key?.id) return 'ERRO: o WhatsApp não enviou a mensagem (' + (r?.error?.message || 'sem resposta') + '). Nada foi enviado para a cliente.';";
    if (!a || String(a.value).split(de).length !== 2) throw new Error('assistente-oferecer: a Resposta das ferramentas mudou');
    a.value = a.value.replace(de, () => "if (!r || !r.key?.id) { const em = String((r && r.error && (r.error.message || JSON.stringify(r.error))) || ''); return /exists.{0,4}false/.test(em) ? 'ERRO: esse número não tem WhatsApp. Nada foi enviado. Diga em uma frase que o número da cliente não tem WhatsApp e peça para conferir o número.' : 'ERRO: o WhatsApp não conseguiu mandar agora. Nada foi enviado. Diga em uma frase que não deu para mandar agora e que ela pode pedir de novo em alguns minutos.'; }");
  }

  // g. só grava na ficha de quem a dona citou (24/11, teste com o áudio real da Jaque: "acabei de finalizar, ela chegou...",
  // sem nome, e a assistente concluiu e anotou a Helena, a primeira cliente do dia). concluir, anotar, chegou e
  // status_atendimento levam "citadas" = o pedido atual + as últimas 12 mensagens da conversa com a dona (as dela e as da
  // assistente: aviso "⏰ fulana não chegou", pendências, "Qual o serviço da fulana?"). Se o nome da cliente não aparece
  // ali (com tolerância de áudio: Sirlei = Shirley, Jaque = Jackelined, Stella = Stela), nada é gravado e a assistente
  // recebe PERGUNTE (não ERRO): pergunta "De quem você fala?".
  const PRECISA_CITAR = ['concluir', 'anotar', 'chegou', 'status_atendimento'];
  const CITADAS = "={{ (() => { let t = ''; try { t += String($('Juntar mensagens').first().json.texto || ''); } catch (e) {} " +
    "try { for (const s of [].concat($('Memória: ler (Agente assistente)').first().json.memoria || []).slice(0, 12)) { try { const m = JSON.parse(s); t += ' ' + String((m.data && m.data.content) || ''); } catch (e) {} } } catch (e) {} " +
    'return t.slice(-8000); })() }}';
  const gatilho = achar(F, 'Recebe pedido da assistente').parameters.workflowInputs.values;
  if (!gatilho.some((x) => x.name === 'citadas')) gatilho.push({ name: 'citadas' });
  for (const nome of PRECISA_CITAR) {
    const t = achar(A, nome);
    if (!('cliente_nome' in t.parameters.workflowInputs.value)) throw new Error('assistente-oferecer: ' + nome + ' sem cliente_nome');
    t.parameters.workflowInputs.value.citadas = CITADAS;
    const sc = t.parameters.workflowInputs.schema;
    if (Array.isArray(sc) && !sc.some((s) => s.id === 'citadas')) sc.push({ ...sc[0], id: 'citadas', displayName: 'citadas' });
  }
  trocarUma(achar(F, 'Montar chamada'), 'jsCode', '// Antes de gravar ou enviar: o id é mesmo da cliente', [
    '// assistente-oferecer.js (g): só grava na ficha de quem a dona citou nas mensagens recentes',
    "if (" + JSON.stringify(PRECISA_CITAR) + ".includes(v('acao')) && v('citadas') && v('cliente_nome')) {",
    "  const normNome = (s) => String(s || '').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase().replace(/sh/g, 's').replace(/th/g, 't').replace(/ph/g, 'f').replace(/qu/g, 'k').replace(/c(?=[aou])/g, 'k').replace(/ck/g, 'k').replace(/y/g, 'i').replace(/w/g, 'v').replace(/z/g, 's').replace(/(.)\\1+/g, '$1');",
    "  const palavras = (s) => normNome(s).split(/[^a-z]+/).filter((w) => w.length >= 3);",
    "  const textoCitado = palavras(v('citadas'));",
    "  const citou = palavras(v('cliente_nome')).some((n) => { const k = Math.min(4, n.length); return textoCitado.some((w) => w.length >= k && w.slice(0, k) === n.slice(0, k)); });",
    "  if (!citou) return [{ json: { pergunte: 'nada foi gravado: a Caroline não disse o nome \"' + v('cliente_nome') + '\" nas mensagens recentes, e cliente não se escolhe pela agenda do dia. Pergunte em uma linha \"De quem você fala?\" e, quando ela disser o nome, faça. Não diga que deu erro.' } }];",
    '}',
    '// Antes de gravar ou enviar: o id é mesmo da cliente',
  ].join('\n'));
  {
    const resp = achar(F, 'Resposta');
    const a = (resp.parameters.assignments?.assignments || []).find((x) => x.name === 'resposta');
    const de = "if (m.erro) return 'ERRO: ' + m.erro;";
    if (!a || String(a.value).split(de).length !== 2) throw new Error('assistente-oferecer: a Resposta das ferramentas mudou (erro)');
    a.value = a.value.replace(de, () => "if (m.pergunte) return 'PERGUNTE: ' + m.pergunte;\n  " + de);
  }

  // e. "mandei" quando todo envio desta resposta foi recusado. As linhas do que deu certo ficam (24/11, Maila: "concluída ✅"
  // sumiu e a Caroline só recebeu "Não mandei"), e a nota da memória não diz "nada foi gravado" quando algo foi.
  trocarUma(achar(A, 'Conferir resposta'), 'jsCode',
    'if (afirma && !enviou && !haPouco(ENVIO, 20) && !passado) {',
    "const recusados = novos.filter((f) => ENVIO.includes(f.t) && !ok(f.r) && !/^GUARDEI COMO RECADO/i.test(f.r));\n" +
    "const fica = gravou ? original.split('\\n').filter((l) => l.trim() && !/\\b(avisei|mandei|enviei|perguntei|chamei)\\b|mensagem (foi )?enviada/i.test(l)).join('\\n').trim() : '';\n" +
    "if (afirma && !enviou && recusados.length && !passado) { texto = (fica ? fica + '\\n\\n' : '') + '⚠️ Não mandei: ' + recusados[0].r.replace(/^N[ÃA]O ENVIADO \\(nada chegou à cliente\\):\\s*/i, '').replace(/^ERRO:\\s*/i, '').split(/(?<=\\.)\\s/)[0].replace(/\\s*\\([^)]*\\)/g, ''); corrigida = true; }\n" +
    'else if (afirma && !enviou && !haPouco(ENVIO, 20) && !passado) {');
  trocarUma(achar(A, 'Conferir resposta'), 'jsCode', 'Nada foi gravado nem enviado.', "' + (gravou ? 'O que voltou OK ficou gravado; nenhuma mensagem foi enviada.' : 'Nada foi gravado nem enviado.') + '");

  // h. teste de 24/11 (8 pedidos reais numa cópia): 3 respostas terminaram com o registro interno colado
  // ("O QUE VOCÊ JÁ FEZ: (nada ainda)", "*O QUE EU JÁ FIZ:* ..."). Corta dali até o fim antes de mandar à dona.
  trocarUma(achar(A, 'Conferir resposta'), 'jsCode', "let texto = String(ag.output || '')",
    "let texto = String(ag.output || '').replace(/(^|\\n)[\\s*_]*O QUE (VOC[ÊE]|EU) J[ÁA] F(EZ|IZ)\\b[\\s\\S]*$/i, '')");
  // "Perguntei pra *Rebeca* ✅" sem ter chamado chamar_cliente passava: a conferência só olhava avisei/mandei/enviei
  trocarUma(achar(A, 'Conferir resposta'), 'jsCode', '\\b(avisei|mandei|enviei)\\b|mensagem (foi )?enviada',
    '\\b(avisei|mandei|enviei|perguntei)\\b|mensagem (foi )?enviada');
  trocarUma(achar(A, 'Conferir resposta'), 'jsCode', '(avisei|mandei|enviei|anotei|', '(avisei|mandei|enviei|perguntei|anotei|');

  // i. busca de cliente tolerante a nome falado (supabase/079: "Jaque" traz a Jaqueline e a Jackelined)
  trocarUma(achar(F, 'Montar chamada'), 'jsCode', "funcao = 'n8n_assistente_buscar_cliente_v2'", "funcao = 'n8n_assistente_buscar_cliente_v3'");
};

module.exports.ID_AGENDA = ID_AGENDA;
