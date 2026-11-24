// Testes do prompt inteiro (prompt-inteiro.js). Rodar: node --test n8n/demo-agente/testes/
// Confere o que foi gerado para a Caroline (lojas/carol/workflow-demo-salao.json): o texto que a IA lê é o prompt da
// loja com os dados no lugar, sem regra empilhada, e as ferramentas dizem o mesmo que o prompt.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { expressoes, PROIBIDO } = require('../prompt-inteiro.js');

const PASTA = path.join(__dirname, '..', 'lojas', 'carol');
const wf = JSON.parse(fs.readFileSync(path.join(PASTA, 'workflow-demo-salao.json'), 'utf8'));
const no = (nome) => wf.nodes.find((n) => n.name === nome);
const sistema = no('Agente IA').parameters.options.systemMessage;
const dados = expressoes(sistema);
const semDados = dados.reduce((t, e) => t.split(e).join('«dado»'), sistema);

test('o texto da IA não tem marca de regra empilhada nem recado para programador', () => {
  for (const [re, porque] of PROIBIDO) assert.doesNotMatch(semDados, re, porque);
  assert.doesNotMatch(semDados, /mega hair|cabelo|queratina/i);
});

test('todos os dados entraram no lugar e não sobrou marca @@', () => {
  assert.doesNotMatch(sistema, /@@[A-Z_]+@@/);
  for (const trecho of ["$('Supabase: tabela de serviços')", "$('Sobre esta cliente').first().json.texto", "linhas.push('- Endereço: '", "$('Supabase: respostas aprendidas')", "$('Áudios disponíveis')", 'Sinal de todo horário novo'])
    assert.ok(dados.some((e) => e.includes(trecho)), 'falta o dado: ' + trecho);
});

test('cada bloco de dados aparece uma vez só', () => {
  for (const titulo of ['SERVIÇOS E PREÇOS (', 'SOBRE ESTA CLIENTE (', 'DADOS DO SALÃO (', 'RESPOSTAS QUE A CAROLINE JÁ DEU (', 'ÁUDIOS PRONTOS ('])
    assert.equal(semDados.split(titulo).length - 1, 1, titulo);
  // os blocos que a base colava não estão mais lá
  for (const velho of ['SINAL PARA RESERVAR', 'PIX PELO SISTEMA', 'COMO A RESPOSTA CHEGA', 'MENSAGENS SEGUIDAS (numeradas)', 'SERVIÇO QUE SAIU, DESCOLOU OU QUEBROU', 'VÍDEO DA CLIENTE'])
    assert.ok(!semDados.includes(velho), 'bloco colado voltou: ' + velho);
});

test('o texto ficou do tamanho do prompt da loja (nada colado por cima)', () => {
  const md = fs.readFileSync(path.join(PASTA, 'prompt-agente.md'), 'utf8').replace(/\r\n/g, '\n').match(/```text\n([\s\S]*?)```/)[1].trim();
  assert.ok(Math.abs(semDados.length - md.length) < 600, `prompt da loja ${md.length}, texto sem os dados ${semDados.length}`);
  // cada linha de regra do prompt da loja está no texto gerado (arquivo gerado velho falha aqui: gere de novo com montar-workflow.js --loja carol)
  for (const linha of md.split('\n').filter((l) => l.trim() && !l.includes('{{') && !l.includes('@@'))) assert.ok(sistema.includes(linha), 'o arquivo gerado não tem esta linha do prompt: ' + linha.slice(0, 80));
});

test('reparo vale para a Caroline e para a Duda', () => {
  assert.match(semDados, /Foi feito aqui no studio\?/);
  assert.match(semDados, /Foi aqui, com a Caroline ou com a Duda/);
  assert.doesNotMatch(semDados, /Foi a Caroline que fez\?/);
});

test('as ferramentas dizem o mesmo que o prompt (ferramentas.json da loja)', () => {
  const f = JSON.parse(fs.readFileSync(path.join(PASTA, 'ferramentas.json'), 'utf8'));
  for (const [nome, d] of Object.entries(f)) {
    const p = no(nome).parameters;
    assert.equal(p.description || p.toolDescription, d.descricao, nome);
    for (const [campo, desc] of Object.entries(d.campos || {})) assert.ok(String(p.workflowInputs.value[campo]).includes(desc), nome + '.' + campo);
  }
  const todas = wf.nodes.filter((n) => /toolWorkflow|toolCode/.test(n.type)).map((n) => (n.parameters.description || n.parameters.toolDescription || '') + JSON.stringify((n.parameters.workflowInputs || {}).value || {})).join('\n');
  assert.doesNotMatch(todas, /bom senso|QUANDO PRECISA DA CAROLINE|objeção de preço|parcelar/i);
});

test('quem cumprimenta de novo recebe o cumprimento de volta (o filtro não apaga)', () => {
  const codigo = no('Quebrar mensagens').parameters.jsCode;
  assert.ok(codigo.includes('if (jaFalou && !elaCumprimentou) {'));
  const re = new RegExp(codigo.match(/const elaCumprimentou = \/(.*)\/i\.test/)[1], 'i');
  for (const sim of ['oi', 'Olá', 'olá tudo bem', 'Oii boa noite', '[1] oi', 'boa tarde, quanto é a manicure?', 'opa']) assert.ok(re.test(sim), sim);
  for (const nao of ['oitenta reais?', 'quanto é a manicure?', 'obrigada', 'olaria']) assert.ok(!re.test(nao), nao);
});

test('a consulta de horários leva o telefone (cliente antiga continua com quem a atende)', () => {
  const v = no('consultar_horarios_livres').parameters.workflowInputs.value;
  assert.equal(v.telefone, no('criar_agendamento').parameters.workflowInputs.value.telefone);
  assert.ok(String(v.telefone).includes('telefone'));
});
