// Liga a IA ao Supabase (o banco que o CRM lê). Ver CONTRATO.md §5.
// Chamado pelo montar-workflow.js: encaixa nós nos workflows existentes (não cria workflow novo).
//   Principal: cada mensagem da cliente -> n8n_registrar_entrada (cria a cliente, grava a mensagem,
//              devolve ia_pausada = botão "Pausar IA" do CRM); cada balão da IA -> n8n_registrar_saida;
//              resposta manual da dona -> n8n_registrar_saida(humano, pausa 12h); "#ia" -> reativa.
//   Agenda:    criar / cancelar / remarcar no Google -> mesmo agendamento em `agendamentos` (origem 'ia').
//   Pausa:     transferir_para_humano -> ia_pausada_ate + motivo no Supabase (aparece em "Precisam de você").
// Tudo com onError = continuar: se o Supabase cair, a IA continua atendendo.
// Precisa no .env (e no docker-compose): SUPABASE_URL, SUPABASE_SERVICE_KEY, EMPRESA_ID.

// Telefone no formato do banco (55 + DDD + número). O WhatsApp entrega celular antigo sem o 9
// (556699990000); o CRM grava com 9 (5566999990000). Sem isso a mesma cliente vira duas.
const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;
const TIPO = (t) => `({ audioMessage: 'audio', imageMessage: 'imagem', conversation: 'texto', extendedTextMessage: 'texto' })[${t}] || 'outro'`;
const EMPRESA = '$env.EMPRESA_ID';

module.exports = ({ node, main, D, workflow, agendaWorkflow, pausaWorkflow }) => {
  const headers = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Prefer', value: 'return=representation' },
  ] };
  const supa = (name, method, rota, body, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method, url: `={{ $env.SUPABASE_URL }}/rest/v1/${rota}`,
    sendHeaders: true, headerParameters: headers,
    ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}` } : {}),
    options: {},
  }, { onError: 'continueRegularOutput', alwaysOutputData: true, ...extra });
  const entre = (wf, de, novo, para, saida = 0) => {
    wf.nodes.push(novo);
    wf.connections[de].main[saida] = [{ node: novo.name, type: 'main', index: 0 }];
    wf.connections[novo.name] = main(para);
  };
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`Supabase: não achei "${nome}"`); return n; };

  // ---------- Principal: mensagem da cliente ----------
  // Ordem nova: Filtro -> mídia -> Texto -> registrar no Supabase -> pausa (Redis OU CRM) -> buffer.
  // Registrar antes da pausa: o CRM mostra a mensagem mesmo com a IA pausada.
  workflow.connections['Filtro'] = main('É áudio ou foto?');
  workflow.nodes.push(supa('Supabase: registrar entrada', 'POST', 'rpc/n8n_registrar_entrada',
    `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR(`${D}.telefone`)}, p_nome: ${D}.nome || null,
       p_conteudo: $json.texto, p_tipo: ${TIPO(`${D}.tipo`)}, p_wa_message_id: ${D}.msgId }`));
  workflow.connections['Texto da mensagem'] = main('Supabase: registrar entrada');
  workflow.connections['Supabase: registrar entrada'] = main('Pausa: verificar');
  // Quem manda na pausa é o Supabase (botões Pausar/Reativar do CRM). O Redis só vale se o Supabase
  // não respondeu. Ativa pelo Supabase -> apaga a pausa antiga do Redis, senão "Reativar IA" no CRM
  // não destrava uma cliente que pediu humano (a pausa do Redis dura 12 h).
  workflow.nodes.push(node('Pausa: alinhar com o CRM', 'n8n-nodes-base.redis', 1, [0, 0], {
    operation: 'delete', key: `=pausa:{{ ${D}.telefone }}`,
  }, { credentials: achar(workflow, 'Pausa: verificar').credentials }));
  workflow.connections['IA ativa?'] = main('Pausa: alinhar com o CRM');
  workflow.connections['Pausa: alinhar com o CRM'] = main('Buffer: guardar msg');
  const ativa = achar(workflow, 'IA ativa?').parameters.conditions.conditions[0];
  ativa.leftValue = "={{ (() => { const p = $('Supabase: registrar entrada').item.json.ia_pausada; return typeof p === 'boolean' ? !p : !$json.pausa; })() }}";
  achar(workflow, 'Buffer: guardar msg').parameters.messageData = "={{ $('Texto da mensagem').item.json.texto }}";

  // ---------- Principal: a IA lê a ficha e o histórico antes de responder ----------
  // Não é outra IA: são duas consultas e um texto "Sobre esta cliente" no prompt. O que a Gleide
  // confirma no ✓ da agenda (inclusive "Fez outra coisa") aparece aqui na próxima mensagem.
  const M = "$('Montar entrada').item.json";
  workflow.nodes.push(
    supa('Supabase: ficha da cliente', 'GET',
      'clientes_status?select=id,nome,status,criado_em,ultima_visita,total_visitas,proximo_agendamento,retorno_previsto,observacoes' +
      `&empresa_id=eq.{{ ${EMPRESA} }}&telefone=eq.{{ ${TEL_BR(`${M}.telefone`)} }}`, null),
    supa('Supabase: histórico da cliente', 'GET',
      'agendamentos?select=inicio,status,retorno_previsto,servicos(nome)&status=neq.cancelado&order=inicio.desc&limit=12' +
      "&cliente_id=eq.{{ $json.id || '00000000-0000-0000-0000-000000000000' }}", null),
    node('Sobre esta cliente', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: String.raw`
