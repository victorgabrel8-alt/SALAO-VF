// Prompt modular da IA da Gleide (22/11/2026): um NÚCLEO curto que vale sempre + o BLOCO da situação da conversa.
// Motivo: o prompt único (prompt-agente.md, 83 mil letras) cresceu por remendo e as regras de um assunto vazavam para
// o outro (troca de método tratada como manutenção, promoção em toda resposta, pergunta técnica para iniciante).
//
// Como funciona:
//   1. um roteador (chamada pequena ao modelo) lê as últimas mensagens e diz de 1 a 3 situações;
//   2. o prompt da resposta = núcleo + blocos dessas situações + exemplos dessas situações + as partes de operação
//      (agenda, ferramentas, dados do salão), que continuam vindo de prompt-agente.md sem mudança.
// Por enquanto só o banco de testes usa isto (node testes/banco/rodar.js <rótulo> --novo). O fluxo no ar não mudou.

const fs = require('fs');
const path = require('path');
const AQUI = __dirname;
const ler = (f) => fs.readFileSync(path.join(AQUI, f), 'utf8').replace(/\r\n/g, '\n').trim();

const SITUACOES = {
  primeira_vez: 'nunca usou mega, ou ainda não dá para saber; quer conhecer, saber valor, alongar, dar volume',
  ja_usa: 'já usa mega e quer manutenção, recolocar o que já tem, ou arrumar/afinar uma tela',
  troca_metodo: 'já usa mega e quer TROCAR de método/técnica, ou está insatisfeita com o método que usa',
  cabelo: 'quer comprar cabelo ou peça (topo, rabo, aplique) e sabe o que pede: disse cor, comprimento ou peso, ou já usa mega',
  dinheiro: 'achou caro, vai pensar, vai se organizar, perguntou forma de pagamento ou parcelas, falou de anúncio ou promoção (só perguntar "quanto custa?" NÃO é esta situação)',
  de_fora: 'é de outra cidade, não consegue vir, perguntou de onde é o salão, ou quer que enviem o cabelo',
  agenda: 'quer marcar, escolheu horário, quer remarcar ou desmarcar, tem horário marcado, faltou, ou responde a um lembrete',
  delicado: 'queda de cabelo, saúde, medo de estragar o cabelo, experiência ruim em outro salão, reclamação',
  outro: 'mensagem enviada por engano ou assunto que não é do salão',
};

function secoes() {
  const md = fs.readFileSync(path.join(AQUI, '..', 'prompt-agente.md'), 'utf8').replace(/\r\n/g, '\n');
  const p = md.match(/```text\n([\s\S]*?)```/)[1];
  const s = {};
  for (const parte of p.split(/\n=+\n(?=\d\d \|)/).slice(1)) s[parte.slice(0, 2)] = parte.replace(/^([^\n]*)\n=+\n/, '$1\n').trim();
  return s;
}
const entre = (texto, de, ate) => { const i = texto.indexOf(de); if (i < 0) throw new Error('prompt-modular: não achei "' + de + '"'); const j = ate ? texto.indexOf(ate, i) : -1; return texto.slice(i, j < 0 ? undefined : j).trim(); };
const antes = (texto, ate) => { const j = texto.indexOf(ate); if (j < 0) throw new Error('prompt-modular: não achei "' + ate + '"'); return texto.slice(0, j).trim(); };

// exemplos da seção 11 do prompt antigo, por situação (número do exemplo → situações)
// (primeira_vez, dinheiro e troca_metodo têm exemplos próprios no bloco, já no jeito de consultora)
const EXEMPLOS = { de_fora: [4], delicado: [2, 6], ja_usa: [15], cabelo: [9], agenda: [5, 18, 11] };
// os exemplos antigos ensinavam a pedir concordância e a enfeitar a oferta: tira isso antes de mostrar ao modelo
const semVicio = (t) => t.replace(/,? né\?/g, '.').replace(/A boa notícia é que o /g, 'O ').replace(/\.\./g, '.');

