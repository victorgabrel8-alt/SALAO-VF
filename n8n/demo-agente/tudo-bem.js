// "Tudo bem?" no lugar certo (24/11/2026, conversas da Lene e da Noraneuza).
// O prompt proíbe perguntar "tudo bem?" por conta própria, mas a IA respondeu "Bom dia" com "Tudo bem? 😊" (Lene) e
// devolveu "Tudo bem por aqui?" (com interrogação) a quem perguntou (Noraneuza). No "Quebrar mensagens", antes do envio:
//   - a cliente NÃO perguntou "tudo bem?" (nem "tudo bom", "como vai", "como você está"): a frase "Tudo bem?" /
//     "Tudo bom?" solta sai;
//   - a cliente perguntou: "Tudo bem por aqui?" vira "Tudo ótimo por aqui, e com você?" se não houver outra pergunta
//     na resposta, ou "Tudo ótimo por aqui 😊" se houver (uma pergunta por resposta, regra 10).
module.exports = ({ workflow: wf }) => {
  const q = wf.nodes.find((n) => n.name === 'Quebrar mensagens');
  if (!q) throw new Error('tudo-bem: sem o nó Quebrar mensagens');
  const DE = 'baloes = baloes.filter(b => b.t);';
  if (q.parameters.jsCode.split(DE).length < 2) throw new Error('tudo-bem: o "Quebrar mensagens" mudou');
  const BLOCO = `
// --- tudo-bem.js: "tudo bem?" só para devolver a quem perguntou (24/11/2026)
{
  const msgTb = (() => { try { return String($('Montar entrada').first().json.texto_cliente || ''); } catch (e) { return ''; } })();
  const perguntouTb = /tudo (bem|bom|certo|ok|tranquilo|joia)|td (bem|bom)|como (vai|voc[eê] (est[aá]|t[aá]))|como est[aá]/i.test(msgTb);
  const SOLTA = /(^|(?<=[.!?😊🥰💛✨]\\s))\\s*(e\\s+)?tudo (bem|bom)( por aqu[ií]| com voc[eê])?\\s*\\?\\s*(😊|🥰|💛|✨)?\\s*/giu;
  const outraPergunta = (txt) => (txt.replace(/tudo (bem|bom|[oó]timo) por aqu[ií]\\s*\\?/gi, '').match(/\\?/g) || []).length > 0;
  const todas = baloes.map((b) => b.t).join(' ');
  baloes = baloes.map((b) => {
    let t = b.t;
    if (!perguntouTb) t = t.replace(SOLTA, '$1');
    else t = t.replace(/tudo (bem|bom|[oó]timo) por aqu[ií]\\s*\\?/gi, () => (outraPergunta(todas) ? 'Tudo ótimo por aqui 😊' : 'Tudo ótimo por aqui, e com você?'));
    return { ...b, t: t.replace(/^\\s+/, '').trim() };
  });
}
`;
  q.parameters.jsCode = q.parameters.jsCode.replace(DE, () => BLOCO + DE);
};
