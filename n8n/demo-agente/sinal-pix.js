// Sinal por Pix para reservar (só nas lojas com "sinal_pix": true no loja.json; a Gleide não passa por aqui).
// Liga/desliga e valores ficam no banco, em empresas.config.loja.sinal_pix ({ ativo, valor, chave,
// nome_recebedor, regra }): com ativo false a loja agenda como antes.
//
// 1. Foto da cliente: comprovante de Pix vira UMA linha
//    fixa ("COMPROVANTE PIX | valor: ... | id: ..."), que o n8n_registrar_entrada grava em mensagens.
// 2. Agenda (criar): antes de gravar, n8n_sinal_conferir (supabase/037) lê essa linha no banco (não o que a
//    IA diz que leu) e confere valor, quem recebeu, data, situação e se o comprovante já foi usado. Não bateu:
//    não grava e devolve NÃO AGENDADO com o motivo. Bateu: grava o agendamento com o sinal (o app mostra
//    "sinal pago, abater no acerto").
// 3. Prompt: bloco SINAL PARA RESERVAR montado na hora com o que está no banco (vazio se ativo for false).

const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;

// vai ANTES do texto da foto (a troca da loja continua trocando cabelo por unhas no resto)
const FOTO_COMPROVANTE = 'SE A IMAGEM FOR COMPROVANTE de Pix ou de transferência (tela ou print de banco), responda SÓ uma linha exatamente neste formato, copiando o que está escrito na imagem: ' +
  'COMPROVANTE PIX | valor: 0,00 | data: DD/MM/AAAA HH:MM | situacao: concluido, agendado, pendente ou nao aparece | recebedor: nome de quem recebeu | chave: chave Pix de quem recebeu | id: ID ou código da transação, sem espaços | pagador: nome de quem pagou | suspeito: sim ou nao. ' +
  'Campo que não aparece na imagem fica vazio. Marque suspeito: sim só se a imagem parecer montagem, recortada ou com números editados. SE NÃO FOR COMPROVANTE: ';

// o que a IA faz em cada motivo de recusa (n8n_sinal_conferir.motivo)
const MOTIVOS = {
  sem_comprovante: "'NÃO AGENDADO: ainda não chegou a foto do comprovante do Pix do sinal. Se ainda não passou, passe o valor do sinal e a chave Pix e peça o print do comprovante. Só chame criar_agendamento de novo depois que a foto chegar.'",
  ja_usado: "'NÃO AGENDADO: o comprovante que ela mandou já foi usado para outro horário. Peça com educação o comprovante do Pix deste horário.'",
  valor: "'NÃO AGENDADO: o comprovante é de R$ ' + f(s.valor_pago) + ', menor que o sinal de R$ ' + f(s.valor_sinal) + '. Explique com educação o valor do sinal. Se ela fizer outro Pix para completar, use transferir_para_humano para a Gleide conferir.'",
  recebedor: "'NÃO AGENDADO: o Pix do comprovante não foi para a conta do studio (recebedor no comprovante: ' + ((s.comprovante || {}).recebedor || 'não aparece') + '). Sem acusar, pergunte se ela usou a chave certa e passe a chave de novo.'",
  data: "'NÃO AGENDADO: o comprovante é de outra data (' + ((s.comprovante || {}).data || 'sem data') + '). Peça o comprovante do Pix feito para este horário.'",
  situacao: "'NÃO AGENDADO: o comprovante mostra o Pix como agendado ou pendente, ainda não caiu. Peça o comprovante quando o Pix for concluído.'",
  ilegivel: "'NÃO AGENDADO: não deu para ler o valor no comprovante. Peça um print mais nítido, com o comprovante inteiro.'",
  suspeito: "'NÃO AGENDADO: o comprovante parece recortado ou editado. Sem acusar, peça o print inteiro do comprovante. Se ela mandar de novo e continuar assim, use transferir_para_humano.'",
  erro: "'NÃO AGENDADO: não consegui conferir o comprovante agora. Peça desculpas e use transferir_para_humano.'",
};

