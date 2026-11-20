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
    '// "Parecido" = texto igual, ou o MESMO horário/dia citado e pelo menos 2 palavras do assunto em comum (sem contar nome, dia e palavras de horário)',
    '// (as duas desculpas da Vanessa falavam de "14:30 amanhã"; uma oferta nova de "10h" passa).',
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
    '    return mesmaHora && comuns >= 2;',
    '  })());',
    '  if (recente) {',
    "    bloqueio = 'NÃO ENVIADO (nada chegou à cliente): às ' + hm(recente.criado_em) + ' ela já recebeu uma mensagem parecida: «' + String(recente.conteudo).replace(/\\s+/g, ' ').slice(0, 160) + '». ' +",
    "      'Duas mensagens quase iguais em poucos minutos confundem a cliente. Se a Caroline quer acrescentar algo, mande SÓ o que é novo, curto; se não há nada novo, não mande e conte isso à Caroline em uma linha.';",
    '  }',
    '}',
    'return [{ json: { bloqueio, recado, telefone: tel,',
  ].join('\n'));
};
