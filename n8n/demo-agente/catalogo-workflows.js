// Catálogo de fotos de cabelo (supabase/018, cadastrar-catalogo.js).
// Chamado pelo montar-workflow.js. Devolve 1 workflow e encaixa a tool no principal:
//   - "Catálogo - Enviar fotos"  subworkflow da tool enviar_catalogo: recebe o pedido (tipo, cor, comprimento,
//                                 textura, quantidade), escolhe 1 a 4 fotos que combinam (no máximo 1 por cabelo, sem repetir
//                                 as que a cliente já recebeu), gera URL assinada do Storage (bucket privado
//                                 "catalogo") e manda pela Evolution uma por vez, com pausa de gente entre elas.
//                                 A Evolution baixa a foto direto da URL (nada de base64 passando pelo n8n).
//                                 Cada foto enviada vai para o CRM (mensagens, tipo imagem). Nunca manda preço.
//                                 Se falhar, devolve texto para a IA responder sem foto.
//   - Principal: tool enviar_catalogo ligada ao Agente IA.

const EMPRESA = '$env.EMPRESA_ID';
const TEL_BR = (t) => `(() => { const d = String(${t} || '').replace(/\\D/g, ''); return /^55\\d{2}[6-9]\\d{7}$/.test(d) ? d.slice(0, 4) + '9' + d.slice(4) : d; })()`;
// marca na mensagem gravada no CRM: é por ela que o fluxo sabe quais fotos a cliente já recebeu
const MARCA = (arquivo) => `'[foto do catálogo: ' + ${arquivo} + ']'`;

