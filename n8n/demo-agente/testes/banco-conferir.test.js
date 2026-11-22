// Conferências automáticas do banco de testes (testes/banco/conferir.js)
const test = require('node:test');
const assert = require('node:assert');
const { conferir, nota, passou, perguntas } = require('./banco/conferir.js');

const ctx = (ferramentas = []) => ({ precosDaTabela: [150, 200, 500], ferramentas });
const regras = (f) => f.map((x) => x.regra);
const BOA = ['Oi, Maria! Tudo bem? 😊 A mão de obra é R$ 150 por tela e o cabelo é à parte.', 'Me conta, como seu cabelo tá hoje?'];

test('resposta boa não tem falha', () => {
  assert.deepStrictEqual(conferir(BOA, {}, ctx()), []);
});

test('"tudo bem?" e "né?" não contam como pergunta', () => {
  assert.strictEqual(perguntas('Oi! Tudo bem? Cabelo comprido é uma delícia, né? Como ele tá hoje?'), 1);
  assert.ok(regras(conferir(['Você quer alongar? E já usou mega antes?'], {}, ctx())).includes('mais de uma pergunta'));
  assert.deepStrictEqual(conferir(['Você quer alongar? E já usou mega antes?'], { permite: ['duas_perguntas'] }, ctx()), []);
});

test('sinal e valor fora da tabela são falha grave', () => {
  const f = conferir(['Pra garantir o horário peço um sinal de R$ 20.'], {}, ctx());
  assert.ok(f.some((x) => x.regra === 'falou de sinal ou cobrança' && x.grave));
  assert.ok(conferir(['O cabelo de 60 cm fica uns R$ 1.800.'], {}, ctx()).some((x) => x.regra === 'valor fora da tabela do app' && x.grave));
  assert.ok(!regras(conferir(['Como você faltou, o sinal é de R$ 20.'], { permite: ['sinal'], valores_permitidos: [20] }, ctx())).includes('falou de sinal ou cobrança'));
});

test('ferramenta exigida e proibida', () => {
  assert.ok(regras(conferir(BOA, { ferramenta_deve: ['perguntar_para_gleide'] }, ctx())).includes('não usou perguntar_para_gleide'));
  assert.deepStrictEqual(conferir(BOA, { ferramenta_deve: ['perguntar_para_gleide'] }, ctx(['perguntar_para_gleide'])), []);
  assert.ok(regras(conferir(BOA, { ferramenta_nao: ['criar_agendamento'] }, ctx(['criar_agendamento']))).includes('usou criar_agendamento sem dever'));
});

test('palavra proibida, balão longo, emoji em assunto delicado e resposta vazia', () => {
  assert.ok(regras(conferir(['Seu cabelo vai ficar perfeito!'], {}, ctx())).some((r) => r.startsWith('palavra proibida')));
  assert.ok(regras(conferir([Array(60).fill('palavra').join(' ')], {}, ctx())).includes('balão longo'));
  assert.ok(regras(conferir(['Entendo demais 💛'], { sem_emoji: true }, ctx())).includes('emoji em assunto delicado'));
  assert.ok(conferir([], {}, ctx())[0].grave);
});

test('nota: juiz cheio dá 10, falha leve tira 1, falha grave limita a 4', () => {
  const cheio = { calor: 2, responde: 2, conduz: 2, especifica: 2, fiel: 2, esperado: 2 };
  assert.strictEqual(nota(cheio, []), 10);
  assert.strictEqual(nota(cheio, [{ regra: 'x', grave: false }]), 9);
  assert.strictEqual(nota(cheio, [{ regra: 'x', grave: true }]), 4);
  assert.strictEqual(passou(10, cheio, []), true);
  assert.strictEqual(passou(9, { ...cheio, esperado: 0 }, []), false);
});