const TZ = 'America/Cuiaba';
const ficha = $('Supabase: ficha da cliente').first().json;
const hist = $('Supabase: histórico da cliente').all().map((i) => i.json).filter((a) => a.inicio);
const dia = (s) => DateTime.fromISO(s).setZone(TZ).setLocale('pt-BR');
const data = (s) => (s.length === 10 ? DateTime.fromISO(s, { zone: TZ }) : dia(s)).toFormat('dd/LL/yyyy');
const NOVA = 'Cliente nova: é a primeira conversa dela com o salão. Nunca veio e não tem nada marcado; trate como primeiro contato.';
if (!ficha.id) return [{ json: { texto: NOVA } }];
// A ficha é criada na 1ª mensagem (n8n_registrar_entrada), então "sem visita" sozinho não diz se é nova:
// nova = cadastrada há menos de 1 dia e sem nenhum atendimento (nem marcado nem feito).
const recente = DateTime.fromISO(ficha.criado_em) > DateTime.now().minus({ days: 1 });
if (recente && !ficha.total_visitas && !hist.length) return [{ json: { texto: NOVA + (ficha.observacoes ? '\nObservações da Gleide: ' + ficha.observacoes : '') } }];

const SITUACAO = { em_dia: 'em dia', retorno_chegando: 'retorno de algum serviço chegando', retorno_atrasado: 'passou da data de voltar e ainda não marcou',
  inativa: 'sumida há bastante tempo', sem_visita: 'já conversou, mas ainda não veio ao salão' };
const linhas = [];
if (ficha.nome) linhas.push('Nome: ' + ficha.nome);
linhas.push('Situação: ' + (SITUACAO[ficha.status] || ficha.status));
if (ficha.total_visitas) linhas.push('Veio ' + ficha.total_visitas + 'x; última visita em ' + data(ficha.ultima_visita) + '.');

const agora = DateTime.now();
const futuros = hist.filter((a) => a.status === 'agendado' && dia(a.inicio) > agora).reverse();
for (const a of futuros) linhas.push('Horário marcado: ' + dia(a.inicio).toFormat("cccc, dd/LL 'às' HH:mm") + ' — ' + (a.servicos?.nome || 'serviço não informado'));

// um por serviço (o mais recente), com o retorno previsto de cada um
const vistos = new Set();
for (const a of hist.filter((x) => x.status === 'realizado')) {
  const nome = a.servicos?.nome || 'serviço não informado';
  if (vistos.has(nome)) continue;
  vistos.add(nome);
  linhas.push('Já fez: ' + nome + ' em ' + data(a.inicio) + (a.retorno_previsto ? ' → voltar por volta de ' + data(a.retorno_previsto) : ''));
}
const faltas = hist.filter((a) => a.status === 'faltou').length;
if (faltas) linhas.push('Faltou ' + faltas + 'x sem avisar.');
if (ficha.observacoes) linhas.push('Observações da Gleide: ' + ficha.observacoes.replace(/\s*\n\s*/g, ' | '));
// a Gleide chamou pelo CRM e esta mensagem é a resposta dela
const alo = $('Supabase: último alô').first().json;
if (alo.mensagem) linhas.push('ALÔ DE ' + (alo.tipo === 'reativacao' ? 'REATIVAÇÃO' : 'RETORNO') + ': em ' + dia(alo.criado_em).toFormat("dd/LL 'às' HH:mm") +
  ' a Gleide mandou para ela: «' + alo.mensagem + '». A mensagem de agora é a resposta a esse alô.');
