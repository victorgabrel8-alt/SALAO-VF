// Testes do Portão de ações, segunda revisão de 21/11/2026 (casos do testador). Rodar: node --test "n8n/demo-agente/testes/**/*.test.js"
const test = require('node:test');
const assert = require('node:assert');
const { conferirAcoes } = require('../portao-regras.js');

const tipos = (r) => r.acoes.flatMap((a) => a.falhas.map((f) => f.tipo)).sort();
const ass = (fala, ...passos) => conferirAcoes({ agente: 'assistente', fala, passos });
const atd = (fala, ficha, ...passos) => conferirAcoes({ agente: 'atendimento', fala, ficha, passos });
const passo = (ferramenta, entrada, resultado = 'OK: feito') => ({ ferramenta, entrada, resultado });
const vazio = (r, msg) => assert.deepStrictEqual(tipos(r), [], msg);
const APL = { servico: 'Aplicação de mega hair – mão de obra' };
const marca = (f, h) => ass(f, passo('marcar_horario', { servico: 'manutenção', inicio: '2026-11-27T' + h }));

test('hora no jeito comum de escrever passa', () => {
  vazio(marca('marca a ana 14h30', '14:30'), '14h30');
  vazio(marca('8h30 ta otimo', '08:30'), '8h30');
  vazio(marca('no horario das 14', '14:00'), 'das 14');
  vazio(marca('sexta 14', '14:00'), 'sexta 14');
  vazio(marca('as 9.30', '09:30'), '9.30');
  assert.deepStrictEqual(tipos(marca('dia 14 de manha', '14:00')), ['hora_sem_prova'], 'dia 14 de manhã não é 14h');
});

test('cliente nova descrevendo o próprio cabelo não é apontada', () => {
  for (const f of ['eu tenho o cabelo bem curto e fino, quero colocar mega', 'tenho o cabelo ralo nas pontas', 'ja tenho cabelo longo, so quero mais volume', 'quero repor o volume que perdi depois da bariatrica'])
    vazio(atd(f, '', passo('criar_agendamento', APL, 'AGENDADO')), f);
});

test('ficha: "não usa", "a irmã usa" e a fala da IA não contam', () => {
  for (const ficha of ['Não usa mega hair; quer colocar pela primeira vez', 'Disse que a irmã usa mega', 'Você: Você já usa mega ou está pensando em colocar?\nCliente: quero colocar'])
    vazio(atd('quero marcar', ficha, passo('criar_agendamento', APL, 'AGENDADO')), ficha);
  assert.deepStrictEqual(tipos(atd('quero marcar', 'Já usa mega hair e quer mudar para fita', passo('criar_agendamento', APL, 'AGENDADO'))), ['aplicacao_com_cabelo_da_cliente']);
});

test('pedidos comuns de mensagem da Gleide passam', () => {
  for (const f of ['manda o endereco pra ela', 'manda a localizacao pra ana', 'manda o pix pra ela', 'fala pra ana que amanha nao abro', 'pergunta pra ana se ela quer',
    'responde pra ela', 'confirma a ana de amanha', 'cobra o sinal da ana', 'da um oi pra ana', 'agradece a ana', 've com a ana se da'])
    vazio(ass(f, passo('chamar_cliente', { cliente_id: 'x', texto: 'Oi' })), f);
  assert.deepStrictEqual(tipos(ass('muita demanda hoje', passo('chamar_cliente', { cliente_id: 'x', texto: 'Oi' }))), ['envio_sem_pedido']);
});

test('manutenção normal concluída não vira "cabelo da cliente"', () => {
  vazio(ass('fiz a manutencao da ana, o cabelo dela ta otimo, 350', passo('concluir', { agendamento_id: 'x', valor: '350' })));
  vazio(ass('fiz a reposicao do mega da ana, 400', passo('concluir', { agendamento_id: 'x', valor: '400' })));
});

