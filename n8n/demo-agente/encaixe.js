// Encaixe na falta (parte 4 do portão, 21/11/2026). Só na Gleide (ligado no montar-workflow.js). Banco: supabase/067.
// A Gleide confirma à assistente que uma cliente faltou. A assistente pergunta, em conversa normal, se pode ver com a
// cliente do horário mais próximo DEPOIS da vaga, no mesmo dia, se ela consegue vir antes ("Quer que eu veja com a Ana
// (das 15h) se ela consegue vir antes?"). Só com o "pode" da Gleide sai UMA mensagem para essa cliente. A cliente diz a
// hora em que consegue chegar (a IA nunca sugere hora nem tempo de deslocamento), a IA confirma por extenso e só remarca
// depois do sim. Sem resposta ou "não": fica tudo como está, e NUNCA se chama a segunda cliente.
// Nada de número de pedido nem "responda sim ou não" para a Gleide (pedido do Victor, 21/11).
//
// O que este arquivo muda nos workflows já montados:
//   Assistente - Ferramentas  liberar_horario e status_atendimento passam a chamar as funções "_encaixe" (as de sempre + a
//                             pergunta); ferramenta nova chamar_para_encaixe; a mensagem enviada marca o encaixe como oferecido
//   Assistente da Gleide      ferramenta chamar_para_encaixe, a pergunta que espera resposta lida do banco a cada mensagem, regras
//   Atendimento               "Encaixe: oferta aberta" antes da ficha; a ficha ganha "ALÔ DE ENCAIXE" (no lugar do "ALÔ DE VAGA");
//                             remarcar_agendamento e consultar_horarios_livres levam o sinal do encaixe para a agenda
//   Agenda                    remarcar para a hora que a cliente disse vale em cima da hora (dentro da vaga e antes do horário dela)
//   Faltas, atrasos e vagas   a rotina de vagas não oferece mais sozinha a vaga de falta (n8n_vagas_para_oferecer_v2)
// Ligar no salão: empresas.config.encaixe = {"ligado": true, "so_para": [], "folga_min": 30} (ver supabase/067).

