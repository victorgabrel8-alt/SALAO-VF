// Assistente da Gleide (ver docs/PLANO-IA-ALIMENTA-CRM.md, Camada 2).
// Chamado pelo montar-workflow.js: desvia no principal as mensagens dos números de ASSISTENTE_NUMEROS
// e devolve 3 workflows novos:
//   - "Assistente da Gleide"         agente que conversa com a Gleide, grava no banco do 004 e faz pelo WhatsApp o
//                                    que ela faz no app: agenda, fichas e avisos para a cliente (supabase/013)
//   - "Assistente - Ferramentas"     subworkflow das tools (SQL nas funções n8n_assistente_*; avisar_cliente
//                                    também envia a mensagem pela Evolution)
//   - "Assistente - Pendências"      de 1 em 1 h (8h–20h) pergunta à Gleide o que falta no CRM
//                                    (a mesma pendência por no máximo 2 h, ver supabase/011)
//                                    (GET /webhook/assistente-pendencias dispara na hora, para testar)
//
// Banco: o Supabase de verdade (o mesmo do app e do CRM), pela API com a chave de serviço, chamando as funções
// n8n_assistente_* de supabase/004 e 006. (Antes era o "salao_teste" local, credencial "Salão teste (004)".)

const EMPRESA = "$env.EMPRESA_ID || '00000000-0000-0000-0000-000000000001'";
const NUMEROS = "($env.ASSISTENTE_NUMEROS || '').split(',').map(s => s.trim()).filter(Boolean)";
const TEL = "($json.body.data.key.remoteJid.endsWith('@lid') && $json.body.data.key.remoteJidAlt ? $json.body.data.key.remoteJidAlt : $json.body.data.key.remoteJid).split('@')[0]";
// número cadastrado que bate com o telefone t (no WhatsApp, celular antigo de MT pode chegar sem o 9: 5566999990000 → 556699990000)
const NUMERO_DE = (t) => `(${NUMEROS}.find(n => n === ${t} || n.replace(/^(55\\d\\d)9(\\d{8})$/, '$1$2') === ${t}) || '')`;
const A = "$('Extrair dados').first().json";

const CAMPOS = ['acao', 'pedido_por', 'busca', 'data', 'cliente_id', 'agendamento_id', 'resultado', 'tecnica_indicada',
  'tipo_cabelo', 'comprimento_cm', 'gramas', 'valor', 'motivo_nao_fechou', 'proximo_passo', 'data_proximo_passo',
  'observacoes', 'status', 'telefone', 'nome', 'servico', 'inicio', 'texto',
  // agenda pelo WhatsApp (supabase/013)
  'extras', 'forcar', 'minutos', 'a_partir', 'ate', 'tipo', 'desfazer', 'aniversario'];

