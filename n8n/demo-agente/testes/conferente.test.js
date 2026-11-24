// Testes do Conferente (conferente-regras.js). Rodar: node --test n8n/demo-agente/testes/
// Casos tirados dos erros reais do Vigia (13 a 20/11, Caroline) e de respostas boas que NÃO podem ser barradas.
const test = require('node:test');
const assert = require('node:assert');
const { conferir, versaoSegura, montarPedido, escolher } = require('../conferente-regras.js');

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

// caso real de 20/11 (Caroline): o criar_agendamento devolve JSON, o Conferente não via o AGENDADO, cortou a confirmação
// e mandou "Posso reservar esse horário pra você?" para quem já tinha pago o sinal e já estava marcada
const AGENDADO_JSON = '[{"resposta":"AGENDADO com sucesso na agenda do salão: sábado, 21/11 às 08:00 com a Duda. Agora confirme para a cliente o serviço, o dia e a hora. SINAL: o comprovante de R$ 20,00 foi conferido e ficou registrado no agendamento."}]';
test('AGENDADO dentro de JSON (resultado real do criar_agendamento) passa', () => {
  const passos = [{ ferramenta: 'criar_agendamento', resultado: AGENDADO_JSON }];
  const texto = 'Agendado 🙏\n\nSua manicure e pedicure ficou marcada pra amanhã, sábado, às 8h com a Duda. O sinal de R$ 20 já está registrado e fica descontado no valor total no dia.';
  assert.deepStrictEqual(tipos(conferir(base({ texto, passos }))), []);
});

test('NÃO AGENDADO dentro de JSON continua barrado e a versão segura diz que não ficou reservado', () => {
  const passos = [{ ferramenta: 'criar_agendamento', resultado: '[{"resposta":"NÃO AGENDADO: ainda não chegou a foto do comprovante do Pix do sinal."}]' }];
  const ctx = base({ texto: 'Reservei pra você sábado às 8h 🙏', passos, ficha: 'sábado 8h' });
  assert.deepStrictEqual(tipos(conferir(ctx)), ['promessa']);
  assert.match(versaoSegura(ctx).texto, /ainda não ficou reservado/);
});

test('repetir a confirmação de um horário que já está marcado na ficha passa', () => {
  const ficha = 'Nome: [cliente]\nHorário marcado: sábado, 21/11 às 08:00 — Manicure e pedicure';
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Reservei seu pé e mão pra amanhã, sábado, às 8h com a Duda 🙏', ficha }))), []);
});

test('mesma hora em outro dia, ou com NÃO AGENDADO agora, continua barrado mesmo com horário na ficha', () => {
  const ficha = 'Horário marcado: sábado, 21/11 às 08:00 — Manicure e pedicure';
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Reservei segunda às 8h pra você!', ficha }))), ['promessa']);
  const passos = [{ ferramenta: 'criar_agendamento', resultado: '[{"resposta":"NÃO AGENDADO: falta comprovante"}]' }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Reservei sábado às 8h pra você!', ficha, passos }))), ['promessa']);
});

test('"Reservei" num horário diferente do que está marcado continua barrado', () => {
  const ficha = 'Horário marcado: sábado, 21/11 às 08:00 — Manicure e pedicure';
  const anteriores = [{ direcao: 'saida', autor: 'ia', conteudo: 'Tenho sábado às 10h', criado_em: min(5) }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Reservei pra você sábado às 10h 🙏', ficha, anteriores }))), ['promessa']);
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

// ---- casos do testador (20/11) ----
test('preço redondo inventado agora é barrado (antes passava por ser "soma menos sinal")', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'A manicure fica R$45' }))), ['preco']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Pé e mão R$ 90' }))), ['preco']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Pé e mão fica R$ 110, e no dia você paga R$ 90 porque o sinal é R$ 20' }))), []);
});

test('mais jeitos de dizer que marcou sem a ferramenta', () => {
  for (const t of ['Prontinho, agendado! Sábado 9h', 'Agendadíssimo', 'Tá marcado então', 'Remarcado pra quinta!', 'Troquei seu horário pra quinta', 'Desmarquei seu horário', 'Seu horário foi cancelado']) {
    assert.ok(tipos(conferir(base({ texto: t, ficha: 'sábado 9h quinta 9h' }))).includes('promessa'), t);
  }
});

