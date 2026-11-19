// Mensagem que a assistente da dona manda a uma cliente passa por mais quatro conferências antes de sair (só nas lojas
// com "envio_cuidadoso": true no loja.json; a Gleide não passa por aqui). Erros reais da Caroline, 13 a 19/11/2026:
//
// 1. ASSISTENTE E IA FALANDO AO MESMO TEMPO. Em 17/11 a Joyce escreveu para o salão e, no mesmo minuto, a Caroline mandou a
//    assistente oferecer horários a ela. A Joyce recebeu 8 mensagens em 5 minutos, de duas "pessoas", com ofertas
//    diferentes (sexta 17h, horário de almoço, sábado 15h, sexta 9h/11h/14h). O mesmo com Kauanny, Ingrid, Dirleia e Katia.
//    Agora: se a cliente escreveu nos últimos 4 minutos e a mensagem fala de horário, a assistente NÃO manda; o texto vira
//    RECADO para a IA de atendimento (Redis recado_dona:<telefone>, 3 h), que o usa na próxima resposta a ela.
//    O contato (contatos, tipo aviso) continua gravado para o oferta-da-dona.js saber que a dona ofereceu o horário (sem
//    sinal), mas com resultado "sem_resposta" para a IA não achar que ele foi entregue ("AVISO DO SALÃO" da ficha).
// 2. CONFIRMAÇÃO REPETIDA. A automática da véspera (18h) e, uma hora depois, outra da assistente (18/11: Dirleia, Giovanna,
//    Maria Cecilia; a Dirleia já tinha respondido). A Caroline pediu "sem mensagens insistentes". Agora: se a cliente já
//    recebeu confirmação nas últimas 20 h, a assistente não manda outra e conta à dona se ela respondeu.
// 3. "CONFIRMADO" SEM HORÁRIO. 17/11: "Seu horário está confirmadíssimo!" para a Fernanda Iasmin, que não tinha nada
//    marcado; 13/11: "seu horário para o dia 17/12" para a Marcia, marcada em 17/11. Agora: texto que diz que está
//    marcado/confirmado/reservado só sai se a cliente tem horário futuro no app, e as datas escritas (dd/mm) têm de bater.
// 4. TEXTO VAZIO não sai.
// 5. REMARCOU SEM AVISAR. 19/11: a assistente passou a Dirleia das 14h para as 16h (a IA tinha acabado de dizer a ela que as
//    16h estavam ocupadas) e a Maria Cecilia das 18h para as 18h30, e nenhuma das duas soube. Agora a resposta do
//    reagendar lembra a assistente de avisar a cliente (regra que já estava no prompt e foi esquecida).

