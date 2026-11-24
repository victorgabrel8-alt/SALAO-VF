// Promoção de Natal e fim de ano da Gleide (campanha do Facebook, pedido do Victor em 21/11/2026; regra corrigida
// por ele em 22/11): quem vai COLOCAR o mega hair parcela TUDO (o cabelo e a colocação) em até 10x sem juros no cartão.
// Só fica de fora a MANUTENÇÃO de quem já usa mega. Compra só do cabelo: entra (interpretação minha de "é tudo incluso").
// Química e tratamento: o Victor não disse; a IA pergunta para a Gleide.
//
// Um lugar só para a regra: o prompt da IA (marcador %%PROMOCAO_ATIVA%% no prompt-agente.md, trocado no
// montar-workflow.js) e a mensagem que leva o valor do cabelo para a cliente (pedidos-workflows.js).
// Passou do último dia, a IA para de citar sozinha, sem novo deploy.
//
// Último dia: 26/11/2026 (o Victor confirmou a data em 21/11/2026).
// A IA não diz a data para a cliente: se perguntarem até quando vale, ela pergunta para a Gleide.

const ULTIMO_DIA = '2026-11-26'; // AAAA-MM-DD, horário de Cuiabá

const REGRA = 'PROMOÇÃO ATIVA AGORA — Natal e fim de ano: quem vai COLOCAR o mega hair parcela TUDO em até 10x sem juros no cartão de crédito: o cabelo e a colocação (mão de obra da aplicação). A compra do cabelo sozinha também entra. ' +
  'NÃO entra: a MANUTENÇÃO de quem já usa mega hair, que é paga no Pix ou no cartão (não fale de juros por conta própria). Química e tratamento não estão definidos na promoção: se perguntarem, use perguntar_para_gleide. ' +
  'Como e quando citar: parte 9, PROMOÇÃO.';
const SEM = 'PROMOÇÃO ATIVA AGORA: nenhuma. Não cite promoção nem parcelamento sem juros; se a cliente perguntar de uma promoção que viu em anúncio, diga que vai confirmar e use perguntar_para_gleide.';

// expressão do n8n, resolvida a cada mensagem (as frases não têm aspas simples nem chaves)
const expressaoPrompt = `{{ $now.setZone('America/Cuiaba').toFormat('yyyy-LL-dd') <= '${ULTIMO_DIA}' ? '${REGRA}' : '${SEM}' }}`;

// trecho de código para os nós Code do n8n: verdadeiro enquanto a promoção vale
const ativaJs = `(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Cuiaba' }) <= '${ULTIMO_DIA}')`;

if (/['{}]/.test(REGRA + SEM)) throw new Error('promo-natal.js: as frases não podem ter aspas simples nem chaves');

module.exports = { ULTIMO_DIA, REGRA, SEM, expressaoPrompt, ativaJs };