return [{ json: { texto: linhas.join('\n') } }];
` }),
  );
  workflow.connections['Marcar como lida'] = main('Supabase: ficha da cliente');
  workflow.connections['Supabase: ficha da cliente'] = main('Supabase: histórico da cliente');
  // último alô do CRM (14 dias, o mesmo prazo do "respondeu" no banco) que ainda não virou agendamento
  workflow.nodes.push(supa('Supabase: último alô', 'GET',
    'contatos?select=tipo,mensagem,criado_em,resultado&resultado=in.(pendente,respondeu)&order=criado_em.desc&limit=1' +
    "&cliente_id=eq.{{ $('Supabase: ficha da cliente').first().json.id || '00000000-0000-0000-0000-000000000000' }}" +
    "&criado_em=gte.{{ $now.minus(14, 'days').toUTC().toISO() }}", null, { executeOnce: true }));
  workflow.connections['Supabase: histórico da cliente'] = main('Supabase: último alô');
  workflow.connections['Supabase: último alô'] = main('Sobre esta cliente');
  workflow.connections['Sobre esta cliente'] = main('Agente IA');
  const agente = achar(workflow, 'Agente IA').parameters.options;
  // o prompt do Victor já traz a ficha na seção 22: só acrescenta se ele não tiver
  if (!agente.systemMessage.includes("$('Sobre esta cliente')")) agente.systemMessage += `

SOBRE ESTA CLIENTE (ficha do salão, atualizada agora)
{{ $('Sobre esta cliente').first().json.texto }}

Use a ficha como quem já conhece a cliente:
- Não pergunte o que já está na ficha (nome, se já tem mega hair, qual serviço fez).
- Se ela perguntar "que horas é meu horário?", use ver_agendamentos para confirmar o horário atual,
  mesmo se a ficha já mostrar um horário.
- Se o retorno de um serviço está chegando ou passou, pode lembrar com naturalidade UMA vez
  (ex.: "já tá chegando a hora da manutenção do seu mega hair, quer que eu veja um horário?").
- Para marcar a volta de um serviço que ela já fez, ofereça a manutenção desse serviço.
- Se a ficha tiver "ALÔ DE RETORNO" ou "ALÔ DE REATIVAÇÃO", ela está respondendo à Gleide. Se ela
  topar ("quero", "sim", "pode ver"), NÃO pergunte qual serviço: use consultar_horarios_livres para a
  manutenção/serviço citado no alô (ou o último que ela fez) e já ofereça 2 horários. Se ela disser que
  não pode agora, responda com carinho, sem insistir. Não repita o texto do alô.