// Gleide (13/11/2026): entra com semBloco (as regras da conversa ficam no prompt dela) e dona 'Gleide'; no banco,
// config.loja.sinal_pix.so_para_quem_faltou faz o sistema exigir o comprovante só de quem faltou (supabase/047).
module.exports = ({ node, workflow, agendaWorkflow, loja, semBloco, dona }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`sinal_pix: não achei "${nome}"`); return n; };
  const trocar = (texto, de, para, onde) => { if (!texto.includes(de)) throw new Error(`sinal_pix: o código de "${onde}" mudou`); return texto.replace(de, para); };

  // 1. foto: comprovante em linha fixa antes da descrição de sempre
  const midia = achar(workflow, 'Entender mídia (Gemini)');
  if (FOTO_COMPROVANTE.includes("'")) throw new Error('sinal_pix: aspas no texto da foto');
  midia.parameters.jsonBody = trocar(midia.parameters.jsonBody, "? 'Uma cliente de um salão de mega hair mandou esta foto", `? '${FOTO_COMPROVANTE}Uma cliente de um salão de mega hair mandou esta foto`, 'Entender mídia');
  midia.parameters.jsonBody = trocar(midia.parameters.jsonBody, 'Se for print de conversa, comprovante ou outra coisa, diga só o que é.', 'Se for print de conversa ou outra coisa, diga só o que é.', 'Entender mídia');

  // 1b. comprovante em PDF (13/11/2026): o banco manda o comprovante como arquivo e o "Filtro" jogava fora
  //     (só passava texto, áudio e foto). PDF agora segue o caminho da foto: o Gemini lê PDF do mesmo jeito
  //     e devolve a mesma linha "COMPROVANTE PIX | ...". Outro tipo de arquivo continua de fora.
  const DOC = "($json.body.data.message?.documentMessage || $json.body.data.message?.documentWithCaptionMessage?.message?.documentMessage)";
  const campos = achar(workflow, 'Extrair dados').parameters.assignments.assignments;
  const campo = (nome) => { const c = campos.find((x) => x.name === nome); if (!c) throw new Error(`sinal_pix: "Extrair dados" sem o campo ${nome}`); return c; };
  if (campo('tipo').value !== '={{ $json.body.data.messageType }}') throw new Error('sinal_pix: o campo tipo de "Extrair dados" mudou');
  campo('tipo').value = `={{ ${DOC} && /pdf/i.test(String(${DOC}.mimetype || ${DOC}.fileName || '')) ? 'imageMessage' : $json.body.data.messageType }}`;
  campo('texto').value = trocar(campo('texto').value, "|| '' }}", `|| ${DOC}?.caption || '' }}`, 'Extrair dados (texto)');
  // o PDF não é foto: não vai para o Storage como imagem (o app mostraria uma foto quebrada)
  for (const nome of ['Foto: é foto?', 'Foto (dona): é foto?']) {
    const c = achar(workflow, nome).parameters.conditions.conditions[0];
    c.leftValue = trocar(c.leftValue, "=== 'imageMessage' }}", "=== 'imageMessage' && !/document/i.test(String($('Webhook Evolution').first().json.body?.data?.messageType || '')) }}", nome);
  }

  // 2. agenda: conferir o comprovante antes de montar o agendamento
  const conferir = JSON.parse(JSON.stringify(achar(agendaWorkflow, 'Supabase: profissionais')));
  conferir.name = 'Supabase: conferir sinal';
  conferir.id = 'b1a7c0de-5a1a-4c1d-9f1e-' + String(loja.slug).padEnd(12, '0').slice(0, 12).replace(/[^0-9a-f]/g, '0');
  conferir.parameters = {
    ...conferir.parameters,
    method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_sinal_conferir',
    sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ p_empresa_id: $env.EMPRESA_ID, p_telefone: ${TEL_BR("$('Preparar').first().json.telefone")} }) }}`,
  };
  delete conferir.retryOnFail; delete conferir.maxTries; delete conferir.waitBetweenTries; delete conferir.executeOnce;
  agendaWorkflow.nodes.push(conferir);
  if (agendaWorkflow.connections['Supabase: profissionais']?.main?.[0]?.[0]?.node !== 'Montar agendamento') throw new Error('sinal_pix: a ligação da agenda mudou');
  agendaWorkflow.connections['Supabase: profissionais'] = { main: [[{ node: conferir.name, type: 'main', index: 0 }]] };
  agendaWorkflow.connections[conferir.name] = { main: [[{ node: 'Montar agendamento', type: 'main', index: 0 }]] };

  const montar = achar(agendaWorkflow, 'Montar agendamento');
  // resposta sem "exige" = o Supabase falhou: na loja com sinal, não grava sem conferir
  montar.parameters.jsCode = trocar(montar.parameters.jsCode,
    "if (!cliente.id) return [{ json: { pular: true, motivo: 'cliente não está no Supabase' } }];",
    "if (!cliente.id) return [{ json: { pular: true, motivo: 'cliente não está no Supabase' } }];\n" +
    "const sinal = $('Supabase: conferir sinal').first().json || {};\n" +
    "if (typeof sinal.exige !== 'boolean') return [{ json: { pular: true, motivoSinal: 'erro', sinal } }];\n" +
    "if (sinal.exige && !sinal.ok) return [{ json: { pular: true, motivoSinal: sinal.motivo || 'sem_comprovante', sinal } }];",
    'Montar agendamento');
  montar.parameters.jsCode = trocar(montar.parameters.jsCode,
    "status: 'agendado', origem: 'ia', observacoes: obs || null,",
    "status: 'agendado', origem: 'ia', observacoes: obs || null,\n" +
    "  ...(sinal.exige ? { sinal_valor: sinal.valor_pago, sinal_codigo: sinal.codigo, sinal_pago_em: new Date().toISOString(), sinal_comprovante: sinal.comprovante } : {}),",
    'Montar agendamento');

  const resp = achar(agendaWorkflow, 'Resposta (agendado)').parameters.assignments.assignments[0];
  const m = /^=\{\{ ([\s\S]*) \}\}$/.exec(resp.value);
  if (!m) throw new Error('sinal_pix: a resposta da agenda mudou');
  resp.value = '={{ (() => { ' +
    "const g = $('Supabase: gravar agendamento').item.json.id; const mo = $('Montar agendamento').first().json; const s = mo.sinal || {}; " +
    "const f = (v) => Number(v || 0).toFixed(2).replace('.', ','); " +
    `const base = (${m[1]}); ` +
    "if (g && mo.corpo && mo.corpo.sinal_codigo) return base + ' SINAL: o comprovante de R$ ' + f(mo.corpo.sinal_valor) + ' foi conferido e ficou registrado no agendamento. Diga que o sinal fica descontado do valor no dia.'; " +
    `const motivos = { ${Object.entries(MOTIVOS).map(([k, v]) => `${k}: () => ${dona ? v.replace(/a Caroline/g, 'a ' + dona).replace(/conta do studio/g, 'conta do salão') : v}`).join(', ')} }; ` +
    'if (!g && mo.motivoSinal) return (motivos[mo.motivoSinal] || motivos.erro)(); ' +
    'return base; })() }}';

  // 3. ferramenta e prompt
  const criar = achar(workflow, 'criar_agendamento');
  criar.parameters.description += ' Se a loja pede sinal por Pix, só grava depois que a cliente mandou a foto do comprovante (o sistema confere); senão volta NÃO AGENDADO com o motivo.';
  if (semBloco) return;
  const agente = achar(workflow, 'Agente IA').parameters.options;
  if (!agente.systemMessage.includes("$('Supabase: dados do salão')")) throw new Error('sinal_pix: rode lojas.dadosDoSalao antes');
  agente.systemMessage += "\n\n{{ (() => { const s = ((($('Supabase: dados do salão').first().json.config || {}).loja || {}).sinal_pix) || {}; if (!s.ativo) return ''; " +
    "const f = (v) => Number(v || 0).toFixed(2).replace('.', ','); const nome = Array.isArray(s.nome_recebedor) ? s.nome_recebedor[0] : (s.nome_recebedor || ''); " +
    "return ['SINAL PARA RESERVAR (vale mais que qualquer outra regra sobre sinal, inclusive a de perguntar para a dona)', " +
    "'- Todo horário NOVO precisa de um sinal de R$ ' + f(s.valor) + ' por Pix, que é descontado do valor do serviço no dia.', " +
    "'- Ordem: a cliente escolheu o horário e você já tem serviço e nome -> numa mensagem curta diga que para garantir o horário é um sinal de R$ ' + f(s.valor) + ' no Pix, descontado no dia, e peça o print do comprovante; mande a chave sozinha em outra mensagem (use ---) para ela copiar: ' + (s.chave || '(chave não cadastrada: use transferir_para_humano)') + (nome ? ' (em nome de ' + nome + ')' : '') + '.', " +
    "'- Na mensagem que pede o sinal diga SEMPRE os três valores: o preço do serviço que ela escolheu (da lista SERVIÇOS E PREÇOS), que o Pix agora é só o sinal de R$ ' + f(s.valor) + ' (não é o valor do serviço) e quanto fica para pagar no dia. Ex.: A manicure fica R$ 50. Pra garantir o horário é só um sinal de R$ 20 no Pix agora, e no dia você paga os R$ 30 que faltam. Nunca mande a chave Pix sem dizer o valor do sinal.', " +
    "'- Antes de pedir o sinal confirme QUAL serviço ela quer, pelo nome da lista. Fazer a mão / fazer a unha pode ser manicure, esmaltação em gel ou outro: se ela não disse, pergunte uma vez, citando as opções da lista com o preço.', " +
    "'- Quando chegar [foto da cliente] COMPROVANTE PIX, chame criar_agendamento na hora com o horário que ela escolheu, sem perguntar mais nada. Quem confere o comprovante é o sistema: não diga que está certo antes do AGENDADO.', " +
    "'- Antes do AGENDADO o horário NÃO está reservado: nunca diga reservei, guardei, separei ou marquei. Diga que o horário fica garantido quando o comprovante chegar.', " +
    "'- Já paguei sem a foto não vale: peça o print do comprovante. Nunca chame criar_agendamento antes de o comprovante chegar.', " +
    "'- Se voltar NÃO AGENDADO, siga o que a resposta disser, sem acusar a cliente. Se voltar AGENDADO, confirme serviço, dia e hora e diga que o sinal já fica descontado no dia.', " +
    "'- Remarcar não pede sinal novo: o sinal vai junto para o novo horário.'" +
    "].concat(s.regra ? ['- ' + String(s.regra).trim()] : []).join('\\n'); })() }}";
};
