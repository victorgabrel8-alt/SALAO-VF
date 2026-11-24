// O WhatsApp da segunda profissional (Duda) na assistente do salão (só nas lojas com segunda_profissional.telefone
// no loja.json; a Gleide não passa por aqui). Pedido do Victor (20/11/2026): a Eduarda (Duda) também representa o
// salão e usa a assistente pelo WhatsApp (marcar, remarcar, cancelar, ver agenda) como a Caroline, mas recebe só
// o que é dela:
//   - ela fala com a assistente: o número dela entra só nos lugares que AUTORIZAM ("É a Gleide (assistente)?" no
//     principal e "Extrair dados" da assistente), e no banco em empresas.config.assistente_numeros. Os avisos do
//     salão (pendências, resumo da noite, faltas, ligação) continuam só para a Caroline: a lista geral
//     (assistente_numeros do loja.json) NÃO muda;
//   - a assistente sabe que quem escreve é a Duda e a chama de Duda;
//   - a assistente marca, remarca e muda a duração na agenda da profissional certa, conferindo conflito só com a mesma
//     profissional (supabase/061 e 064); a dona pode dizer "com a Duda"; a agenda do dia diz com quem é cada horário;
//   - pergunta de cliente da Duda (o próximo horário dela é com a Duda) vai para o WhatsApp da Duda; as outras
//     continuam com a Caroline. As duas podem responder um pedido numerado ("27 sim").
// Vem depois do pedido-numerado.js (troca nós que ele põe) e antes do paraLoja (os nomes ainda são os da Gleide).