// A linha da ficha ("Sobre esta cliente") quando a cliente tem uma oferta de encaixe aberta. enc = n8n_encaixe_da_cliente.
// Também é colada no n8n: nada de require nem variável de fora. Cuiabá é -04:00 o ano todo.
function linhaEncaixe(enc) {
  if (!enc || !enc.agendamento_id || !enc.horario_original) return '';
  const p2 = (n) => String(n).padStart(2, '0');
  const local = (iso) => new Date(new Date(iso).getTime() - 4 * 3600e3);
  const hm = (iso) => { const d = local(iso); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); };
  // "15h", "15h30": como se fala
  const fala = (iso) => { const d = local(iso); return d.getUTCHours() + 'h' + (d.getUTCMinutes() ? p2(d.getUTCMinutes()) : ''); };
  const d = local(enc.horario_original);
  const isoLocal = d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + 'T' + hm(enc.horario_original);
  const h = fala(enc.horario_original);
  // a cliente que tinha faltado apareceu: a vaga não existe mais
  if (enc.vaga_aberta === false) return 'ALÔ DE ENCAIXE (o salão chamou, ela não pediu)' + (enc.enviado_em ? ': hoje às ' + hm(enc.enviado_em) : ': hoje') +
    ' você mandou: «' + String(enc.mensagem || '') + '». ATENÇÃO: esse horário mais cedo NÃO está mais livre (foi ocupado depois da mensagem). ' +
    'Se ela responder que consegue vir antes, agradeça, peça desculpas com carinho, diga que o horário mais cedo acabou de ser ocupado e que o dela, hoje às ' + hm(enc.horario_original) +
    ', continua garantido. NÃO confirme hora nova, NÃO use remarcar_agendamento para adiantar e não ofereça outros horários. Se a mensagem dela é sobre outro assunto, responda o assunto.';
  return 'ALÔ DE ENCAIXE (o salão chamou, ela não pediu)' + (enc.enviado_em ? ': hoje às ' + hm(enc.enviado_em) : ': hoje') +
    ' você mandou: «' + String(enc.mensagem || '') + '». A mensagem de agora pode ser a resposta. O horário dela continua sendo hoje às ' +
    hm(enc.horario_original) + ' (data_hora_inicio = ' + isoLocal + ') e só muda se ELA quiser vir antes.\n' +
    'Como responder ao encaixe:\n' +
    '1. Quem diz a hora é ELA. Nunca sugira hora, nunca calcule nem pergunte tempo de deslocamento, não use consultar_horarios_livres para isso e não ofereça outros horários.\n' +
    '2. Ela disse a hora em que consegue chegar, antes das ' + h + ': confirme por extenso, numa pergunta só, e NÃO remarque ainda. ' +
    'Ex.: "Combinado: você vem hoje às 13h30 em vez das ' + h + ', certo?" (se ela disser em minutos, "daqui 40 min", faça a conta pela hora de agora e confirme a hora).\n' +
    '3. Só depois do sim dela a essa pergunta: remarcar_agendamento com data_hora_inicio = ' + isoLocal + ' e data_hora_nova = hoje na hora que ela disse. ' +
    'Só diga que mudou se a resposta começar com REMARCADO; aí confirme curto e com carinho que a Gleide espera por ela nesse horário.\n' +
    '4. Disse que consegue vir antes, mas não disse a hora: pergunte só "Que horas você consegue chegar?".\n' +
    '5. Disse que não dá ou que prefere manter: responda com carinho que está tudo certo e que o horário das ' + h + ' continua garantido. Não insista e não ofereça de novo.\n' +
    '6. A ferramenta não remarcou (a hora não encaixou): diga com carinho que essa hora não encaixou na agenda e que o horário das ' + h + ' continua garantido.\n' +
    '7. Hora depois das ' + h + ' ou outro dia não é encaixe: é remarcação comum, siga as regras de sempre. Se a mensagem dela é sobre outro assunto, responda o assunto e não puxe o encaixe.';
}

// A agenda (Calcular) pergunta: esta remarcação é o encaixe que foi oferecido a ela? sinal = o campo "motivo" que a ferramenta
// leva (JSON do encaixe aberto). É encaixe quando é o horário dela, no mesmo dia, para ANTES do horário dela e DENTRO da vaga
// (do começo do horário que faltou em diante). Aí vale em cima da hora (até 15 min atrás: ela pode levar uns minutos para
// dizer o sim). Fora disso é remarcação comum, com as regras de sempre. Também é colada no n8n: sem require.
function encaixeNaAgenda(sinal, agendamentoId, iniMs, novoMs, agoraMs) {
  let j = null;
  try { j = JSON.parse(sinal || ''); } catch (e) { return { encaixe: false }; }
  if (!j || j.encaixe !== true || !j.ag || j.ag !== agendamentoId) return { encaixe: false };
  const de = Date.parse(j.de), ate = Date.parse(j.ate);
  if (!Number.isFinite(de) || !Number.isFinite(ate) || !Number.isFinite(novoMs) || !Number.isFinite(iniMs)) return { encaixe: false };
  const minuto = (ms) => Math.floor(ms / 60000);
  const dia = (ms) => Math.floor((ms - 4 * 3600e3) / 86400e3);
  if (minuto(ate) !== minuto(iniMs)) return { encaixe: false };          // o horário dela mudou depois da oferta
  if (dia(novoMs) !== dia(iniMs)) return { encaixe: false };              // outro dia
  if (!(novoMs < iniMs) || minuto(novoMs) < minuto(de)) return { encaixe: false }; // depois do horário dela, ou antes da vaga
  return { encaixe: true, passou: novoMs < agoraMs - 15 * 60000 };
}