test('confirmar horário que ela já tem e negar não é promessa falsa', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Confirmado, te espero amanhã às 9h 🙏', ficha: 'ALÔ DE LEMBRETE: em 19/11 às 18:00 ... amanhã às 9h' }))), []);
  const passos = [{ ferramenta: 'ver_agendamentos', resultado: 'Agendamentos futuros desta cliente:\n- Manicure: sábado, 21/11 às 09:00' }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Tá marcado sim, sábado às 9h', passos }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Ainda não marquei, preciso do comprovante' }))), []);
});

test('"toda bonita" minúsculo é elogio, não nome de loja', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Vai ficar toda bonita pro casamento' }))), []);
});

test('rua sem número e "tô na rua" não são endereço; link cortado é barrado', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Tô na rua agora, já te respondo' }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'É bem perto da Avenida das Embaúbas' }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Fica na Rua dos Angicos, no Jardim Imperial' }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'https://maps.app.goo.gl/c6ebcio' }))), ['endereco']);
});

test('"às 16" é lido; duração de 6h ou mais não vira horário', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Tenho às 16' }))), ['horario']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Fica pronto em 6h' }))), []);
});

test('"Chave Pix:" antes da chave é aceito; {{ }} é sobra de sistema; entrada nula não quebra', () => {
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Chave Pix: ' + CHAVE }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Oi {{ $json.nome }}' }))), ['sistema']);
  assert.doesNotThrow(() => conferir(base({ texto: 'oi', passos: [null], anteriores: [null] })));
});

// ---- casos novos de 20/11 (voucher, Duda, adicionais) e modo ligado ----
const servicos2 = [...servicos, { nome: 'Francesinha (adicional)', preco: 30 }, { nome: 'Decoração (por dedo)', preco: 15 }];
const config2 = { ...config, loja: { ...config.loja, voucher_gel: { ativo: true } } };
const base2 = (extra) => base({ servicos: servicos2, config: config2, ...extra });
const CONSULTA = { ferramenta: 'consultar_horarios_livres', resultado: 'OFEREÇA À CLIENTE SÓ ESTES 2 HORÁRIOS: 9h com a Duda (data_hora_inicio: 2026-11-21T09:00) ou 14h com a Caroline (data_hora_inicio: 2026-11-21T14:00)' };

test('voucher da esmaltação em gel (R$ 20) e o valor da linha VOUCHER da ficha passam', () => {
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'Na esmaltação em gel você ganha um voucher de R$ 20 pro seu próximo serviço aqui, vale 30 dias depois do atendimento' }))), []);
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'Seu voucher é de R$ 25 no próximo serviço', ficha: 'VOUCHER: código GEL-7K2Q, R$ 25 no próximo serviço, vale até 15/12 (não usado)' }))), []);
});

test('horário "com a Duda" / "com a Caroline" passa e não afrouxa o preço', () => {
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'Tenho amanhã às 9h com a Duda ou às 14h com a Caroline', passos: [CONSULTA] }))), []);
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'A manicure fica R$ 45. Tenho amanhã às 9h com a Duda', passos: [CONSULTA] }))), ['preco']);
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'Isso a Caroline te explica no dia do atendimento' }))), []);
});

test('adicionais da lista: francesinha e decoração por dedo, sozinhos e somados', () => {
  for (const t of ['A francesinha é adicional de R$ 30 e a decoração R$ 15 por dedo', 'A manicure com francesinha fica R$ 80',
    'A decoração em 2 dedos fica R$ 30', 'Manicure com decoração em 4 dedos fica R$ 110']) assert.deepStrictEqual(tipos(conferir(base2({ texto: t }))), [], t);
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'A francesinha fica R$ 35' }))), ['preco']);
  // "por dedo" não libera múltiplos em qualquer frase (R$ 45 = 3 x 15)
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'A manicure fica R$ 45' }))), ['preco']);
});

