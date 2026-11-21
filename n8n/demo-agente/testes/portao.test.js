// Testes do Portão de ações (portao-regras.js). Rodar: node --test "n8n/demo-agente/testes/**/*.test.js"
// Casos tirados dos erros reais da Gleide (11 a 18/11/2026) e de ações certas que NÃO podem ser apontadas.
const test = require('node:test');
const assert = require('node:assert');
const { conferirAcoes } = require('../portao-regras.js');

const tipos = (r) => r.acoes.flatMap((a) => a.falhas.map((f) => f.tipo)).sort();
const ass = (fala, ...passos) => conferirAcoes({ agente: 'assistente', fala, passos });
const atd = (fala, ficha, ...passos) => conferirAcoes({ agente: 'atendimento', fala, ficha, passos });
const passo = (ferramenta, entrada, resultado = 'OK: feito') => ({ ferramenta, entrada, resultado });

// ---------- erros reais ----------
test('Renata 11/11: fechou como aplicação o cabelo dela que caiu', () => {
  const r = ass('a Renata veio, os cabelos dela cairam, ela volta sexta 13h pra recolocar',
    passo('resultado_avaliacao', { resultado: 'fechou', proximo_passo: 'Aplicação marcada para 13/11 às 13:00' }),
    passo('marcar_horario', { servico: 'aplicação', inicio: '2026-11-13T13:00' }));
  assert.ok(tipos(r).includes('aplicacao_com_cabelo_da_cliente'));
  assert.ok(tipos(r).includes('aplicacao_sem_cabelo_novo'));
});

test('Dienne 16/11 (atendimento): "pra colocar meu cabelo" virou aplicação', () => {
  const r = atd('1200\npra colocar meu cabelo', 'Já usa mega hair e quer mudar a metodologia para fita adesiva.',
    passo('criar_agendamento', { servico: 'Aplicação de mega hair – mão de obra', data_hora_inicio: '2026-11-18T13:00' }, 'AGENDADO'));
  assert.deepStrictEqual(tipos(r), ['aplicacao_com_cabelo_da_cliente']);
});

test('valor que ninguém disse é apontado', () => {
  const r = ass('a Adriana fez a manutenção', passo('concluir', { agendamento_id: 'x', valor: '350' }));
  assert.deepStrictEqual(tipos(r), ['valor_sem_prova']);
});

test('mensagem para cliente sem a dona pedir', () => {
  const r = ass('a Ana desmarcou ontem', passo('chamar_cliente', { cliente_id: 'x', texto: 'Oi Ana!' }));
  assert.deepStrictEqual(tipos(r), ['envio_sem_pedido']);
});

test('falta sem a dona dizer que faltou', () => {
  const r = ass('a das 13h tá atrasada', passo('liberar_horario', { agendamento_id: 'x' }));
  assert.deepStrictEqual(tipos(r), ['falta_sem_prova']);
});

