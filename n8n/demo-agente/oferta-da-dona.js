// Horário que a dona mandou oferecer não pede sinal nem nova confirmação (só nas lojas com "oferta_sem_sinal": true
// no loja.json e sinal por Pix ligado; a Gleide não passa por aqui).
// 13/11/2026, Caroline: ela mandou a assistente chamar uma cliente e oferecer terça às 8h (reagendamento). A cliente
// respondeu "sim", a IA de atendimento tentou marcar, a agenda recusou por falta do sinal e a IA voltou a perguntar
// à Caroline "posso marcar sem sinal?". Ordem do Victor: a assistente só diz se vai cobrar o sinal ou não; se não,
// a IA marca e pronto.
// Como a agenda sabe: a mensagem que a assistente manda fica em "contatos" (tipo aviso). Se nas últimas 72 h o salão
// mandou a esta cliente uma mensagem com a HORA deste agendamento e nenhuma das mensagens fala em sinal ou Pix,
// o horário é gravado sem comprovante. Se a dona quis cobrar, a mensagem fala do sinal e a regra de sempre vale.

module.exports = ({ workflow, agendaWorkflow }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`oferta_sem_sinal: não achei "${nome}"`); return n; };
  const trocar = (texto, de, para, onde) => { if (!String(texto).includes(de)) throw new Error(`oferta_sem_sinal: "${onde}" mudou`); return String(texto).replace(de, () => para); };

  // 1. agenda: ler o que o salão mandou a ela
  const ler = JSON.parse(JSON.stringify(achar(agendaWorkflow, 'Supabase: conferir sinal')));
  ler.name = 'Supabase: oferta da dona';
  ler.id = 'b1a7c0de-5a1a-4c1d-9f1e-0fe27a0d0a00';
  ler.position = [ler.position[0] + 110, ler.position[1] + 160];
  ler.parameters = {
    ...ler.parameters, method: 'GET',
    url: "={{ $env.SUPABASE_URL }}/rest/v1/contatos?select=mensagem,criado_em&tipo=eq.aviso&order=criado_em.desc&limit=8&empresa_id=eq.{{ $env.EMPRESA_ID }}" +
      "&cliente_id=eq.{{ $('Supabase: cliente e serviços').first().json.id || '00000000-0000-0000-0000-000000000000' }}" +
      "&criado_em=gte.{{ $now.minus({ hours: 72 }).toUTC().toISO() }}",
    sendBody: false,
  };
  delete ler.parameters.specifyBody; delete ler.parameters.jsonBody;
  ler.alwaysOutputData = true; ler.onError = 'continueRegularOutput';
  agendaWorkflow.nodes.push(ler);
  if (agendaWorkflow.connections['Supabase: conferir sinal']?.main?.[0]?.[0]?.node !== 'Montar agendamento') throw new Error('oferta_sem_sinal: a ligação da agenda mudou');
  agendaWorkflow.connections['Supabase: conferir sinal'] = { main: [[{ node: ler.name, type: 'main', index: 0 }]] };
  agendaWorkflow.connections[ler.name] = { main: [[{ node: 'Montar agendamento', type: 'main', index: 0 }]] };

  // 2. agenda: horário oferecido pela dona passa sem comprovante
  const montar = achar(agendaWorkflow, 'Montar agendamento');
  let js = montar.parameters.jsCode;
  js = trocar(js, "if (sinal.exige && !sinal.ok) return [{ json: { pular: true, motivoSinal: sinal.motivo || 'sem_comprovante', sinal } }];", String.raw`// oferta-da-dona.js
let ofertaDaDona = false;
if (sinal.exige && !sinal.ok) {
  const avisos = $('Supabase: oferta da dona').all().map((i) => String((i.json || {}).mensagem || '').toLowerCase()).filter(Boolean);
  const ini = DateTime.fromISO(horario.start.dateTime).setZone('America/Cuiaba');
  const H = ini.hour, MM = String(ini.minute).padStart(2, '0');
  const hora = ini.minute === 0
    ? new RegExp('(^|[^0-9:])0?' + H + '(:00|h00|h(?![0-9a-z])|hs|hrs| ?horas?)')
    : new RegExp('(^|[^0-9:])0?' + H + '(:|h) ?' + MM);
  ofertaDaDona = avisos.some((t) => hora.test(t)) && !avisos.some((t) => /sinal|pix/.test(t));
  if (!ofertaDaDona) return [{ json: { pular: true, motivoSinal: sinal.motivo || 'sem_comprovante', sinal } }];
}`, 'Montar agendamento (sinal)');
  js = trocar(js, "pedido.motivo || null].filter(Boolean)", "pedido.motivo || null, ofertaDaDona ? 'Sem sinal: horário oferecido pelo salão' : null].filter(Boolean)", 'Montar agendamento (obs)');
  js = trocar(js, '...(sinal.exige ? { sinal_valor:', '...(sinal.exige && sinal.ok ? { sinal_valor:', 'Montar agendamento (gravar sinal)');
  montar.parameters.jsCode = js;

  // 3. IA de atendimento: aceitou o horário oferecido, marca direto
  const agente = achar(workflow, 'Agente IA').parameters.options;
  agente.systemMessage = trocar(agente.systemMessage, "'- Remarcar não pede sinal novo: o sinal vai junto para o novo horário.'",
    "'- Remarcar não pede sinal novo: o sinal vai junto para o novo horário.', " +
    "'- HORÁRIO QUE O SALÃO OFERECEU OU RESERVOU: se em O QUE O SALÃO JÁ MANDOU A ELA há uma mensagem do salão oferecendo ou reservando um dia e hora e a cliente aceitou (pode, ok, obrigada, combinado), olhe PRIMEIRO se esse horário já está marcado (Horário marcado, na ficha, ou ver_agendamentos). JÁ ESTÁ MARCADO: não há nada a marcar. Responda só confirmando o dia e a hora em uma frase. Não chame criar_agendamento, cancelar_agendamento nem remarcar_agendamento, não use transferir_para_humano e não diga que vai confirmar com a dona: foi ela quem reservou. Se a cliente quiser acrescentar ou trocar o serviço nesse horário, diga que anotou e use perguntar_para_gleide; o horário fica como está. AINDA NÃO ESTÁ MARCADO e a mensagem NÃO fala em sinal: chame criar_agendamento com esse dia e hora na mesma resposta (serviço: o que a mensagem ou as observações dizem; se não der para saber, pergunte o serviço uma vez e marque em seguida). Não peça sinal, não chame consultar_horarios_livres para decidir e NÃO use perguntar_para_gleide para pedir permissão: a dona já decidiu ao oferecer. Só se criar_agendamento voltar NÃO AGENDADO siga o que a resposta disser. Se a mensagem do salão fala em sinal, cobre o sinal como em qualquer horário novo.'",
    'bloco do sinal no prompt');
  const sobre = achar(workflow, 'Sobre esta cliente');
  sobre.parameters.jsCode = trocar(sobre.parameters.jsCode,
    'Se você não achar esse horário em ver_agendamentos, não negue: diga que vai confirmar e use perguntar_para_gleide.',
    'Se o salão OFERECEU ou RESERVOU um horário e ela aceitou: se ele já aparece em Horário marcado, só confirme o dia e a hora (não cancele, não marque de novo, não transfira); se ainda não está marcado, marque na hora com criar_agendamento (regra HORÁRIO QUE O SALÃO OFERECEU OU RESERVOU), sem pedir permissão à dona. Se o salão CONFIRMOU um horário que você não acha em ver_agendamentos, não negue: diga que vai confirmar e use perguntar_para_gleide.',
    'Sobre esta cliente (contexto-saidas)');
};
