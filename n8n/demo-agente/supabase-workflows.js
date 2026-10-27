// Liga a IA ao Supabase (o banco que o CRM lê). Ver CONTRATO.md §5.
// Chamado pelo montar-workflow.js: encaixa nós nos workflows existentes (não cria workflow novo).
//   Principal: cada mensagem da cliente -> n8n_registrar_entrada (cria a cliente, grava a mensagem,
//              devolve ia_pausada = botão "Pausar IA" do CRM); cada balão da IA -> n8n_registrar_saida;
//              resposta manual da dona -> n8n_registrar_saida(humano, pausa 12h); "#ia" -> reativa.
//   Agenda:    a agenda é a do app: lê e grava em `agendamentos` (criar com origem 'ia', cancelar, remarcar).
//   Pausa:     transferir_para_humano -> ia_pausada_ate + motivo no Supabase (aparece em "Precisam de você").
// Tudo com onError = continuar: se o Supabase cair, a IA continua atendendo.
// Precisa no .env (e no docker-compose): SUPABASE_URL, SUPABASE_SERVICE_KEY, EMPRESA_ID.

// Telefone no formato do banco (55 + DDD + número). O WhatsApp entrega celular antigo sem o 9
// (556699990000); o CRM grava com 9 (5566999990000). Sem isso a mesma cliente vira duas.
const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;
const TIPO = (t) => `({ audioMessage: 'audio', imageMessage: 'imagem', conversation: 'texto', extendedTextMessage: 'texto' })[${t}] || 'outro'`;
const EMPRESA = '$env.EMPRESA_ID';