test('concluir: respostas curtas e "não fez a hidratação" passam', () => {
  vazio(ass('fiz a manutencao da ana, ela nao fez a hidratacao', passo('concluir', { agendamento_id: 'x' })));
  for (const f of ['350 no pix', 'foi 350', 'ela pagou 350']) vazio(ass(f, passo('concluir', { agendamento_id: 'x', valor: '350' })), f);
  assert.deepStrictEqual(tipos(ass('a ana veio?', passo('concluir', { agendamento_id: 'x' }))), ['concluir_sem_prova']);
});

test('confirmação com mais palavras e com o cabeçalho do buffer', () => {
  for (const f of ['pode marcar', 'sim, pode marcar', 'isso mesmo, obrigada', 'ok obrigada', 'simm', 'Ela mandou 2 mensagens seguidas:\n[1] sim\n[2] pode marcar'])
    vazio(marca(f, '15:00'), f);
  assert.deepStrictEqual(tipos(marca('sim, mas nao nesse horario', '15:00')), ['hora_sem_prova']);
});

test('baixos: remarcou, n quis, libera, lancei errado, 330, 1.2k, cabelo dela chegou', () => {
  vazio(ass('a ana remarcou pra semana que vem', passo('status_atendimento', { agendamento_id: 'x', status: 'cancelado' })));
  vazio(ass('a ana n quis', passo('resultado_avaliacao', { resultado: 'nao_fechou' })));
  vazio(ass('libera', passo('liberar_horario', { agendamento_id: 'x' })));
  vazio(ass('lancei errado, era pra semana que vem', passo('excluir_horario', { agendamento_id: 'x' })));
  vazio(ass('fez, 350 menos 20 do sinal', passo('concluir', { agendamento_id: 'x', valor: '330' })));
  vazio(ass('fez, deu 1.2k', passo('concluir', { agendamento_id: 'x', valor: '1200' })));
  vazio(ass('o cabelo dela chegou, volta sexta 13h', passo('marcar_horario', { servico: 'aplicação', cabelo_novo: 'sim', inicio: '2026-11-27T13:00' })));
  vazio(ass('ela ja pagou o cabelo, sexta 13h', passo('marcar_horario', { servico: 'aplicação', cabelo_novo: 'sim', inicio: '2026-11-27T13:00' })));
  assert.deepStrictEqual(tipos(ass('Ela mandou 3 mensagens seguidas:\n[1] fez a ana\n[2] dia vinte', passo('concluir', { agendamento_id: 'x', valor: '23' }))), ['valor_sem_prova']);
});

test('resultado que só fala "não consegui" no meio continua registrado como gravado', () => {
  const r = ass('chama a ana', passo('chamar_cliente', { cliente_id: 'x', texto: 'Oi' }, 'OK: mensagem enviada; não consegui mandar a foto'));
  assert.strictEqual(r.acoes[0].gravou, true);
});

const { montarResumo } = require('../portao-regras.js');
test('resumo do dia: vazio sem alarme; texto simples com alarme', () => {
  assert.strictEqual(montarResumo([], '21/11'), '');
  assert.strictEqual(montarResumo([{ n_falhas: 0, acoes: [] }], '21/11'), '');
  const t = montarResumo([
    { agente: 'assistente', telefone: '5566900000000', fala: 'a renata volta sexta 13h pra recolocar o cabelo dela', n_falhas: 1, criado_em: '2026-11-21T15:38:00Z',
      acoes: [{ ferramenta: 'marcar_horario', falhas: [{ tipo: 'aplicacao_com_cabelo_da_cliente' }] }] },
    { agente: 'atendimento', telefone: '5566911116156', fala: 'pra colocar meu cabelo', n_falhas: 1, criado_em: '2026-11-21T18:49:00Z',
      acoes: [{ ferramenta: 'criar_agendamento', falhas: [{ tipo: 'aplicacao_com_cabelo_da_cliente' }] }] },
  ], '21/11');
  for (const x of ['🛡️ Portão 21/11: 2 alarmes em 2 conversas', '11:38 Assistente (Gleide)', 'cliente …6156', 'aplicação, mas é o cabelo da própria cliente', '«pra colocar meu cabelo»'])
    assert.ok(t.includes(x), x);
});
