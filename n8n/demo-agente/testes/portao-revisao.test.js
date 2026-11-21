// Testes do Portão de ações, revisão de 21/11/2026 (casos achados pelo testador). Rodar: node --test "n8n/demo-agente/testes/**/*.test.js"
const test = require('node:test');
const assert = require('node:assert');
const { conferirAcoes } = require('../portao-regras.js');

const tipos = (r) => r.acoes.flatMap((a) => a.falhas.map((f) => f.tipo)).sort();
const ass = (fala, ...passos) => conferirAcoes({ agente: 'assistente', fala, passos });
const atd = (fala, ficha, ...passos) => conferirAcoes({ agente: 'atendimento', fala, ficha, passos });
const passo = (ferramenta, entrada, resultado = 'OK: feito') => ({ ferramenta, entrada, resultado });
const vazio = (r, msg) => assert.deepStrictEqual(tipos(r), [], msg);
const APL = { servico: 'Aplicação de mega hair – mão de obra' };

test('cliente nova que fala "meu cabelo" não é cabelo da cliente', () => {
  for (const f of ['Quero alongar meu cabelo!', 'meu cabelo e curto e fino, quero colocar mega', 'meu cabelo ta caindo muito, quero colocar mega'])
    vazio(atd(f, '', passo('criar_agendamento', APL, 'AGENDADO')), f);
  vazio(atd('ja uso mega mas quero comprar cabelo novo, 100g', '', passo('criar_agendamento', APL, 'AGENDADO')));
});

test('cliente que já tem o cabelo, dito de outros jeitos, é apontada', () => {
  for (const f of ['tenho o cabelo ja, quero colocar', 'comprei o cabelo na internet, quero colocar'])
    assert.deepStrictEqual(tipos(atd(f, '', passo('criar_agendamento', APL, 'AGENDADO'))), ['aplicacao_com_cabelo_da_cliente'], f);
  assert.deepStrictEqual(tipos(atd('quero marcar', 'Usa mega há 2 anos', passo('criar_agendamento', APL, 'AGENDADO'))), ['aplicacao_com_cabelo_da_cliente']);
});

test('a Gleide falando do cabelo da cliente em terceira pessoa', () => {
  for (const f of ['ela volta sexta 13h pra colocar o cabelo dela', 'ela ja tem o cabelo, volta sexta as 13', 'ela vai trazer o cabelo sexta 13h', 'vai reaproveitar o cabelo, sexta 13h'])
    assert.ok(tipos(ass(f, passo('marcar_horario', { servico: 'aplicação', cabelo_novo: 'sim', inicio: '2026-11-27T13:00' }))).includes('aplicacao_com_cabelo_da_cliente'), f);
});

test('"sim", "pode", "isso" confirmam o que a IA perguntou', () => {
  for (const f of ['sim', 'pode', 'pode sim', 'isso', 'ok envia', 'Sim!', '[1] sim']) {
    vazio(ass(f, passo('excluir_horario', { agendamento_id: 'x' })), f);
    vazio(ass(f, passo('chamar_cliente', { cliente_id: 'x', texto: 'Oi' })), f);
    vazio(ass(f, passo('liberar_horario', { agendamento_id: 'x' })), f);
    vazio(atd(f, '', passo('cancelar_agendamento', {}, 'CANCELADO')), f);
  }
  vazio(ass('350', passo('concluir', { agendamento_id: 'x', valor: '350' })));
});

test('cancelamento com o sinal pediuCancelar passa', () => {
  vazio(conferirAcoes({ agente: 'atendimento', fala: 'ta bom', pediuCancelar: true, passos: [passo('cancelar_agendamento', {}, 'CANCELADO')] }));
});

test('cabelo novo precisa de prova de verdade (não "de novo", "nova", "chegou", "comprimento")', () => {
  for (const f of ['marca ela de novo sexta 13h', 'a cliente nova volta sexta 13h', 'a ana chegou, volta sexta 13h', 'qual o comprimento? sexta 13h'])
    assert.deepStrictEqual(tipos(ass(f, passo('marcar_horario', { servico: 'aplicação', cabelo_novo: 'sim', inicio: '2026-11-27T13:00' }))), ['cabelo_novo_sem_prova'], f);
  vazio(ass('ela comprou o cabelo, 100g, volta sexta 13h', passo('marcar_horario', { servico: 'aplicação', cabelo_novo: 'sim', inicio: '2026-11-27T13:00' })));
});

