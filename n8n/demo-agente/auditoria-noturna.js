// Conferência noturna das conversas (pedido do Victor, 24/11/2026: "sempre tem um erro"; supabase/074).
// Todo dia às 21h (Cuiabá), para cada loja: lê as conversas do dia, conta quem ficou sem resposta (no código, sem IA),
// pede ao Gemini a lista de erros da IA com o trecho e o conserto sugerido, guarda em auditoria_noturna e manda um
// resumo curto para o WhatsApp do Victor (pelo número do salão, como o "Alerta de erro").
// Não muda nada nas conversas nem no prompt: só aponta. O conserto continua passando pelo Victor.
//
// Uso (em n8n/demo-agente):  node auditoria-noturna.js            -> gera workflow-auditoria.json
//                            node auditoria-noturna.js --enviar   -> cria/atualiza no n8n e ativa (id em .workflow-auditoria-id)
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const env = Object.fromEntries(fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));

const NUMERO = env.ALERTA_NUMERO || '556699270860';
const MODELO = 'gemini-3.5-flash'; // estável: a prévia (3 Flash) ficou sobrecarregada em 24/11
const GEMINI_CRED = { googlePalmApi: { id: 'LAK6FIw68X0BIcHa', name: 'Google Gemini(PaLM) Api account' } };

// Lojas conferidas e o que vale para cada uma (o que a IA da loja deve fazer; o auditor usa isto para julgar)
const LOJAS = [
  {
    empresa_id: '00000000-0000-0000-0000-000000000001', nome: 'Gleide (mega hair)',
    regras: [
      'Venda consultiva de serviço caro: acolher, entender o caso, convidar para a avaliação gratuita.',
      'Quem nunca usou mega não recebe valor nenhum (nem mão de obra) e nenhuma pergunta técnica (gramas, telas, cm).',
      '"Quanto custa?" se responde sem número: do que depende o valor, e os 10x sem juros com o prazo real (até 26/11/2026). Nunca "não precisa se preocupar com o preço".',
      'Os 10x aparecem uma vez por conversa, sem "o que ajuda" depois.',
      'Quem já usa e pede informação da manutenção recebe a informação antes da pergunta.',
      'Foto que não abriu: o CERTO é agradecer, dizer com leveza que não abriu e pedir de novo. Erro é ser seco ou deixar para "a ligação".',
    ],
  },
  {
    empresa_id: '26a5d3eb-e8e4-4ed8-b206-095095292fdd', nome: 'Caroline (unhas)',
    regras: [
      'Venda simples e direta: responder primeiro o que ela perguntou, preço direto da lista, uma pergunta por resposta.',
      'Catálogo só quando ela pede ou pergunta todos os valores; nunca no lugar do preço.',
      'Horário novo pede sinal Pix pelo sistema; depois do comprovante, confirmar sem perguntar "posso reservar?".',
      'Sempre dizer com quem é o horário (Caroline ou Duda).',
    ],
  },
];

// Os defeitos que se repetem neste projeto (skill venda-consultiva, references/diagnostico.md) + os de 24/11
const DEFEITOS = [
  'nao_respondeu: não respondeu o que ela perguntou (devolveu só uma pergunta, mandou catálogo no lugar do preço, desviou do preço)',
  'pergunta_dupla: duas perguntas na mesma resposta, ou uma pergunta composta com "ou"/"e"',
  'convite_repetido: ofereceu os mesmos horários de novo, ou convite em toda resposta',
  'repeticao: repetiu informação já dita (promoção, preço, endereço, apresentação)',
  'invencao: afirmou algo que não é fato do salão (resultado, química, prazo, estoque, "agenda lotada")',
  'promessa_falsa: disse marcado/reservado/enviado sem ter acontecido, ou prometeu o que não pode cumprir',
  'tom_robo: frase de chatbot ("Com certeza!", "Fico à disposição", "Pra eu te orientar melhor"), "tudo bem?" por conta própria, eco do que ela disse',
  'vendedora: vender a vantagem ("o que ajuda", "ótima notícia"), superlativo, pressão',
  'seca: resposta fria ou curta demais quando ela contou algo pessoal ou mandou foto',
  'caminho_errado: tratou pelo caminho errado (iniciante com pergunta técnica, troca de método como manutenção, horário no salão para quem é de fora)',
  'falha_tecnica: "Desculpa, tive um probleminha", mensagem que não saiu (o conserto é no sistema: diga "conferir por que a IA falhou"); foto que não abriu só é erro se a IA foi seca ou adiou o assunto',
  'dado_errado: horário, dia, preço, modalidade (online x presencial) ou nome errado',
];