module.exports = ({ node, main, ifNode, cond, REDIS, workflow, ferramentasWorkflow: F }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('envio-cuidadoso: não achei "' + nome + '"'); return n; };
  const modelo = achar(F, 'Apagar contato não enviado');
  const headers = modelo.parameters.headerParameters;
  if (!/apikey/.test(JSON.stringify(headers))) throw new Error('envio-cuidadoso: o nó modelo do Supabase mudou');
  const supa = (nome, url, extra = {}) => node(nome, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method: 'GET', url, sendHeaders: true, headerParameters: headers, options: { timeout: 15000 }, ...extra,
  }, { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true });
  const BANCO = "$('Executar no banco').first().json.data";
  const TEL = `(() => { try { return String(JSON.parse(${BANCO}).telefone || '').replace(/\\D/g, '') || '0'; } catch (e) { return '0'; } })()`;
  // a chave do recado usa o número SEM o 9 (é como o WhatsApp manda o telefone para a IA de atendimento)
  const SEM9 = (exp) => `String(${exp}).replace(/\\D/g, '').replace(/^(55\\d\\d)9(\\d{8})$/, '$1$2')`;

  // ---------- 1. ferramentas: conferir antes de mandar ----------
  const CONFERIR = String.raw`
const TZ = 'America/Cuiaba';
const agora = DateTime.now().setZone(TZ);
let b = {}; try { b = JSON.parse($('Executar no banco').first().json.data || '{}'); } catch (e) {}
const txt = String(b.mensagem || '');
const tel = String(b.telefone || '').replace(/\D/g, '');
const falhou = (x) => !x || x.error || (x.code && x.message);
const lerTudo = (nome) => { try { return $(nome).all().map((i) => i.json); } catch (e) { return [{ error: 'não rodou' }]; } };
const rMsgs = lerTudo('Envio: conversa da cliente'), rAgs = lerTudo('Envio: horários da cliente');
const leuMsgs = !rMsgs.some((x) => x && (x.error || (x.code && x.message)));
const leuAgs = !rAgs.some((x) => x && (x.error || (x.code && x.message)));
const msgs = rMsgs.filter((x) => x && x.criado_em && !falhou(x));
const ags = rAgs.filter((x) => x && x.inicio && !falhou(x));
const hm = (s) => DateTime.fromISO(s).setZone(TZ).toFormat('HH:mm');
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const n = norm(txt);
let bloqueio = '', recado = false;

// 4. vazio
if (!/[a-z0-9]/.test(n)) bloqueio = 'NÃO ENVIADO (nada chegou à cliente): o texto estava vazio. Escreva a mensagem e mande de novo.';

// 1. ela está conversando com a IA de atendimento agora
const ultimaDela = msgs.find((x) => x.direcao === 'entrada');
const minDela = ultimaDela ? agora.diff(DateTime.fromISO(ultimaDela.criado_em), 'minutes').minutes : 1e9;
const falaDeHorario = /\b\d{1,2} ?(h\b|h\d{2}|:\d{2}|horas?\b)|amanha|\bhoje\b|segunda|terca|quarta|quinta|sexta|sabado|domingo|\bdia \d|\b\d{1,2}\/\d{1,2}\b|horario|agenda|\bvaga|marcar|remarc|reagend|reserv|encaix/.test(n);
if (!bloqueio && leuMsgs && minDela <= 4 && falaDeHorario) {
  recado = true;
  bloqueio = 'GUARDEI COMO RECADO (nada foi mandado à cliente agora): ela está conversando com a IA de atendimento neste momento (última mensagem dela às ' + hm(ultimaDela.criado_em) + '). ' +
    'Se eu mandasse, ela receberia duas conversas ao mesmo tempo com ofertas diferentes. O seu texto foi passado para a IA de atendimento, que vai usar na próxima resposta a ela. ' +
    'Diga à Caroline em UMA linha: "*Nome* está conversando com a IA agora; passei seu recado pra IA usar na resposta ✅". NÃO chame chamar_cliente nem avisar_cliente de novo para ela agora e não diga que mandou.';
}

// 2. confirmação repetida
const ehConfirmacao = (s) => /confirm(ar|ando|ad[oa]|amos|o\b|ei)|lembrando (do|que|seu)|lembrete/.test(s) && /horario|amanha|\bhoje\b|atendimento/.test(s);
const ehMudanca = /\bmud|remarc|reagend|\btroc|passou para|passamos para|em vez de|novo horario|cancel|desmarc/.test(n);
if (!bloqueio && leuMsgs && ehConfirmacao(n) && !ehMudanca) {
  const ant = msgs.find((x) => x.direcao === 'saida' && ehConfirmacao(norm(x.conteudo)) && agora.diff(DateTime.fromISO(x.criado_em), 'hours').hours < 20);
  if (ant) {
    const resp = msgs.filter((x) => x.direcao === 'entrada' && x.criado_em > ant.criado_em).pop();
    bloqueio = 'NÃO ENVIADO (nada chegou à cliente): ela já recebeu confirmação deste horário às ' + hm(ant.criado_em) + ' («' + String(ant.conteudo).replace(/\s+/g, ' ').slice(0, 140) + '»)' +
      (resp ? ' e respondeu às ' + hm(resp.criado_em) + ': «' + String(resp.conteudo).replace(/\s+/g, ' ').slice(0, 100) + '»' : ' e ainda não respondeu') +
      '. A Caroline quer UMA confirmação por cliente: não mande outra. Conte a ela em uma linha se a cliente já confirmou ou não.';
  }
}

// 3. diz que está marcado/confirmado sem horário no app (ou com a data errada)
const afirma = /\b(confirmad[oa]s?|confirmadissim[oa]|marcad[oa]s?|reservad[oa]s?|agendad[oa]s?|garantid[oa]s?|marquei|reservei|agendei)\b/.test(n) && !/cancel|desmarc/.test(n);
if (!bloqueio && leuAgs && afirma) {
  const lista = ags.map((a) => DateTime.fromISO(a.inicio).setZone(TZ).toFormat("dd/LL 'às' HH:mm") + (a.servicos && a.servicos.nome ? ' (' + a.servicos.nome + ')' : '')).join('; ');
  if (!ags.length) {
    bloqueio = 'NÃO ENVIADO (nada chegou à cliente): o texto diz que o horário está marcado/confirmado/reservado, mas ela NÃO tem nenhum horário futuro no app. ' +
      'Primeiro grave com marcar_horario (dia, hora e serviço) e veja que voltou OK; só depois avise. Se a Caroline só quer oferecer, escreva como oferta, sem dizer que está marcado.';
  } else {
    const dias = new Set(ags.map((a) => DateTime.fromISO(a.inicio).setZone(TZ).toFormat('dd/LL')));
    const citadas = [...n.matchAll(/\b(\d{1,2})\/(\d{1,2})\b/g)].map((x) => x[1].padStart(2, '0') + '/' + x[2].padStart(2, '0'));
    if (citadas.length && citadas.every((d) => !dias.has(d))) {
      bloqueio = 'NÃO ENVIADO (nada chegou à cliente): o texto fala de ' + [...new Set(citadas)].join(', ') + ', mas os horários dela no app são: ' + lista +
        '. Confira o dia e o MÊS (em 13/11 uma cliente foi avisada de 17/12 quando o horário era 17/11) e mande de novo com a data certa.';
    }
  }
}
return [{ json: { bloqueio, recado, telefone: tel, chave: tel.replace(/^(55\d\d)9(\d{8})$/, '$1$2'), texto: txt } }];
`;

  // o "Mandar para a cliente" lia o resultado do banco em $json: com os nós novos no meio, lê pelo nome
  const mandar = achar(F, 'Mandar para a cliente');
  for (const k of ['url', 'jsonBody']) {
    const v = String(mandar.parameters[k] || '');
    if (!v.includes('$json.data') && k === 'jsonBody') throw new Error('envio-cuidadoso: o "Mandar para a cliente" não lê mais $json.data');
    mandar.parameters[k] = v.split('$json.data').join(BANCO);
    if (/\$json\b/.test(mandar.parameters[k])) throw new Error('envio-cuidadoso: sobrou $json em "Mandar para a cliente" (' + k + ')');
  }
  if (F.connections['Mandar para a cliente?']?.main?.[0]?.[0]?.node !== 'Mandar para a cliente') throw new Error('envio-cuidadoso: a ligação antes do envio mudou');

  const apagar = JSON.parse(JSON.stringify(modelo));
  delete apagar.id; apagar.name = 'Apagar contato bloqueado'; apagar.position = [modelo.position[0], modelo.position[1] + 200];
  // recado: o contato fica (o oferta-da-dona.js lê a hora oferecida), mas sem contar como entregue
  const marcarRecado = JSON.parse(JSON.stringify(modelo));
  delete marcarRecado.id; marcarRecado.name = 'Recado: contato não entregue'; marcarRecado.position = [modelo.position[0], modelo.position[1] + 400];
  marcarRecado.parameters = { ...marcarRecado.parameters, method: 'PATCH', sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ resultado: 'sem_resposta', mensagem: '[recado passado à IA, não enviado] ' + $('Envio: conferir').first().json.texto }) }}` };

  F.nodes.push(
    supa('Envio: conversa da cliente', `={{ $env.SUPABASE_URL }}/rest/v1/mensagens?select=direcao,autor,conteudo,criado_em,clientes!inner(telefone)&empresa_id=eq.{{ $env.EMPRESA_ID }}&clientes.telefone=eq.{{ ${TEL} }}&criado_em=gte.{{ $now.minus({ hours: 30 }).toUTC().toISO() }}&order=criado_em.desc&limit=40`),
    supa('Envio: horários da cliente', `={{ $env.SUPABASE_URL }}/rest/v1/agendamentos?select=id,inicio,status,servicos(nome),clientes!inner(telefone)&empresa_id=eq.{{ $env.EMPRESA_ID }}&clientes.telefone=eq.{{ ${TEL} }}&status=eq.agendado&inicio=gte.{{ $now.minus({ hours: 2 }).toUTC().toISO() }}&order=inicio`),
    node('Envio: conferir', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: CONFERIR.trim() }),
    ifNode('Envio liberado?', [0, 0], [cond('ev1', '={{ !$json.bloqueio }}', { type: 'boolean', operation: 'true', singleValue: true })]),
    ifNode('Envio: é recado?', [0, 0], [cond('ev2', '={{ !!$json.recado }}', { type: 'boolean', operation: 'true', singleValue: true })]),
    node('Recado: ler', 'n8n-nodes-base.redis', 1, [0, 0], {
      operation: 'get', key: "=recado_dona:{{ $('Envio: conferir').first().json.chave }}", propertyName: 'anterior', keyType: 'string', options: {},
    }, { credentials: REDIS, onError: 'continueRegularOutput', alwaysOutputData: true }),
    node('Recado: juntar', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: [
      "const ant = String($input.first().json.anterior || '').trim();",
      "const novo = '[' + DateTime.now().setZone('America/Cuiaba').toFormat('HH:mm') + '] ' + String($('Envio: conferir').first().json.texto || '').trim();",
      "return [{ json: { valor: ((ant ? ant + '\\n' : '') + novo).slice(-1500) } }];",
    ].join('\n') }),
    node('Recado: guardar', 'n8n-nodes-base.redis', 1, [0, 0], {
      operation: 'set', key: "=recado_dona:{{ $('Envio: conferir').first().json.chave }}", value: '={{ $json.valor }}', expire: true, ttl: 10800,
    }, { credentials: REDIS, onError: 'continueRegularOutput' }),
    apagar, marcarRecado,
  );
  F.connections['Mandar para a cliente?'].main[0] = [{ node: 'Envio: conversa da cliente', type: 'main', index: 0 }];
  F.connections['Envio: conversa da cliente'] = main('Envio: horários da cliente');
  F.connections['Envio: horários da cliente'] = main('Envio: conferir');
  F.connections['Envio: conferir'] = main('Envio liberado?');
  F.connections['Envio liberado?'] = { main: [[{ node: 'Mandar para a cliente', type: 'main', index: 0 }], [{ node: 'Envio: é recado?', type: 'main', index: 0 }]] };
  F.connections['Envio: é recado?'] = { main: [[{ node: 'Recado: ler', type: 'main', index: 0 }], [{ node: 'Apagar contato bloqueado', type: 'main', index: 0 }]] };
  F.connections['Recado: ler'] = main('Recado: juntar');
  F.connections['Recado: juntar'] = main('Recado: guardar');
  F.connections['Recado: guardar'] = main('Recado: contato não entregue');
  F.connections['Recado: contato não entregue'] = main('Resposta');
  F.connections['Apagar contato bloqueado'] = main('Resposta');

  // ---------- resposta à assistente: bloqueio/recado e o lembrete de avisar depois de remarcar ----------
  const resp = achar(F, 'Resposta').parameters.assignments.assignments[0];
  const m = /^=\{\{ ([\s\S]*) \}\}$/.exec(resp.value);
  if (!m) throw new Error('envio-cuidadoso: a "Resposta" das ferramentas mudou');
  const AVISAR = 'A CLIENTE AINDA NÃO SABE DESTA MUDANÇA (nada foi mandado a ela). Regra da Caroline: horário mudado a pedido dela = avise a cliente UMA vez, agora, com avisar_cliente ' +
    '(tipo aviso, sem texto: a mensagem sai pronta com o horário antigo e o novo). Só não avise se a Caroline disse que ela mesma avisa ou que já combinou direto com a cliente. Na resposta à Caroline diga se avisou ("Avisei a *Nome* ✅").';
  resp.value = '={{ (() => { ' +
    "try { if ($('Envio: conferir').isExecuted) { const ev = $('Envio: conferir').first().json; if (ev && ev.bloqueio) return ev.bloqueio; } } catch (e) {} " +
    'let r = (' + m[1] + '); ' +
    "try { if ($('Montar chamada').first().json.funcao === 'n8n_assistente_reagendar_confirma' && /^\\s*OK/i.test(String(r))) r = r + String.fromCharCode(10, 10) + " + JSON.stringify(AVISAR) + '; } catch (e) {} ' +
    'return r; })() }}';

  // ---------- 2. IA de atendimento: lê o recado (e apaga) antes de montar a ficha ----------
  const D = "$('Extrair dados').first().json";
  const antes = 'Supabase: conversa antiga';
  const depois = workflow.connections[antes]?.main?.[0]?.[0]?.node;
  if (!depois || workflow.connections[antes].main[0].length !== 1) throw new Error('envio-cuidadoso: a ligação depois de "Supabase: conversa antiga" mudou');
  const CHAVE_IA = `=recado_dona:{{ ${SEM9(D + '.telefone')} }}`;
  workflow.nodes.push(
    node('Recado da dona: ler', 'n8n-nodes-base.redis', 1, [0, 0], {
      operation: 'get', key: CHAVE_IA, propertyName: 'recado', keyType: 'string', options: {},
    }, { credentials: REDIS, onError: 'continueRegularOutput', alwaysOutputData: true }),
    node('Recado da dona: apagar', 'n8n-nodes-base.redis', 1, [0, 0], { operation: 'delete', key: CHAVE_IA },
      { credentials: REDIS, onError: 'continueRegularOutput', alwaysOutputData: true }),
  );
  workflow.connections[antes] = main('Recado da dona: ler');
  workflow.connections['Recado da dona: ler'] = main('Recado da dona: apagar');
  workflow.connections['Recado da dona: apagar'] = main(depois);
  const sobre = achar(workflow, 'Sobre esta cliente');
  const DE = 'const JA_FALOU = SAIDAS_TXT + (';
  if (!sobre.parameters.jsCode.includes(DE)) throw new Error('envio-cuidadoso: precisa do contexto-saidas.js antes (não achei "' + DE + '")');
  sobre.parameters.jsCode = sobre.parameters.jsCode.replace(DE, () => [
    '// envio-cuidadoso.js: recado que a Caroline mandou pela assistente enquanto a cliente conversava com você (não foi enviado a ela)',
    "let RECADO_TXT = '';",
    "try { const r = String($('Recado da dona: ler').first().json.recado || '').trim(); if (r) RECADO_TXT = '\\nRECADO DA CAROLINE PARA ESTA CLIENTE (chegou pela assistente enquanto vocês conversavam; AINDA NÃO FOI MANDADO a ela; hora entre colchetes): ' + r +",
    "  '\\nUse este recado AGORA, na sua resposta, com as suas palavras e junto do assunto da conversa. O que a Caroline mandou oferecer ou dizer vale mais que a sua sugestão: se ela mandou oferecer um horário, ofereça esse; se disse que um horário não dá, não ofereça. Se o recado não fala de sinal nem Pix, o horário que ela ofereceu não pede sinal. Não diga que é recado nem cite a assistente: fale como o salão.'; } catch (e) {}",
    'const JA_FALOU = RECADO_TXT + SAIDAS_TXT + (',
  ].join('\n'));
};
