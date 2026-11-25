// Consertos da assistente da Caroline a partir da conversa de 25/11/2026 (pedido do Victor: "faz todos").
// Roda o código gerado para a Caroline (lojas/carol/*.json) com os casos reais do dia. Rodar: node --test testes/
const test = require('node:test');
const assert = require('node:assert');

const assistente = require('../lojas/carol/workflow-assistente.json');
const codigo = (wf, nome) => {
  const n = wf.nodes.find((x) => x.name === nome);
  if (!n) throw new Error('não achei o nó ' + nome);
  return n.parameters.jsCode;
};
const no = (itens) => ({ first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })) });

// ---------- 3. pergunta numerada sai da lista quando a assistente mexe no horário da cliente ----------
const ok = (obj, resto = '') => JSON.stringify([{ resposta: 'OK: ' + JSON.stringify(obj) + resto }]);
const PEDIDOS = {
  'carol:pedido:3EB0AAA': JSON.stringify({ telefone: '5566999845384', nome: 'Rebeca', pergunta: 'Pode incluir esmaltação em gel no pé dia 03/12 às 14h30?', num: 14 }),
  'carol:pedido:3EB0BBB': JSON.stringify({ telefone: '5566996213521', nome: 'Gabriella Marçal', pergunta: 'Gabriella não vem sábado 14h por causa de confra. Remarco?', num: 15 }),
  'carol:pedido:contador': '15',
};
const respondidos = (passos) => {
  const dados = { 'Agente assistente': [{ intermediateSteps: passos }], 'Ler pedidos abertos': [PEDIDOS] };
  const $ = (nome) => no(dados[nome]);
  return new Function('$', codigo(assistente, 'Pedidos respondidos'))($).map((x) => x.json.chave);
};

test('Rebeca #14: reagendar e ajustar o horário dela fecha a pergunta (sem mandar mensagem)', () => {
  const passos = [
    { action: { tool: 'agenda_do_dia', toolInput: { data: '2026-12-03' } }, observation: ok([{ nome: 'Rebeca', tel_final: '5384', cliente_id: 'c-rebeca', agendamento_id: 'a-rebeca' }]) },
    { action: { tool: 'reagendar', toolInput: { cliente_nome: 'Rebeca', agendamento_id: 'a-rebeca' } }, observation: ok({ nome: 'Rebeca', tel_final: '5384', agendamento_id: 'a-rebeca' }, '\n\nGOOGLE AGENDA DA DONA ...') },
    { action: { tool: 'anotar', toolInput: { cliente_id: 'c-rebeca', texto: 'Incluir o pé' } }, observation: ok({ cliente_id: 'c-rebeca' }) },
  ];
  assert.deepStrictEqual(respondidos(passos), ['carol:pedido:3EB0AAA']);
});

test('só anotar na ficha (com a cliente vista antes na conversa) também fecha', () => {
  const passos = [
    { action: { tool: 'buscar_cliente', toolInput: { busca: 'Rebeca' } }, observation: ok([{ nome: 'Rebeca', telefone: '5566999845384', cliente_id: 'c-rebeca' }]) },
    { action: { tool: 'anotar', toolInput: { cliente_id: 'c-rebeca', texto: 'x' } }, observation: ok({ cliente_id: 'c-rebeca' }) },
  ];
  assert.deepStrictEqual(respondidos(passos), ['carol:pedido:3EB0AAA']);
});

test('mensagem à cliente continua fechando, como antes', () => {
  const passos = [{ action: { tool: 'chamar_cliente', toolInput: {} }, observation: JSON.stringify([{ resposta: 'OK: mensagem enviada para a cliente (tel. 5566996213521): Oi' }]) }];
  assert.deepStrictEqual(respondidos(passos), ['carol:pedido:3EB0BBB']);
});

test('só consultar a agenda, ferramenta com erro ou outra cliente com o mesmo final não fecham', () => {
  assert.deepStrictEqual(respondidos([{ action: { tool: 'agenda_do_dia', toolInput: {} }, observation: ok([{ nome: 'Rebeca', tel_final: '5384' }]) }]), []);
  assert.deepStrictEqual(respondidos([{ action: { tool: 'reagendar', toolInput: {} }, observation: JSON.stringify([{ resposta: 'ERRO: 400 ...' }]) }]), []);
  assert.deepStrictEqual(respondidos([{ action: { tool: 'reagendar', toolInput: {} }, observation: ok({ nome: 'Paula', tel_final: '5384' }) }]), []);
});