const D = '$json';
const montarCode = String.raw`
// junta as mensagens do dia por cliente e conta quem ficou sem resposta (sem IA); uma saída por loja
const todas = $input.all().map((i) => i.json).filter((m) => m && m.cliente_id);
return $('Lojas').all().map((li) => {
const loja = li.json;
const msgs = todas.filter((m) => m.empresa_id === loja.empresa_id);
const porCliente = {};
for (const m of msgs) (porCliente[m.cliente_id] = porCliente[m.cliente_id] || []).push(m);
const hora = (t) => new Date(t).toLocaleTimeString('pt-BR', { timeZone: 'America/Cuiaba', hour: '2-digit', minute: '2-digit' });
const quem = { cliente: 'CLIENTE', ia: 'IA', humano: 'SALÃO (pessoa)' };
const FECHO = /^\s*(ok+|obrigad[ao]|obg|brigad[ao]|blz|beleza|valeu|t[aá] bom|tabom|certo|perfeito|combinado|👍|🙏|❤️|🥰|😊)[\s!.]*$/i;
const agora = Date.now();
// números de teste do Victor ficam fora da conta
const TESTE = /(556699270860|5566999270860)$/;
let texto = '', conversas = 0, respostasIa = 0;
const semResposta = [];
for (const [id, ms] of Object.entries(porCliente)) {
  const c = ms[0].clientes || {};
  const tel = String(c.telefone || '').slice(-4);
  const nome = String(c.nome || '').trim() || 'sem nome';
  if (TESTE.test(String(c.telefone || ''))) continue;
  const temCliente = ms.some((m) => m.autor === 'cliente');
  if (!temCliente) continue; // só alô/lembrete sem resposta dela não é conversa
  conversas++;
  respostasIa += ms.filter((m) => m.autor === 'ia').length;
  const ultima = ms[ms.length - 1];
  if (ultima.autor === 'cliente' && agora - Date.parse(ultima.criado_em) > 15 * 60 * 1000 && !FECHO.test(String(ultima.conteudo || '')))
    semResposta.push({ cliente: nome, final: tel, desde: hora(ultima.criado_em), ultima: String(ultima.conteudo || '').slice(0, 120) });
  texto += '\n===== ' + nome + ' (final ' + tel + ')\n' + ms.map((m) => '[' + hora(m.criado_em) + '] ' + (quem[m.autor] || m.autor) + ': ' + String(m.conteudo || '').replace(/\n+/g, ' / ').slice(0, 500)).join('\n') + '\n';
}
const pedido = [
  'Você confere as conversas de WhatsApp da IA de atendimento de um salão (' + loja.nome + ') e aponta os ERROS DA IA, para o dono consertar.',
  'Só julgue as mensagens marcadas IA. Mensagens SALÃO (pessoa) são da equipe: use como contexto, não aponte erro nelas.',
  'O que vale nesta loja:', ...loja.regras.map((r) => '- ' + r),
  'Tipos de erro (use exatamente o código antes dos dois-pontos):', ...${JSON.stringify(DEFEITOS)}.map((d) => '- ' + d),
  'Regras da conferência:',
  '- Aponte só erro de verdade, com o trecho exato da IA. Na dúvida, não aponte. Resposta boa não entra.',
  '- Um erro por resposta da IA (o mais grave). O mesmo erro repetido na mesma conversa conta uma vez.',
  '- gravidade: alta = pode perder a cliente ou dá informação errada; media = atrapalha a venda; baixa = tom.',
  '- conserto: uma frase dizendo o que a IA deveria ter feito.',
  'Responda só JSON: {"erros":[{"cliente":"nome","final":"1234","hora":"10:19","tipo":"codigo","gravidade":"alta|media|baixa","trecho":"frase da IA","conserto":"..."}]}',
  '', 'CONVERSAS DE HOJE:', texto || '(nenhuma)',
].join('\n');
return { json: { empresa_id: loja.empresa_id, nome: loja.nome, dia: loja.dia, conversas, respostasIa, semResposta, pedido, vazio: !conversas } };
});
`;