test('hora que ninguém disse', () => {
  const r = ass('marca a Bia sexta de manhã pra manutenção', passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-27T09:00' }));
  assert.deepStrictEqual(tipos(r), ['hora_sem_prova']);
});

test('cabelo_novo = sim sem a fala dizer cabelo novo', () => {
  const r = ass('marca a Vitória sexta às 8 pra colocar o mega', passo('marcar_horario', { servico: 'aplicação', cabelo_novo: 'sim', inicio: '2026-11-13T08:00' }));
  assert.deepStrictEqual(tipos(r), ['cabelo_novo_sem_prova']);
});

test('cliente pede outra coisa e a IA cancela o horário', () => {
  const r = atd('dá pra ir mais cedo?', '', passo('cancelar_agendamento', { data_hora_inicio: '2026-11-27T13:00' }, 'CANCELADO'));
  assert.deepStrictEqual(tipos(r), ['cancelar_sem_prova']);
});

// ---------- ações certas: não podem ser apontadas ----------
test('Vitória: aplicação com cabelo novo e hora ditos passa', () => {
  const r = ass('agenda a Vitória sexta às 8, colocação do cabelo novo que chegou', passo('marcar_horario', { servico: 'aplicação', cabelo_novo: 'sim', inicio: '2026-11-13T08:00' }));
  assert.deepStrictEqual(tipos(r), []);
});

test('manutenção com hora dita passa (13h, 13:30, 1 da tarde)', () => {
  assert.deepStrictEqual(tipos(ass('a Renata volta sexta 13h pra manutenção', passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-13T13:00' }))), []);
  assert.deepStrictEqual(tipos(ass('marca a Ana dia 27 às 13:30, manutenção', passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-27T13:30' }))), []);
  assert.deepStrictEqual(tipos(ass('marca a Ana sexta 1 da tarde manutenção', passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-27T13:00' }))), []);
  assert.deepStrictEqual(tipos(ass('ela vem meio dia', passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-27T12:00' }))), []);
});

test('concluir com valor dito passa (R$ 1.200 e 1200)', () => {
  assert.deepStrictEqual(tipos(ass('a Dienne terminou, cobrei 1.200', passo('concluir', { agendamento_id: 'x', valor: '1200' }))), []);
  assert.deepStrictEqual(tipos(ass('fiz a Adriana, ficou 280', passo('concluir', { agendamento_id: 'x', valor: '280' }))), []);
});

test('resultado: fechou, pensando e não fechou com prova passam', () => {
  assert.deepStrictEqual(tipos(ass('a Dienne fechou, manutenção dia 18 às 13h', passo('resultado_avaliacao', { resultado: 'fechou', proximo_passo: 'manutenção marcada 18/11 às 13:00' }))), []);
  assert.deepStrictEqual(tipos(ass('a Leidyane ficou de pensar', passo('resultado_avaliacao', { resultado: 'pensando' }))), []);
  assert.deepStrictEqual(tipos(ass('a Rose não quis, achou caro', passo('resultado_avaliacao', { resultado: 'nao_fechou' }))), []);
});

test('falta, envio e exclusão pedidos passam', () => {
  assert.deepStrictEqual(tipos(ass('a das 13h não veio', passo('liberar_horario', { agendamento_id: 'x' }))), []);
  assert.deepStrictEqual(tipos(ass('chama a Roseli e pergunta se ainda quer', passo('chamar_cliente', { cliente_id: 'x', texto: 'Oi Roseli' }))), []);
  assert.deepStrictEqual(tipos(ass('cancela o horário da Bia', passo('excluir_horario', { agendamento_id: 'x' }))), []);
});

test('ferramentas só de leitura não entram no registro', () => {
  const r = ass('o que tenho amanhã?', passo('agenda_do_dia', { data: '2026-11-22' }, 'lista'), passo('buscar_cliente', { busca: 'ana' }, 'lista'));
  assert.deepStrictEqual(r.acoes, []);
  assert.strictEqual(r.n_falhas, 0);
});

test('atendimento: cliente nova pedindo aplicação passa; manutenção de quem já usa passa', () => {
  assert.deepStrictEqual(tipos(atd('quero colocar mega hair, nunca usei', '', passo('criar_agendamento', { servico: 'Aplicação de mega hair – mão de obra' }, 'AGENDADO'))), []);
  assert.deepStrictEqual(tipos(atd('já uso mega, preciso da manutenção', '', passo('criar_agendamento', { servico: 'Manutenção – mão de obra' }, 'AGENDADO'))), []);
  assert.deepStrictEqual(tipos(atd('não vou conseguir ir amanhã, pode cancelar', '', passo('cancelar_agendamento', {}, 'CANCELADO'))), []);
});

test('unha (Caroline) não é aplicação de cabelo', () => {
  assert.deepStrictEqual(tipos(atd('já uso alongamento, quero refazer', '', passo('criar_agendamento', { servico: 'Alongamento molde F1 – aplicação' }, 'AGENDADO'))), []);
});

test('entrada em texto (JSON) e ferramenta que deu erro sem falha não quebram', () => {
  const r = ass('a Ana fez a manutenção', passo('concluir', '{"agendamento_id":"x"}', 'ERRO: horário não encontrado'));
  assert.deepStrictEqual(r.acoes, []);
  assert.doesNotThrow(() => conferirAcoes({}));
  assert.doesNotThrow(() => conferirAcoes({ passos: [null, { ferramenta: 'concluir', entrada: 'texto solto' }] }));
});

// 21/11, primeiro dia do portão no ar: alarme falso por erro de digitação da Gleide
test('"A Vida não feichou" (erro de digitação) prova o não fechou', () => {
  assert.deepStrictEqual(tipos(ass('A vida não feichou', passo('resultado_avaliacao', { resultado: 'nao_fechou' }))), []);
  assert.deepStrictEqual(tipos(ass('a vida feichou, volta sexta', passo('resultado_avaliacao', { resultado: 'fechou' }))), []);
  assert.deepStrictEqual(tipos(ass('a vida veio', passo('resultado_avaliacao', { resultado: 'nao_fechou' }))), ['nao_fechou_sem_prova']);
});

test('atendimento: resposta da agenda embrulhada em JSON não vira falha nem erro', () => {
  const r = atd('Hoje🌹', '', passo('criar_agendamento', { servico: 'Coloração', data_hora_inicio: '2026-11-21T10:30' },
    '[{"resposta":"AGENDADO com sucesso na agenda do salão: sábado, 21/11 às 10:30."}]'));
  assert.deepStrictEqual(tipos(r), []);
  assert.strictEqual(r.acoes[0].gravou, true);
  const e = atd('Hoje', '', passo('criar_agendamento', { servico: 'Coloração' }, '[{"resposta":"NÃO AGENDADO: horário ocupado."}]'));
  assert.deepStrictEqual(e.acoes, [], 'não gravou e nada a apontar: não registra');
});