- Nunca leia a ficha para ela nem diga "no sistema consta". Observações da Gleide (alergias, preferências) são para você levar em conta, não para repetir.`;
  entre(workflow, 'Enviar mensagem', supa('Supabase: registrar saída', 'POST', 'rpc/n8n_registrar_saida',
    `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR(`${D}.telefone`)}, p_conteudo: $('Um balão por vez').item.json.texto,
       p_autor: 'ia', p_tipo: 'texto', p_wa_message_id: $json.key?.id || null }`), 'Um balão por vez');

  // ---------- Principal: a dona respondeu pelo celular / "#ia" ----------
  workflow.nodes.push(supa('Supabase: dona respondeu', 'POST', 'rpc/n8n_registrar_saida',
    `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR(`${D}.telefone`)}, p_conteudo: ${D}.texto || '[mídia]',
       p_autor: 'humano', p_tipo: ${TIPO(`${D}.tipo`)}, p_wa_message_id: ${D}.msgId, p_pausar_horas: 12 }`));
  workflow.connections['Pausa: humano assumiu (12h)'] = main('Supabase: dona respondeu');
  workflow.nodes.push(supa('Supabase: reativar IA', 'PATCH',
    `clientes?empresa_id=eq.{{ ${EMPRESA} }}&telefone=eq.{{ ${TEL_BR(`${D}.telefone`)} }}`,
    '{ ia_pausada_ate: null, motivo_pausa: null }'));
  workflow.connections['Pausa: remover'] = main('Supabase: reativar IA');

  // ---------- Principal: o "alô" de retorno que a Gleide manda pelo CRM não é "a dona assumiu" ----------
  // O CRM grava o alô em contatos e abre o WhatsApp do salão com o texto pronto; quando ela envia, chega
  // aqui como fromMe. Se o texto bate com um alô gravado nas últimas 2 h, só registra a saída (sem pausa):
  // a resposta da cliente tem de cair na IA, que já oferece o horário (ver "Sobre esta cliente").
  workflow.nodes.push(supa('Supabase: alô recente', 'GET',
    'contatos?select=mensagem,clientes!inner(telefone)&order=criado_em.desc&limit=1' +
    '&empresa_id=eq.{{ ' + EMPRESA + ' }}&clientes.telefone=eq.{{ ' + TEL_BR(D + '.telefone') + ' }}' +
    "&criado_em=gte.{{ $now.minus(2, 'hours').toUTC().toISO() }}", null));
  const SO_LETRAS = "(s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '').slice(0, 60)";
  workflow.nodes.push(node('É o alô do CRM?', 'n8n-nodes-base.if', 2.2, [0, 0], {
    conditions: {
      options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'alo1', operator: { type: 'boolean', operation: 'true', singleValue: true }, rightValue: '',
        leftValue: '={{ (() => { const n = ' + SO_LETRAS + '; const a = n($json.mensagem); return a.length > 10 && a === n(' + D + '.texto); })() }}' }],
      combinator: 'and',
    },
    options: {},
  }));
  workflow.nodes.push(supa('Supabase: registrar alô', 'POST', 'rpc/n8n_registrar_saida',
    '{ p_empresa_id: ' + EMPRESA + ', p_telefone: ' + TEL_BR(D + '.telefone') + ', p_conteudo: ' + D + ".texto, p_autor: 'humano', p_tipo: 'texto', p_wa_message_id: " + D + '.msgId }'));
  const naoEhAlo = workflow.connections['Comando #ia?'].main[1];
  workflow.connections['Comando #ia?'].main[1] = [{ node: 'Supabase: alô recente', type: 'main', index: 0 }];
  workflow.connections['Supabase: alô recente'] = main('É o alô do CRM?');
  workflow.connections['É o alô do CRM?'] = { main: [[{ node: 'Supabase: registrar alô', type: 'main', index: 0 }], naoEhAlo] };

  // ---------- Pausa: transferir_para_humano ----------
  const P = "$('Recebe pedido do agente').item.json";
  const motivoPausa = `(/reclam/i.test(${P}.motivo || '') ? 'reclamacao' : 'pediu_humano')`;
  const ultimoPausa = Object.keys(pausaWorkflow.connections).find((k) => pausaWorkflow.connections[k].main[0][0].node === 'Resposta');
  entre(pausaWorkflow, ultimoPausa, supa('Supabase: pausar IA', 'PATCH',
    `clientes?empresa_id=eq.{{ ${EMPRESA} }}&telefone=eq.{{ ${TEL_BR(`${P}.telefone`)} }}`,
    `{ ia_pausada_ate: $now.plus(12, 'hours').toISO(), motivo_pausa: ${motivoPausa} }`), 'Resposta');

  const Pr = "$('Preparar').item.json";

  // ---------- Agenda: o que já está marcado no CRM também ocupa horário (Calcular soma ao Google) ----------
  // inicio desde 12 h antes da janela, para pegar atendimento longo que começou antes e ainda não acabou
  agendaWorkflow.nodes.push(supa('Supabase: horários ocupados', 'GET',
    `agendamentos?select=inicio,fim,google_event_id&empresa_id=eq.{{ ${EMPRESA} }}&status=in.(agendado,realizado)` +
    `&inicio=gte.{{ DateTime.fromISO(${Pr}.timeMin || $now.toISO()).minus({ hours: 12 }).toUTC().toISO() }}` +
    `&inicio=lt.{{ ${Pr}.timeMax || $now.plus({ days: 8 }).toUTC().toISO() }}`, null));
  // horário de funcionamento e almoço do salão (os mesmos do CRM) e os horários futuros desta cliente
  // (marcados pela IA ou pela Gleide no app) para ver / remarcar / cancelar
  agendaWorkflow.nodes.push(
    supa('Supabase: config do salão', 'GET', `empresas?select=config&id=eq.{{ ${EMPRESA} }}`, null, { executeOnce: true }),
    supa('Supabase: agendamentos da cliente', 'GET',
      'agendamentos?select=id,inicio,fim,google_event_id,observacoes,servicos(nome),clientes!inner(telefone)' +
      `&empresa_id=eq.{{ ${EMPRESA} }}&status=eq.agendado&inicio=gt.{{ $now.toUTC().toISO() }}` +
      `&clientes.telefone=eq.{{ ${TEL_BR(`${Pr}.telefone`)} }}&order=inicio`, null),
  );
  agendaWorkflow.connections['Google: agendamentos da cliente'] = main('Supabase: horários ocupados');
  agendaWorkflow.connections['Supabase: horários ocupados'] = main('Supabase: config do salão');
  agendaWorkflow.connections['Supabase: config do salão'] = main('Supabase: agendamentos da cliente');
  agendaWorkflow.connections['Supabase: agendamentos da cliente'] = main('Calcular');

  // ---------- Agenda: criar ----------
  const ultimoCriar = Object.keys(agendaWorkflow.connections).find((k) => agendaWorkflow.connections[k].main[0][0]?.node === 'Resposta (agendado)');
  agendaWorkflow.nodes.push(
    supa('Supabase: cliente e serviços', 'GET',
      `clientes?select=id,nome&empresa_id=eq.{{ ${EMPRESA} }}&telefone=eq.{{ ${TEL_BR(`${Pr}.telefone`)} }}`, null),
    supa('Supabase: serviços', 'GET', `servicos?select=id,nome,duracao_min&ativo=eq.true&empresa_id=eq.{{ ${EMPRESA} }}`, null,
      { alwaysOutputData: true, executeOnce: true }),
    supa('Supabase: profissionais', 'GET', `profissionais?select=id,nome&ativo=eq.true&order=criado_em&empresa_id=eq.{{ ${EMPRESA} }}`, null,
      { executeOnce: true }),
    node('Montar agendamento', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: String.raw`