const resultadoCode = String.raw`
const bases = $('Montar conversas').all().map((i) => i.json);
return $input.all().map((it, idx) => {
const $json = it.json;
const base = bases[idx];
let erros = [];
if (!base.vazio) {
  const parts = ($json.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
  try { erros = (JSON.parse(parts.replace(/^\s*${'```'}(json)?|${'```'}\s*$/g, '')).erros || []).filter((e) => e && e.tipo && e.trecho); }
  catch (e) { erros = [{ cliente: '-', final: '', hora: '', tipo: 'conferencia_falhou', gravidade: 'baixa', trecho: String(parts || $json.error?.message || 'sem resposta do Gemini').slice(0, 200), conserto: 'rodar de novo' }]; }
}
const ordem = { alta: 0, media: 1, baixa: 2 };
erros.sort((a, b) => (ordem[a.gravidade] ?? 3) - (ordem[b.gravidade] ?? 3));
const por100 = base.respostasIa ? Math.round((erros.length / base.respostasIa) * 1000) / 10 : null;
return { json: { ...base, erros, n_erros: erros.length, erros_por_100: por100 } };
});
`;

const juntarCode = String.raw`
const lojas = $input.all().map((i) => i.json);
const dia = lojas[0] ? lojas[0].dia.split('-').reverse().slice(0, 2).join('/') : '';
const linhas = ['🔎 Conferência das conversas, ' + dia];
for (const l of lojas) {
  linhas.push('');
  if (l.vazio) { linhas.push('*' + l.nome + '*: nenhuma conversa hoje.'); continue; }
  const altas = l.erros.filter((e) => e.gravidade === 'alta').length;
  linhas.push('*' + l.nome + '*: ' + l.conversas + ' conversas, ' + l.n_erros + ' erro(s)' + (altas ? ' (' + altas + (altas > 1 ? ' graves)' : ' grave)') : '') + (l.erros_por_100 !== null ? ', ' + String(l.erros_por_100).replace('.', ',') + ' a cada 100 respostas' : ''));
  if (l.semResposta.length) linhas.push('⚠️ Sem resposta: ' + l.semResposta.map((s) => s.cliente + ' (' + s.final + ') desde ' + s.desde).join('; '));
  for (const e of l.erros.slice(0, 6)) linhas.push('• ' + (e.gravidade === 'alta' ? '🔴 ' : '') + e.cliente + ' ' + e.final + ' ' + e.hora + ': "' + String(e.trecho).slice(0, 90) + '" → ' + e.conserto);
  if (l.erros.length > 6) linhas.push('… e mais ' + (l.erros.length - 6) + ' (lista completa guardada no banco)');
}
linhas.push('', 'Para consertar, me manda este resumo no Claude.');
return [{ json: { texto: linhas.join('\n') } }];
`;

let n = 0;
const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ id: `0a0d1700-0000-4000-8000-${String(++n).padStart(12, '0')}`, name, type, typeVersion, position, parameters, ...extra });
const supaHeaders = { parameters: [{ name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' }, { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' }] };

