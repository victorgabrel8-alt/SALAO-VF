// Promoção de Natal e fim de ano da Gleide (campanha do Facebook, pedido do Victor em 21/11/2026):
// o CABELO do mega hair comprado no salão pode ser parcelado em até 10x sem juros no cartão.
// Só a compra do cabelo. Colocação (mão de obra), manutenção, química e os outros serviços NÃO entram.
//
// Um lugar só para a regra: o prompt da IA (marcador %%PROMOCAO_ATIVA%% no prompt-agente.md, trocado no
// montar-workflow.js) e a mensagem que leva o valor do cabelo para a cliente (pedidos-workflows.js).
// Passou do último dia, a IA para de citar sozinha, sem novo deploy.
//
// Último dia: 26/11/2026 (o Victor confirmou a data em 21/11/2026).
// A IA não diz a data para a cliente: se perguntarem até quando vale, ela pergunta para a Gleide.

const ULTIMO_DIA = '2026-11-26'; // AAAA-MM-DD, horário de Cuiabá

const REGRA = 'PROMOÇÃO ATIVA AGORA — Natal e fim de ano: o CABELO do mega hair comprado no salão pode ser parcelado em até 10x sem juros no cartão de crédito. ' +
  'Vale SÓ para a compra do cabelo. NÃO entra: a colocação (mão de obra da aplicação), a manutenção, as químicas, os tratamentos e qualquer outro serviço; esses continuam no Pix ou no cartão com os juros da maquininha. ' +
  'Como e quando citar: seção 04, PROMOÇÃO DE 10X SEM JUROS.';
const SEM = 'PROMOÇÃO ATIVA AGORA: nenhuma. Não cite promoção nem parcelamento sem juros; se a cliente perguntar de uma promoção que viu em anúncio, diga que vai confirmar e use perguntar_para_gleide.';

// expressão do n8n, resolvida a cada mensagem (as frases não têm aspas simples nem chaves)
const expressaoPrompt = `{{ $now.setZone('America/Cuiaba').toFormat('yyyy-LL-dd') <= '${ULTIMO_DIA}' ? '${REGRA}' : '${SEM}' }}`;

// trecho de código para os nós Code do n8n: verdadeiro enquanto a promoção vale
const ativaJs = `(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Cuiaba' }) <= '${ULTIMO_DIA}')`;

if (/['{}]/.test(REGRA + SEM)) throw new Error('promo-natal.js: as frases não podem ter aspas simples nem chaves');

module.exports = { ULTIMO_DIA, REGRA, SEM, expressaoPrompt, ativaJs };
