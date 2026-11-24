// O aviso que a dona recebe quando a IA passa uma cliente para ela (transferir_para_humano).
//
// 24/11/2026, Gleide: chegou "joana · (66) 99999-0011 / Gerar e enviar link de pagamento para a Joana /
// https://app.oistudio.com.br/conversas/…". Ela não entendeu o que era aquele link e perguntou à assistente ("Oi / Esse
// link"). A assistente não sabia do aviso (ele não entrava na memória dela) e respondeu que não tinha aparecido nada.
//
// Agora o aviso é um repasse completo, para a dona não precisar perguntar nada (anthropics/knowledge-work-plugins,
// customer-support/customer-escalation: o que a cliente pediu, o que já foi dito a ela, o que é preciso fazer e o link
// com nome; composio-community/support-skills, handoff-notes: "Last action / What's needed"; SortedEA/skills,
// sound-human: começar pelo assunto, sem frase feita):
//   *Joana* precisa de você: gerar e enviar o link de pagamento.
//   Ela escreveu: «Queria saber se ela consegue me mandar um link de pagamento» «Amanhã vou viajar…»
//   A IA disse a ela que você responde e não vai mais responder ela por 12 h.
//   Pode falar com ela pelo WhatsApp do salão (o número dela é (66) 99999-0011) ou me dizer aqui o que mandar.
//   Conversa dela no app: https://app.oistudio.com.br/conversas/…
// O mesmo texto entra na memória da assistente, com o id da cliente, para ela saber explicar e agir.