const workflow = {
  name: 'Conferência noturna das conversas',
  nodes: [
    node('Às 21h', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'days', triggerAtHour: 21, triggerAtMinute: 0 }] } }),
    node('Lojas', 'n8n-nodes-base.code', 2, [220, 0], {
      jsCode: `const dia = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Cuiaba' });\nreturn ${JSON.stringify(LOJAS.map(({ empresa_id, nome, regras }) => ({ empresa_id, nome, regras })))}.map((l) => ({ json: { ...l, dia, desde: new Date(dia + 'T00:00:00-04:00').toISOString() } }));`,
    }),
    node('Mensagens do dia', 'n8n-nodes-base.httpRequest', 4.2, [440, 0], {
      method: 'GET',
      // uma chamada só para todas as lojas (executeOnce); o "Montar conversas" separa pela empresa
      url: "={{ $env.SUPABASE_URL }}/rest/v1/mensagens?select=empresa_id,cliente_id,autor,conteudo,criado_em,clientes(nome,telefone)&empresa_id=in.({{ $('Lojas').all().map((i) => i.json.empresa_id).join(',') }})&criado_em=gte.{{ $('Lojas').first().json.desde }}&order=criado_em.asc&limit=5000",
      sendHeaders: true, headerParameters: supaHeaders, options: {},
    }, { alwaysOutputData: true, executeOnce: true }),
    node('Montar conversas', 'n8n-nodes-base.code', 2, [660, 0], { jsCode: montarCode }),
    node('Auditor (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [880, 0], {
      method: 'POST', url: `https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`,
      authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
      sendBody: true, specifyBody: 'json',
      jsonBody: '={{ JSON.stringify({ contents: [{ parts: [{ text: $json.pedido }] }], generationConfig: { temperature: 0.2, responseMimeType: "application/json" } }) }}',
      options: { timeout: 180000 },
    }, { credentials: GEMINI_CRED, onError: 'continueRegularOutput', retryOnFail: true, maxTries: 2, waitBetweenTries: 5000 }),
    node('Resultado', 'n8n-nodes-base.code', 2, [1100, 0], { jsCode: resultadoCode }),
    node('Guardar', 'n8n-nodes-base.httpRequest', 4.2, [1320, -120], {
      method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/auditoria_noturna',
      sendHeaders: true, headerParameters: supaHeaders, sendBody: true, specifyBody: 'json',
      jsonBody: `={{ JSON.stringify({ empresa_id: $json.empresa_id, dia: $json.dia, conversas: $json.conversas, respostas_ia: $json.respostasIa, erros: $json.erros, sem_resposta: $json.semResposta, n_erros: $json.n_erros, erros_por_100: $json.erros_por_100, modelo: '${MODELO}' }) }}`,
      options: {},
    }, { onError: 'continueRegularOutput' }),
    node('Juntar lojas', 'n8n-nodes-base.code', 2, [1320, 120], { jsCode: juntarCode }),
    node('Mandar ao Victor', 'n8n-nodes-base.httpRequest', 4.2, [1540, 120], {
      method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
      sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify({ number: '${NUMERO}', text: $json.texto }) }}`, options: {},
    }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),
  ],
  connections: {
    'Às 21h': { main: [[{ node: 'Lojas', type: 'main', index: 0 }]] },
    Lojas: { main: [[{ node: 'Mensagens do dia', type: 'main', index: 0 }]] },
    'Mensagens do dia': { main: [[{ node: 'Montar conversas', type: 'main', index: 0 }]] },
    'Montar conversas': { main: [[{ node: 'Auditor (Gemini)', type: 'main', index: 0 }]] },
    'Auditor (Gemini)': { main: [[{ node: 'Resultado', type: 'main', index: 0 }]] },
    Resultado: { main: [[{ node: 'Guardar', type: 'main', index: 0 }, { node: 'Juntar lojas', type: 'main', index: 0 }]] },
    'Juntar lojas': { main: [[{ node: 'Mandar ao Victor', type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1', timezone: 'America/Cuiaba' },
};
const alertaId = path.join(dir, '.workflow-alerta-id');
if (fs.existsSync(alertaId)) workflow.settings.errorWorkflow = fs.readFileSync(alertaId, 'utf8').trim();

fs.writeFileSync(path.join(dir, 'workflow-auditoria.json'), JSON.stringify(workflow, null, 2));
console.log('workflow-auditoria.json gerado');
module.exports = { workflow, LOJAS, DEFEITOS };

if (require.main === module && process.argv.includes('--enviar')) {
  (async () => {
    const base = env.N8N_URL + '/api/v1/workflows';
    const headers = { 'X-N8N-API-KEY': env.N8N_API_KEY, 'Content-Type': 'application/json' };
    const idFile = path.join(dir, '.workflow-auditoria-id');
    const id = fs.existsSync(idFile) ? fs.readFileSync(idFile, 'utf8').trim() : '';
    const res = await fetch(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', headers, body: JSON.stringify(workflow) });
    const body = await res.json();
    if (!res.ok) { console.error('Erro', res.status, JSON.stringify(body).slice(0, 500)); process.exit(1); }
    fs.writeFileSync(idFile, body.id);
    console.log(`${id ? 'Atualizado' : 'Criado'}: ${workflow.name} (id=${body.id})`);
    const a = await fetch(`${base}/${body.id}/activate`, { method: 'POST', headers });
    console.log('  ativo:', a.ok);
  })();
}