// O que cada ferramenta chama no Supabase: uma função n8n_assistente_* (supabase/004, 006, 011 e 013), pela API
// com a chave de serviço, como o agente de atendimento. Vazio vira null; o resto vem da IA (texto).
// enviar: depois de gravar, o subworkflow manda a mensagem que a função devolveu para a cliente (avisar_cliente).
const MONTAR_CHAMADA = String.raw`
const e = $input.first().json;
const empresa = ${EMPRESA};
const v = (k) => (e[k] === undefined || e[k] === null ? '' : String(e[k]).trim());
const ou = (s) => (s === '' ? null : s);
const num = (k) => { const n = v(k).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return n === '' || n === '-' ? null : Number(n); };
const tel = (t) => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d; };
// "2026-10-24T14:40" no fuso do salão (Cuiabá, -04:00 o ano todo)
const quando = (k) => (v(k) ? v(k) + (/[+-]\d\d:?\d\d$|Z$/.test(v(k)) ? '' : '-04:00') : null);
const sim = (k) => /^(s|sim|true|1|yes)/i.test(v(k));
const base = { p_empresa_id: empresa, p_pedido_por: v('pedido_por') };
let funcao, args, enviar = false;
switch (v('acao')) {
  case 'buscar_cliente':
    funcao = 'n8n_assistente_buscar_cliente'; args = { ...base, p_busca: v('busca') };
    break;
  case 'agenda_do_dia':
    funcao = 'n8n_assistente_agenda_do_dia'; args = { ...base, p_data: ou(v('data')) };
    break;
  case 'resultado_avaliacao': {
    const inteiro = (k) => { const n = num(k); return n === null ? '' : String(Math.trunc(n)); };
    const d = { resultado: v('resultado'), tecnica_indicada: v('tecnica_indicada'), tipo_cabelo: v('tipo_cabelo'),
      comprimento_cm: inteiro('comprimento_cm'), gramas: inteiro('gramas'), valor_orcado: num('valor') === null ? '' : String(num('valor')),
      motivo_nao_fechou: v('motivo_nao_fechou'), proximo_passo: v('proximo_passo'), data_proximo_passo: v('data_proximo_passo'),
      observacoes: v('observacoes') };
    funcao = 'n8n_assistente_resultado_avaliacao'; args = { ...base, p_cliente_id: ou(v('cliente_id')), p_dados: d };
    break;
  }
  case 'status_atendimento':
    funcao = 'n8n_assistente_status_agendamento';
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_status: v('status'), p_valor: num('valor') };
    break;
  case 'registrar_atendimento':
    funcao = 'n8n_assistente_registrar_atendimento_nome';
    args = { ...base, p_telefone: tel(v('telefone')), p_nome: v('nome'), p_servico: v('servico'),
      p_inicio: quando('inicio'), p_valor: num('valor'), p_observacoes: ou(v('observacoes')) };
    break;
  case 'anotar':
    funcao = 'n8n_assistente_anotar_cliente'; args = { ...base, p_cliente_id: ou(v('cliente_id')), p_texto: v('texto') };
    break;
  case 'liberar_horario':
    funcao = 'n8n_assistente_liberar_horario'; args = { ...base, p_agendamento_id: ou(v('agendamento_id')) };
    break;
  case 'horarios_livres':
    funcao = 'n8n_assistente_horarios_livres';
    args = { ...base, p_data: ou(v('data')), p_servico: ou(v('servico')), p_ignorar: ou(v('agendamento_id')) };
    break;
  case 'marcar_horario':
    funcao = 'n8n_assistente_marcar_horario';
    args = { ...base, p_cliente_id: ou(v('cliente_id')), p_telefone: ou(v('telefone')), p_nome: ou(v('nome')), p_servico: v('servico'),
      p_inicio: quando('inicio'), p_observacoes: ou(v('observacoes')), p_forcar: sim('forcar') };
    break;
  case 'reagendar':
    funcao = 'n8n_assistente_reagendar';
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_inicio: quando('inicio'), p_servico: ou(v('servico')), p_forcar: sim('forcar') };
    break;
  case 'atrasar_agenda':
    funcao = 'n8n_assistente_atrasar_agenda';
    args = { ...base, p_minutos: num('minutos') === null ? null : Math.round(num('minutos')), p_a_partir: ou(v('a_partir')), p_data: ou(v('data')) };
    break;
  case 'concluir':
    funcao = 'n8n_assistente_concluir';
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_servico: ou(v('servico')), p_extras: ou(v('extras')), p_valor: num('valor') };
    break;
  case 'chegou':
    funcao = 'n8n_assistente_chegou'; args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_chegou: !sim('desfazer') };
    break;
  case 'excluir_horario':
    funcao = 'n8n_assistente_excluir_horario'; args = { ...base, p_agendamento_id: ou(v('agendamento_id')) };
    break;
  case 'bloquear_dias':
    funcao = 'n8n_assistente_bloquear_dias'; args = { ...base, p_de: ou(v('data')), p_ate: ou(v('ate')), p_motivo: ou(v('texto')) };
    break;
  case 'desbloquear_dias':
    funcao = 'n8n_assistente_desbloquear_dias'; args = { ...base, p_dia: ou(v('data')) };
    break;
  case 'pausar_ia':
    funcao = 'n8n_assistente_pausar_ia'; args = { ...base, p_cliente_id: ou(v('cliente_id')), p_pausar: !sim('desfazer') };
    break;
  case 'editar_cliente':
    funcao = 'n8n_assistente_editar_cliente';
    args = { ...base, p_cliente_id: ou(v('cliente_id')), p_nome: ou(v('nome')), p_aniversario: ou(v('aniversario')) };
    break;
  case 'avisar_cliente':
    funcao = 'n8n_assistente_avisar_cliente'; enviar = true;
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_tipo: v('tipo') === 'remarcacao' ? 'remarcacao' : 'aviso', p_texto: ou(v('texto')) };
    break;
  default:
    return [{ json: { erro: 'ferramenta desconhecida: ' + v('acao') } }];
}
return [{ json: { funcao, args, enviar } }];
`;