// Roda dentro do n8n (nó de código): só JavaScript simples.
// ctx: { nome, telefone, cliente_id, o_que_precisa, motivo, mensagens (do banco, a mais nova primeiro), app, agora }
function avisoTransferencia(ctx) {
  ctx = ctx || {};
  const NFC = (x) => String(x == null ? '' : x).normalize('NFC');
  // celular gravado sem o 9 ("556696736156") sai com o 9, como a Gleide disca
  const fone = (t) => { const m = String(t || '').replace(/\D/g, '').match(/^55(\d{2})(\d{4,5})(\d{4})$/); if (!m) return ''; const meio = m[2].length === 4 && /^[6-9]/.test(m[2]) ? '9' + m[2] : m[2]; return '(' + m[1] + ') ' + meio + '-' + m[3]; };
  // só as letras do nome ("💕mari💕" vira "Mari"; "." e número não são nome)
  const nome = NFC(ctx.nome).replace(/[^\p{L}\s'-]/gu, ' ').trim().split(/\s+/).filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w)).slice(0, 2)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  const tel = fone(ctx.telefone);
  const temNome = !!nome && !/^cliente( teste)?$/i.test(nome);
  const quem = temNome ? '*' + nome + '*' : (tel ? 'A cliente do ' + tel : 'Uma cliente');
  const semAcento = (x) => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // o que a dona precisa fazer (só espaços conta como vazio), até 160 letras
  let precisa = NFC(ctx.o_que_precisa).replace(/\s+/g, ' ').trim() || NFC(ctx.motivo).replace(/\s+/g, ' ').trim();
  if (precisa.length > 160) precisa = precisa.slice(0, 160).replace(/\s+\S*$/, '') + '…';
  // "Gerar o link de pagamento para a Joana": o nome no FIM sai (já está no começo do aviso). No meio da frase fica
  // ("Conferir se a Carla tem horário dia 12/12" continua inteira).
  const primeiro = nome ? semAcento(nome.split(' ')[0]) : '';
  if (primeiro) {
    const p = semAcento(precisa).search(new RegExp('\\s+(para|pra|da|do|de|com|a)\\s+(a\\s+|o\\s+)?' + primeiro + '(\\s+\\S+)?[\\s.!]*$'));
    if (p > 0) precisa = precisa.slice(0, p).trim();
  }
  // pergunta fica com "?"; o resto termina com um ponto só
  const pergunta = /\?\s*$/.test(precisa);
  precisa = precisa.replace(/[.!?…\s]+$/, '');
  // começa minúsculo depois dos dois-pontos, a não ser sigla ou o nome da própria cliente
  const primeiraPalavra = semAcento(precisa.split(' ')[0] || '');
  if (precisa && !/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}\b/.test(precisa) && !(nome && semAcento(nome).split(' ').includes(primeiraPalavra))) precisa = precisa[0].toLowerCase() + precisa.slice(1);
  const linhas = [quem + ' precisa de você' + (precisa ? ': ' + precisa + (pergunta ? '?' : '.') : '.')];
  // o que ela mandou desde a última resposta do salão (a mais antiga primeiro), sem cumprimento e sem "ok"
  const SOLTAS = ['oi', 'oie', 'oii', 'ola', 'e', 'ai', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'td', 'tb', 'sim', 'nao', 'ok', 'okay', 'ta', 'to', 'tah',
    'certo', 'beleza', 'blz', 'obrigada', 'obrigado', 'obrigadaa', 'obg', 'brigada', 'valeu', 'aham', 'uhum', 'otimo', 'joia', 'show', 'combinado', 'entendi', 'perfeito', 'ah', 'vc', 'voce'];
  const trivial = (t) => { const ps = semAcento(t).split(/[^a-z]+/).filter(Boolean); return ps.length <= 5 && ps.every((w) => SOLTAS.includes(w)); };
  // foto, vídeo e áudio chegam no banco com o que a IA viu ou transcreveu: no aviso vira só o que ela mandou
  const legivel = (t) => {
    if (/^\[(foto|imagem)/i.test(t)) return '(mandou uma foto)';
    if (/^\[v[íi]deo/i.test(t)) return '(mandou um vídeo)';
    if (/^\[(arquivo|documento|pdf)/i.test(t)) return '(mandou um arquivo)';
    if (/^\[[áa]udio\]/i.test(t)) { const r = t.replace(/^\[[áa]udio\]\s*/i, ''); return !r || /envie o arquivo|n[ãa]o (consegui|foi poss[ií]vel)/i.test(r) ? '(mandou um áudio)' : r; }
    return t;
  };
  const dela = [];
  for (const m of Array.isArray(ctx.mensagens) ? ctx.mensagens : []) {
    if (!m || typeof m !== 'object') continue;
    if (m.direcao !== 'entrada') break;
    const t = legivel(NFC(m.conteudo).replace(/\s+/g, ' ').trim());
    if (t && !trivial(t) && dela[0] !== t) dela.unshift(t.length > 160 ? t.slice(0, 160) + '…' : t);
  }
  let citacao = dela.slice(-3).map((t) => (/^\(mandou/.test(t) ? t : '«' + t + '»')).join(' ');
  if (citacao.length > 420) citacao = citacao.slice(0, 420) + '…';
  if (citacao) linhas.push('Ela escreveu: ' + citacao);
  linhas.push('A IA disse a ela que você responde e não vai mais responder ela por 12 h.');
  linhas.push('Pode falar com ela pelo WhatsApp do salão' + (tel ? ' (o número dela é ' + tel + ')' : '') + ' ou me dizer aqui o que mandar.');
  if (ctx.cliente_id) linhas.push('Conversa dela no app: ' + String(ctx.app || 'https://app.oistudio.com.br').replace(/\/$/, '') + '/conversas/' + ctx.cliente_id);
  const texto = linhas.join('\n');
  // "ter 24/11 17:21" no fuso do salão (Cuiabá, -04:00 o ano todo), como as outras mensagens da memória da assistente
  const d = new Date((Number(ctx.agora) || Date.now()) - 4 * 3600e3);
  const p2 = (n) => String(n).padStart(2, '0');
  const quando = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getUTCDay()] + ' ' + p2(d.getUTCDate()) + '/' + p2(d.getUTCMonth() + 1) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  const extra = [ctx.cliente_id ? 'cliente_id: ' + ctx.cliente_id : '', ctx.telefone ? 'telefone: ' + String(ctx.telefone).replace(/\D/g, '') : '',
    ctx.nome ? 'nome no cadastro: ' + NFC(ctx.nome) : ''].filter(Boolean).join(', ');
  const memoria = JSON.stringify({ type: 'ai', data: { content: '[' + quando + '] ' + texto + (extra ? '\n(' + extra + ')' : ''),
    additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } });
  return { texto, memoria };
}

module.exports = { avisoTransferencia };