test('número solto não prova hora nem valor', () => {
  assert.deepStrictEqual(tipos(ass('[1] marca a ana\n[2] manutenção sexta', passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-27T13:00' }))), ['hora_sem_prova']);
  assert.deepStrictEqual(tipos(ass('marca a ana dia 13 manutenção', passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-27T13:00' }))), ['hora_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a ana fez dia 13', passo('concluir', { agendamento_id: 'x', valor: '350' }))), ['valor_sem_prova']);
});

test('hora e valor ditos de outros jeitos passam', () => {
  const m = (f, h) => vazio(ass(f, passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-27T' + h })), f);
  m('marca ela duas da tarde', '14:00'); m('oito horas da manha, manutenção', '08:00'); m('2 e meia', '14:30');
  m('as 14 ta bom', '14:00'); m('pode ser no mesmo horario', '15:00'); m('umas 9 da manha', '09:00');
  const v = (f, valor) => vazio(ass(f, passo('concluir', { agendamento_id: 'x', valor })), f);
  v('fez, ficou mil e duzentos', '1200'); v('fez, pagou 99,90', '99.90'); v('fez, 300 + 50 do cabelo', '350'); v('fez, ficou 2,8k', '2800');
});

test('negação não prova', () => {
  assert.deepStrictEqual(tipos(ass('a ana nao veio', passo('concluir', { agendamento_id: 'x' }))), ['concluir_sem_prova']);
  assert.deepStrictEqual(tipos(ass('ainda nao terminei a ana', passo('concluir', { agendamento_id: 'x' }))), ['concluir_sem_prova']);
  assert.deepStrictEqual(tipos(ass('a ana nao fechou', passo('resultado_avaliacao', { resultado: 'fechou' }))), ['fechou_sem_prova']);
  assert.deepStrictEqual(tipos(ass('nao tira a ana', passo('excluir_horario', { agendamento_id: 'x' }))), ['excluir_sem_prova']);
  assert.deepStrictEqual(tipos(ass('nao manda nada pra ela', passo('chamar_cliente', { cliente_id: 'x', texto: 'Oi' }))), ['envio_sem_pedido']);
  assert.deepStrictEqual(tipos(atd('nao vou faltar nao, to indo', '', passo('cancelar_agendamento', {}, 'CANCELADO'))), ['cancelar_sem_prova']);
  assert.deepStrictEqual(tipos(atd('nao da pra ir mais cedo?', '', passo('cancelar_agendamento', {}, 'CANCELADO'))), ['cancelar_sem_prova']);
});

test('jeitos comuns de falar passam', () => {
  vazio(ass('ja ta pronta a ana', passo('concluir', { agendamento_id: 'x' })));
  vazio(ass('da baixa na ana', passo('concluir', { agendamento_id: 'x' })));
  for (const f of ['libera o horario da ana', 'n veio', 'nem veio a ana', 'não compareceu', 'deu bolo'])
    vazio(ass(f, passo('liberar_horario', { agendamento_id: 'x' })), f);
  for (const f of ['bateu o martelo', 'pagou o sinal', 'ela quer fazer'])
    vazio(ass(f, passo('resultado_avaliacao', { resultado: 'fechou' })), f);
  for (const f of ['nao tem dinheiro agora', 'achou muito'])
    vazio(ass(f, passo('resultado_avaliacao', { resultado: 'nao_fechou' })), f);
  for (const f of ['n vou poder ir', 'nao vai rolar amanha', 'surgiu um imprevisto', 'pode tirar meu horario', 'fiquei doente'])
    vazio(atd(f, '', passo('cancelar_agendamento', {}, 'CANCELADO')), f);
});

test('status realizado sem prova e concluir com cabelo da cliente são apontados', () => {
  assert.deepStrictEqual(tipos(ass('a ana nao veio', passo('status_atendimento', { agendamento_id: 'x', status: 'realizado' }))), ['concluir_sem_prova']);
  assert.ok(tipos(ass('a renata veio, recoloquei o cabelo dela', passo('concluir', { agendamento_id: 'x' }))).includes('concluir_com_cabelo_da_cliente'));
});

test('erro em objeto não conta como gravado; entrada fica como objeto', () => {
  const r = ass('a ana nao veio', passo('concluir', { agendamento_id: 'x' }, { erro: 'não achei' }));
  assert.strictEqual(r.acoes[0].gravou, false);
  const r2 = ass('fez a ana', passo('concluir', { agendamento_id: 'x', valor: '350' }));
  assert.strictEqual(typeof r2.acoes[0].entrada, 'object');
  assert.strictEqual(r2.acoes[0].entrada.agendamento_id, 'x');
});