module.exports = ({ node, main, D, workflow, agendaWorkflow, pausaWorkflow, crmWorkflow }) => {
  const headers = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Prefer', value: 'return=representation' },
  ] };
  // Supabase oscilando (502 do Cloudflare, "socket hang up" depois de 2,5 min): no máximo 15 s por chamada,
  // e leitura (GET) tenta de novo até 3x antes de a IA dizer que a agenda está fora do ar. Gravação não
  // repete sozinha, para não duplicar horário ou mensagem.
  const supa = (name, method, rota, body, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method, url: `={{ $env.SUPABASE_URL }}/rest/v1/${rota}`,
    sendHeaders: true, headerParameters: headers,
    ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}` } : {}),
    options: { timeout: 15000 },
  }, { onError: 'continueRegularOutput', alwaysOutputData: true,
    ...(method === 'GET' ? { retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 } : {}), ...extra });
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
  ativa.leftValue = "={{ (() => { const p = $('Supabase: registrar entrada').first().json.ia_pausada; return typeof p === 'boolean' ? !p : !$json.pausa; })() }}";
  achar(workflow, 'Buffer: guardar msg').parameters.messageData = `={{ JSON.stringify({ id: ${D}.msgId, texto: $('Texto da mensagem').item.json.texto }) }}`;

  // ---------- Principal: a IA lê a ficha e o histórico antes de responder ----------
  // Não é outra IA: são duas consultas e um texto "Sobre esta cliente" no prompt. O que a Gleide
  // confirma no ✓ da agenda (inclusive "Fez outra coisa") aparece aqui na próxima mensagem.
  const M = "$('Montar entrada').first().json";
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
// Mensagens dela que ficaram sem resposta (ex.: a IA falhou e só mandou o pedido de desculpas): não estão na
// memória do Redis, mas estão no banco. Sem isso a IA esquece o que ela pediu antes.
let agora_ids = [];
try { agora_ids = JSON.parse($('Montar entrada').first().json.mensagens || '[]').map((m) => m.id).filter(Boolean); } catch (e) {}
const recentes = $('Supabase: últimas mensagens').all().map((i) => i.json).filter((m) => m.direcao);
const pendentes = [];
for (const m of recentes) {
  if (m.direcao !== 'entrada') { if (/^Desculpa, tive um probleminha/.test(m.conteudo || '')) continue; break; } // o pedido de desculpas não responde nada
  if (!agora_ids.includes(m.wa_message_id)) pendentes.unshift(m);
}
const SEM_RESPOSTA = pendentes.length ? '\nMENSAGENS ANTERIORES DELA AINDA SEM RESPOSTA (responda junto com a de agora; podem não estar no histórico): ' +
  pendentes.map((m) => '«' + String(m.conteudo || '').slice(0, 300) + '» (' + dia(m.criado_em).toFormat('HH:mm') + ')').join(' · ') : '';
// Já respondeu nas últimas horas (a memória do Redis pode ter sido perdida ou apagada): não se apresentar de novo
const ultimaIA = recentes.find((m) => m.direcao === 'saida' && !/^Desculpa, tive um probleminha/.test(m.conteudo || ''));
const JA_FALOU = ultimaIA ? '\nVocê já conversou com ela hoje (sua última resposta foi às ' + dia(ultimaIA.criado_em).toFormat('HH:mm') +
  '): continue a conversa, sem se apresentar de novo nem cumprimentar como primeiro contato.' : '';
if (!ficha.id) return [{ json: { texto: (ultimaIA ? '' : NOVA) + JA_FALOU + SEM_RESPOSTA } }];
// A ficha é criada na 1ª mensagem (n8n_registrar_entrada), então "sem visita" sozinho não diz se é nova:
// nova = cadastrada há menos de 1 dia e sem nenhum atendimento (nem marcado nem feito).
const recente = DateTime.fromISO(ficha.criado_em) > DateTime.now().minus({ days: 1 });
if (recente && !ficha.total_visitas && !hist.length) return [{ json: { texto: (ultimaIA ? 'Ainda não veio ao salão e não tem nada marcado.' : NOVA) + (ficha.observacoes ? '\nObservações da Gleide: ' + ficha.observacoes : '') + JA_FALOU + SEM_RESPOSTA } }];

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
// remarcação: a Gleide teve um imprevisto e pediu pelo app para remarcar um horário (ver CONTRATO.md)
// falta: ela não veio e a IA a chamou sozinha para marcar outro horário (ver supabase/007)
if (alo.mensagem && alo.tipo === 'falta') linhas.push('ALÔ DE FALTA: ela faltou ao horário de ' +
  (alo.horario_original ? dia(alo.horario_original).toFormat("cccc, dd/LL 'às' HH:mm") : 'antes') +
  ' e em ' + dia(alo.criado_em).toFormat("dd/LL 'às' HH:mm") + ' você mandou: «' + alo.mensagem + '». A mensagem de agora é a resposta.');
// atraso: passou do horário dela, ela não chegou e a IA perguntou se está a caminho (ver supabase/011)
else if (alo.mensagem && alo.tipo === 'atraso') linhas.push('ALÔ DE ATRASO: o horário dela era ' +
  (alo.horario_original ? dia(alo.horario_original).toFormat("cccc, dd/LL 'às' HH:mm") + ' (data_hora_inicio = ' + dia(alo.horario_original).toFormat("yyyy-LL-dd'T'HH:mm") + ')' : 'hoje') +
  ', ela não tinha chegado e em ' + dia(alo.criado_em).toFormat("dd/LL 'às' HH:mm") + ' você mandou: «' + alo.mensagem + '». A mensagem de agora é a resposta.' +
  (alo.agendamentos?.status === 'faltou' ? ' ATENÇÃO: ela não respondeu a tempo e esse horário já ficou como falta (pode ter ido para outra cliente).' : ''));
// vaga: abriu um horário antes do dela e a IA ofereceu adiantar (ver supabase/010)
else if (alo.mensagem && alo.tipo === 'vaga') linhas.push('ALÔ DE VAGA: em ' + dia(alo.criado_em).toFormat("dd/LL 'às' HH:mm") +
  ' você ofereceu adiantar o horário dela de ' + (alo.horario_original ? dia(alo.horario_original).toFormat("cccc, dd/LL 'às' HH:mm") : 'agora') +
  ' para a vaga de ' + (alo.vagas?.inicio ? dia(alo.vagas.inicio).toFormat("cccc, dd/LL 'às' HH:mm") + ' (data_hora_nova = ' + dia(alo.vagas.inicio).toFormat("yyyy-LL-dd'T'HH:mm") + ')' : '?') +
  ' e mandou: «' + alo.mensagem + '». A mensagem de agora é a resposta.' +
  // vaga de atraso: confere na hora se a cliente atrasada não apareceu (a rotina de 5 min pode não ter fechado a vaga ainda)
  (alo.vagas && (alo.vagas.status !== 'aberta' || (alo.vagas.motivo === 'atraso' && alo.vagas.agendamentos?.status !== 'faltou'))
    ? ' ATENÇÃO: essa vaga não está mais livre (outra pessoa ficou com ela ou já está em cima da hora).' : ''));
else if (alo.mensagem && alo.tipo === 'remarcacao') linhas.push('ALÔ DE REMARCAÇÃO: em ' + dia(alo.criado_em).toFormat("dd/LL 'às' HH:mm") +
  ' a Gleide pediu para remarcar o horário de ' + (alo.horario_original ? dia(alo.horario_original).toFormat("cccc, dd/LL 'às' HH:mm") : 'ela') +
  ' e mandou: «' + alo.mensagem + '». A mensagem de agora é a resposta a esse pedido.');
// aviso: a Gleide pediu à assistente para avisar a cliente (horário mudado, cancelamento, recado; ver supabase/013)
else if (alo.mensagem && alo.tipo === 'aviso') linhas.push('AVISO DO SALÃO: em ' + dia(alo.criado_em).toFormat("dd/LL 'às' HH:mm") +
  ' a Gleide mandou avisar: «' + alo.mensagem + '». A mensagem de agora pode ser a resposta a esse aviso.');
else if (alo.mensagem) linhas.push('ALÔ DE ' + (alo.tipo === 'reativacao' ? 'REATIVAÇÃO' : 'RETORNO') + ': em ' + dia(alo.criado_em).toFormat("dd/LL 'às' HH:mm") +
  ' a Gleide mandou para ela: «' + alo.mensagem + '». A mensagem de agora é a resposta a esse alô.');
return [{ json: { texto: linhas.join('\n') + JA_FALOU + SEM_RESPOSTA } }];
` }),
  );
  workflow.connections['Marcar como lida'] = main('Supabase: ficha da cliente');
  workflow.connections['Supabase: ficha da cliente'] = main('Supabase: histórico da cliente');
  // último alô do CRM (14 dias, o mesmo prazo do "respondeu" no banco) que ainda não virou agendamento
  workflow.nodes.push(supa('Supabase: último alô', 'GET',
    'contatos?select=tipo,mensagem,criado_em,resultado,horario_original,vagas(inicio,status,motivo,agendamentos(status)),agendamentos!contatos_agendamento_id_fkey(status)' +
    '&resultado=in.(pendente,respondeu)&order=criado_em.desc&limit=1' +
    "&cliente_id=eq.{{ $('Supabase: ficha da cliente').first().json.id || '00000000-0000-0000-0000-000000000000' }}" +
    "&criado_em=gte.{{ $now.minus(14, 'days').toUTC().toISO() }}", null, { executeOnce: true }));
  // últimas mensagens (12 h, mais nova primeiro) para achar as que ficaram sem resposta
  workflow.nodes.push(supa('Supabase: últimas mensagens', 'GET',
    'mensagens?select=direcao,conteudo,wa_message_id,criado_em&order=criado_em.desc&limit=15' +
    "&cliente_id=eq.{{ $('Supabase: ficha da cliente').first().json.id || '00000000-0000-0000-0000-000000000000' }}" +
    "&criado_em=gte.{{ $now.minus(12, 'hours').toUTC().toISO() }}", null, { executeOnce: true }));
  workflow.connections['Supabase: histórico da cliente'] = main('Supabase: último alô');
  workflow.connections['Supabase: último alô'] = main('Supabase: últimas mensagens');
  // Tabela de serviços que a Gleide edita no app (Configurações › Serviços e preços): vale mais que a seção 09
  workflow.nodes.push(supa('Supabase: tabela de serviços', 'GET',
    `servicos?select=nome,categoria,preco,duracao_min,a_partir_de&ativo=eq.true&order=categoria,nome&empresa_id=eq.{{ ${EMPRESA} }}`, null, { executeOnce: true }));
  workflow.connections['Supabase: últimas mensagens'] = main('Supabase: tabela de serviços');
  workflow.connections['Supabase: tabela de serviços'] = main('Sobre esta cliente');
  workflow.connections['Sobre esta cliente'] = main('Agente IA');
  const agente = achar(workflow, 'Agente IA').parameters.options;
  agente.systemMessage += `

SERVIÇOS E PREÇOS (do app, atualizados agora pela Gleide; se algum valor ou duração for diferente da seção 09, vale ESTA lista)
{{ $('Supabase: tabela de serviços').all().map((i) => i.json).filter((s) => s.nome).map((s) => '- ' + s.nome + ': ' + (s.preco === null || s.preco === undefined ? 'sem preço cadastrado (não informe valor)' : Number(s.preco) === 0 ? 'gratuito' : (s.a_partir_de === false ? 'R$ ' : 'a partir de R$ ') + Number(s.preco).toLocaleString('pt-BR')) + ', ' + s.duracao_min + ' min').join('\\n') || '(sem lista: use a seção 09)' }}
Serviço desativado no app não deve estar nesta lista nem ser oferecido. O filtro de serviços ativos precisa ser garantido na consulta Supabase anterior a esta expressão; não presuma que o .filter((s) => s.nome) exclui desativados. "a partir de" = valor mínimo, o final depende do serviço/cabelo (seção 07); sem "a partir de" = preço fechado. Cabelo humano (fios) não tem preço liberado nesta lista nem na seção 09: para tentar obter uma estimativa, consulte a Gleide conforme seção 07-C, e só repasse número explicitamente confirmado para aquele pedido, se houver. Se a lista aparecer vazia ou inválida, não trate isso como prova de que todos os serviços antigos estão ativos: use a seção 09 só como referência e peça confirmação à Gleide se não houver dados confiáveis para ofertar/marcar um serviço. Valores ausentes, vazios ou inválidos não devem ser interpretados como gratuito ou R$ NaN. As expressões dinâmicas acima permanecem intocadas; a validação de campos preco, a_partir_de, duracao_min e ativo deve ser feita no fluxo antes de inserir a lista aqui.`;
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
- Se a ficha tiver "ALÔ DE REMARCAÇÃO", a Gleide teve um imprevisto e pediu para remarcar aquele horário.
  É remarcar, não marcar outro: use ver_agendamentos, consultar_horarios_livres para o mesmo serviço
  (perto do dia que ela preferir) e, com o "sim" dela, remarcar_agendamento. Nunca use criar_agendamento.