const PROMPT = `Você é a assistente pessoal da Gleide, dona do salão Toda Bonita Mega Hair (Sinop - MT).
Seu trabalho é fazer pelo WhatsApp tudo o que ela faria no app (agenda e fichas das clientes) e manter o CRM em dia,
SEM ela precisar abrir o app nem digitar muito.
Ela é ocupada: mensagens curtíssimas, sem formalidade, no máximo 1 emoji. Pode usar *negrito* do WhatsApp.
Data e hora atual: {{ $now.setZone('America/Cuiaba').toFormat("cccc, dd/MM/yyyy HH:mm", { locale: 'pt-BR' }) }} (America/Cuiaba).

O QUE FALTA ELA TE CONTAR (pendências abertas agora, com os ids para as ferramentas):
{{ (() => { const t = $('Ler pendências').first().json.data; try { return JSON.parse(t) || '(nenhuma)'; } catch (e) { return t || '(nenhuma)'; } })() }}

O QUE VOCÊ FAZ
- Agenda, igual ao app: ver o dia (agenda_do_dia), ver horários livres (horarios_livres), marcar (marcar_horario),
  reagendar (reagendar), empurrar a agenda quando ela atrasa (atrasar_agenda), cancelar (status_atendimento cancelado),
  apagar horário lançado por engano (excluir_horario), "chegou" (chegou), concluir com o que foi feito (concluir),
  dias sem atender (bloquear_dias / desbloquear_dias).
- Fala com a cliente pelo número do salão quando a Gleide pedir: aviso de horário mudado ou o pedido para remarcar
  num imprevisto dela (avisar_cliente).
- Ficha da cliente: anotar, nome e aniversário (editar_cliente), pausar ou reativar a IA de atendimento para ela (pausar_ia).
- Registra como foram as avaliações e os atendimentos que ela contar, e o que ela falar por conta própria
  (cliente que veio sem marcar, anotação sobre a cliente).
- Responde dúvidas ("quem vem amanhã?", "tenho horário sexta à tarde pra selagem?", "quando a Maria veio?").
- Só no app (diga isso se ela pedir): excluir cliente, trocar telefone, horário de funcionamento, almoço, mensagens prontas.

AGENDA (siga sempre)
- Ache o horário certo: agenda_do_dia (vazio = hoje) e escolha pela hora/nome, ou buscar_cliente (traz horarios_marcados
  com agendamento_id). "A das 14:00" sem dia = hoje. Se tiver mais de uma cliente na mesma hora ou não achar, pergunte.
- Datas e horas para as ferramentas: inicio = AAAA-MM-DDTHH:mm, data = AAAA-MM-DD (calcule "sexta", "amanhã", "dia 30"
  a partir da data atual). Se ela não disser a hora (ou o dia), pergunte; não chute.
- Serviço: escreva como ela falou ("selagem", "manutenção queratina"). Se a ferramenta disser que o nome pode ser mais
  de um serviço, pergunte qual, mostrando as opções.
- REAGENDAR UM horário que ela identificou sem dúvida, para a hora que ela disse ("passa a das 14 pra 14:40, atrasei"):
  faça direto, sem pedir confirmação. Depois responda em 1 linha o que mudou e pergunte "Aviso ela?".
- Atraso que pega mais de uma cliente ("atrasei 30 min", "empurra todo mundo"): pergunte se é só a próxima ou todas a partir
  de tal hora; mostre a lista (nome: de → para) e, com o sim, use atrasar_agenda (a_partir = a hora da 1ª que vai mudar).
  Depois pergunte "Aviso elas?".
- Todo o resto que muda a agenda (marcar, cancelar, excluir, concluir, bloquear dias): resumo de 1 linha + "Pode?".
  Grave só depois do sim.
- Se a ferramenta responder NÃO MARQUEI / NÃO REAGENDEI com o motivo (encavala, almoço, fora do horário, dia sem atender,
  ela já tem horário), conte o motivo em 1 frase e ofereça as saídas: outro horário (use horarios_livres e sugira 2 ou 3),
  empurrar as próximas também (atrasar_agenda, quando for atraso) ou marcar assim mesmo. Só chame de novo com forcar = sim
  se ela disser que quer assim mesmo.
- Marcar para cliente nova: precisa de nome e telefone com DDD. Se a cliente já tem horário marcado, a ferramenta avisa:
  pergunte se é para mudar aquele (reagendar) ou marcar outro (forcar = sim).
- Cancelar: status_atendimento cancelado (fica no histórico; o horário pode ser oferecido para outra cliente adiantar).
  excluir_horario só para horário lançado por engano.
- Concluir (o ✓ do app): concluir com servico só se ela fez OUTRO serviço no lugar do marcado e extras com os serviços
  que fez A MAIS ("fez selagem também" → extras = selagem). Valor só se ela disser.
- "Chegou", "tá aqui" (antes de atender): chegou. Engano: chegou com desfazer = sim.
- Bloquear dias: se a ferramenta devolver horários marcados nesses dias, conte quantos e quem, e pergunte se você pede
  para elas remarcarem (avisar_cliente tipo remarcacao, uma por cliente).

MENSAGEM PARA A CLIENTE (avisar_cliente)
- Nunca mande sem o sim da Gleide. Uma chamada por cliente.
- Horário que você acabou de mudar: tipo aviso, sem texto (a mensagem sai pronta: "em vez de 14:00, vai ser hoje às 14:40").
- Imprevisto da Gleide ("não vou conseguir atender a Carla amanhã, pede pra remarcar"): tipo remarcacao, sem texto. Quando
  a cliente responder, a IA de atendimento oferece horários e remarca sozinha; o app mostra o andamento.
- Outro aviso (cancelamento, recado): tipo aviso com o texto que você escrever — curto, carinhoso, em nome do salão,
  sem inventar motivo — e mostre o texto para ela aprovar antes.
- Se a ferramenta disser que enviou, responda "Avisei ✅". Se der erro no envio, diga que não foi.

COMO GRAVAR AVALIAÇÕES E ATENDIMENTOS QUE ELA CONTA
1. Descubra a cliente. Se ela estiver nas pendências acima, use o cliente_id/agendamento_id de lá.
   Senão, use buscar_cliente. Se vier mais de uma com o mesmo nome, pergunte qual (mostre os 4 últimos dígitos do telefone).
2. ANTES de gravar, mostre um resumo curto do que vai anotar e pergunte se está certo. Exemplo:
   "Anotei pra *Juliana Souza (…2222)*:
   ✅ Fechou — queratina, vietnamita 70 cm, 150 g
   💰 R$ 2.800
   Tá certo?"
   Se ela respondeu VÁRIAS pendências de uma vez (comum em áudio), faça UM resumo só, uma linha por cliente, e peça um único
   "Tá certo?". O que ela não falou (valor, gramas, cm) entra como "valor: não informado" — NÃO segure o resumo esperando isso;
   no fim do resumo, numa frase só, diga que se ela souber os valores pode mandar junto.
3. Só depois do "sim" (ou "isso", "pode", 👍) chame as ferramentas — TODAS as necessárias para o resumo confirmado, uma por cliente/ação.
   Se ela corrigir, ajuste e confirme de novo.
4. Se a ferramenta devolver ERRO, diga em uma frase que não conseguiu gravar e o motivo. Nunca diga que gravou sem o OK da ferramenta.
5. Depois de gravar, responda só "Pronto, tá no CRM ✅" e, se ainda houver pendência, pergunte a próxima (uma por vez).

REGRAS
- Nunca invente valor, gramas, técnica, data ou resultado. Use só o que ela disse. Faltou algo importante (ex.: fechou mas não falou o valor)? Pergunte UMA vez; se ela não souber, grave sem.
- "fechou" = vai fazer o serviço; "pensando" = ficou de decidir (pergunte quando chamar de novo e grave em data_proximo_passo); "nao_fechou" = desistiu (pergunte o motivo uma vez).
- Avaliação que fechou e já marcou a aplicação: grave o resultado com proximo_passo "aplicação marcada DD/MM às HH:mm" e
  data_proximo_passo nessa data (calcule "terça que vem" a partir da data atual). Se a aplicação ainda não está na agenda,
  ofereça marcar (marcar_horario com o serviço de aplicação da técnica que fechou).
- Fez um serviço A MAIS do que estava na agenda (ex.: marcou hidratação e fez selagem também): concluir no horário agendado
  com extras (nunca um horário novo para o serviço a mais).
- Pediu para chamar a cliente daqui X dias: calcule a data e grave com anotar ("Chamar em DD/MM: motivo"). Diga que ficou anotado
  na ficha (o envio automático ainda não existe — não prometa que você vai mandar).
- Uma pergunta por mensagem. Se ela não responder algo, não insista.
- Cliente que NÃO veio: depois da confirmação, grave status faltou. A IA de atendimento chama a cliente sozinha (em até
  5 min, no horário do salão) para marcar outro horário, e você avisa a Gleide quando ela remarcar ou se não responder.
  Diga isso numa frase curta ("Anotei a falta. Vou chamar ela pra remarcar e te aviso 👍").
- Cliente ATRASADA (pendência atraso_confirmar, ou o aviso "⏰ … não chegou nem respondeu. Ela está aí?"): aqui a resposta
  dela já é a confirmação, não peça "tá certo?" (é na hora, ela está ocupada).
  "veio", "tá aqui", "chegou" → status_atendimento realizado e responda "Beleza ✅".
  "libera", "não veio", "pode liberar" → liberar_horario e diga em uma frase o que a ferramenta respondeu sobre a vaga.
  Se não ficou claro, pergunte só "Ela veio?". Nunca libere sem ela dizer: sem resposta, o horário continua da cliente.
- Se ela disser que uma cliente que você liberou apareceu depois, use status_atendimento realizado (o sistema avisa se outra
  já tinha adiantado para aquele horário).
- Fora o avisar_cliente (sempre ligado a um horário), você não fala com clientes. Se ela pedir "chama a Carla" para outra
  coisa (retorno, oferta), diga que por enquanto isso você só anota, e grave como próximo passo.
- Avisos que você mandou ("✅ Remarquei…", "⚠️ … não respondeu") ficam na conversa: se ela responder a eles, entenda pelo contexto.
- Mensagens que começam com [áudio] são a transcrição de um áudio dela.`;