test('"1.200 reais" é lido como mil e duzentos; "Agendado pra você" sem AGENDADO é promessa', () => {
  assert.deepStrictEqual(tipos(conferir(base({ servicos: [{ nome: 'Pacote', preco: 1200 }], texto: 'O pacote fica 1.200 reais' }))), []);
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'Agendado pra você amanhã às 9h com a Duda 🙏', passos: [CONSULTA] }))), ['promessa']);
  assert.deepStrictEqual(tipos(conferir(base2({ texto: 'Agendado pra você amanhã às 9h?', passos: [CONSULTA] }))), []);
});

test('versão segura: "reservei" vira oferta, preço errado sai e vem o da lista, horário inventado sai', () => {
  const s1 = versaoSegura(base2({ texto: 'Reservei pra você amanhã às 9h com a Duda 🙏', passos: [CONSULTA] }));
  assert.strictEqual(s1.texto, 'Posso reservar pra você amanhã às 9h com a Duda?');
  const s2 = versaoSegura(base2({ texto: 'A manicure fica R$ 45. Tenho amanhã às 9h com a Duda', passos: [CONSULTA] }));
  assert.strictEqual(s2.texto, 'Tenho amanhã às 9h com a Duda\n\nManicure fica R$ 50');
  const s3 = versaoSegura(base2({ texto: 'Tenho às 10h com a Duda', passos: [CONSULTA] }));
  assert.ok(!/10h/.test(s3.texto) && s3.texto.length > 0, s3.texto);
  for (const s of [s1, s2, s3]) assert.deepStrictEqual(s.falhas, []);
});

test('versão segura: NÃO AGENDADO, chave grudada, endereço errado, repetida inteira', () => {
  const naoAg = [CONSULTA, { ferramenta: 'criar_agendamento', resultado: 'NÃO AGENDADO: ainda não chegou a foto do comprovante do Pix do sinal.' }];
  const s1 = versaoSegura(base2({ texto: 'Agendado 🙏 te espero amanhã às 9h com a Duda', passos: naoAg }));
  assert.ok(/ainda não ficou reservado/.test(s1.texto) && !/agendado|te espero/i.test(s1.texto), s1.texto);
  assert.ok(versaoSegura(base2({ texto: 'A chave é ' + CHAVE + ' me manda o print' })).texto.split('\n').includes(CHAVE));
  assert.ok(/Rua dos Angicos, 690/.test(versaoSegura(base2({ texto: 'Fica na Rua das Orquídeas, 123' })).texto));
  // repetir não é informação errada: se tudo era repetido, sai como veio (nunca fica sem resposta)
  const msg = 'Pra garantir o horário é um sinal de R$ 20 no Pix';
  assert.strictEqual(versaoSegura(base2({ texto: msg, anteriores: [{ direcao: 'saida', autor: 'ia', conteudo: msg, criado_em: min(10) }] })).texto, msg);
});

test('escolher: reescrita boa passa; barrada, vazia, sem chave ou com "vou ver com a Caroline" vira versão segura', () => {
  const ctx = base2({ texto: 'Reservei pra você amanhã às 9h com a Duda 🙏', passos: [CONSULTA] });
  const f = conferir(ctx).falhas;
  assert.strictEqual(escolher(ctx, f, 'Posso reservar pra você amanhã às 9h com a Duda?', '').usou, 'reescrita');
  const barrada = escolher(ctx, f, 'Agendado pra você amanhã às 9h com a Duda 🙏', '');
  assert.deepStrictEqual([barrada.usou, barrada.motivo, barrada.texto], ['segura', 'reescrita_barrada', 'Posso reservar pra você amanhã às 9h com a Duda?']);
  assert.strictEqual(escolher(ctx, f, '', 'timeout').motivo, 'gemini_falhou');
  assert.strictEqual(escolher(ctx, f, '', '').motivo, 'reescrita_vazia');
  assert.strictEqual(escolher(ctx, f, 'Tenho amanhã às 9h com a Duda. Vou ver com a Caroline e te aviso', '').motivo, 'reescrita_promete_depois');
  const comChave = base2({ texto: 'Reservei 🙏\n' + CHAVE, passos: [CONSULTA] });
  const e = escolher(comChave, conferir(comChave).falhas, 'Posso reservar pra você?', '');
  assert.ok(e.motivo === 'reescrita_sem_chave' && e.texto.includes(CHAVE));
});