- Se a ficha tiver "ALÔ DE ATRASO", passou do horário dela e você perguntou se está a caminho. Chegando ou já
  no salão: responda curto, sem cobrar. Não vem hoje: acolha, consulte horários do mesmo serviço e, com o "sim",
  use remarcar_agendamento com o data_hora_inicio da ficha (se a ficha disser que já ficou como falta, criar_agendamento).
- Se a ficha tiver "AVISO DO SALÃO", a Gleide mandou um aviso sobre o horário dela (ex.: horário mudou porque a agenda
  atrasou). Se ela confirmar ("ok", "tudo bem"), responda curto e carinhoso. Se o novo horário não der, peça desculpas pelo
  transtorno, use ver_agendamentos e consultar_horarios_livres do mesmo serviço e, com o "sim", remarcar_agendamento.
- Se a ficha tiver "ALÔ DE FALTA", ela não veio ao horário e você a chamou. Acolha sem cobrar nem julgar
  (imprevisto acontece; o horário já passou, então não fale em desmarcar nem em multa). Se ela quiser,
  consulte horários do mesmo serviço e, com o "sim", use
  criar_agendamento (o horário antigo já ficou como falta: é um horário novo). Se não quiser agora, encerre com carinho.
- Nunca leia a ficha para ela nem diga "no sistema consta". Observações da Gleide (alergias, preferências) são para você levar em conta, não para repetir.`;
  // .first(), não .item: quando a mensagem esperou a IA terminar outra resposta ("Aguardar 3s"), o n8n
  // perdia o fio do .item até "Extrair dados", a expressão quebrava ("JSON Body não é JSON válido") e o
  // balão não ia para o app. Cada execução é de uma mensagem só e o loop manda um balão por vez.
  entre(workflow, 'Enviar mensagem', supa('Supabase: registrar saída', 'POST', 'rpc/n8n_registrar_saida',
    `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR("$('Extrair dados').first().json.telefone")}, p_conteudo: $('Um balão por vez').first().json.texto,
       p_autor: 'ia', p_tipo: 'texto', p_wa_message_id: $json.key?.id || null }`), 'Um balão por vez');
  // só grava o balão que o WhatsApp aceitou: o app não mostra como enviada a mensagem que não chegou
  achar(workflow, 'Supabase: registrar saída').parameters.url =
    "={{ $env.SUPABASE_URL }}/rest/v1/{{ $json.key?.id ? 'rpc/n8n_registrar_saida' : 'nao_gravar' }}";

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
  const P = "$('Recebe pedido do agente').first().json";
  // a IA escreve o motivo com as palavras dela ("insatisfeita, a mega caiu"): não só "reclamação"
  const motivoPausa = `(/reclam|insatisf|chatead|chate|frustr|caiu|mal feit|ruim|estrag|defeito|problema com o servi/i.test(${P}.motivo || '') ? 'reclamacao' : 'pediu_humano')`;
  const ultimoPausa = Object.keys(pausaWorkflow.connections).find((k) => pausaWorkflow.connections[k].main[0][0].node === 'Resposta');
  entre(pausaWorkflow, ultimoPausa, supa('Supabase: pausar IA', 'PATCH',
    `clientes?empresa_id=eq.{{ ${EMPRESA} }}&telefone=eq.{{ ${TEL_BR(`${P}.telefone`)} }}`,
    `{ ia_pausada_ate: $now.plus(12, 'hours').toISO(), motivo_pausa: ${motivoPausa}, resumo_ia_em: $now.toISO(),
       resumo_ia: ['Motivo: ' + (${P}.motivo || 'pediu atendimento'), ${P}.resumo || '', ${P}.o_que_precisa ? 'Precisa de você: ' + ${P}.o_que_precisa : ''].filter(Boolean).join('\\n') }`), 'Resposta');
  // Aviso no WhatsApp da dona (empresas.config.whatsapp_alerta): resumo curto + link da conversa no app.
  // Sai pelo número do salão, então o número de alerta tem de ser outro (o WhatsApp não manda para ele mesmo).
  entre(pausaWorkflow, 'Supabase: pausar IA', supa('Supabase: número de alerta', 'GET',
    `empresas?select=alerta:config->>whatsapp_alerta&id=eq.{{ ${EMPRESA} }}`, null, { executeOnce: true }), 'Resposta');
  const CLI = "$('Supabase: pausar IA').first().json";
  const FONE = `String(${CLI}.telefone || '').replace(/^55(\\d{2})(\\d{4,5})(\\d{4})$/, '($1) $2-$3')`;
  entre(pausaWorkflow, 'Supabase: número de alerta', node('Avisar a Gleide (WhatsApp)', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
    sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ number: $json.alerta, text: '🔔 Cliente precisa de você\\n' + (${CLI}.nome || 'Cliente') + ' · ' + ${FONE} +
      '\\n' + (${P}.motivo || 'pediu atendimento') + (${P}.resumo ? '\\n\\n' + ${P}.resumo : '') +
      (${P}.o_que_precisa ? '\\n\\nPrecisa de você: ' + ${P}.o_que_precisa : '') +
      '\\n\\nVer e responder: ' + ($env.APP_URL || 'https://app.oistudio.com.br') + '/conversas/' + ${CLI}.id }) }}`,
    options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput', executeOnce: true }), 'Resposta');

  // ---------- CRM: anotar_no_crm também no Supabase ----------
  // O que a IA anota (interesse, orçamento, objeção) vira a pré-avaliação da cliente (supabase/004):
  // o app mostra o pre_resumo com o selo "IA" na Agenda, no Início, no ✓ e na ficha. A ficha antiga
  // (Postgres do PC) continua recebendo também. Pré-avaliação sem horário ligado não vira pendência
  // da assistente (pendencias_gleide só cobra avaliação com agendamento).
  const A = "$('Recebe pedido do agente').first().json";
  entre(crmWorkflow, 'Anotar na ficha', supa('Supabase: pré-avaliação', 'POST', 'rpc/n8n_salvar_pre_avaliacao',
    `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR(`${A}.telefone`)},
       p_dados: { resumo: (${A}.resumo || ${A}.interesse || '').trim(), tecnica_interesse: (${A}.interesse || '').trim() } }`), 'Resposta');

  const Pr = "$('Preparar').item.json";
  const C = "$('Calcular').item.json";
  const se = (wf, de, saida, para) => { wf.connections[de].main[saida] = [{ node: para, type: 'main', index: 0 }]; };
  const resposta = (nome, gravou, ok, falha) => {
    achar(agendaWorkflow, nome).parameters.assignments.assignments[0].value = `={{ $('${gravou}').item.json.id ? ${ok} : ${falha} }}`;
  };

  // ---------- Agenda: o que já está marcado no CRM ocupa horário (é a única agenda) ----------
  // inicio desde 12 h antes da janela, para pegar atendimento longo que começou antes e ainda não acabou
  agendaWorkflow.nodes.push(supa('Supabase: horários ocupados', 'GET',
    // faltou também vem: o Calcular não conta esse horário como ocupado (vaga de atraso, 011)
    `agendamentos?select=inicio,fim,status&empresa_id=eq.{{ ${EMPRESA} }}&status=in.(agendado,realizado,faltou)` +
    `&inicio=gte.{{ DateTime.fromISO(${Pr}.timeMin || $now.toISO()).minus({ hours: 12 }).toUTC().toISO() }}` +
    `&inicio=lt.{{ ${Pr}.timeMax || $now.plus({ days: 8 }).toUTC().toISO() }}`, null));
  agendaWorkflow.nodes.push(
    supa('Supabase: config do salão', 'GET', `empresas?select=config&id=eq.{{ ${EMPRESA} }}`, null, { executeOnce: true }),
    supa('Supabase: agendamentos da cliente', 'GET',
      'agendamentos?select=id,inicio,fim,observacoes,servicos(nome),clientes!inner(telefone)' +
      // desde 1 h atrás: a cliente atrasada (011) ainda consegue remarcar o horário que acabou de passar
      `&empresa_id=eq.{{ ${EMPRESA} }}&status=eq.agendado&inicio=gt.{{ $now.minus(1, 'hour').toUTC().toISO() }}` +
      `&clientes.telefone=eq.{{ ${TEL_BR(`${Pr}.telefone`)} }}&order=inicio`, null),
  );
  agendaWorkflow.connections['Preparar'] = main('Supabase: horários ocupados');
  agendaWorkflow.connections['Supabase: horários ocupados'] = main('Supabase: config do salão');
  agendaWorkflow.connections['Supabase: config do salão'] = main('Supabase: agendamentos da cliente');
  agendaWorkflow.connections['Supabase: agendamentos da cliente'] = main('Calcular');

  // ---------- Agenda: criar = novo horário no app (origem 'ia') ----------
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
const horario = $('Calcular').first().json.evento;
const cliente = $('Supabase: cliente e serviços').first().json;
const servicos = $('Supabase: serviços').all().map((i) => i.json).filter((s) => s.id);
const prof = $('Supabase: profissionais').all().map((i) => i.json).filter((p) => p.id);
const alvo = palavras(pedido.servico);
// A IA às vezes manda só "Queratina" e deixa o "manutenção" no motivo ("manutenção queratina"):
// sem isso virava a aplicação (240 min, outro preço e outro retorno)
if (!alvo.includes('manutencao') && palavras(pedido.motivo).includes('manutencao')) alvo.push('manutencao');
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
// a ficha é criada na 1ª mensagem (n8n_registrar_entrada); sem ela não há onde marcar
if (!cliente.id) return [{ json: { pular: true, motivo: 'cliente não está no Supabase' } }];
const obs = [melhor ? null : 'Serviço pedido: ' + pedido.servico, pedido.motivo || null].filter(Boolean).join(' · ');
return [{ json: { pular: false, corpo: {
  empresa_id: $env.EMPRESA_ID, cliente_id: cliente.id, servico_id: melhor ? melhor.id : null,
  profissional_id: prof[0] ? prof[0].id : null,
  inicio: horario.start.dateTime, fim: horario.end.dateTime,
  status: 'agendado', origem: 'ia', observacoes: obs || null,
} } }];
` }),
    supa('Supabase: gravar agendamento', 'POST', 'agendamentos', '$json.corpo'),
  );
  se(agendaWorkflow, 'Criar evento?', 0, 'Supabase: cliente e serviços');
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
  // cliente sem ficha: não grava (rota inexistente = erro = "NÃO AGENDADO")
  achar(agendaWorkflow, 'Supabase: gravar agendamento').parameters.url =
    "={{ $env.SUPABASE_URL }}/rest/v1/{{ $json.pular ? 'nao_gravar' : 'agendamentos' }}";
  resposta('Resposta (agendado)', 'Supabase: gravar agendamento',
    `'AGENDADO com sucesso na agenda do salão: ' + ${C}.quando + '. Agora confirme para a cliente o serviço, o dia e a hora.'`,
    "'NÃO AGENDADO: a agenda falhou ao gravar. Peça desculpas e use transferir_para_humano para a equipe marcar.'");

  // ---------- Agenda: cancelar / remarcar = o mesmo horário no app (vale para o que a Gleide marcou) ----------
  const ALVO = `id=eq.{{ ${C}.agendamentoId }}`;
  agendaWorkflow.nodes.push(
    supa('Supabase: cancelar agendamento', 'PATCH', `agendamentos?empresa_id=eq.{{ ${EMPRESA} }}&${ALVO}`, "{ status: 'cancelado' }"),
    supa('Supabase: remarcar agendamento', 'PATCH', `agendamentos?empresa_id=eq.{{ ${EMPRESA} }}&${ALVO}`,
      `{ inicio: ${C}.patch.start.dateTime, fim: ${C}.patch.end.dateTime, ...(${C}.observacoes ? { observacoes: ${C}.observacoes } : {}) }`),
  );
  se(agendaWorkflow, 'Cancelar evento?', 0, 'Supabase: cancelar agendamento');
  agendaWorkflow.connections['Supabase: cancelar agendamento'] = main('Resposta (cancelado)');
  se(agendaWorkflow, 'Remarcar evento?', 0, 'Supabase: remarcar agendamento');
  agendaWorkflow.connections['Supabase: remarcar agendamento'] = main('Resposta (remarcado)');
  resposta('Resposta (cancelado)', 'Supabase: cancelar agendamento',
    `'CANCELADO com sucesso: o agendamento de ' + ${C}.de + ' foi removido da agenda. Confirme para a cliente.'`,
    "'NÃO CANCELADO: a agenda falhou. Peça desculpas e use transferir_para_humano.'");
  resposta('Resposta (remarcado)', 'Supabase: remarcar agendamento',
    `'REMARCADO com sucesso: o agendamento saiu de ' + ${C}.de + ' para ' + ${C}.quando + ' (é o MESMO agendamento, o horário antigo não existe mais). Confirme para a cliente.'`,
    "'NÃO REMARCADO: a agenda falhou. Peça desculpas e use transferir_para_humano.'");

  // a ferramenta de ver horários agora enxerga também o que a Gleide marcou no CRM
  achar(workflow, 'ver_agendamentos').parameters.description =
    'Lista os horários futuros desta cliente (marcados pela IA ou pela Gleide). SEMPRE use quando ela perguntar o horário ' +
    'dela ("que horas é meu horário?", "que dia marquei?"), mesmo se a ficha já mostrar um: a ficha pode estar desatualizada. ' +
    'Use também antes de remarcar/cancelar se você não souber o data_hora_inicio do agendamento atual.';
};