module.exports = ({ env, node, str, main, toolSub, workflow }) => {
  const REDIS = { redis: { id: env.N8N_REDIS_CRED_ID || '', name: 'Redis local' } };
  const GEMINI = env.N8N_GEMINI_CRED_ID ? { googlePalmApi: { id: env.N8N_GEMINI_CRED_ID, name: 'Google Gemini(PaLM) Api account' } } : {};
  const EVO = '={{ $env.EVOLUTION_URL }}';
  const apikey = { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] };
  // Chama uma função do Supabase (POST /rest/v1/rpc/<funcao>). texto=true devolve a resposta crua em $json.data
  // (sem isso o n8n quebra uma lista em vários itens e uma lista vazia some)
  const supaHeaders = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const rpc = (name, position, funcao, args, { texto = false, ...extra } = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: `={{ $env.SUPABASE_URL }}/rest/v1/rpc/${funcao}`,
    sendHeaders: true, headerParameters: supaHeaders, sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${args}) }}`,
    options: texto ? { response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } } : {},
  }, extra);
  const ifNode = (name, position, conditions) => node(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions, combinator: 'and' },
    options: {},
  });
  const cond = (id, left) => ({ id, leftValue: left, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } });
  const evoPost = (name, position, rota, body, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: `${EVO}/${rota}/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikey, sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}`, options: {},
  }, extra);
  const settings = { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', saveManualExecutions: true };

  // ---------- 1. Principal: número da Gleide vai para a assistente (inclusive o eco do que a assistente mandou) ----------
  workflow.nodes.push(
    ifNode('É a Gleide (assistente)?', [440, -520], [cond('g1', `={{ ${NUMERO_DE('$json.telefone')} !== '' }}`)]),
    node('Repassar para a assistente', 'n8n-nodes-base.httpRequest', 4.2, [660, -600], {
      method: 'POST', url: 'http://localhost:5678/webhook/assistente-gleide',
      sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify($('Webhook Evolution').item.json.body) }}", options: {},
    }, { onError: 'continueRegularOutput' }),
  );
  const depois = workflow.connections['Extrair dados'].main[0][0].node;
  workflow.connections['Extrair dados'] = main('É a Gleide (assistente)?');
  workflow.connections['É a Gleide (assistente)?'] = { main: [
    [{ node: 'Repassar para a assistente', type: 'main', index: 0 }], [{ node: depois, type: 'main', index: 0 }],
  ] };

  // ---------- 2. Subworkflow das ferramentas ----------
  const ferramentasWorkflow = {
    name: 'Assistente - Ferramentas',
    nodes: [
      node('Recebe pedido da assistente', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: CAMPOS.map((name) => ({ name })) },
      }),
      node('Montar chamada', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: MONTAR_CHAMADA }),
      rpc('Executar no banco', [440, 0], '{{ $json.funcao }}', '$json.args', { texto: true, onError: 'continueRegularOutput' }),
      // avisar_cliente: o banco gravou o contato e devolveu telefone + mensagem; manda pelo número do salão.
      // O eco (fromMe) bate com o contato no principal ("É o alô do CRM?") e não pausa a IA da cliente.
      ifNode('Mandar para a cliente?', [660, 0], [cond('e1', "={{ !!$('Montar chamada').first().json.enviar && !$json.error && !!$json.data }}")]),
      evoPost('Mandar para a cliente', [880, -120], 'message/sendText',
        '{ number: JSON.parse($json.data).telefone, text: JSON.parse($json.data).mensagem }',
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
      node('Resposta', 'n8n-nodes-base.set', 3.4, [1100, 0], {
        assignments: { assignments: [str('resposta', `={{ (() => {
  const m = $('Montar chamada').first().json, b = $('Executar no banco').first().json;
  if (m.erro) return 'ERRO: ' + m.erro;
  if (b.error) return 'ERRO: ' + (b.error.message || b.message || JSON.stringify(b.error));
  if (!m.enviar) return 'OK: ' + (b.data || 'feito');
  const r = $('Mandar para a cliente').isExecuted ? $('Mandar para a cliente').first().json : null;
  if (!r || r.error) return 'ERRO: gravei, mas o WhatsApp não enviou a mensagem (' + (r?.error?.message || 'sem resposta') + ')';
  return 'OK: mensagem enviada para a cliente: ' + JSON.parse(b.data).mensagem;
})() }}`)] },
        options: {},
      }),
    ],
    connections: {
      'Recebe pedido da assistente': main('Montar chamada'),
      'Montar chamada': main('Executar no banco'),
      'Executar no banco': main('Mandar para a cliente?'),
      'Mandar para a cliente?': { main: [[{ node: 'Mandar para a cliente', type: 'main', index: 0 }], [{ node: 'Resposta', type: 'main', index: 0 }]] },
      'Mandar para a cliente': main('Resposta'),
    },
    settings: { ...settings, callerPolicy: 'workflowsFromSameOwner' },
  };

  // ---------- 3. Agente da assistente ----------
  const ferramentasIdFile = require('path').join(__dirname, '.workflow-assistente-ferramentas-id');
  const lerFerramentasId = () => (require('fs').existsSync(ferramentasIdFile) ? require('fs').readFileSync(ferramentasIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_FERRAMENTAS');
  const fixo = { pedido_por: `={{ ${A}.numero }}` };
  const tool = (name, position, description, acao, ia) => toolSub(name, position, description, lerFerramentasId, CAMPOS, { acao, ...fixo }, ia);
  const ID = (q) => [q, `${q} (uuid exato, das pendências ou de buscar_cliente / agenda_do_dia)`, 'string'];

  const assistenteWorkflow = {
    name: 'Assistente da Gleide',
    nodes: [
      node('Webhook assistente', 'n8n-nodes-base.webhook', 2, [0, 0],
        { httpMethod: 'POST', path: 'assistente-gleide', options: {} }, { webhookId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a80' }),
      node('Extrair dados', 'n8n-nodes-base.set', 3.4, [220, 0], {
        assignments: { assignments: [
          str('evento', '={{ $json.body.event }}'),
          str('jid', '={{ $json.body.data.key.remoteJid }}'),
          str('telefone', `={{ ${TEL} }}`),
          // o número como está em ASSISTENTE_NUMEROS / config.assistente_numeros (é o que o banco confere)
          str('numero', `={{ ${NUMERO_DE(TEL)} }}`),
          { id: 'a-fromMe', name: 'fromMe', value: '={{ $json.body.data.key.fromMe }}', type: 'boolean' },
          str('msgId', '={{ $json.body.data.key.id }}'),
          str('tipo', '={{ $json.body.data.messageType }}'),
          str('texto', "={{ $json.body.data.message?.conversation || $json.body.data.message?.extendedTextMessage?.text || '' }}"),
        ] },
        options: {},
      }),
      ifNode('Filtro', [440, 0], [
        cond('f1', "={{ $json.evento === 'messages.upsert' && !$json.fromMe }}"),
        cond('f2', "={{ $json.numero !== '' }}"),
        cond('f3', "={{ $json.tipo === 'audioMessage' || (['conversation', 'extendedTextMessage'].includes($json.tipo) && $json.texto.trim() !== '') }}"),
      ]),
      ifNode('É áudio?', [660, 0], [cond('au', "={{ $json.tipo === 'audioMessage' }}")]),
      evoPost('Baixar áudio (Evolution)', [880, -120], 'chat/getBase64FromMediaMessage',
        `{ message: { key: { id: ${A}.msgId } }, convertToMp4: false }`, { onError: 'continueRegularOutput' }),
      node('Transcrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [1100, -120], {
        method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ contents: [{ parts: [ { text: 'Transcreva este áudio de WhatsApp em português do Brasil, exatamente como foi falado. Responda só com a transcrição, sem comentários.' }, { inline_data: { mime_type: String($json.mimetype || 'audio/ogg').split(';')[0], data: $json.base64 } } ] }] }) }}",
        options: {},
      }, { credentials: GEMINI, onError: 'continueRegularOutput' }),
      node('Texto da mensagem', 'n8n-nodes-base.set', 3.4, [1320, 0], {
        assignments: { assignments: [str('texto',
          `={{ (() => { if (${A}.tipo !== 'audioMessage') return ${A}.texto; const r = ($json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join(' ').trim(); return r ? '[áudio] ' + r : '[áudio que não consegui ouvir]'; })() }}`)] },
        options: {},
      }),
      rpc('Ler pendências', [1540, 0], 'n8n_assistente_pendencias_texto', `{ p_empresa_id: ${EMPRESA} }`,
        { texto: true, alwaysOutputData: true, onError: 'continueRegularOutput' }),
      node('Agente assistente', '@n8n/n8n-nodes-langchain.agent', 3.1, [1760, 0], {
        promptType: 'define', text: "={{ $('Texto da mensagem').first().json.texto }}",
        options: { systemMessage: '=' + PROMPT },
      }),
      node('Gemini Flash', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, [1640, 220], {
        modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.2 },
      }, { credentials: GEMINI }),
      node('Memória (Redis)', '@n8n/n8n-nodes-langchain.memoryRedisChat', 1.5, [1800, 220], {
        sessionIdType: 'customKey', sessionKey: `=assistente:{{ ${A}.numero }}`, sessionTTL: 259200, contextWindowLength: 20,
      }, { credentials: REDIS }),
      tool('buscar_cliente', [1960, 220], 'Procura clientes pelo nome ou telefone. Devolve id, telefone, status, etapa do funil, pré-avaliação, valor orçado, observações e os horários marcados (com agendamento_id).',
        'buscar_cliente', [['busca', 'Nome (ou parte) ou telefone da cliente', 'string']]),
      tool('agenda_do_dia', [2120, 220], 'Lista os horários de um dia (com agendamento_id, hora, fim, cliente, serviço, status, se chegou e serviços a mais).',
        'agenda_do_dia', [['data', 'Dia AAAA-MM-DD (vazio = hoje)', 'string']]),
      tool('resultado_avaliacao', [2280, 220], 'Grava o resultado de uma avaliação. Só use DEPOIS que a Gleide confirmou o resumo.',
        'resultado_avaliacao', [ID('cliente_id'),
          ['resultado', 'fechou, pensando ou nao_fechou', 'string'],
          ['tecnica_indicada', 'Técnica que a Gleide indicou (ex.: queratina, fita adesiva)', 'string'],
          ['tipo_cabelo', 'Tipo de cabelo (ex.: brasileiro, vietnamita)', 'string'],
          ['comprimento_cm', 'Comprimento em cm, só o número', 'string'],
          ['gramas', 'Gramas, só o número', 'string'],
          ['valor', 'Valor orçado em reais, só o número (ex.: 2800)', 'string'],
          ['motivo_nao_fechou', 'Se não fechou: motivo', 'string'],
          ['proximo_passo', 'Próximo passo combinado (ex.: chamar sexta)', 'string'],
          ['data_proximo_passo', 'Data do próximo passo AAAA-MM-DD', 'string'],
          ['observacoes', 'Outras observações da Gleide', 'string']]),
      tool('status_atendimento', [2440, 220], 'Marca um horário como realizado (veio), faltou ou cancelado. Só use DEPOIS da confirmação.',
        'status_atendimento', [ID('agendamento_id'),
          ['status', 'realizado, faltou ou cancelado', 'string'],
          ['valor', 'Valor cobrado em reais, só o número (se ela disse)', 'string']]),
      tool('registrar_atendimento', [2600, 220], 'Registra um atendimento que já aconteceu e não estava na agenda (cliente veio sem marcar). Só use DEPOIS da confirmação.',
        'registrar_atendimento', [
          ['telefone', 'Telefone da cliente (de buscar_cliente, ou o que a Gleide disser)', 'string'],
          ['nome', 'Nome da cliente', 'string'],
          ['servico', 'Serviço feito (ex.: manutenção, aplicação, avaliação)', 'string'],
          ['inicio', 'Quando foi, AAAA-MM-DDTHH:mm (vazio = agora)', 'string'],
          ['valor', 'Valor cobrado em reais, só o número', 'string'],
          ['observacoes', 'Observações', 'string']]),
      tool('anotar', [2760, 220], 'Acrescenta uma anotação na ficha da cliente (alergia, preferência, combinado). Não apaga as anteriores. Só use DEPOIS da confirmação.',
        'anotar', [ID('cliente_id'), ['texto', 'A anotação, curta', 'string']]),
      tool('liberar_horario', [2920, 220], 'Cliente atrasada que NÃO veio: marca falta e oferece o resto do horário para quem tem horário mais tarde hoje. ' +
        'Só use quando a Gleide disser "libera" ou "não veio" para essa cliente. Nunca por conta própria.',
        'liberar_horario', [ID('agendamento_id')]),
      // ---- agenda pelo WhatsApp (supabase/013) ----
      tool('horarios_livres', [1960, 440], 'Horários livres de um dia para um serviço, de 30 em 30 min (mesmas regras do app: expediente, almoço, dias sem atender, sem encavalar).',
        'horarios_livres', [['data', 'Dia AAAA-MM-DD (vazio = hoje)', 'string'],
          ['servico', 'Serviço como a Gleide falou (define a duração)', 'string'],
          ['agendamento_id', 'Se for para reagendar: o agendamento_id que vai mudar (o horário dele não conta como ocupado). Senão vazio', 'string']]),
      tool('marcar_horario', [2120, 440], 'Marca um horário novo na agenda. Cliente da lista (cliente_id) ou nova (nome + telefone). Só use DEPOIS do sim da Gleide.',
        'marcar_horario', [
          ['cliente_id', 'cliente_id de buscar_cliente (vazio se for cliente nova)', 'string'],
          ['nome', 'Nome da cliente nova', 'string'],
          ['telefone', 'Telefone com DDD da cliente nova', 'string'],
          ['servico', 'Serviço como a Gleide falou', 'string'],
          ['inicio', 'Dia e hora AAAA-MM-DDTHH:mm', 'string'],
          ['observacoes', 'Observação do horário (se ela disse)', 'string'],
          ['forcar', '"sim" só se a Gleide mandou marcar mesmo com o problema que a ferramenta apontou; senão vazio', 'string']]),
      tool('reagendar', [2280, 440], 'Muda o horário (e o serviço, se ela pedir) do MESMO agendamento. Pode usar direto quando ela disse qual horário e para quando.',
        'reagendar', [ID('agendamento_id'),
          ['inicio', 'Novo dia e hora AAAA-MM-DDTHH:mm', 'string'],
          ['servico', 'Novo serviço, só se ela pediu para trocar; senão vazio', 'string'],
          ['forcar', '"sim" só se a Gleide mandou mudar mesmo com o problema que a ferramenta apontou; senão vazio', 'string']]),
      tool('atrasar_agenda', [2440, 440], 'Empurra (ou adianta, minutos negativos) todos os horários a atender do dia a partir de uma hora. Só use DEPOIS do sim da Gleide.',
        'atrasar_agenda', [['minutos', 'Quantos minutos (ex.: 30; negativo adianta)', 'string'],
          ['a_partir', 'Hora HH:mm do primeiro horário que muda', 'string'],
          ['data', 'Dia AAAA-MM-DD (vazio = hoje)', 'string']]),
      tool('concluir', [2600, 440], 'O ✓ do app: marca o horário como realizado, com o serviço feito e os serviços a mais. Só use DEPOIS do sim da Gleide.',
        'concluir', [ID('agendamento_id'),
          ['servico', 'Só se ela fez OUTRO serviço no lugar do marcado; senão vazio', 'string'],
          ['extras', 'Serviços feitos A MAIS, separados por vírgula (ex.: selagem, hidratação); senão vazio', 'string'],
          ['valor', 'Valor cobrado em reais, só o número (se ela disse)', 'string']]),
      tool('chegou', [2760, 440], 'A cliente chegou ao salão (botão "Chegou" do app): a IA não cobra atraso dela.',
        'chegou', [ID('agendamento_id'), ['desfazer', '"sim" para desfazer um "chegou" marcado por engano; senão vazio', 'string']]),
      tool('excluir_horario', [2920, 440], 'Apaga de vez um horário lançado por engano (cliente que desmarcou é status_atendimento cancelado). Só use DEPOIS do sim da Gleide.',
        'excluir_horario', [ID('agendamento_id')]),
      tool('bloquear_dias', [3080, 440], 'Marca dias sem atender (viagem, folga, curso): o app e a IA de atendimento param de oferecer horário. Devolve os horários já marcados nesses dias. Só use DEPOIS do sim da Gleide.',
        'bloquear_dias', [['data', 'Primeiro dia AAAA-MM-DD', 'string'], ['ate', 'Último dia AAAA-MM-DD (vazio = só um dia)', 'string'],
          ['texto', 'Motivo (ex.: viagem)', 'string']]),
      tool('desbloquear_dias', [3240, 440], 'Tira o bloqueio que cobre um dia (o salão volta a atender). Só use DEPOIS do sim da Gleide.',
        'desbloquear_dias', [['data', 'Um dia do bloqueio, AAAA-MM-DD', 'string']]),
      tool('pausar_ia', [3080, 220], 'Pausa por 12 h (ou reativa) a IA de atendimento para uma cliente, como no app.',
        'pausar_ia', [ID('cliente_id'), ['desfazer', '"sim" para reativar a IA; vazio para pausar', 'string']]),
      tool('editar_cliente', [3240, 220], 'Corrige o nome ou grava o aniversário da cliente. Só use DEPOIS do sim da Gleide.',
        'editar_cliente', [ID('cliente_id'), ['nome', 'Nome certo (vazio = não muda)', 'string'],
          ['aniversario', 'Aniversário AAAA-MM-DD (se não souber o ano, use 1900) (vazio = não muda)', 'string']]),
      tool('avisar_cliente', [3400, 220], 'Manda mensagem para a cliente pelo número do salão sobre um horário dela. Só use DEPOIS do sim da Gleide.',
        'avisar_cliente', [ID('agendamento_id'),
          ['tipo', '"aviso" (horário mudado, cancelamento, recado) ou "remarcacao" (imprevisto da Gleide: pede para a cliente remarcar)', 'string'],
          ['texto', 'Vazio para a mensagem pronta (horário mudado / remarcação). Outro aviso: o texto aprovado pela Gleide', 'string']]),
      evoPost('Responder a Gleide', [2000, 0], 'message/sendText',
        // **negrito** de markdown aparece com os asteriscos no WhatsApp: vira *negrito*
        `{ number: ${A}.jid, text: ($json.output || 'Desculpa, deu um erro aqui. Pode repetir?').replace(/\\*\\*(.+?)\\*\\*/g, '*$1*').trim() }`,
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
    ],
    connections: {
      'Webhook assistente': main('Extrair dados'),
      'Extrair dados': main('Filtro'),
      'Filtro': main('É áudio?'),
      'É áudio?': { main: [[{ node: 'Baixar áudio (Evolution)', type: 'main', index: 0 }], [{ node: 'Texto da mensagem', type: 'main', index: 0 }]] },
      'Baixar áudio (Evolution)': main('Transcrever (Gemini)'),
      'Transcrever (Gemini)': main('Texto da mensagem'),
      'Texto da mensagem': main('Ler pendências'),
      'Ler pendências': main('Agente assistente'),
      'Agente assistente': main('Responder a Gleide'),
      'Gemini Flash': { ai_languageModel: [[{ node: 'Agente assistente', type: 'ai_languageModel', index: 0 }]] },
      'Memória (Redis)': { ai_memory: [[{ node: 'Agente assistente', type: 'ai_memory', index: 0 }]] },
      ...Object.fromEntries(['buscar_cliente', 'agenda_do_dia', 'resultado_avaliacao', 'status_atendimento', 'registrar_atendimento', 'anotar', 'liberar_horario',
        'horarios_livres', 'marcar_horario', 'reagendar', 'atrasar_agenda', 'concluir', 'chegou', 'excluir_horario', 'bloquear_dias',
        'desbloquear_dias', 'pausar_ia', 'editar_cliente', 'avisar_cliente']
        .map((t) => [t, { ai_tool: [[{ node: 'Agente assistente', type: 'ai_tool', index: 0 }]] }])),
    },
    settings,
  };

  // ---------- 4. Pendências: a assistente puxa a conversa ----------
  const pendenciasWorkflow = {
    name: 'Assistente - Pendências',
    nodes: [
      node('A cada 1 h', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'hours', hoursInterval: 1, triggerAtMinute: 0 }] } }),
      ifNode('Horário do salão?', [220, 0], [cond('h1', "={{ $now.setZone('America/Cuiaba').hour >= 8 && $now.setZone('America/Cuiaba').hour < 20 }}")]),
      node('Disparar agora (teste)', 'n8n-nodes-base.webhook', 2, [0, 200],
        { httpMethod: 'GET', path: 'assistente-pendencias', responseMode: 'lastNode', options: {} }, { webhookId: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b91' }),
      // a mesma pendência: na hora, +1 h e +2 h, depois para (a função já filtra, supabase/011)
      rpc('Pendências novas', [440, 100], 'n8n_assistente_pendencias_novas', `{ p_empresa_id: ${EMPRESA} }`, { onError: 'continueRegularOutput' }),
      node('Montar mensagem', 'n8n-nodes-base.code', 2, [660, 100], { jsCode: String.raw`
const ps = $input.all().map((i) => i.json).filter((p) => p.tipo);
if (!ps.length) return [];
const nome = (p) => (p.nome || 'cliente').split(' ').slice(0, 2).join(' ');
// "hoje às 18:27", "ontem às 18:27" ou "20/10 às 18:27": sem o dia, um horário de ontem confunde
const diaDe = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Cuiaba' });
const hora = (p) => {
  if (!p.inicio) return '';
  const d = new Date(p.inicio);
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Cuiaba' });
  const hoje = diaDe(new Date()), ontem = diaDe(new Date(Date.now() - 86400000)), dia = diaDe(d);
  return (dia === hoje ? 'hoje' : dia === ontem ? 'ontem' : dia.slice(8) + '/' + dia.slice(5, 7)) + ' às ' + h;
};
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const linha = (p) => {
  if (p.tipo === 'avaliacao_sem_resultado') return '• Como foi a avaliação de *' + nome(p) + '* (' + hora(p) + ')? Fechou?';
  if (p.tipo === 'atraso_confirmar') return '• *' + nome(p) + '* (' + hora(p) + ') não chegou nem respondeu. Ela está aí? *veio* ou *libera*';
  if (p.tipo === 'atendimento_sem_status') return '• *' + nome(p) + '* (' + hora(p) + (p.servico ? ', ' + p.servico.toLowerCase() : '') + ') veio?';
  return '• *' + nome(p) + '* ficou de pensar' + (p.valor_orcado ? ' (' + brl(p.valor_orcado) + ')' : '') + '. Alguma novidade?';
};
const texto = 'Oi, Gleide! Pra deixar o CRM em dia:\n' + ps.map(linha).join('\n') + '\n\nPode responder em áudio, do seu jeito 🙂';
const ids = ps.map((p) => p.pendencia_id);
const numeros = ${NUMEROS};
return numeros.map((tel) => ({ json: { tel, texto, ids,
  // mesma estrutura que o nó de memória do n8n grava, para o agente saber o que perguntou
  memoria: JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } }) } }));