const REGRAS_PROMPT = `ENCAIXE NA FALTA (ver com a próxima cliente do dia se ela consegue vir antes)
Pergunta de encaixe esperando a resposta da Gleide agora:
{{ (() => { const t = $('Encaixe: esperando resposta').first().json.data; try { return JSON.parse(t) || '(nenhuma)'; } catch (e) { return t || '(nenhuma)'; } })() }}
- Quando você grava uma falta (liberar_horario, ou status_atendimento faltou) e a resposta da ferramenta traz "encaixe" com
  "perguntar": true, termine a SUA resposta com a pergunta que veio em "pergunta" (aqui vale terminar com pergunta).
  Ex.: "Anotei a falta da Maria ✅ A IA chama ela pra remarcar. Quer que eu veja com a Ana (das 15h) se ela consegue vir antes?"
  Só essa pergunta, do jeito de sempre: sem número, sem "responda sim ou não", sem explicar como funciona.
- Sem "encaixe" na resposta, ou com "perguntar": false: não pergunte nada sobre encaixe e não comente o motivo.
- Ela autorizou ("pode", "vê sim", "chama", "manda", "tenta"): chamar_para_encaixe NA HORA, com o agendamento_id e o nome que
  estão acima. A mensagem para a cliente sai pronta, você não escreve o texto. Depois responda curto:
  "Mandei pra Ana ✅ Se ela conseguir vir antes, você recebe o aviso do horário novo; se não, fica tudo como está."
- Ela disse que não ("não precisa", "deixa", "melhor não"): chamar_para_encaixe com desfazer = sim (ninguém recebe mensagem)
  e responda só "Beleza, fica como está."
- Ela não respondeu a isso, mudou de assunto, ou a resposta não deixa claro se é sobre o encaixe: NÃO chame ninguém. Se
  ficou ambíguo (ela disse "pode" e você tinha perguntado outra coisa junto), pergunte de novo, natural: "Posso ver com a Ana
  se ela vem antes?"
- Nunca chame para encaixe por conta própria, nunca troque a cliente por outra e nunca chame uma segunda cliente se a primeira
  não respondeu ou disse que não: é uma cliente só por falta, a que a ferramenta trouxe. Você não sugere hora para a cliente:
  quem diz a hora em que consegue chegar é ela, na conversa com a IA de atendimento.
- A ferramenta devolveu ERRO (passou do tempo, a cliente já chegou, a pergunta venceu): diga em uma frase que não deu mais
  tempo de chamar e que ficou tudo como está. Não tente outro caminho.
- Se a lista acima diz que o WhatsApp não enviou e a Gleide pedir para tentar de novo: chamar_para_encaixe outra vez.`;

const ID = (n) => 'e0ca15e0-0067-4a00-8000-' + String(n).padStart(12, '0');
const UUID_RE = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i';