// ---------- 4 e 5. o que sai para a cliente (Envio: conferir) ----------
let DateTime;
try { ({ DateTime } = require('luxon')); } catch (e) { test('envio (sem o luxon)', { skip: 'sem o luxon' }, () => {}); }
const ferramentas = require('../lojas/carol/workflow-assistente-ferramentas.json');
const enviar = (mensagem, conversa = []) => {
  const agora = DateTime.now();
  const dados = {
    'Executar no banco': [{ data: JSON.stringify({ mensagem, telefone: '5566999187078' }) }],
    'Envio: conversa da cliente': conversa.map(([min, direcao, conteudo]) => ({ criado_em: agora.minus({ minutes: min }).toISO(), direcao, conteudo })),
    'Envio: horários da cliente': [],
  };
  const $ = (nome) => no(dados[nome] || []);
  return new Function('$', 'DateTime', codigo(ferramentas, 'Envio: conferir'))($, DateTime)[0].json.bloqueio;
};
const OFERTA_10H = 'Oi Cintia! A Carol viu aqui que consegue te atender nesta quinta-feira às 17:00. Esse horário fica bom para você?';

test('Cintia: mensagem com horários novos (sexta 13h e 13h30) sai, mesmo repetindo quinta 17h', { skip: !DateTime }, () => {
  const b = enviar('Olá, Cintia! Na sexta temos 13:00 ou 13:30. Na quinta, às 17:00, a Caroline consegue atendê-la. Qual prefere?', [[2, 'saida', OFERTA_10H]]);
  assert.strictEqual(b, '');
});

test('a mesma oferta de novo em poucos minutos não sai, e o aviso à Caroline começa por uma frase inteira', { skip: !DateTime }, () => {
  const b = enviar('Oi Cintia! A Carol consegue te atender nesta quinta-feira às 17:00. Fica bom para você?', [[2, 'saida', OFERTA_10H]]);
  assert.match(b, /^NÃO ENVIADO \(nada chegou à cliente\): ela recebeu uma mensagem quase igual às \d\d:\d\d\. Foi esta: «/);
});

test('texto que fala como se fosse a Caroline ou conta o assunto dela não sai', { skip: !DateTime }, () => {
  for (const t of ['Oi Cintia! Para sexta no final da tarde não vou conseguir por causa da minha prova, só tenho 13:00.',
    'Olá, Ana! A Caroline tem uma consulta no médico na sexta, podemos remarcar?', 'Olá, Ana! Por causa da prova, sexta não dá.'])
    assert.match(enviar(t), /fala como se fosse a Caroline ou conta um assunto dela/, t);
});

test('o jeito certo sai: motivo pessoal, formal; e assunto da cliente não é barrado', { skip: !DateTime }, () => {
  assert.strictEqual(enviar('Olá, Gabriela! Tudo bem? A Caroline não poderá atender sábado às 14:00 por um motivo pessoal. Podemos remarcar?'), '');
  assert.strictEqual(enviar('Olá, Ana! Para o seu casamento, temos sábado às 10:00. Podemos reservar para você?'), '');
});

// ---------- pendências de 24/11: resposta que era só o registro interno, e "mandei" sem ter mandado ----------
const conferir = (output, passos = []) => {
  const dados = { 'Agente assistente': [{ output, intermediateSteps: passos }], Contexto: [{ lista: [] }] };
  return new Function('$', codigo(assistente, 'Conferir resposta'))((nome) => no(dados[nome] || []))[0].json.texto;
};

test('resposta que era só o registro interno diz o que foi feito, não "Certo."', () => {
  const passos = [
    { action: { tool: 'reagendar', toolInput: { cliente_nome: 'Giovanna Donatelli' } }, observation: ok({ nome: 'Giovanna Donatelli' }) },
    { action: { tool: 'avisar_cliente', toolInput: { cliente_nome: 'Giovanna Donatelli' } }, observation: JSON.stringify([{ resposta: 'OK: mensagem enviada para a cliente (tel. 5527992681944): Olá' }]) },
  ];
  assert.strictEqual(conferir('O QUE VOCÊ JÁ FEZ:\n- reagendar Giovanna', passos), 'Remarquei *Giovanna*, Avisei *Giovanna* ✅');
});

test('"mandei" sem ter chamado o envio pergunta se manda agora, sem pedir para repetir', () => {
  assert.strictEqual(conferir('Mandei pra *Cintia* ✅'), '⚠️ Ainda não mandei nada pra ela. Quer que eu mande agora?');
});

module.exports = { codigo, no, ok };