` }),
      evoPost('Mandar para a Gleide', [880, 100], 'message/sendText', '{ number: $json.tel, text: $json.texto }',
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),
      node('Guardar na memória do agente', 'n8n-nodes-base.redis', 1, [1100, 100], {
        operation: 'push', list: "=assistente:{{ $('Montar mensagem').item.json.tel }}",
        messageData: "={{ $('Montar mensagem').item.json.memoria }}", tail: false,
      }, { credentials: REDIS }),
      rpc('Marcar como perguntado', [1320, 100], 'n8n_assistente_marcar_perguntado',
        `{ p_empresa_id: ${EMPRESA}, p_pedido_a: $('Montar mensagem').item.json.tel, p_ids: $('Montar mensagem').item.json.ids }`),
    ],
    connections: {
      'A cada 1 h': main('Horário do salão?'),
      'Horário do salão?': main('Pendências novas'),
      'Disparar agora (teste)': main('Pendências novas'),
      'Pendências novas': main('Montar mensagem'),
      'Montar mensagem': main('Mandar para a Gleide'),
      'Mandar para a Gleide': main('Guardar na memória do agente'),
      'Guardar na memória do agente': main('Marcar como perguntado'),
    },
    settings,
  };

  return { assistenteWorkflow, ferramentasWorkflow, pendenciasWorkflow, ferramentasIdFile };
};
