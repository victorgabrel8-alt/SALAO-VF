// Reparo de serviço feito no próprio salão: a IA acolhe, avisa a dona e JÁ agenda o reparo, sem sinal
// (só nas lojas com "reparo_do_studio": true no loja.json; precisa de sinal_pix e oferta_sem_sinal).
// 18/11/2026, Caroline: a Vanessa fez esmaltação em gel na sexta, na terça mandou foto dela saindo. A IA só perguntou
// à Caroline e disse "já te aviso"; a cliente ficou a noite sem resposta. Ordem do Victor: se a unha foi feita aqui,
// é problema da empresa: a IA acolhe, avisa a Caroline da situação e agenda o reparo na hora.
// Ordem corrigida pelo Victor no mesmo dia: 1º saber se foi a dona ou outra profissional; 2º acolher de acordo;
// se foi a dona: entender o que aconteceu, tentar agendar e, ao mesmo tempo, avisar a dona.
// Como a agenda sabe que é reparo: o motivo do criar_agendamento começa com "REPARO" E a cliente tem um atendimento
// realizado no salão nos últimos 45 dias. Só assim o horário é gravado sem comprovante de Pix.

module.exports = ({ workflow, agendaWorkflow, dona }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`reparo_do_studio: não achei "${nome}"`); return n; };
  const trocar = (texto, de, para, onde) => { if (!String(texto).includes(de)) throw new Error(`reparo_do_studio: "${onde}" mudou`); return String(texto).replace(de, () => para); };
  const D = dona || 'a dona';

  // 1. agenda: a cliente foi atendida aqui há pouco?
  const ler = JSON.parse(JSON.stringify(achar(agendaWorkflow, 'Supabase: oferta da dona')));
  ler.name = 'Supabase: serviço recente';
  ler.id = 'b1a7c0de-5a1a-4c1d-9f1e-0fe27a0d0a01';
  ler.position = [ler.position[0] + 110, ler.position[1] + 160];
  ler.parameters = {
    ...ler.parameters,
    url: "={{ $env.SUPABASE_URL }}/rest/v1/agendamentos?select=id,inicio&status=eq.realizado&order=inicio.desc&limit=1&empresa_id=eq.{{ $env.EMPRESA_ID }}" +
      "&cliente_id=eq.{{ $('Supabase: cliente e serviços').first().json.id || '00000000-0000-0000-0000-000000000000' }}" +
      "&inicio=gte.{{ $now.minus({ days: 45 }).toUTC().toISO() }}",
  };
  agendaWorkflow.nodes.push(ler);
  if (agendaWorkflow.connections['Supabase: oferta da dona']?.main?.[0]?.[0]?.node !== 'Montar agendamento') throw new Error('reparo_do_studio: a ligação da agenda mudou');
  agendaWorkflow.connections['Supabase: oferta da dona'] = { main: [[{ node: ler.name, type: 'main', index: 0 }]] };
  agendaWorkflow.connections[ler.name] = { main: [[{ node: 'Montar agendamento', type: 'main', index: 0 }]] };

  // 2. agenda: reparo de quem foi atendida aqui passa sem comprovante
  const montar = achar(agendaWorkflow, 'Montar agendamento');
  let js = montar.parameters.jsCode;
  js = trocar(js, 'let ofertaDaDona = false;', 'let ofertaDaDona = false, reparoDoStudio = false; // reparo-do-studio.js', 'Montar agendamento (variável)');
  js = trocar(js, '  if (!ofertaDaDona) return [{ json: { pular: true, motivoSinal:',
    "  reparoDoStudio = /^\\s*reparo/i.test(String(pedido.motivo || '')) && $('Supabase: serviço recente').all().some((i) => i.json && i.json.id);\n" +
    '  if (!ofertaDaDona && !reparoDoStudio) return [{ json: { pular: true, motivoSinal:', 'Montar agendamento (sinal)');
  js = trocar(js, "ofertaDaDona ? 'Sem sinal: horário oferecido pelo salão' : null",
    "ofertaDaDona ? 'Sem sinal: horário oferecido pelo salão' : null, reparoDoStudio ? 'Sem sinal: reparo de serviço feito no salão' : null", 'Montar agendamento (obs)');
  montar.parameters.jsCode = js;

  // 3. IA de atendimento: o que fazer quando o serviço feito aqui deu problema
  const agente = achar(workflow, 'Agente IA').parameters.options;
  agente.systemMessage += '\n\n' + [
    'SERVIÇO QUE SAIU, DESCOLOU OU QUEBROU (pedido do Victor, 18/11/2026; vale mais que a seção 17 e que a regra de transferir em reclamação)',
    'Quando a cliente contar que um serviço saiu, descolou, lascou, quebrou, levantou ou não durou (com ou sem foto), siga esta ORDEM, um passo por vez:',
    `PASSO 1 - SABER QUEM FEZ, ANTES DE QUALQUER OUTRA COISA. Você precisa saber se foi a ${D} ou outra profissional. Só não pergunte se a ficha ("Já fez") mostra esse mesmo serviço feito aqui nas últimas semanas ou se ela já disse quem fez. Em qualquer outro caso, a primeira resposta é uma frase curta de acolhimento neutro e a pergunta: "Poxa, que chato isso. Foi a ${D} que fez?". Não ofereça horário, não fale de valor e não avise a ${D} antes de saber.`,
    'PASSO 2 - ACOLHER DE ACORDO COM A RESPOSTA.',
    `- FOI OUTRA PROFISSIONAL: acolha sem falar mal de ninguém e sem assumir que o problema é do studio. Não é reparo: siga a regra de material de outra profissional (a ${D} remove e faz o dela), com os preços da lista e o sinal normal. Não avise a ${D} por isso.`,
    `- FOI A ${D.toUpperCase()}: é problema do studio. Acolha com as palavras dela, sem discutir, sem culpar a cliente e sem explicar causa, e siga os passos 3 a 5.`,
    'PASSO 3 - ENTENDER O QUE ACONTECEU (só quando foi feito aqui). Se ela ainda não contou, faça UMA pergunta simples para entender: o que aconteceu, quando começou e se foi em uma unha ou em várias. Se ela já contou ou a foto já mostra, não pergunte de novo.',
    `PASSO 4 - AVISAR ${D.toUpperCase()} E TENTAR AGENDAR, AO MESMO TEMPO. Assim que souber que foi feito aqui e o que aconteceu, na mesma vez: (a) avise com perguntar_para_gleide, num texto que se entende sozinho: "AVISO, não precisa responder: [nome] fez [serviço] em [data] e [o que aconteceu, com as palavras dela]. Estou vendo um horário para arrumar."; (b) use consultar_horarios_livres com o serviço da lista que conserta o caso (uma ou poucas unhas: "Reposição ou reconstrução (cada unha)"; o serviço inteiro saindo: o mesmo serviço que ela fez) e ofereça os 2 horários mais próximos. Não espere a resposta da ${D} para oferecer horário e não diga à cliente "vou ver com ela e te aviso": você já está resolvendo.`,
    'PASSO 5 - ELA ESCOLHEU O HORÁRIO: criar_agendamento na hora, com o motivo começando por "REPARO: " e o que aconteceu (ex.: "REPARO: esmaltação em gel de 13/11 começou a sair"). Reparo de serviço feito aqui NÃO pede sinal nem Pix. Depois do AGENDADO, confirme dia e hora.',
    `VALOR DO REPARO: não diga preço, não diga que é de graça e não ofereça desconto ou reembolso. Se ela perguntar se paga, diga que a ${D} vê isso com ela no dia. Não faça oferta de outro serviço.`,
    `DOR, MACHUCADO, INFLAMAÇÃO, ALERGIA, ou a cliente brava pedindo para falar com a ${D}: aí é transferir_para_humano, como sempre. Reclamação de cobrança ou de atendimento também.`,
    'Se a agenda não tiver horário nos próximos dias ou a ferramenta falhar, diga isso e use transferir_para_humano. Nunca termine a conversa só com "vou ver e te aviso".',
  ].join('\n');
};
