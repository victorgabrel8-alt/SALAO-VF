// Conferências automáticas (sem IA) de uma resposta do banco de testes. Ver criterios.md.
// Cada conferência que falha vira um item { regra, grave, detalhe }. "grave" derruba o caso, as outras tiram 1 ponto.

const PROIBIDAS = [
  ['garantia de resultado', /\bgarant(ir|e|imos|o|ido)\b|\bsem risco\b|\bvai segurar\b|\bmelhor fixa[cç][aã]o\b/i],
  ['propaganda', /\bincr[ií]ve(l|is)\b|\bmaravilhos[oa]s?\b|\bresultado dos sonhos\b|\btransforma[cç][aã]o\b|\bperfeit[oa]s?\b/i],
  ['vocativo', /\b(flor|querida|princesa|amor|linda)\b[,!.?]/i],
  ['central de atendimento', /como posso (te )?ajudar|fico [àa] disposi[cç][aã]o|estou [àa] disposi[cç][aã]o|agradecemos o contato|conforme informado|ficou alguma d[uú]vida/i],
  ['regra interna', /n[aã]o tenho (faixa|autoriza[cç][aã]o)|a ferramenta|no sistema consta/i],
];
// perguntas de cortesia não contam como "pergunta" da resposta
const CORTESIA = /(tudo bem|tudo bom|como vai|n[eé]|t[aá]|t[aá] bom|combinado|pode ser|certo|ok|sabe)\s*\?/gi;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

const palavras = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;
const perguntas = (t) => (String(t || '').replace(CORTESIA, '.').match(/\?/g) || []).length;
const valores = (t) => [...String(t || '').matchAll(/R\$\s?(\d{1,3}(?:\.\d{3})*|\d+)(?:,(\d{2}))?/g)].map((m) => Number(m[1].replace(/\./g, '')));

// baloes: textos que a cliente receberia; caso: item de casos.json; ctx: { precosDaTabela: [150, ...], ferramentas: ['nome', ...] }
function conferir(baloes, caso, ctx) {
  const falhas = [];
  const falha = (regra, grave, detalhe) => falhas.push({ regra, grave: !!grave, detalhe: String(detalhe || '') });
  const permite = new Set(caso.permite || []);
  const texto = baloes.join('\n\n');
  const usadas = ctx.ferramentas || [];

  if (!texto.trim()) { falha('sem resposta', true, 'a IA não escreveu nada'); return falhas; }
  const longo = baloes.find((b) => palavras(b) > 55);
  if (longo) falha('balão longo', false, palavras(longo) + ' palavras: "' + longo.slice(0, 60) + '…"');
  if (baloes.length > 3) falha('muitos balões', false, baloes.length + ' balões');
  if (palavras(texto) > 110) falha('resposta longa', false, palavras(texto) + ' palavras no total');
  if (!permite.has('duas_perguntas') && perguntas(texto) > 1) falha('mais de uma pergunta', false, perguntas(texto) + ' perguntas');
  for (const [nome, re] of PROIBIDAS) { const m = texto.match(re); if (m) falha('palavra proibida (' + nome + ')', false, '"' + m[0] + '"'); }
  // jeito de vendedora (skill venda-consultiva, fala.md): enfeitar a oferta e pedir concordância
  { const m = texto.match(/(o que|que) (ajuda|facilita) (muito|bastante|bem)|[óo]tima not[ií]cia|boa not[ií]cia|olha que legal|o melhor [eé] que|e o mais legal|aproveitando,|lembrando que/i); if (m) falha('vendeu a vantagem', false, '"' + m[0] + '"'); }
  { const m = texto.match(/[^.!?\n]{0,40},? n[eé]\?/i); if (m) falha('pediu concordância', false, '"' + m[0].trim() + '"'); }
  { const m = baloes.find((b) => /R\$|10x|sem juros|gratuit/i.test(b) && /!/.test(b.replace(/^[^!]{0,60}!/, ''))); if (m && /(10x|sem juros)[^.?\n]{0,60}!/i.test(m)) falha('exclamação na oferta', false, ''); }
  if (!permite.has('sinal')) { const m = texto.match(/\bsinal\b|\bmulta\b|taxa de falta|R\$\s?20\b/i); if (m) falha('falou de sinal ou cobrança', true, '"' + m[0] + '"'); }
  const fora = valores(texto).filter((v) => !(ctx.precosDaTabela || []).includes(v) && !(caso.valores_permitidos || []).includes(v));
  if (fora.length) falha('valor fora da tabela do app', true, 'R$ ' + fora.join(', R$ '));
  { const m = texto.match(/26\/11|dia 26\b|at[eé] (quinta|o fim do m[eê]s)/i); if (m) falha('disse a data final da promoção', false, '"' + m[0] + '"'); }
  if (caso.sem_emoji && EMOJI.test(texto)) falha('emoji em assunto delicado', false, '');
  for (const f of caso.ferramenta_deve || []) if (!usadas.includes(f)) falha('não usou ' + f, true, 'usou: ' + (usadas.join(', ') || 'nenhuma'));
  for (const f of caso.ferramenta_nao || []) if (usadas.includes(f)) falha('usou ' + f + ' sem dever', true, '');
  for (const r of caso.deve || []) if (!new RegExp(r, 'i').test(texto)) falha('faltou dizer', true, '/' + r + '/');
  for (const r of caso.nao_deve || []) { const m = texto.match(new RegExp(r, 'i')); if (m) falha('disse o que não devia', true, '"' + m[0] + '"'); }
  return falhas;
}

// nota de 0 a 10: média das notas do juiz (cada uma 0, 1 ou 2), menos 1 ponto por falha leve; falha grave limita a nota a 4
const CRITERIOS = ['calor', 'responde', 'conduz', 'especifica', 'fiel', 'esperado'];
function nota(juiz, falhas) {
  const soma = CRITERIOS.reduce((s, k) => s + Math.max(0, Math.min(2, Number(juiz && juiz[k]) || 0)), 0);
  let n = (soma / (CRITERIOS.length * 2)) * 10 - falhas.filter((f) => !f.grave).length;
  if (falhas.some((f) => f.grave)) n = Math.min(n, 4);
  return Math.max(0, Math.round(n * 10) / 10);
}
const passou = (n, juiz, falhas) => n >= 7 && !falhas.some((f) => f.grave) && Number(juiz && juiz.esperado) > 0;

module.exports = { conferir, nota, passou, palavras, perguntas, valores, CRITERIOS };