module.exports = ({ workflow, agendaWorkflow, assistenteWorkflow: ag, ferramentasWorkflow: fe, faltasWorkflow: fa }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`encaixe: não achei "${nome}" em ${wf.name}`); return n; };
  // troca um trecho de código/texto que TEM de existir uma vez só: se o código de origem mudar, o gerador para aqui
  const trocar = (obj, campo, de, para, onde) => {
    const partes = String(obj[campo]).split(de);
    if (partes.length !== 2) throw new Error(`encaixe: ${onde} mudou (achei ${partes.length - 1}x "${String(de).slice(0, 70)}")`);
    obj[campo] = partes[0] + para + partes[1];
  };
  // encaixa um nó novo entre "antes" e o que vinha depois dele (saída 0)
  const entre = (wf, antes, novo) => {
    const saida = wf.connections[antes]?.main?.[0];
    if (!saida || saida.length !== 1) throw new Error(`encaixe: "${antes}" não tem uma saída só em ${wf.name}`);
    wf.nodes.push(novo);
    wf.connections[novo.name] = { main: [saida.slice()] };
    wf.connections[antes] = { ...wf.connections[antes], main: [[{ node: novo.name, type: 'main', index: 0 }], ...wf.connections[antes].main.slice(1)] };
  };
  if (ag.nodes.some((n) => n.name === 'chamar_para_encaixe')) throw new Error('encaixe: já montado');

  // =============== 1. Assistente - Ferramentas ===============
  const montar = achar(fe, 'Montar chamada').parameters;
  trocar(montar, 'jsCode', "funcao = 'n8n_assistente_liberar_horario'; args", "funcao = 'n8n_assistente_liberar_horario_encaixe'; args", 'liberar_horario no "Montar chamada"');
  trocar(montar, 'jsCode', "args = { ...base, p_agendamento_id: ou(v('agendamento_id')) };\n    break;\n  case 'horarios_livres':",
    "args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_turno: ou(v('busca')) };\n    break;\n  case 'horarios_livres':", 'os argumentos de liberar_horario');
  trocar(montar, 'jsCode', "p_status: v('status'), p_valor: valor() };", "p_status: v('status'), p_valor: valor(), p_turno: ou(v('busca')) };", 'os argumentos de status_atendimento');
  trocar(montar, 'jsCode', "funcao = 'n8n_assistente_status_agendamento';", "funcao = 'n8n_assistente_status_agendamento_encaixe';", 'status_atendimento no "Montar chamada"');
  trocar(montar, 'jsCode', "  default:\n    return [{ json: { erro: 'ferramenta desconhecida: '", [
    "  // encaixe na falta (encaixe.js, supabase/067): a Gleide respondeu à pergunta do encaixe. desfazer vazio = ela autorizou;",
    "  // \"sim\" = ela disse que não (ninguém é chamado); qualquer outro texto não envia nada (a IA pode ter copiado o \"não\" dela).",
    "  case 'chamar_para_encaixe': {",
    "    const recusou = /^\\s*(sim|s|true|1)\\s*[.!]?\\s*$/i.test(v('desfazer'));",
    "    if (!recusou && v('desfazer') !== '') return [{ json: { erro: 'NADA FOI ENVIADO: o campo desfazer só aceita vazio (a Gleide autorizou) ou sim (ela disse que não quer). Chame de novo do jeito certo.' } }];",
    "    funcao = 'n8n_assistente_chamar_para_encaixe'; enviar = !recusou;",
    `    args = { ...base, p_agendamento_id: ${UUID_RE}.test(v('agendamento_id')) ? v('agendamento_id') : null, p_nome: v('cliente_nome'), p_recusou: recusou, p_turno: ou(v('busca')) };`,
    '    break;',
    '  }',
    "  default:\n    return [{ json: { erro: 'ferramenta desconhecida: '",
  ].join('\n'), 'o fim do switch do "Montar chamada"');
  // a mensagem do encaixe saiu: grava na conversa e marca o encaixe como oferecido (as outras continuam como eram)
  const registrar = achar(fe, 'Registrar na conversa').parameters;
  trocar(registrar, 'url', '/rest/v1/rpc/n8n_registrar_saida',
    "/rest/v1/rpc/{{ $('Montar chamada').first().json.funcao === 'n8n_assistente_chamar_para_encaixe' ? 'n8n_encaixe_registrar_saida' : 'n8n_registrar_saida' }}",
    '"Registrar na conversa"');

  // =============== 2. Assistente da Gleide ===============
  const modelo = achar(ag, 'liberar_horario');
  const valores = modelo.parameters?.workflowInputs?.value || {};
  if (!valores.pedido_por || valores.acao !== 'liberar_horario' || !valores.cliente_nome) throw new Error('encaixe: a ferramenta liberar_horario mudou');
  const ia = (c, d) => `={{ $fromAI('${c}', \`${d}\`, 'string') }}`;
  // o "turno" = a mensagem da Gleide que a assistente está respondendo. Vai nas ferramentas da falta e na do encaixe (no campo
  // busca, que elas não usam): o banco recusa chamar a cliente na mesma mensagem em que a pergunta nasceu.
  const TURNO = "={{ $('Extrair dados').first().json.msgId }}";
  for (const nome of ['liberar_horario', 'status_atendimento']) {
    const v = achar(ag, nome).parameters.workflowInputs?.value;
    if (!v || 'busca' in v) throw new Error(`encaixe: a ferramenta ${nome} mudou`);
    v.busca = TURNO;
  }
  const tool = JSON.parse(JSON.stringify(modelo));
  tool.name = 'chamar_para_encaixe'; tool.id = ID(1); tool.position = [modelo.position[0], (modelo.position[1] || 0) + 440];
  tool.parameters.description = 'Encaixe na falta: manda UMA mensagem pronta para a cliente da pergunta de encaixe que está esperando, perguntando se ela consegue vir antes ' +
    '(o horário dela continua garantido). Use SÓ depois que a Gleide responder que pode a essa pergunta. Nunca por conta própria, nunca para outra cliente.';
  tool.parameters.workflowInputs.value = {
    acao: 'chamar_para_encaixe', pedido_por: valores.pedido_por, pode_forcar: valores.pode_forcar,
    agendamento_id: ia('agendamento_id', 'agendamento_id da cliente que pode vir antes, o que está na pergunta de encaixe esperando resposta (uuid exato; vazio se não tiver)'),
    cliente_nome: ia('cliente_nome', 'Primeiro nome da cliente que a Gleide autorizou chamar (a da pergunta de encaixe). Preencha sempre: o sistema confere e recusa se for outra'),
    desfazer: ia('desfazer', '"sim" quando a Gleide respondeu que NÃO quer que chame (ninguém recebe mensagem e a pergunta se encerra); vazio quando ela autorizou'),
    busca: TURNO,
  };
  ag.nodes.push(tool);
  ag.connections.chamar_para_encaixe = { ai_tool: [[{ node: 'Agente assistente', type: 'ai_tool', index: 0 }]] };
  // as duas ferramentas da falta dizem o que a resposta pode trazer (e não prometem mais oferecer o horário sozinhas)
  trocar(modelo.parameters, 'description', 'marca falta e oferece o resto do horário para quem tem horário mais tarde hoje.',
    'marca falta. Se der para a próxima cliente do dia vir antes, a resposta traz a pergunta do encaixe para você fazer à Gleide (ninguém é chamado sem ela autorizar).',
    'a descrição de liberar_horario');
  achar(ag, 'status_atendimento').parameters.description += ' Em falta de hoje, a resposta pode trazer a pergunta do encaixe para você fazer à Gleide.';

  // chamar_para_encaixe conta como gravação e como envio no "Conferir resposta" (registro do que foi feito e "Mandei ✅" só com envio de verdade)
  const conferir = achar(ag, 'Conferir resposta').parameters;
  trocar(conferir, 'jsCode', 'const ENVIO = ["chamar_cliente","avisar_cliente"], ESCRITA = [',
    'const ENVIO = ["chamar_cliente","avisar_cliente","chamar_para_encaixe"], ESCRITA = ["chamar_para_encaixe",', 'a lista de envios do "Conferir resposta"');
  // o "não" da Gleide volta OK com chamou = false: não é envio
  trocar(conferir, 'jsCode', 'const enviou = novos.some((f) => ENVIO.includes(f.t) && ok(f.r));',
    'const enviou = novos.some((f) => ENVIO.includes(f.t) && ok(f.r) && !/"chamou"\\s*:\\s*false/.test(f.r));', 'o "enviou" do "Conferir resposta"');
  // a pergunta que a ferramenta da falta devolveu TEM de chegar à Gleide (o banco já conta como perguntado): se a resposta não
  // trouxe, entra no fim. Só a última (uma pergunta pendente por vez).
  trocar(conferir, 'jsCode', "if (!texto) texto = ag.output ? '👍' : 'Desculpa, deu um erro aqui. Pode repetir?';", [
    "if (!texto) texto = ag.output ? '👍' : 'Desculpa, deu um erro aqui. Pode repetir?';",
    "const pergEncaixe = passos.filter((s) => ['liberar_horario', 'status_atendimento'].includes(s.action?.tool)).map((s) => lerResposta(s.observation))",
    "  .map((r) => (/\"perguntar\"\\s*:\\s*true/.test(r) ? (r.match(/\"pergunta\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"/) || [])[1] : '')).filter(Boolean).pop();",
    "if (pergEncaixe && !/vir antes/i.test(texto)) texto = texto + '\\n' + pergEncaixe.replace(/\\\\\"/g, '\"');",
  ].join('\n'), 'o fim do "Conferir resposta"');

  // a pergunta que espera a resposta dela, lida do banco a cada mensagem (a memória da conversa não guarda o resultado das ferramentas)
  const ler = achar(ag, 'Ler pendências');
  if (!String(ler.parameters.url).includes('rpc/n8n_assistente_pendencias_texto')) throw new Error('encaixe: "Ler pendências" mudou');
  const esperando = JSON.parse(JSON.stringify(ler));
  esperando.name = 'Encaixe: esperando resposta'; esperando.id = ID(2); esperando.position = [ler.position[0] + 60, (ler.position[1] || 0) - 240];
  esperando.parameters.url = ler.parameters.url.replace('rpc/n8n_assistente_pendencias_texto', 'rpc/n8n_encaixe_pendente_texto');
  entre(ag, 'Ler pendências', esperando);

  const prompt = achar(ag, 'Agente assistente').parameters.options;
  trocar(prompt, 'systemMessage', '- Nunca ofereça procurar cliente para adiantar um horário vago: você não tem como fazer isso.',
    '- Só ofereça ver com uma cliente se ela consegue vir antes quando a ferramenta da falta trouxer essa pergunta (ENCAIXE NA FALTA, no fim). Fora disso, não ofereça procurar cliente para adiantar um horário vago.',
    'a regra de não procurar cliente no prompt da assistente');
  trocar(prompt, 'systemMessage', '→ liberar_horario e diga em uma frase o que a ferramenta respondeu sobre a vaga.',
    '→ liberar_horario e diga em uma frase que anotou a falta; se a resposta trouxer a pergunta do encaixe, termine com ela (ENCAIXE NA FALTA, no fim).',
    'a regra do "libera" no prompt da assistente');
  prompt.systemMessage += '\n\n' + REGRAS_PROMPT;

  // =============== 3. Atendimento: a ficha da cliente ===============
  const sobre = achar(workflow, 'Sobre esta cliente');
  const ficha = achar(workflow, 'Supabase: ficha da cliente');
  const antes = Object.keys(workflow.connections).filter((k) => (workflow.connections[k].main || []).some((s) => (s || []).some((c) => c.node === 'Sobre esta cliente')));
  if (antes.length !== 1) throw new Error('encaixe: esperava um nó só antes de "Sobre esta cliente", achei ' + antes.length);
  const oferta = JSON.parse(JSON.stringify(ficha));
  oferta.name = 'Encaixe: oferta aberta'; oferta.id = ID(3); oferta.position = [sobre.position[0] - 110, (sobre.position[1] || 0) + 200];
  oferta.parameters = {
    method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_encaixe_da_cliente',
    sendHeaders: true, headerParameters: ficha.parameters.headerParameters,
    sendBody: true, specifyBody: 'json',
    jsonBody: "={{ JSON.stringify({ p_empresa_id: $env.EMPRESA_ID, p_cliente_id: $('Supabase: ficha da cliente').first().json.id || null }) }}",
    // resposta crua em $json.data: a função devolve null quando não tem oferta
    options: { timeout: 8000, response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } },
  };
  if (!ficha.parameters.headerParameters) throw new Error('encaixe: "Supabase: ficha da cliente" mudou');
  delete oferta.retryOnFail; delete oferta.maxTries; delete oferta.waitBetweenTries;
  oferta.onError = 'continueRegularOutput'; oferta.alwaysOutputData = true; oferta.executeOnce = true;
  entre(workflow, antes[0], oferta);

  const cod = sobre.parameters;
  trocar(cod, 'jsCode', "const TZ = 'America/Cuiaba';\n", [
    "const TZ = 'America/Cuiaba';",
    '// encaixe.js: oferta de encaixe aberta para esta cliente (supabase/067). Erro na leitura = sem oferta.',
    `const linhaEncaixe = ${linhaEncaixe.toString()};`,
    "const enc = (() => { try { const d = $('Encaixe: oferta aberta').first().json.data; const j = typeof d === 'string' ? JSON.parse(d) : d; return j && j.agendamento_id && j.horario_original ? j : null; } catch (e) { return null; } })();",
    '// o sinal que as ferramentas da agenda e o portão leem: o encaixe e o que a cliente escreveu desde a oferta',
    'const encSinal = () => {',
    '  if (!enc) return null;',
    "  let falas = '';",
    "  try { const desde = (Date.parse(enc.enviado_em) || 0) - 60000; falas = $('Supabase: últimas mensagens').all().map((i) => i.json).filter((m) => m && m.direcao === 'entrada' && Date.parse(m.criado_em) >= desde).map((m) => String(m.conteudo || '')).reverse().join(' | ').slice(0, 1500); } catch (e) {}",
    '  return { aberto: true, ag: enc.agendamento_id, de: enc.janela_inicio, ate: enc.horario_original, falas };',
    '};',
    '',
  ].join('\n'), 'o começo de "Sobre esta cliente"');
  // a oferta do encaixe é um contato do tipo vaga: a ficha mostra o ALÔ DE ENCAIXE no lugar do ALÔ DE VAGA
  trocar(cod, 'jsCode', "else if (alo.mensagem && alo.tipo === 'vaga') linhas.push('ALÔ DE VAGA: em '",
    "else if (alo.mensagem && alo.tipo === 'vaga' && !enc) linhas.push('ALÔ DE VAGA: em '", 'o ALÔ DE VAGA em "Sobre esta cliente"');
  const linhaFinal = "return [{ json: { pediuCancelar: ";
  const pedacos = cod.jsCode.split(linhaFinal);
  if (pedacos.length !== 4) throw new Error('encaixe: as saídas de "Sobre esta cliente" mudaram (achei ' + (pedacos.length - 1) + ')');
  // todas as saídas levam o sinal; a ficha completa (a última) ganha a linha do encaixe
  cod.jsCode = pedacos.slice(0, 3).join('return [{ json: { encaixe: encSinal(), pediuCancelar: ') +
    'if (enc) linhas.push(linhaEncaixe(enc));\nreturn [{ json: { encaixe: encSinal(), pediuCancelar: ' + pedacos[3];

  // as ferramentas da agenda levam o sinal (o campo motivo não é usado para remarcar nem para consultar)
  const SINAL = "={{ (() => { const e = $('Sobre esta cliente').first().json.encaixe; return e && e.aberto ? JSON.stringify({ encaixe: true, ag: e.ag, de: e.de, ate: e.ate }) : ''; })() }}";
  for (const [nome, acao] of [['remarcar_agendamento', 'remarcar'], ['consultar_horarios_livres', 'consultar']]) {
    const v = achar(workflow, nome).parameters.workflowInputs?.value;
    if (!v || v.acao !== acao || 'motivo' in v) throw new Error(`encaixe: a ferramenta ${nome} mudou`);
    v.motivo = SINAL;
  }

  // =============== 4. Agenda: remarcar para a hora que ela disse ===============
  const calc = achar(agendaWorkflow, 'Calcular').parameters;
  if (!String(achar(agendaWorkflow, 'Preparar').parameters.jsCode).includes("motivo: String(e.motivo || '').trim()")) throw new Error('encaixe: o Preparar não leva mais o motivo');
  const EM_CIMA = "  if (novo < agora.plus({ minutes: ANTECEDENCIA_REMARCAR_MIN })) return saida({ resposta: 'O novo horário já passou ou está muito em cima da hora. Ofereça outro.' });";
  trocar(calc, 'jsCode', EM_CIMA, [
    '  // encaixe.js: a cliente foi chamada para vir antes (encaixe na falta) e disse a hora. Vale em cima da hora (a Gleide está',
    '  // com o horário vago), desde que seja antes do horário dela e dentro da vaga. Não encaixou: o horário dela continua valendo.',
    `  const encaixeNaAgenda = ${encaixeNaAgenda.toString()};`,
    '  const encx = encaixeNaAgenda(p.motivo, alvo.agendamentoId, +alvo.ini, +novo, +agora);',
    '  if (encx.encaixe) {',
    "    const GARANTIDO = ' O horário dela de ' + fmt(alvo.ini) + ' CONTINUA GARANTIDO: diga isso com carinho. Não ofereça outros horários; se ela disser outra hora antes do horário dela, confirme com ela e tente de novo.';",
    "    if (encx.passou) return saida({ resposta: 'NÃO REMARCADO: essa hora já passou.' + GARANTIDO });",
    "    if (!noExpediente(novo, fimNovo)) return saida({ resposta: 'NÃO REMARCADO: nessa hora o serviço dela não cabe (almoço ou fechamento do salão).' + GARANTIDO });",
    "    if (semEle.some(([a, b]) => novo < b && fimNovo > a)) return saida({ resposta: 'NÃO REMARCADO: nessa hora a agenda ainda está ocupada.' + GARANTIDO });",
    '  } else',
    EM_CIMA,
  ].join('\n'), 'a antecedência do remarcar no Calcular');
  // consultar a hora do encaixe responderia "muito em cima da hora" (1 h de antecedência para horário novo): quem confere é o remarcar
  const CONSULTA = "    if (t < agora.plus({ minutes: ANTECEDENCIA_MIN })) motivo = 'já passou ou está muito em cima da hora';";
  trocar(calc, 'jsCode', CONSULTA, [
    '    // encaixe.js: hora dentro do encaixe oferecido a ela não se consulta como horário novo',
    "    { let je = null; try { je = JSON.parse(p.motivo || ''); } catch (e) {}",
    "      if (je && je.encaixe === true && +t >= Date.parse(je.de) - 60000 && +t < Date.parse(je.ate)) return [{ json: { acao: 'consultar', ok: true, resposta:",
    "        'ENCAIXE: essa hora é do encaixe que o salão ofereceu a ela, não precisa consultar. Se ela já disse que consegue chegar nessa hora, confirme com ela por extenso e, só com o sim, use remarcar_agendamento (ele confere a agenda sozinho). Não ofereça outros horários. Se esta consulta é de outro pedido (outro serviço ou outra pessoa), diga que vai confirmar com a Gleide e use perguntar_para_gleide.' } }]; }",
    CONSULTA,
  ].join('\n'), 'a consulta de um horário exato no Calcular');

  // =============== 5. Rotina de vagas: a vaga de falta só sai pelo encaixe ===============
  trocar(achar(fa, 'Vagas para oferecer').parameters, 'url', '/rest/v1/rpc/n8n_vagas_para_oferecer', '/rest/v1/rpc/n8n_vagas_para_oferecer_v2', '"Vagas para oferecer"');
};
module.exports.linhaEncaixe = linhaEncaixe;
module.exports.encaixeNaAgenda = encaixeNaAgenda;
module.exports.REGRAS_PROMPT = REGRAS_PROMPT;
