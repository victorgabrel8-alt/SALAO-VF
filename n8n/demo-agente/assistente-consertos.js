// Consertos da assistente da dona, Lote 1 do plano de 20/11/2026 (docs/PLANO-CORRECOES-E-AGENDA-COLADA.md).
// loja.json: "assistente_consertos": true (depende de "envio_cuidadoso", que pôs o "Envio: conferir").
//
// 1. Sinal que sumia (PDF erro 4): depois que a assistente marca um horário, um ramo à parte chama
//    n8n_assistente_vincular_sinal (supabase/054). Se a cliente mandou comprovante válido e ainda não usado, o sinal
//    entra no horário; se não, nada muda. Erro aqui não segura a resposta para a dona.
// 2. Mês trocado (PDF erro 6: "17/11 virou 17/12"): marcar ou remarcar para o MÊS QUE VEM num dia que ainda vai
//    acontecer NESTE mês não grava de primeira; volta para a assistente perguntar o mês à dona. Se a dona confirmar o
//    mês que vem, a mesma data passa na próxima mensagem dela (até 30 min): o "Contexto" lê a recusa na lista do que
//    a assistente já fez e manda a data junto do pode_forcar ("mes:17/12"). NÃO usa o forcar, porque o forcar também
//    passa por cima de horário ocupado no banco.
// 3. Mensagem repetida (20/11, Vanessa: duas desculpas em 1 minuto): mandar para a mesma cliente um texto parecido
//    com o que o salão mandou nos últimos 10 minutos não sai; a assistente manda só o que for novo.
// 4. Tom (PDF erro 12): mensagem para a cliente com "fase de teste", "sistema", "assistente", "confirmadíssimo" ou emoji
//    de enfeite (✨ 💅 😊 ❤️ ✅) não sai. 25/11: nem a que fala como se fosse a Caroline ("minha prova", "não vou
//    conseguir") ou conta um assunto dela; volta para a assistente reescrever formal, como o studio.

const VINCULAR = 'Sinal: vincular ao horário';