test('pedido ao Gemini leva as falhas, os dados certos e não manda perguntar para a dona', () => {
  const ctx = base2({ texto: 'Reservei pra você amanhã às 9h com a Duda 🙏', passos: [CONSULTA], dona: 'Caroline', mensagem: 'pode ser às 9h' });
  const p = montarPedido(ctx, conferir(ctx).falhas, 'Curto e direto.');
  for (const t of ['disse que marcou', 'Manicure: R$ 50', 'Francesinha (adicional): R$ 30', '9h com a Duda', 'Rua dos Angicos', 'VOUCHER', 'Curto e direto.',
    'Não acrescente pergunta para Caroline', 'MENSAGEM DA CLIENTE AGORA:\npode ser às 9h', 'RESPOSTA ORIGINAL:\nReservei']) assert.ok(p.includes(t), t);
});

// Gleide (21/11/2026, fase 3 do portão): na própria loja de mega hair a regra "nome de outra loja" não vale
test('Gleide: semOutraLoja não aponta "mega hair", "Gleide" nem "Toda Bonita"', () => {
  const t = 'Aqui no Toda Bonita a Gle' + 'ide faz mega hair com fita e queratina';
  assert.deepStrictEqual(tipos(conferir(base({ texto: t }))), ['outra_loja']);
  assert.deepStrictEqual(tipos(conferir(base({ texto: t, semOutraLoja: true }))), []);
});

test('Gleide: o Conferente monta em modo observar sem o nó "Supabase: dados do salão", num ramo à parte', () => {
  let n = 0;
  const node = (name, type, typeVersion, position, parameters, extra = {}) => ({ id: 'id-' + (++n), name, type, typeVersion, position, parameters, ...extra });
  const ifNode = (name, position, conditions) => node(name, 'n8n-nodes-base.if', 2.2, position, { conditions: { conditions } });
  const cond = (id, left, operator) => ({ id, leftValue: left, operator });
  const wf = { nodes: ['Agente IA', 'Supabase: tabela de serviços', 'Supabase: últimas mensagens', 'Sobre esta cliente', 'Extrair dados', 'Quebrar mensagens']
    .map((x) => node(x, 'x', 1, [0, 0], { url: x === 'Supabase: últimas mensagens' ? '/rest/v1/mensagens?select=direcao,conteudo,wa_message_id,criado_em&x=1' : '/rest/v1/servicos?select=nome' })),
  connections: { 'Agente IA': { main: [[{ node: 'Quebrar mensagens', type: 'main', index: 0 }]] } } };
  const loja = { slug: 'gleide', empresa_id: '00000000-0000-0000-0000-000000000001', nome: 'Salão Toda Bonita', dona: 'Gleide', conferente: 'observar', outra_loja: false };
  require('../conferente.js')({ node, ifNode, cond, workflow: wf, loja });
  assert.deepStrictEqual(wf.connections['Agente IA'].main[0].map((c) => c.node), ['Quebrar mensagens', 'Conferente: dados do salão']);
  assert.strictEqual(wf.connections['Conferente: dados do salão'].main[0][0].node, 'Conferente: conferir');
  const dados = wf.nodes.find((x) => x.name === 'Conferente: dados do salão');
  assert.match(dados.parameters.url, /empresas\?select=config&id=eq\.00000000-0000-0000-0000-000000000001$/);
  assert.ok(dados.position[1] >= 9000, 'ramo lá embaixo: a resposta sai antes');
  const code = wf.nodes.find((x) => x.name === 'Conferente: conferir').parameters.jsCode;
  assert.ok(code.includes('semOutraLoja: true'));
  assert.ok(code.includes("pega('Conferente: dados do salão'"));
  assert.match(wf.nodes.find((x) => x.name === 'Supabase: últimas mensagens').parameters.url, /criado_em,autor/);
  // no ligado o nó do cadastro continua obrigatório
  const wf2 = JSON.parse(JSON.stringify({ ...wf, nodes: wf.nodes.filter((x) => !/Conferente/.test(x.name)) }));
  assert.throws(() => require('../conferente.js')({ node, ifNode, cond, workflow: wf2, loja: { ...loja, conferente: 'ligado' } }), /dados do salão/);
});