function modeloModular(situacoes) {
  const s = secoes();
  const lista = [...new Set((situacoes || []).filter((x) => SITUACOES[x]))];
  if (!lista.length) lista.push('primeira_vez');
  const s05 = s['05'];
  const temCombinado = s05.includes('COMBINADO DO HORÁRIO');
  const blocos = {
    primeira_vez: () => ler('primeira-vez.md'),
    troca_metodo: () => ler('troca-de-metodo.md'),
    dinheiro: () => ler('dinheiro.md'),
    de_fora: () => ler('de-fora.md'),
    delicado: () => ler('delicado.md'),
    ja_usa: () => 'BLOCO DA SITUAÇÃO: JÁ USA MEGA E QUER MANUTENÇÃO, RECOLOCAR OU ARRUMAR TELA\n(Se ela quer TROCAR de método ou está insatisfeita com o método que usa, isto não vale: o caminho dela é a avaliação.)\n\n' +
      entre(s05, 'QUEM JÁ TEM O CABELO OU AS TELAS', temCombinado ? 'COMBINADO DO HORÁRIO' : null),
    cabelo: () => 'BLOCO DA SITUAÇÃO: COMPRA DE CABELO OU DE PEÇA (cotação com a Gleide)\n' +
      'ANTES DE TUDO: se ela já disse a cor, o comprimento e o peso (gramas), o pedido está completo: use pedir_orcamento_cabelo AGORA, nesta resposta, sem perguntar textura nem mais nada. Pergunta só existe quando falta cor ou comprimento.\n\n' + antes(s['04'].split('\n').slice(1).join('\n'), 'PAGAMENTOS CONFIRMADOS'),
    agenda: () => 'BLOCO DA SITUAÇÃO: CONVITE ACEITO, HORÁRIO, REMARCAR, FALTA\n\n' + entre(s05, 'DEPOIS DO CONVITE:', 'Quem quer só comprar cabelo'),
    outro: () => 'BLOCO DA SITUAÇÃO: MENSAGEM POR ENGANO OU FORA DO ASSUNTO\nSe a mensagem claramente era para outra pessoa, avise com leveza, em uma ou duas linhas, que ela caiu no WhatsApp do salão. Não se apresente longamente, não venda e não use ferramentas.',
  };
  const exemplos = [];
  const s11 = s['11'];
  for (const sit of lista) for (const n of EXEMPLOS[sit] || []) { const m = s11.match(new RegExp('\\n(' + n + '\\. [\\s\\S]*?)(?=\\n\\d+\\. [A-Z"]|$)')); if (m && !exemplos.includes(m[1].trim())) exemplos.push(m[1].trim()); }
  const operacao = [
    temCombinado ? 'AO MARCAR\n' + entre(s05, 'COMBINADO DO HORÁRIO') : '',
    'AGENDA\n' + s['06'].split('\n').slice(1).join('\n'),
    'DADOS DO SALÃO\n' + s['07'].split('\n').slice(1).join('\n'),
    'FERRAMENTAS\n' + s['09'].split('\n').slice(1).join('\n'),
    s['10'].split('\n').slice(1).join('\n'),
  ].filter(Boolean);
  const dinamico = s['17'].split('\n').slice(1).join('\n').replace(/\n?%%PROMOCAO_ATIVA%%/, '');
  const promo = require('../promo-natal.js').expressaoPrompt;
  const SEP = '\n\n====================================================================\n';
  return [
    ler('nucleo.md'),
    'SITUAÇÃO DESTA CONVERSA AGORA: ' + lista.join(', ') + '. Siga o(s) bloco(s) abaixo; onde um bloco e o núcleo disserem coisas diferentes, vale o bloco.',
    ...lista.map((x) => blocos[x]()),
    exemplos.length ? 'CONVERSAS REAIS DESTA SITUAÇÃO (aprenda o jeito, não copie as frases)\n\n' + semVicio(exemplos.slice(0, 4).join('\n\n')) : '',
    'OPERAÇÃO (como usar a agenda e as ferramentas; os números de seção citados aqui são de um texto antigo, ignore-os)\n\n' + operacao.join('\n\n'),
    'CONTEXTO DESTA MENSAGEM\n' + dinamico,
  ].filter(Boolean).join(SEP).replace('%%PROMOCAO_ATIVA%%', () => promo);
}

// pedido ao roteador: devolve o texto a mandar para o modelo (resposta esperada: JSON {"situacoes":[...]})
function pedidoRoteador(conversa, ficha) {
  return 'Você classifica conversas de WhatsApp de um salão de mega hair (alongamento de cabelo) em Sinop/MT. ' +
    'Leia a ficha e as últimas mensagens e diga em quais situações a conversa está AGORA, olhando principalmente a última mensagem da cliente. ' +
    'Escolha 1 ou 2 (só 3 se for mesmo necessário), da mais importante para a menos importante. Menos é melhor: cada situação a mais deixa a resposta mais longa.\n\nSITUAÇÕES:\n' +
    Object.entries(SITUACOES).map(([k, v]) => '- ' + k + ': ' + v).join('\n') +
    '\n\nREGRAS: quem não disse que já usa mega é primeira_vez. "troca_metodo" ganha de "ja_usa" quando ela quer mudar de método ou reclama do método que usa. ' +
    '"cabelo" é só para quem quer comprar e sabe o que pede; iniciante que pergunta "quanto custa o cabelo" é primeira_vez. ' +
    'Junte "dinheiro", "de_fora" ou "delicado" à situação principal quando aparecerem. "agenda" entra quando ela quer marcar, escolheu horário, tem horário marcado ou faltou.\n\n' +
    '=== FICHA ===\n' + (ficha || '(sem ficha)') + '\n\n=== ÚLTIMAS MENSAGENS ===\n' + conversa +
    '\n\nResponda só com JSON: {"situacoes":["..."]}';
}

module.exports = { SITUACOES, modeloModular, pedidoRoteador };