module.exports = ({ node, workflow: W, assistenteWorkflow: A, ferramentasWorkflow: F, perguntaWorkflow: P, loja }) => {
  const sp = loja.segunda_profissional || {};
  const D = String(sp.telefone || '').replace(/\D/g, '');
  const DONA = String((loja.assistente_numeros || [])[0] || '').replace(/\D/g, '');
  if (!/^55\d{10,11}$/.test(D) || !DONA || !sp.id || !sp.nome) throw new Error('segunda-profissional-whatsapp: falta telefone/id/nome da segunda profissional ou o número da dona');
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('segunda-profissional-whatsapp: sem o nó ' + nome); return n; };
  // troca em TODO o JSON dos parâmetros de um nó, com conferência
  const trocarNo = (wf, nome, de, para) => {
    const n = achar(wf, nome);
    const s = JSON.stringify(n.parameters);
    const esc = (x) => JSON.stringify(x).slice(1, -1); // o texto vive dentro de uma string do JSON
    if (!s.includes(esc(de))) throw new Error(`segunda-profissional-whatsapp: "${nome}" mudou (${de.slice(0, 60)})`);
    n.parameters = JSON.parse(s.split(esc(de)).join(esc(para)));
  };
  const LISTA = `'${DONA},${D}'`;

  // 1. quem pode falar com a assistente: a dona e a segunda profissional
  trocarNo(W, 'É a Gleide (assistente)?', '$env.ASSISTENTE_NUMEROS', LISTA);
  trocarNo(A, 'Extrair dados', '$env.ASSISTENTE_NUMEROS', LISTA);
  // quem pode responder um pedido numerado ("27 sim")
  if (P.nodes.some((x) => x.name === 'Pedido nº: guardar índice')) trocarNo(P, 'Pedido nº: guardar índice', '$env.ASSISTENTE_NUMEROS', LISTA);

  // 2. a assistente sabe que é a Duda
  const nomeDuda = JSON.stringify(sp.nome);
  trocarNo(A, 'Contexto', "agora: '[' + quandoFoi(agora) + ']'",
    "agora: '[' + quandoFoi(agora) + ']' + ($('Extrair dados').first().json.numero === '" + D + "' ? ' (QUEM ESCREVE AGORA É A ' + " + nomeDuda + ".toUpperCase() + ', que também atende no studio, e não a ' + " + JSON.stringify(loja.dona) + " + ': chame-a de ' + " + nomeDuda + " + '. O que ela marcar fica na agenda dela.)' : '')");

  // 3. a assistente marca na agenda da profissional certa (supabase/061): marcar_horario passa a chamar
  //    n8n_assistente_marcar_horario_prof, que confere conflito só com a mesma profissional e grava a profissional
  //    (a Duda quando é ela quem pede; vazio = a dona). Sem isso, um horário da Caroline recusava a Duda e o
  //    "marca assim mesmo" passava sem conferir nem a agenda dela.
  const montar = achar(F, 'Montar chamada');
  const DE_F = "funcao = 'n8n_assistente_marcar_horario_c';";
  const DE_A = /p_bloco_min: (\d+) \};/;
  if (montar.parameters.jsCode.split(DE_F).length !== 2 || (montar.parameters.jsCode.match(new RegExp(DE_A.source, 'g')) || []).length !== 1)
    throw new Error('segunda-profissional-whatsapp: o marcar_horario do "Montar chamada" mudou');
  // com quem: o que a dona disse no campo "profissional" ("com a Duda", "Caroline"); sem dizer, marcar fica com quem
  // pediu (a Duda, se foi ela; senão a dona) e remarcar fica com a profissional de antes
  const PROF_JS = "const profDita = (() => { const q = v('profissional').normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').toLowerCase(); " +
    "return /dud|eduard/.test(q) ? '" + sp.id + "' : /carol/.test(q) ? '" + sp.principal_id + "' : null; })();\n";
  const DE_INI = "let funcao, args, enviar = false;";
  if (montar.parameters.jsCode.split(DE_INI).length !== 2) throw new Error('segunda-profissional-whatsapp: o começo do "Montar chamada" mudou');
  montar.parameters.jsCode = montar.parameters.jsCode
    .replace(DE_INI, () => DE_INI + '\n' + PROF_JS)
    .replace(DE_F, () => "funcao = 'n8n_assistente_marcar_horario_prof';")
    .replace(DE_A, (_, n) => 'p_bloco_min: ' + n + ", p_profissional_id: profDita || (v('pedido_por') === '" + D + "' ? '" + sp.id + "' : null) };");
  // remarcar e mudar a duração: conflito só com a mesma profissional (supabase/064); remarcar pode trocar de profissional
  const trocarUma = (de, para) => {
    if (montar.parameters.jsCode.split(de).length !== 2) throw new Error('segunda-profissional-whatsapp: "Montar chamada" mudou (' + de.slice(0, 50) + ')');
    montar.parameters.jsCode = montar.parameters.jsCode.replace(de, () => para);
  };
  trocarUma("funcao = 'n8n_assistente_reagendar_confirma';", "funcao = 'n8n_assistente_reagendar_prof';");
  trocarUma("p_servico: ou(v('servico')), p_forcar: forcar() };", "p_servico: ou(v('servico')), p_forcar: forcar(), p_profissional_id: profDita };");
  trocarUma("funcao = 'n8n_assistente_ajustar_duracao';", "funcao = 'n8n_assistente_ajustar_duracao_prof';");
  // agenda do dia: cada horário diz com quem é (campo "com")
  trocarUma("funcao = 'n8n_assistente_agenda_do_dia';", "funcao = 'n8n_assistente_agenda_do_dia_prof';");
  // 23/11/2026: os nós que decidem pelo NOME da função (ler a Google Agenda da dona; avisar que a cliente ainda não sabe da
  // remarcação) só conheciam os nomes de antes. Desde 20/11 a assistente da Caroline não via a Google ao ver o dia, marcar
  // ou remarcar. Aqui esses nós passam a comparar com o nome de antes.
  const ANTES = "({ n8n_assistente_agenda_do_dia_prof: 'n8n_assistente_agenda_do_dia', n8n_assistente_marcar_horario_prof: 'n8n_assistente_marcar_horario', " +
    "n8n_assistente_reagendar_prof: 'n8n_assistente_reagendar_confirma', n8n_assistente_ajustar_duracao_prof: 'n8n_assistente_ajustar_duracao' })";
  const nomeDeAntes = (expr) => '(' + ANTES + '[' + expr + '] || ' + expr + ')';
  const M = "$('Montar chamada').first().json.funcao";
  trocarNo(F, 'Precisa da Google?', '.includes(' + M + ')', '.includes(' + nomeDeAntes(M) + ')');
  trocarNo(F, 'Resposta', M + " === 'n8n_assistente_agenda_do_dia'", nomeDeAntes(M) + " === 'n8n_assistente_agenda_do_dia'");
  trocarNo(F, 'Resposta', M + " === 'n8n_assistente_reagendar_confirma'", nomeDeAntes(M) + " === 'n8n_assistente_reagendar_confirma'");
  // campo "profissional" chega às ferramentas: gatilho das ferramentas + ferramentas marcar_horario e reagendar
  const gat = F.nodes.find((x) => x.type.includes('executeWorkflowTrigger'));
  if (!gat || !gat.parameters.workflowInputs?.values) throw new Error('segunda-profissional-whatsapp: sem o gatilho das ferramentas');
  if (!gat.parameters.workflowInputs.values.some((x) => x.name === 'profissional')) gat.parameters.workflowInputs.values.push({ name: 'profissional' });
  const DESC = {
    marcar_horario: 'Com quem: "' + loja.dona + '" ou "' + sp.nome + '", se quem pediu disse (ex.: "marca a Ana com a ' + sp.nome + '"). Vazio: fica com quem está pedindo',
    reagendar: 'Só se pediram para trocar de profissional: "' + loja.dona + '" ou "' + sp.nome + '". Vazio: continua com a mesma',
  };
  for (const [nome, desc] of Object.entries(DESC)) {
    const w = achar(A, nome).parameters.workflowInputs;
    w.value.profissional = "={{ $fromAI('profissional', `" + desc + "`, 'string') }}";
    if (!w.schema.some((s) => s.id === 'profissional')) w.schema.push({ id: 'profissional', displayName: 'profissional', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false });
  }

  // 4. pergunta de cliente da Duda vai para a Duda
  const alerta = achar(P, 'Supabase: número de alerta');
  const depois = P.connections['Supabase: número de alerta']?.main?.[0];
  if (!depois || depois.length !== 1) throw new Error('segunda-profissional-whatsapp: a saída de "número de alerta" mudou');
  const TEL = "(() => { const d = String($('Recebe pergunta da IA').first().json.telefone || '').replace(/\\D/g, ''); const com9 = /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; const sem9 = com9.replace(/^(55\\d\\d)9(\\d{8})$/, '$1$2'); return com9 + ',' + sem9; })()";
  P.nodes.push(node('Pergunta: cliente da ' + sp.nome + '?', 'n8n-nodes-base.httpRequest', 4.2, [alerta.position[0] + 110, alerta.position[1] - 220], {
    method: 'GET',
    url: "={{ $env.SUPABASE_URL }}/rest/v1/agendamentos?select=profissional_id,clientes!inner(telefone)&empresa_id=eq." + loja.empresa_id +
      "&status=eq.agendado&inicio=gte.{{ $now.minus({ hours: 2 }).toUTC().toISO() }}&clientes.telefone=in.({{ " + TEL + " }})&order=inicio&limit=1",
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
    ] },
    options: { timeout: 10000 },
  }, { alwaysOutputData: true, onError: 'continueRegularOutput' }));
  P.connections['Supabase: número de alerta'] = { main: [[{ node: 'Pergunta: cliente da ' + sp.nome + '?', type: 'main', index: 0 }]] };
  P.connections['Pergunta: cliente da ' + sp.nome + '?'] = { main: [depois] };
  // o envio lê o número do "número de alerta" (não do $json), então a ordem nova não atrapalha
  const enviar = P.nodes.find((x) => /^Enviar pergunta à /.test(x.name));
  if (!enviar) throw new Error('segunda-profissional-whatsapp: sem o nó de enviar a pergunta');
  const DE = "number: $('Supabase: número de alerta').first().json.alerta,";
  if (!enviar.parameters.jsonBody.includes(DE)) throw new Error('segunda-profissional-whatsapp: o envio da pergunta mudou');
  enviar.parameters.jsonBody = enviar.parameters.jsonBody.split(DE).join(
    "number: (((() => { try { return $('Pergunta: cliente da " + sp.nome + "?').first().json.profissional_id; } catch (e) { return null; } })() === '" + sp.id + "') ? '" + D + "' : $('Supabase: número de alerta').first().json.alerta),");
  // a IA diz à cliente com quem vai confirmar (a Duda, quando a pergunta foi para ela)
  const QUEM = "((() => { try { return $('Pergunta: cliente da " + sp.nome + "?').first().json.profissional_id; } catch (e) { return null; } })() === '" + sp.id + "' ? " + JSON.stringify(sp.nome).replace(/"/g, "'") + " : 'Gleide')";
  trocarNo(P, 'Resposta', "'PERGUNTADO: a Gleide recebeu a pergunta. Diga à cliente, numa frase gentil, que vai confirmar isso com a Gleide e avisa",
    "'PERGUNTADO: a ' + " + QUEM + " + ' recebeu a pergunta. Diga à cliente, numa frase gentil, que vai confirmar isso com a ' + " + QUEM + " + ' e avisa");
};
