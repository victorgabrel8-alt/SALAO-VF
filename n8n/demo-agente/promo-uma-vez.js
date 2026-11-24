// Promoção uma vez só e fato sem enfeite, garantidos no código (pedido do Victor, 24/11/2026).
// O prompt já mandava dizer os 10x uma vez por conversa e não comentar a vantagem, mas a IA repetia os 10x em
// respostas seguidas e colava "o que ajuda a caber no orçamento" depois do fato. No "Quebrar mensagens", antes do envio:
//   - se uma resposta do salão nas últimas 12 h já falou dos 10x, a frase com os 10x sai desta resposta
//     (a não ser que a cliente tenha perguntado agora de pagamento, parcela, cartão, juros ou promoção);
//   - na mesma resposta, os 10x ficam só na primeira frase que fala deles;
//   - o comentário de vantagem colado no fim de uma frase (", o que ajuda...", ", o que facilita...") é cortado.
// A frase cortada é só a que fala dos 10x; o resto do balão (inclusive a pergunta) fica.
module.exports = ({ workflow: wf }) => {
  const q = wf.nodes.find((n) => n.name === 'Quebrar mensagens');
  if (!q) throw new Error('promo-uma-vez: sem o nó Quebrar mensagens');
  if (!wf.nodes.find((n) => n.name === 'Supabase: últimas mensagens')) throw new Error('promo-uma-vez: sem o nó Supabase: últimas mensagens');
  const DE = 'baloes = baloes.filter(b => b.t);';
  if (q.parameters.jsCode.split(DE).length < 2) throw new Error('promo-uma-vez: o "Quebrar mensagens" mudou');
  const BLOCO = `
// --- promo-uma-vez.js: 10x uma vez por conversa e sem comentário de vantagem (24/11/2026)
{
  const DEZ = /\\b10\\s?x\\b/i;
  const pediu = (() => { try { return /(parcel|cart[aã]o|juros|promo|pagament|pagar|10\\s?x|dividir)/i.test(String($('Montar entrada').first().json.texto_cliente || '')); } catch (e) { return false; } })();
  let jaDisse = (() => { try { return $('Supabase: últimas mensagens').all().some((i) => i.json && i.json.direcao === 'saida' && DEZ.test(String(i.json.conteudo || ''))); } catch (e) { return false; } })();
  if (pediu) jaDisse = false;
  const VANTAGEM = /,?\\s+(o que|que isso|isso) (ajuda|facilita|deixa (tudo )?mais f[aá]cil)[^.!?\\n]*/gi;
  baloes = baloes.map((b) => {
    const pars = b.t.split(/\\n{2,}/).map((p) => {
      const frases = p.split(/(?<=[.!?])\\s+/);
      const fica = frases.filter((f) => { if (!DEZ.test(f)) return true; if (jaDisse) return false; jaDisse = true; return true; });
      return fica.join(' ').replace(VANTAGEM, '').trim();
    }).filter(Boolean);
    return { ...b, t: pars.join('\\n\\n').trim() };
  });
}
`;
  q.parameters.jsCode = q.parameters.jsCode.replace(DE, () => BLOCO + DE);
};