// Gleide (21/11): o testador rodou as conversas reais de 11 a 20/11 pelo Conferente
test('Gleide: orçamento que a dona passou (recado automático gravado como ia) vale como fonte do preço', () => {
  const anteriores = [{ direcao: 'saida', autor: 'ia', conteudo: 'A Gle' + 'ide passou o orçamento: o brasileiro 60 cm fica R$ 2.800', criado_em: new Date(agora - 600e3).toISOString() }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'O brasileiro fica R$ 2.800, tá?', anteriores }))), []);
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'O brasileiro fica R$ 2.800, tá?' }))), ['preco']);
  // a mesma frase dita pela própria IA (sem ser o recado) não vira fonte
  const daIa = [{ direcao: 'saida', autor: 'ia', conteudo: 'Fica uns R$ 2.800', criado_em: new Date(agora - 600e3).toISOString() }];
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'O brasileiro fica R$ 2.800, tá?', anteriores: daIa }))), ['preco']);
});

test('Gleide: "está marcado" com "Horário marcado:" na ficha não é promessa', () => {
  const ficha = 'Horário marcado: sexta-feira, 13/11 às 08:00 — Aplicação';
  assert.deepStrictEqual(tipos(conferir(base({ texto: 'Seu horário está marcado para sexta às 08:00.', ficha }))), []);
  assert.ok(tipos(conferir(base({ texto: 'Seu horário está marcado para sexta às 08:00.' }))).includes('promessa'));
});

// ---------- 21/11: casos reais de produção ----------
// No n8n a resposta da ferramenta chega embrulhada. Dienne (Gleide, 09:06) e a cliente da Caroline (20/11 18:14).
const EMBRULHADO = '[{"resposta":"AGENDADO com sucesso na agenda do salão: sábado, 21/11 às 10:30. Agora confirme para a cliente o serviço, o dia e a hora."}]';

test('resposta da ferramenta embrulhada ([{"resposta":"AGENDADO…"}]) confirma o "está marcada" (Dienne, 21/11)', () => {
  const texto = 'Tudo certo, Dienne! Sua coloração está marcada para hoje, às 10h30.';
  const passos = [{ ferramenta: 'criar_agendamento', resultado: EMBRULHADO }];
  assert.deepStrictEqual(tipos(conferir(base({ texto, passos, semOutraLoja: true }))), []);
  // os outros jeitos de chegar: objeto aberto, lista de objetos, texto puro
  for (const resultado of [[{ resposta: 'AGENDADO com sucesso: sábado, 21/11 às 10:30.' }], { resposta: 'AGENDADO com sucesso: sábado, 21/11 às 10:30.' },
    'AGENDADO com sucesso: sábado, 21/11 às 10:30.', JSON.stringify({ resposta: 'AGENDADO com sucesso: sábado, 21/11 às 10:30.' })])
    assert.deepStrictEqual(tipos(conferir(base({ texto, passos: [{ ferramenta: 'criar_agendamento', resultado }], semOutraLoja: true }))), [], JSON.stringify(resultado));
  // sem a agenda confirmar continua sendo promessa
  assert.ok(tipos(conferir(base({ texto, semOutraLoja: true }))).includes('promessa'));
});

test('Caroline 20/11 18:14: "Agendado 🙏 … ficou marcada" com AGENDADO embrulhado não é barrado', () => {
  const texto = 'Agendado 🙏\n\nSua manicure e pedicure ficou marcada pra amanhã, sábado, às 8h com a Duda.';
  const passos = [{ ferramenta: 'criar_agendamento', resultado: '[{"resposta":"AGENDADO com sucesso na agenda do salão: sábado, 21/11 às 08:00 com a Duda. Agora confirme para a cliente o serviço, o dia e a hora."}]' }];
  assert.deepStrictEqual(tipos(conferir(base({ texto, passos }))), []);
});

