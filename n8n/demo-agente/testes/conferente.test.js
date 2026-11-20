// Testes do Conferente (conferente-regras.js). Rodar: node --test n8n/demo-agente/testes/
// Casos tirados dos erros reais do Vigia (13 a 20/11, Caroline) e de respostas boas que NÃO podem ser barradas.
const test = require('node:test');
const assert = require('node:assert');
const { conferir } = require('../conferente-regras.js');

const CHAVE = '1a2b3c4d-0000-4000-8000-123456789abc';
const servicos = [
  { nome: 'Manicure', preco: 50 }, { nome: 'Pedicure', preco: 60 }, { nome: 'Manicure e pedicure', preco: 110 },
  { nome: 'Esmaltação em gel', preco: 100 }, { nome: 'Alongamento molde F1 – aplicação', preco: 260 },
  { nome: 'Remoção de alongamento', preco: 40 }, { nome: 'Reposição ou reconstrução (cada unha)', preco: 25 },
];
const config = {
  endereco: 'Rua dos Angicos, 690, Jardim Imperial, Sinop-MT',
  loja: { mapa: 'https://maps.app.goo.gl/c6ebcioXXTL2DTYRA', sinal_pix: { valor: 20, chave: CHAVE } },
  horario_funcionamento: { seg: '08:00-18:00', sab: '08:00-14:00' },
};
const agora = Date.parse('2026-11-20T14:00:00-04:00');
const min = (m) => new Date(agora - m * 60000).toISOString();
const base = (extra) => ({ servicos, config, agora, passos: [], anteriores: [], ficha: '', ...extra });
const tipos = (r) => r.falhas.map((f) => f.tipo).sort();

test('resposta boa com preço da lista passa', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'A manicure fica R$ 50' }))), []);
});

test('soma de dois serviços e o que falta pagar depois do sinal passam', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'A remoção fica R$ 40 e o alongamento R$ 260, total R$ 300. No dia você paga R$ 280' }))), []);
});

test('preço inventado é barrado', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'O pé e mão fica R$ 33' }))), ['preco']);
});

test('valor que a dona escreveu na conversa passa', () => {
  const anteriores = [{ direcao: 'saida', autor: 'dona', conteudo: 'pode fazer por 80 reais', criado_em: min(20) }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'A Caroline disse que faz por R$ 80', anteriores }))), []);
});

test('"Reservei" sem a ferramenta confirmar é barrado', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Reservei pra você sábado às 8h 🙏', anteriores: [{ direcao: 'saida', autor: 'ia', conteudo: 'Tenho sábado às 8h', criado_em: min(5) }] }))), ['promessa']);
});

test('"Reservei" com AGENDADO passa', () => {
  const passos = [{ ferramenta: 'criar_agendamento', resultado: 'AGENDADO com sucesso: sábado, 21/11 às 08:00' }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Reservei pra você sábado às 8h 🙏', passos }))), []);
});

test('"Agendado" com NÃO AGENDADO é barrado', () => {
  const passos = [{ ferramenta: 'criar_agendamento', resultado: 'NÃO AGENDADO: ainda não chegou a foto do comprovante' }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Agendado 🙏 te espero sábado às 8h', passos, ficha: 'sábado 8h' }))), ['promessa']);
});

test('remarquei sem REMARCADO é barrado', () => {
  assert.ok(tipos(conferir(base({ texto: 'Remarquei pra quinta' }))).includes('promessa'));
});

test('horário da consulta passa; horário inventado é barrado', () => {
  const passos = [{ ferramenta: 'consultar_horarios_livres', resultado: 'OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: 9h (data_hora_inicio: 2026-11-21T09:00) ou 14h30 (data_hora_inicio: 2026-11-21T14:30)' }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Tenho sábado às 9h ou às 14h30', passos }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Tenho sábado às 10h', passos }))), ['horario']);
});

test('horário dentro de uma faixa livre do quadro passa', () => {
  const passos = [{ ferramenta: 'consultar_horarios_livres', resultado: 'Manhã (8h às 12h): livre das 9h às 11h.' }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Pode ser às 10h30?', passos }))), []);
});

test('duração não é confundida com horário', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'O alongamento leva 1h30 e o lembrete vai 2 horas antes' }))), []);
});

test('nome de outra loja é barrado', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Vou ver com a Gle' + 'ide e te falo' }))), ['outra_loja']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Fazemos mega hair também' }))), ['outra_loja']);
});

test('mensagem repetida em 30 min é barrada; depois de 30 min passa', () => {
  const msg = 'Pra garantir o horário é um sinal de R$ 20 no Pix';
  assert.deepStrictEqual(tipos(conferir(base({ texto: msg, anteriores: [{ direcao: 'saida', autor: 'ia', conteudo: msg, criado_em: min(10) }] }))), ['repetida']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: msg, anteriores: [{ direcao: 'saida', autor: 'ia', conteudo: msg, criado_em: min(45) }] }))), []);
});

test('chave Pix repetida em 30 min é barrada', () => {
  const r = conferir(base({ texto: CHAVE, anteriores: [{ direcao: 'saida', autor: 'ia', conteudo: CHAVE, criado_em: min(8) }] }));
  assert.deepStrictEqual(tipos(r), ['pix']);
});

test('chave Pix grudada em texto é barrada; sozinha na linha passa', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'A chave é ' + CHAVE + ' me manda o print' }))), ['pix']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Segue a chave\n' + CHAVE + '\nMe manda o print do comprovante' }))), []);
});

test('endereço do cadastro passa; endereço inventado é barrado', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Fica na Rua dos Angicos, 690, Jardim Imperial\nhttps://maps.app.goo.gl/c6ebcioXXTL2DTYRA' }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Fica na Rua das Orquídeas, 123' }))), ['endereco']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Rua dos Angicos 690 https://maps.app.goo.gl/XXXXXXX' }))), ['endereco']);
});

test('sobra de sistema é barrada; marcadores de balão não', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'A manicure fica R$ [preço da lista]' }))), ['sistema']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Vou usar o perguntar_para_dona' }))), ['sistema']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: '[1] Oi bom dia\n[2] Tenho sim' }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: '[[NAO_ENVIAR]]' }))), []);
});

test('palavras comuns não viram falha (indisponível, perguntado)', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Esse horário ficou indisponível, já tinha perguntado pra Caroline' }))), []);
});

test('resposta vazia passa', () => {
  assert.deepStrictEqual(conferir(base({ texto: '' })), { ok: true, falhas: [] });
});