module.exports = ({ node, str, main, toolSub, workflow }) => {
  const SUPA_H = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const supa = (name, method, rota, body, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
    method, url: `={{ $env.SUPABASE_URL }}/rest/v1/${rota}`, sendHeaders: true, headerParameters: SUPA_H,
    ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}` } : {}), options: { timeout: 15000 },
  }, { onError: 'continueRegularOutput', alwaysOutputData: true,
    ...(method === 'GET' ? { retryOnFail: true, maxTries: 3, waitBetweenTries: 1000 } : {}), ...extra });
  const settings = { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', saveManualExecutions: true };
  const ifNode = (name, cond) => node(name, 'n8n-nodes-base.if', 2.2, [0, 0], {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: name, leftValue: `={{ ${cond} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' },
    options: {},
  });
  const ligar = (wf, pares) => { for (const [de, para] of pares) wf.connections[de] = main(para); };

  // ---------- Subworkflow da tool enviar_catalogo ----------
  const E = "$('Recebe pedido da IA').first().json";
  const enviarWorkflow = {
    name: 'Catálogo - Enviar fotos',
    nodes: [
      node('Recebe pedido da IA', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: ['tipo', 'cor', 'comprimento', 'textura', 'quantidade', 'telefone', 'jid'].map((name) => ({ name })) },
      }),
      supa('Fotos do catálogo', 'GET', `catalogo?select=arquivo,grupo,tipo,cor,comprimento_cm,textura,legenda,ordem&ativo=eq.true&empresa_id=eq.{{ ${EMPRESA} }}&order=grupo,ordem`, null,
        { executeOnce: true }),
      supa('Já enviadas a ela', 'GET',
        "mensagens?select=conteudo,clientes!inner(telefone)&autor=eq.ia&tipo=eq.imagem&clientes.telefone=eq.{{ " + TEL_BR(`${E}.telefone`) + " }}", null,
        { executeOnce: true }),
      node('Escolher fotos', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: String.raw`
// O pedido da IA (tipo, cor, comprimento, textura, quantidade) -> 1 a 4 fotos que combinam, no máximo 1 por cabelo,
// sem repetir foto que esta cliente já recebeu.
const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const pedido = $('Recebe pedido da IA').first().json;
const fotos = $('Fotos do catálogo').all().map((i) => i.json).filter((f) => f.arquivo);
const enviados = $('Já enviadas a ela').all().map((i) => i.json.conteudo || '').join(' ');
if (!fotos.length) return [{ json: { ok: false, resposta: 'FOTOS NÃO ENVIADAS: o catálogo de fotos está vazio ou não carregou. Responda em texto, sem prometer foto.' } }];

const tipo = sem(pedido.tipo); const cor = sem(pedido.cor); const textura = sem(pedido.textura);
const cm = Number(String(pedido.comprimento || '').replace(/\D/g, '')) || 0;
// quantas fotos (o prompt pede 1 por tipo como padrão); sem número = até 4
const maximo = Math.min(4, Math.max(1, Number(String(pedido.quantidade || '').replace(/\D/g, '')) || 4));
// cores parecidas contam como a mesma família (cliente fala "moreno", "escuro", "preto", "mel"...)
const FAMILIA = [['loir', 'mel', 'dourad', 'platin', 'claro', 'ombre', 'esfumad', 'mesclad'], ['castanh', 'moren', 'escur', 'pret', 'chocolate', 'natural'],
  ['ruiv', 'acobread', 'cobre', 'ruiva', 'vermelh'], ['grisalh', 'cinza', 'branc'], ['iluminad', 'luzes', 'mechas']];
const familia = (s) => FAMILIA.findIndex((f) => f.some((p) => s.includes(p)));
const famTex = (s) => /cache|cacho|caipira|crespo/.test(s) ? 'cacheado' : /ondul/.test(s) ? 'ondulado' : /liso/.test(s) ? 'liso' : '';
const pontos = (f) => {
  let p = 0;
  const ft = sem(f.tipo);
  if (tipo) {
    // "brasileiro" sem Sul/regional ainda não foi separado: serve para os dois
    if (tipo.includes('sul') || tipo.includes('regional')) p += ft === tipo || ft === 'brasileiro' ? 4 : ft.startsWith('brasileiro') ? 2 : -4;
    else if (tipo.includes('brasil')) p += ft.startsWith('brasileiro') ? 4 : -4;
    else p += ft.includes(tipo.slice(0, 5)) ? 4 : -4;
  }
  const fc = sem(f.cor);
  if (cor) {
    if (fc === cor) p += 5;
    else if (cor.split(/\s+/).filter((w) => w.length > 3).every((w) => fc.includes(w.slice(0, 5)))) p += 4;
    else if (familia(cor) >= 0 && familia(cor) === familia(fc)) p += 2;
    else p -= 5;
  }
  if (textura) {
    const a = famTex(textura); const b = famTex(sem(f.textura));
    // "ondulado" serve para "levemente ondulado" (e vice-versa): mesma família vale como acerto
    if (sem(f.textura) === textura || (a && a === b)) p += 3; else if (a && b) p -= 3;
  }
  if (cm && f.comprimento_cm) { const d = Math.abs(f.comprimento_cm - cm); p += d === 0 ? 3 : d <= 5 ? 2 : d <= 10 ? 1 : d > 20 ? -2 : 0; }
  return p;
};
const exigido = (tipo ? 4 : 0) + (cor ? 2 : 0);
const porGrupo = {};
for (const f of fotos) {
  if (enviados.includes('[foto do catálogo: ' + f.arquivo + ']')) continue;
  const p = pontos(f);
  if (p < exigido) continue;
  const atual = porGrupo[f.grupo];
  // do mesmo cabelo fica a 1ª foto (a principal) que ela ainda não viu
  if (!atual || p > atual.p || (p === atual.p && f.ordem < atual.f.ordem)) porGrupo[f.grupo] = { f, p };
}
// cabelo que já teve foto enviada vai para o fim da fila (variedade antes de repetir o mesmo cabelo)
const jaViuGrupo = (g) => enviados.includes('[foto do catálogo: ' + g + '/');
const lista = Object.values(porGrupo).sort((a, b) => (jaViuGrupo(a.f.grupo) - jaViuGrupo(b.f.grupo)) || b.p - a.p || a.f.grupo.localeCompare(b.f.grupo));
// variedade: entre as que combinam igual (até 1 ponto da melhor), prefere tipo/cor/comprimento que ainda não foi
const escolhidas = [];
const cara = (f) => [f.tipo, sem(f.cor), sem(f.textura), f.comprimento_cm].join('|');
const melhor = lista.length ? lista[0].p : 0;
for (const nivel of [0, 1]) {
  for (const x of lista) {
    if (escolhidas.length >= maximo) break;
    if (escolhidas.includes(x.f) || x.p < melhor - 1 && nivel === 0) continue;
    if (nivel === 0 && escolhidas.some((e) => cara(e) === cara(x.f) || (e.tipo === x.f.tipo && sem(e.cor) === sem(x.f.cor) && escolhidas.length < 2))) continue;
    escolhidas.push(x.f);
  }
}
const pedidoTxt = [pedido.tipo, pedido.cor, pedido.textura, pedido.comprimento && (cm ? cm + ' cm' : pedido.comprimento)].filter(Boolean).join(', ') || 'sem filtro';
if (!escolhidas.length) {
  const algumaJa = fotos.some((f) => enviados.includes('[foto do catálogo: ' + f.arquivo + ']') && pontos(f) >= exigido);
  return [{ json: { ok: false, resposta: algumaJa
    ? 'FOTOS NÃO ENVIADAS: ela JÁ recebeu todas as fotos do catálogo que combinam com "' + pedidoTxt + '". Não mande de novo; responda em texto, curto, e se ela quiser ver outra opção pergunte cor, tipo ou comprimento diferente.'
    : 'FOTOS NÃO ENVIADAS: não tenho foto no catálogo para "' + pedidoTxt + '". Responda em texto, sem prometer foto; se fizer sentido, pergunte se ela quer ver outra cor, tipo ou comprimento.' } }];
}
// pausa de gente entre uma foto e a próxima (a 1ª sai logo)
return escolhidas.map((f, i) => ({ json: { ok: true, ...f, pedido: pedidoTxt, total: escolhidas.length, posicao: i + 1,
  delay: 1200 + Math.floor(Math.random() * 1500) } }));
` }),
      ifNode('Tem foto?', '$json.ok'),
      // URL assinada (1 h) para a Evolution baixar direto do Storage; as fotos de uma vez num pedido só
      node('URLs assinadas', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
        method: 'POST', url: '={{ $env.SUPABASE_URL }}/storage/v1/object/sign/catalogo',
        sendHeaders: true, headerParameters: SUPA_H, sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ expiresIn: 3600, paths: $('Escolher fotos').all().map(i => i.json.arquivo) }) }}",
        options: { timeout: 15000 },
      }, { onError: 'continueRegularOutput', alwaysOutputData: true, executeOnce: true, retryOnFail: true, maxTries: 2, waitBetweenTries: 1000 }),
      node('Montar envios', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: [
        "const base = $env.SUPABASE_URL + '/storage/v1';",
        "const assinadas = $('URLs assinadas').all().flatMap((i) => Array.isArray(i.json) ? i.json : [i.json]);",
        "const url = Object.fromEntries(assinadas.filter((a) => a && a.signedURL).map((a) => [a.path, base + a.signedURL]));",
        `const jid = ${E}.jid;`,
        "return $('Escolher fotos').all().filter((i) => url[i.json.arquivo]).map((i) => ({ json: { ...i.json, jid, url: url[i.json.arquivo] } }));",
      ].join('\n') }, { alwaysOutputData: true }),
      ifNode('Gerou URL?', '!!$json.url'),
      // uma foto por vez: 1 envio a cada 3,5 s + "delay" da própria Evolution (1,2 a 2,7 s), como quem escolhe e manda.
      // Legenda curta só quando ajuda a diferenciar (cor e comprimento); nunca preço.
      node('Enviar foto', 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
        method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendMedia/{{ $env.EVOLUTION_INSTANCE }}',
        sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ number: $json.jid, mediatype: 'image', mimetype: 'image/jpeg', media: $json.url, fileName: 'cabelo-' + $json.posicao + '.jpg', caption: $json.total > 1 ? ($json.legenda || '') : '', delay: $json.delay }) }}",
        options: { batching: { batch: { batchSize: 1, batchInterval: 3500 } }, timeout: 60000 },
      }, { onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 2000 }),
      // só vai para o CRM (e conta como "já enviada") a foto que a Evolution aceitou
      node('Enviadas', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: [
        "const fotos = $('Montar envios').all().filter((i) => i.json.url);",
        "return $input.all().map((r, i) => ({ json: { ...fotos[i].json, wa_id: r.json.key?.id || null } })).filter((x) => x.json.wa_id);",
      ].join('\n') }, { alwaysOutputData: true }),
      ifNode('Enviou alguma?', '!!$json.wa_id'),
      supa('Registrar no CRM', 'POST', 'rpc/n8n_registrar_saida',
        `{ p_empresa_id: ${EMPRESA}, p_telefone: ${TEL_BR(`${E}.telefone`)},
           p_conteudo: '📷 Foto do catálogo ' + ${MARCA('$json.arquivo')} + ': ' + ($json.legenda || $json.tipo),
           p_autor: 'ia', p_tipo: 'imagem', p_wa_message_id: $json.wa_id }`),
      node('Resposta (enviadas)', 'n8n-nodes-base.set', 3.4, [0, 0], {
        assignments: { assignments: [str('resposta',
          `={{ (() => { const f = $('Enviadas').all().map(i => i.json); const pedidas = $('Escolher fotos').all().length;
  return 'FOTOS ENVIADAS: a cliente acabou de receber ' + f.length + ' foto(s) do catálogo (' + f[0].pedido + '): ' +
    f.map(x => x.tipo + ', ' + (x.legenda || x.cor)).join(' | ') + '. ' +
    (f.length < pedidas ? 'Outras ' + (pedidas - f.length) + ' não foram (falha no envio); não comente. ' : '') +
    'São fotos do catálogo do fornecedor (não são estoque do salão nem resultado da Gleide). As fotos e legendas já respondem o pedido: NÃO escreva mensagem só para resumir, descrever ou elogiar as fotos, NÃO pergunte automaticamente de agendamento e NÃO fale preço (preço do cabelo só pela Gleide, via perguntar_para_gleide). ' +
    'Se a mensagem dela tiver outras perguntas, responda só essas; se não tiver, não escreva nada (resposta vazia).'; })() }}`)] },
        options: {},
      }, { executeOnce: true }),
      node('Resposta (sem foto)', 'n8n-nodes-base.set', 3.4, [0, 0], {
        assignments: { assignments: [str('resposta', '={{ $json.resposta }}')] }, options: {},
      }, { executeOnce: true }),
      node('Resposta (falhou)', 'n8n-nodes-base.set', 3.4, [0, 0], {
        assignments: { assignments: [str('resposta', 'FOTOS NÃO ENVIADAS (falha no envio). Responda em texto, curto, sem dizer que mandou foto e sem prometer mandar depois.')] }, options: {},
      }, { executeOnce: true }),
    ],
    connections: {},
    settings: { ...settings, callerPolicy: 'workflowsFromSameOwner' },
  };
  ligar(enviarWorkflow, [
    ['Recebe pedido da IA', 'Fotos do catálogo'], ['Fotos do catálogo', 'Já enviadas a ela'], ['Já enviadas a ela', 'Escolher fotos'],
    ['Escolher fotos', 'Tem foto?'], ['URLs assinadas', 'Montar envios'], ['Montar envios', 'Gerou URL?'],
    ['Enviar foto', 'Enviadas'], ['Enviadas', 'Enviou alguma?'], ['Registrar no CRM', 'Resposta (enviadas)'],
  ]);
  const ramos = (sim, nao) => ({ main: [[{ node: sim, type: 'main', index: 0 }], [{ node: nao, type: 'main', index: 0 }]] });
  enviarWorkflow.connections['Tem foto?'] = ramos('URLs assinadas', 'Resposta (sem foto)');
  enviarWorkflow.connections['Gerou URL?'] = ramos('Enviar foto', 'Resposta (falhou)');
  enviarWorkflow.connections['Enviou alguma?'] = ramos('Registrar no CRM', 'Resposta (falhou)');

  // ---------- Principal: tool enviar_catalogo ----------
  const fs = require('fs');
  const idFile = require('path').join(__dirname, '.workflow-catalogo-id');
  const lerId = () => (fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : 'ID_DO_WORKFLOW_CATALOGO');
  const M = "$('Montar entrada').first().json";
  workflow.nodes.push(toolSub('enviar_catalogo', [0, 0],
    'Busca no catálogo autorizado do fornecedor e manda para a cliente FOTOS de cabelo que combinam com o pedido (tipo, cor, comprimento, textura), uma por vez, com legenda curta. ' +
    'Use quando ela pedir para ver os cabelos, as opções, as cores ou um tipo específico. Não reenvia fotos que ela já recebeu. ' +
    'A resposta diz se as fotos foram enviadas (FOTOS ENVIADAS / FOTOS NÃO ENVIADAS); nunca fale preço por causa delas.',
    lerId, ['tipo', 'cor', 'comprimento', 'textura', 'quantidade', 'telefone', 'jid'], { telefone: `={{ ${M}.telefone }}`, jid: `={{ ${M}.jid }}` },
    [['tipo', 'Tipo de cabelo pedido: brasileiro do Sul, brasileiro regional, indiano ou vietnamita. Vazio se ela não disse', 'string'],
      ['cor', 'Cor pedida, com as palavras dela (ex.: loiro, loiro mel, castanho, ruivo, morena iluminada). Vazio se não disse', 'string'],
      ['comprimento', 'Comprimento em cm se ela disse (ex.: 60). Vazio se não disse', 'string'],
      ['textura', 'Textura pedida: liso, ondulado ou cacheado. Vazio se não disse', 'string'],
      ['quantidade', 'Quantas fotos mandar, de 1 a 4. Padrão 1 por tipo pedido', 'string']]));
  workflow.connections.enviar_catalogo = { ai_tool: [[{ node: 'Agente IA', type: 'ai_tool', index: 0 }]] };

  return { enviarWorkflow, idFile };
};