test('"NÃO AGENDADO" embrulhado continua barrando e a versão segura enxerga a recusa', () => {
  const passos = [{ ferramenta: 'criar_agendamento', resultado: '[{"resposta":"NÃO AGENDADO: esse horário acabou de ser ocupado."}]' }];
  const ctx = base({ texto: 'Agendado 🙏 Te espero amanhã às 8h.', passos });
  const r = conferir(ctx);
  assert.ok(tipos(r).includes('promessa'));
  assert.doesNotThrow(() => versaoSegura(ctx, r.falhas));
});

test('Caroline 20/11 18:15: repetir "Reservei … às 8h" com o horário já na ficha não é promessa; outro dia ou outra hora é', () => {
  // 20/11/2026 é sexta; "amanhã" = sábado
  const sexta = Date.parse('2026-11-20T22:15:00Z');
  const ficha = 'Horário marcado: sábado, 21/11 às 08:00 — Manicure e pedicure';
  const t = (texto, extra = {}) => tipos(conferir(base({ texto, ficha, agora: sexta, ...extra })));
  assert.deepStrictEqual(t('Reservei seu pé e mão pra amanhã, sábado, às 8h com a Duda 🙏'), []);
  assert.deepStrictEqual(t('Reservei pra você amanhã às 08:00 🙏'), []);
  assert.ok(t('Reservei pra você amanhã às 9h 🙏').includes('promessa'), 'outra hora');
  assert.ok(t('Reservei pra você segunda às 8h 🙏').includes('promessa'), 'outro dia');
  assert.ok(t('Reservei pra você 🙏').includes('promessa'), 'sem dizer a hora não dá para conferir');
  assert.ok(t('Reservei pra você amanhã às 8h 🙏', { ficha: '' }).includes('promessa'), 'sem horário na ficha');
  assert.ok(t('Reservei pra você amanhã às 8h 🙏', { passos: [{ ferramenta: 'criar_agendamento', resultado: '[{"resposta":"NÃO AGENDADO: horário ocupado."}]' }] }).includes('promessa'), 'a agenda recusou agora');
});


// testador (21/11): a regra do "Reservei" repetido não pode deixar passar promessa de verdade
test('"Reservei" repetido: outra semana, outra data, "que vem", "depois de amanhã" ou ferramenta rodando agora continuam promessa', () => {
  const sexta = Date.parse('2026-11-20T22:15:00Z');
  const ficha = 'Horário marcado: sábado, 21/11 às 08:00 — Manicure e pedicure';
  const t = (texto, extra = {}) => tipos(conferir(base({ texto, ficha, agora: sexta, ...extra })));
  assert.deepStrictEqual(t('Reservei seu pé e mão pra amanhã, sábado, às 8h com a Duda 🙏'), []);
  assert.deepStrictEqual(t('Reservei pra você sábado, dia 21/11, às 8h 🙏'), []);
  for (const f of ['Reservei sua manicure pra sábado, dia 28/11, às 8h 🙏', 'Reservei pra você dia 24/11 às 8h 🙏', 'Reservei pra sábado que vem, às 8h 🙏',
    'Reservei pra depois de amanhã às 8h 🙏', 'Reservei pro próximo sábado às 8h 🙏', 'Reservei pra você dia 28 às 8h 🙏', 'Reservei sábado às 14h e terça às 8h 🙏'])
    assert.ok(t(f).includes('promessa'), f);
  // a agenda respondeu outra coisa nesta resposta (recusa sem "NÃO AGENDADO", erro, cancelamento): não vale a ficha
  for (const resultado of ['[{"resposta":"Esse horário acabou de ser ocupado. Consulte os horários livres de novo."}]', 'ERRO: agenda fora do ar', '[{"resposta":"CANCELADO com sucesso."}]'])
    assert.ok(t('Reservei pra você amanhã às 8h 🙏', { passos: [{ ferramenta: resultado.includes('CANCELADO') ? 'cancelar_agendamento' : 'criar_agendamento', resultado }] }).includes('promessa'), resultado);
  // "Horário marcado:" dentro de outra linha (observação, conversa antiga) não conta; o nome do serviço com dia não confunde
  assert.ok(t('Reservei pra você amanhã às 8h 🙏', { ficha: 'Observações: ela disse que o Horário marcado: sábado às 08:00 não dá' }).includes('promessa'));
  assert.deepStrictEqual(t('Reservei pra você amanhã às 8h 🙏', { ficha: 'Horário marcado: sábado, 21/11 às 08:00 — Pacote sexta e sábado' }), []);
});