module.exports = ({ node, ifNode, cond, ferramentasWorkflow: F, assistenteWorkflow: A, empresaId }) => {
  const achar = (nome, wf = F) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('assistente-consertos: sem o nó ' + nome); return n; };
  const trocar = (no, de, para, wf = F) => {
    const n = achar(no, wf);
    if (!n.parameters.jsCode.includes(de)) throw new Error(`assistente-consertos: o código de "${no}" mudou (${de.slice(0, 50)})`);
    n.parameters.jsCode = n.parameters.jsCode.replace(de, () => para);
  };

  // ---------- 1. sinal: ramo à parte depois de "Executar no banco" ----------
  // O sub-workflow devolve o ÚLTIMO nó que rodou. No executionOrder v1 o n8n roda primeiro o ramo mais acima e à
  // esquerda: o ramo do sinal fica acima e à esquerda de "Mandar para a cliente?" para rodar antes dele, e "Resposta"
  // continua sendo o último. Não mover estes nós para baixo ou para a direita de "Mandar para a cliente?".
  achar('Executar no banco');
  const [mx, my] = achar('Mandar para a cliente?').position;
  F.nodes.push(
    ifNode('Sinal: foi marcação?', [mx - 150, my - 300], [cond('s1',
      "={{ String($('Montar chamada').first().json.funcao || '').startsWith('n8n_assistente_marcar_horario') &&(() => { try { return !!JSON.parse($json.data || '{}').agendamento_id; } catch (e) { return false; } })() }}",
      { type: 'boolean', operation: 'true', singleValue: true })]),
    node(VINCULAR, 'n8n-nodes-base.httpRequest', 4.2, [mx - 150, my - 500], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_assistente_vincular_sinal',
      sendHeaders: true,
      headerParameters: { parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
        { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
      ] },
      sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ p_empresa_id: '${empresaId}', p_agendamento_id: JSON.parse($('Executar no banco').first().json.data).agendamento_id }) }}`,
      options: { timeout: 10000 },
    }, { onError: 'continueRegularOutput' }),
  );
  const saida = F.connections['Executar no banco']?.main?.[0];
  if (!saida || !saida.length) throw new Error('assistente-consertos: "Executar no banco" sem saída');
  saida.push({ node: 'Sinal: foi marcação?', type: 'main', index: 0 });
  F.connections['Sinal: foi marcação?'] = { main: [[{ node: VINCULAR, type: 'main', index: 0 }], []] };

  // ---------- 2. mês: dia que ainda vai acontecer neste mês, gravado no mês que vem ----------
  trocar('Montar chamada', '// Antes de gravar ou enviar: o id é mesmo da cliente', [
    "// assistente-consertos.js (20/11): \"17/11 virou 17/12\". Dia que ainda vai acontecer neste mês, gravado no mês que vem,",
    "// volta para a assistente perguntar o mês. Data que a dona já viu nessa pergunta (\"mes:17/12\" no pode_forcar, posto pelo",
    "// Contexto) passa. O forcar não serve para isso: ele também passaria por cima de horário ocupado.",
    "const mesVisto = ((v('pode_forcar').match(/mes:([0-9\\/,]+)/) || [])[1] || '').split(',').filter(Boolean);",
    "if (['marcar_horario', 'reagendar'].includes(v('acao')) && v('inicio')) {",
    "  const ini = DateTime.fromISO(v('inicio').slice(0, 16), { zone: 'America/Cuiaba' });",
    "  const hoje = DateTime.now().setZone('America/Cuiaba').startOf('day');",
    "  const mesmoDiaEsteMes = ini.isValid ? hoje.set({ day: Math.min(ini.day, hoje.daysInMonth) }) : null;",
    "  if (ini.isValid && !mesVisto.includes(ini.toFormat('dd/LL')) && ini.startOf('month') > hoje.startOf('month') && mesmoDiaEsteMes.day === ini.day && mesmoDiaEsteMes >= hoje) {",
    "    return [{ json: { erro: 'NÃO GRAVEI: você ia marcar em ' + ini.toFormat('dd/LL') + ', mas o dia ' + ini.day + ' DESTE mês (' + mesmoDiaEsteMes.toFormat('dd/LL') + ') ainda vai acontecer. ' +",
    "      'Em 13/11 uma cliente pediu 17/11 e foi marcada em 17/12. Pergunte à Caroline em uma linha: \"É dia ' + mesmoDiaEsteMes.toFormat('dd/LL') + ' ou ' + ini.toFormat('dd/LL') + '?\" e grave o que ela disser. ' +",
    "      'Se ela confirmar ' + ini.toFormat('dd/LL') + ', chame de novo do mesmo jeito (sem forcar): o sistema já sabe que ela confirmou.' } }];",
    '  }',
    '}',
    '// Antes de gravar ou enviar: o id é mesmo da cliente',
  ].join('\n'));
  // o Contexto da assistente acha as datas recusadas por mês nos últimos 30 min e manda junto do pode_forcar
  if (!A) throw new Error('assistente-consertos: falta o workflow da assistente');
  trocar('Contexto', "return [{ json: { lista, texto, podeForcar,", [
    "// assistente-consertos.js: datas que voltaram \"NÃO GRAVEI: você ia marcar em DD/MM\" há menos de 30 min: a dona já viu a pergunta do mês",
    "const mesVisto = [...new Set(lista.filter((f) => agora - f.em < 30 * 60e3).map((f) => (String(f.r || '').match(/NÃO GRAVEI: você ia marcar em (\\d\\d\\/\\d\\d)/) || [])[1]).filter(Boolean))];",
    "const podeForcarMes = (podeForcar + (mesVisto.length ? ' mes:' + mesVisto.join(',') : '')).trim();",
    "return [{ json: { lista, texto, podeForcar: podeForcarMes,",
  ].join('\n'), A);

  // ---------- 3. mensagem parecida para a mesma cliente em menos de 10 minutos ----------
  trocar('Envio: conferir', 'return [{ json: { bloqueio, recado, telefone: tel,', [
    '// 5. assistente-consertos.js (20/11, Vanessa): texto parecido com o que o salão mandou a ela nos últimos 10 min.',
    '// "Parecido" = texto igual, ou o MESMO horário/dia citado, nenhum horário/dia novo e pelo menos 2 palavras do assunto em comum',
    '// (sem contar nome, dia e palavras de horário). As duas desculpas da Vanessa falavam de "14:30 amanhã"; uma oferta nova de "10h"',
    '// passa, e a da Cintia (25/11: quinta 17h de novo, mas com sexta 13h e 13h30 que ela ainda não tinha recebido) também passa.',
    "const COMUNS_ENV = new Set('oi ola tudo bem bom dia boa tarde noite para voce voces pode como mais pelo pela com que nao sim esta ta fica ficar caroline horario horarios amanha hoje segunda terca quarta quinta sexta sabado domingo pediu pedir manha tarde'.split(' '));",
    '// nome próprio (palavra com maiúscula fora do começo da frase, como o nome da cliente) também não conta como assunto',
    "const nomes = (s) => new Set([...String(s || '').matchAll(/(?<![.!?]\\s)(?<!^)\\b([A-ZÀ-Ú][a-zà-ú]+)/g)].map((m) => norm(m[1])));",
    "const palavras = (s) => { const nm = nomes(s); return new Set(norm(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\\s+/).filter((w) => w.length > 3 && !COMUNS_ENV.has(w) && !nm.has(w))); };",
    "const marcas = (s) => new Set([...norm(s).matchAll(/\\b(\\d{1,2})(?:h|:)(\\d{2})?\\b|\\b(\\d{1,2})\\/(\\d{1,2})\\b/g)].map((m) => m[1] !== undefined ? m[1] + ':' + (m[2] || '00') : m[3] + '/' + m[4]));",
    "const igualTxt = (s) => norm(s).replace(/[^a-z0-9]+/g, ' ').trim();",
    'if (!bloqueio && leuMsgs) {',
    '  const novas = palavras(txt), horasNovas = marcas(txt);',
    "  const recente = msgs.find((x) => x.direcao === 'saida' && agora.diff(DateTime.fromISO(x.criado_em), 'minutes').minutes <= 10 && (() => {",
    '    if (igualTxt(x.conteudo) === igualTxt(txt)) return true;',
    '    const velhas = palavras(x.conteudo), horasVelhas = marcas(x.conteudo);',
    '    let comuns = 0; for (const w of novas) if (velhas.has(w)) comuns++;',
    '    const mesmaHora = [...horasNovas].some((h) => horasVelhas.has(h));',
    '    const horaNova = [...horasNovas].some((h) => !horasVelhas.has(h));',
    '    return mesmaHora && !horaNova && comuns >= 2;',
    '  })());',
    '  if (recente) {',
    "    bloqueio = 'NÃO ENVIADO (nada chegou à cliente): ela recebeu uma mensagem quase igual às ' + hm(recente.criado_em) + '. Foi esta: «' + String(recente.conteudo).replace(/\\s+/g, ' ').slice(0, 160) + '». ' +",
    "      'Duas mensagens quase iguais em poucos minutos confundem a cliente. Se a Caroline quer acrescentar algo, mande SÓ o que é novo, curto; se não há nada novo, não mande e conte isso à Caroline em uma linha.';",
    '  }',
    '}',
    '// 6. assistente-consertos.js (PDF erro 12): fala de teste/sistema/IA ou emoji de enfeite não chega à cliente.',
    '// 25/11 (Cintia: "não vou conseguir por causa da minha prova"): também não sai texto que fala como se fosse a Caroline',
    '// ou conta um assunto dela. A mensagem é do studio, formal, e o motivo dela vira "um motivo pessoal".',
    "const robo = /fase de teste|em teste|estamos testando|\\bsistema\\b|\\brobo\\b|intelig[eê]ncia artificial|\\bsou (a|uma) (ia|assistente)|assistente virtual|confirmad[ií]ssim/i.test(txt);",
    "const enfeite = /[\\u2728\\u{1F485}\\u{1F60A}\\u2764\\u2705\\u{1F496}\\u{1F497}\\u{1F338}\\u{1F31F}]/u.test(txt);",
    "const ASSUNTO_DELA = '(prova|faculdade|compromisso|consulta|viagem|aula|exame|m[eé]dic[oa]|dentista|hospital|velório|enterro)';",
    "const pessoal = new RegExp('\\\\b(minha|meu)\\\\s+' + ASSUNTO_DELA + '|\\\\bn[aã]o vou (conseguir|poder)\\\\b|\\\\b(caroline|carol)\\\\s+(tem|ter[aá]|vai ter|est[aá] (com|em)|estar[aá] (com|em))\\\\s+(uma?\\\\s+)?' + ASSUNTO_DELA + '|\\\\bpor causa d[aeo]\\\\s+' + ASSUNTO_DELA, 'i').test(txt);",
    'if (!bloqueio && (robo || enfeite || pessoal)) {',
    "  bloqueio = 'NÃO ENVIADO (nada chegou à cliente): ' + (pessoal ? 'o texto fala como se fosse a Caroline ou conta um assunto dela' : robo ? 'o texto fala de teste, sistema, IA/assistente ou \"confirmadíssimo\"' : 'o texto tem emoji de enfeite (✨ 💅 😊 ❤️ ✅)') +",
    "    '. A mensagem é do studio: formal e simples, \"a Caroline\" e nunca \"eu\", nada do que ela te contou. Se ela não vai atender: \"a Caroline não poderá atender nesse horário por um motivo pessoal\" e ofereça remarcar. Reescreva e mande de novo.';",
    '}',
    'return [{ json: { bloqueio, recado, telefone: tel,',
  ].join('\n'));

  // ---------- 7. aviso pronto formal e regra que não se empilha (25/11, supabase/081) ----------
  // avisar_cliente sem texto: "a Caroline não poderá atender ... por um motivo pessoal. Podemos remarcar?"
  trocar('Montar chamada', "funcao = 'n8n_assistente_avisar_cliente'; enviar = true;", "funcao = 'n8n_assistente_avisar_cliente_v2'; enviar = true;");
  // guardar_regra: trocar = número da regra que a nova substitui; sem ele, regra repetida ou incompleta volta recusada
  trocar('Montar chamada', "funcao = 'n8n_assistente_guardar_regra'; args = { ...base, p_texto: v('texto') };",
    "funcao = 'n8n_assistente_guardar_regra_v2'; args = { ...base, p_texto: v('texto'), p_trocar: ou(v('trocar')) };");
  const entrada = F.nodes.find((n) => /executeWorkflowTrigger/.test(n.type));
  if (!entrada?.parameters?.workflowInputs?.values) throw new Error('assistente-consertos: a entrada das ferramentas mudou');
  if (!entrada.parameters.workflowInputs.values.some((x) => x.name === 'trocar')) entrada.parameters.workflowInputs.values.push({ name: 'trocar' });
  const regra = achar('guardar_regra', A);
  const w = regra.parameters.workflowInputs;
  w.value.trocar = "={{ $fromAI('trocar', `Número da regra (da lista REGRAS FIXAS) que esta substitui, quando é o mesmo assunto ou ela mudou a regra. Vazio quando é regra nova`, 'string') }}";
  if (!w.schema.some((x) => x.id === 'trocar')) w.schema.push({ ...w.schema.find((x) => x.id === 'texto'), id: 'trocar', displayName: 'trocar' });
};