// Serviço: o da lista do Supabase mais parecido com o que a IA escreveu, pela proporção de
// palavras em comum (desempata nomes parecidos: "Manutenção de queratina" -> "Manutenção – queratina",
// "Mega hair com queratina" -> "Aplicação de mega hair – queratina"). Sem nada parecido: fica sem
// serviço e o nome vai nas observações (o CRM mostra; a Gleide ajusta no ✓).
const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const palavras = (s) => sem(s).split(/[^a-z0-9]+/).filter((p) => p.length > 2 && !['com', 'para', 'das', 'dos', 'que'].includes(p));
const pedido = $('Preparar').first().json;
const google = $('Google: criar evento').first().json;
const cliente = $('Supabase: cliente e serviços').first().json;
const servicos = $('Supabase: serviços').all().map((i) => i.json).filter((s) => s.id);
const prof = $('Supabase: profissionais').all().map((i) => i.json).filter((p) => p.id);
const alvo = palavras(pedido.servico);
let melhor = null, nota = 0;
// Manutenção só se o pedido falar em manutenção ("Tela adesiva" é aplicação). E precisa de pelo menos
// uma palavra em comum que não seja genérica ("Corte de cabelo" não vira "Visita para escolher cabelo").
const GENERICAS = ['cabelo', 'mega', 'hair'];
for (const s of servicos) {
  const ps = palavras(s.nome);
  if (ps.includes('manutencao') && !alvo.includes('manutencao')) continue;
  const comuns = ps.filter((p) => alvo.includes(p));
  if (!comuns.some((p) => !GENERICAS.includes(p))) continue;
  const n = comuns.length / new Set([...ps, ...alvo]).size;
  if (n > nota) { melhor = s; nota = n; }
}
if (!google.id || !cliente.id) return [{ json: { pular: true, motivo: !google.id ? 'google falhou' : 'cliente não está no Supabase' } }];
const obs = [melhor ? null : 'Serviço pedido: ' + pedido.servico, pedido.motivo || null].filter(Boolean).join(' · ');
return [{ json: { pular: false, corpo: {
  empresa_id: $env.EMPRESA_ID, cliente_id: cliente.id, servico_id: melhor ? melhor.id : null,
  profissional_id: prof[0] ? prof[0].id : null,
  inicio: google.start.dateTime, fim: google.end.dateTime,
  status: 'agendado', origem: 'ia', google_event_id: google.id, observacoes: obs || null,
} } }];
` }),
    supa('Supabase: gravar agendamento', 'POST', 'agendamentos', '$json.corpo'),
  );
  agendaWorkflow.connections[ultimoCriar] = main('Supabase: cliente e serviços');
  agendaWorkflow.connections['Supabase: cliente e serviços'] = main('Supabase: serviços');
  agendaWorkflow.connections['Supabase: serviços'] = main('Supabase: profissionais');
  agendaWorkflow.connections['Supabase: profissionais'] = main('Montar agendamento');
  agendaWorkflow.connections['Montar agendamento'] = main('Supabase: gravar agendamento');
  // nome que a cliente confirmou ao agendar vale mais que o nome do perfil do WhatsApp (apelido, emoji)
  agendaWorkflow.nodes.push(supa('Supabase: nome da cliente', 'PATCH',
    "clientes?id=eq.{{ $('Montar agendamento').item.json.corpo?.cliente_id || 'nenhum' }}",
    `{ nome: ${Pr}.nome || $('Supabase: cliente e serviços').item.json.nome }`));
  agendaWorkflow.connections['Supabase: gravar agendamento'] = main('Supabase: nome da cliente');
  agendaWorkflow.connections['Supabase: nome da cliente'] = main('Resposta (agendado)');
  // não grava se o Google falhou ou a cliente não existe no Supabase
  achar(agendaWorkflow, 'Supabase: gravar agendamento').parameters.url =
    "={{ $env.SUPABASE_URL }}/rest/v1/{{ $json.pular ? 'nao_gravar' : 'agendamentos' }}";

  // ---------- Agenda: cancelar / remarcar ----------
  // Pelo id do agendamento no Supabase (vale para o que a Gleide marcou no CRM). O Google só é mexido
  // quando o horário tem evento lá (os marcados pela IA); a resposta para a IA depende do Supabase.
  const C = "$('Calcular').item.json";
  const ALVO = `{{ ${C}.agendamentoId ? 'id=eq.' + ${C}.agendamentoId : 'google_event_id=eq.' + ${C}.eventId }}`;
  for (const [acao, google, resposta, ok, falha] of [
    ['cancelar', 'Google: cancelar evento', 'Resposta (cancelado)',
      `'CANCELADO com sucesso: o agendamento de ' + ${C}.de + ' foi removido da agenda. Confirme para a cliente.'`,
      "'NÃO CANCELADO: a agenda falhou. Peça desculpas e use transferir_para_humano.'"],
    ['remarcar', 'Google: remarcar evento', 'Resposta (remarcado)',
      `'REMARCADO com sucesso: o agendamento saiu de ' + ${C}.de + ' para ' + ${C}.quando + ' (é o MESMO agendamento, o horário antigo não existe mais). Confirme para a cliente.'`,
      "'NÃO REMARCADO: a agenda falhou. Peça desculpas e use transferir_para_humano.'"],
  ]) {
    const nome = acao === 'cancelar' ? 'Supabase: cancelar agendamento' : 'Supabase: remarcar agendamento';
    const ultimo = Object.keys(agendaWorkflow.connections).find((k) => agendaWorkflow.connections[k].main[0][0]?.node === resposta);
    entre(agendaWorkflow, ultimo, supa(nome, 'PATCH', `agendamentos?empresa_id=eq.{{ ${EMPRESA} }}&${ALVO}`,
      acao === 'cancelar'
        ? "{ status: 'cancelado' }"
        : `{ inicio: ${C}.patch.start.dateTime, fim: ${C}.patch.end.dateTime, ...(${C}.observacoes ? { observacoes: ${C}.observacoes } : {}) }`),
    resposta);
    // sem evento no Google: pula o Google e vai direto para o que vinha depois dele
    const se = `Tem evento no Google (${acao})?`;
    const pergunta = Object.keys(agendaWorkflow.connections).find((k) => agendaWorkflow.connections[k].main[0][0]?.node === google);
    agendaWorkflow.nodes.push(node(se, 'n8n-nodes-base.if', 2.2, [0, 0], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: `g-${acao}`, leftValue: `={{ !!${C}.eventId }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    }));
    agendaWorkflow.connections[pergunta].main[0] = [{ node: se, type: 'main', index: 0 }];
    agendaWorkflow.connections[se] = { main: [[{ node: google, type: 'main', index: 0 }], [{ node: agendaWorkflow.connections[google].main[0][0].node, type: 'main', index: 0 }]] };
    // deu certo = o Supabase mudou o horário (o Google é secundário)
    achar(agendaWorkflow, resposta).parameters.assignments.assignments[0].value = `={{ $('${nome}').item.json.id ? ${ok} : ${falha} }}`;
  }

  // a ferramenta de ver horários agora enxerga também o que a Gleide marcou no CRM
  achar(workflow, 'ver_agendamentos').parameters.description =
    'Lista os horários futuros desta cliente (marcados pela IA ou pela Gleide). Use quando ela perguntar o horário ' +
    'dela, ou antes de remarcar/cancelar se você não souber o data_hora_inicio do agendamento atual.';
};