// testador, rodada 2 (21/11): a regra ficou invertida. Só vale com o dia dito e igual ao da ficha.
test('"Reservei" repetido, regra fechada: precisa dizer o dia, e o dia resolvido em data tem de ser o da ficha', () => {
  const sexta = Date.parse('2026-11-20T22:15:00Z');   // sexta, 20/11/2026, 18:15 em Cuiabá
  const t = (texto, ficha, extra = {}) => tipos(conferir(base({ texto, ficha, agora: sexta, ...extra })));
  const amanha = 'Horário marcado: sábado, 21/11 às 08:00 — Manicure e pedicure';
  const outraSemana = 'Horário marcado: sábado, 28/11 às 08:00 — Manicure e pedicure';
  // continuam valendo
  for (const f of ['Reservei seu pé e mão pra amanhã, sábado, às 8h com a Duda 🙏', 'Reservei pra você amanhã às 8h 🙏', 'Reservei pra sábado às 8h 🙏',
    'Reservei pra você dia 21/11 às 8h 🙏', 'Reservei pra você dia 21 de novembro às 8h 🙏'])
    assert.deepStrictEqual(t(f, amanha), [], f);
  // "amanhã", "hoje" e o dia da semana sozinho não valem para o horário de outra semana
  for (const f of ['Reservei pra amanhã às 8h 🙏', 'Reservei pra amanhã, sábado, às 8h 🙏', 'Reservei pra hoje às 8h 🙏', 'Reservei pra sábado às 8h 🙏'])
    assert.ok(t(f, outraSemana).includes('promessa'), f + ' (ficha de 28/11)');
  assert.deepStrictEqual(t('Reservei pra você dia 28/11 às 8h 🙏', outraSemana), []);
  // sem dizer o dia, outra pessoa, a mais, toda semana, data em outro formato, hora por extenso, outro jeito de dizer outro dia
  for (const f of ['Reservei pra você às 8h 🙏', 'Reservei o horário da sua filha também, sábado às 8h com a Caroline 🙏', 'Reservei pra sua mãe no sábado às 8h 🙏',
    'Reservei também a esmaltação em gel pra sábado às 8h 🙏', 'Reservei todo sábado às 8h pra você 🙏', 'Reservei pra 28 de novembro às 8h 🙏',
    'Reservei pra dia 21 de dezembro às 8h 🙏', 'Reservei pra 28-11 às 8h 🙏', 'Reservei sábado às 8h pra você e às nove e meia pra sua irmã 🙏',
    'Reservei sábado às 8h e outro ao meio-dia 🙏', 'Reservei pra daqui 15 dias, sábado às 8h 🙏', 'Reservei pra semana que entra, sábado às 8h 🙏'])
    assert.ok(t(f, amanha).includes('promessa'), f);
  // outra ferramenta nesta resposta desliga a regra; só olhar os horários dela não
  assert.ok(t('Reservei pra amanhã às 8h 🙏', amanha, { passos: [{ ferramenta: 'consultar_horarios_livres', resultado: '[{"resposta":"INDISPONÍVEL: sábado, 21/11 às 08:00 já está ocupado."}]' }] }).includes('promessa'));
  assert.ok(t('Reservei pra amanhã às 8h 🙏', amanha, { passos: [{ ferramenta: 'transferir_para_humano', resultado: 'TRANSFERIDO' }] }).includes('promessa'));
  assert.deepStrictEqual(t('Reservei pra amanhã às 8h 🙏', amanha, { passos: [{ ferramenta: 'ver_agendamentos', resultado: '[{"resposta":"Agendamentos futuros: sábado, 21/11 às 08:00"}]' }] }), []);
});
