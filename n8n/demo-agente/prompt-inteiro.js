// Prompt inteiro (loja.json: "prompt_inteiro": true): o prompt-agente.md da loja é TODO o texto de regras que a IA lê.
// Pedido do Victor (23/11/2026): "se uma regra está errada, tira ela e coloca a certa no lugar". Até aqui o gerador
// colava no fim do prompt da loja os blocos da base (MENSAGENS SEGUIDAS, COMO A RESPOSTA CHEGA, SINAL PARA RESERVAR,
// PIX PELO SISTEMA, SERVIÇO QUE SAIU, VÍDEO...), cada um com as suas regras e os seus "vale mais que". Na Caroline o
// prompt escrito tinha 15,7 mil caracteres e a IA recebia 37 mil, com ordens que se contradiziam.
//
// Com esta opção:
//   1. dos blocos colados fica só o DADO que muda a cada conversa (lista de serviços, ficha, dados do salão, respostas
//      aprendidas, áudios, valor do sinal). O prompt da loja diz onde cada um entra, com @@NOME@@;
//   2. as regras desses blocos NÃO entram: cada regra fica escrita uma vez, no prompt-agente.md da loja;
//   3. a descrição das ferramentas que dizem coisa diferente do prompt é TROCADA inteira pela de lojas/<slug>/ferramentas.json;
//   4. o texto final é conferido: não pode ter marca de regra empilhada nem recado para programador.
// Roda depois de todos os módulos que mexem no texto do agente e antes do paraLoja (os nomes ainda são os da base).
// Sem a opção, nada muda (a Gleide não passa por aqui).
const fs = require('fs');
const path = require('path');

// cada dado: como reconhecer a expressão que os outros módulos montaram
const DADOS = {
  SERVICOS: (e) => e.includes("$('Supabase: tabela de serviços')"),
  FICHA: (e) => e.includes("$('Sobre esta cliente').first().json.texto") && e.length < 120,
  DADOS_DO_SALAO: (e) => e.includes("linhas.push('- Endereço: '"),
  RESPOSTAS: (e) => e.includes("$('Supabase: respostas aprendidas')"),
  AUDIOS: (e) => e.includes("$('Áudios disponíveis')"),
};
// o que não pode aparecer no texto que a IA lê
const PROIBIDO = [
  [/vale (mais|acima)/i, '"vale mais que / vale acima de": regra empilhada; apague a regra antiga e escreva a certa no lugar'],
  [/\bEXCEÇÃO\b|exceção (à|a esta|a essa|desta|dessa) regra|acima d[ao]s? (seç|regra|bloco|anterior)|ignore a (regra|seção|instrução)/i, 'regra com remendo ("exceção", "acima da regra", "ignore a regra"); reescreva a regra inteira'],
  [/pedido do Victor/i, 'histórico de quem pediu a regra não é para a IA'],
  [/\(\d\d\/\d\d\/20\d\d[:)]/, 'data de conserto não é para a IA'],
  [/se[cç][aã]o \d+/i, 'referência a seção numerada de versão antiga'],
  [/\bn8n\b|workflow|webhook|Supabase anterior|placeholders/i, 'recado para programador dentro do texto da IA'],
];

// separa as expressões {{ ... }} do texto (o fim é o primeiro "}}" em que o miolo é JavaScript válido)
function expressoes(texto) {
  const achadas = [];
  for (let i = texto.indexOf('{{'); i >= 0; i = texto.indexOf('{{', i)) {
    let fim = -1;
    for (let j = texto.indexOf('}}', i + 2); j >= 0; j = texto.indexOf('}}', j + 2)) {
      try { new Function('return (' + texto.slice(i + 2, j) + '\n)'); fim = j + 2; break; } catch (e) { /* ainda dentro do código */ }
    }
    if (fim < 0) throw new Error('prompt-inteiro: expressão sem fim perto de "' + texto.slice(i, i + 60) + '"');
    achadas.push(texto.slice(i, fim));
    i = fim;
  }
  return achadas;
}

module.exports = ({ workflow, loja }) => {
  const agente = workflow.nodes.find((n) => n.name === 'Agente IA');
  if (!agente) throw new Error('prompt-inteiro: sem o nó "Agente IA"');
  const montado = String(agente.parameters.options.systemMessage || '');
  const md = fs.readFileSync(path.join(loja.pasta, 'prompt-agente.md'), 'utf8').replace(/\r\n/g, '\n');
  let texto = md.match(/```text\n([\s\S]*?)```/)[1].trim();

  // ---------- 1. os dados que os módulos montaram ----------
  const todas = expressoes(montado);
  const valor = {};
  for (const [nome, ehEste] of Object.entries(DADOS)) {
    const e = todas.filter(ehEste);
    if (e.length > 1 && new Set(e).size > 1) throw new Error(`prompt-inteiro: achei ${e.length} expressões diferentes para ${nome}`);
    if (e.length) valor[nome] = e[0];
  }
  // o valor e a regra do sinal (do cadastro); o jeito de cobrar está escrito no prompt da loja
  const dadosNo = (valor.DADOS_DO_SALAO || '').match(/\$\('([^']+)'\)\.first\(\)\.json\.config/);
  if (dadosNo) valor.SINAL = "{{ (() => { const s = ((($('" + dadosNo[1] + "').first().json.config || {}).loja || {}).sinal_pix) || {}; " +
    "if (!s.ativo || !(Number(s.valor) > 0)) return 'O studio não pede sinal: não fale em sinal nem em Pix para reservar.'; " +
    "const v = Number(s.valor); const reais = 'R$ ' + (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')); " +
    "return (s.so_para_quem_faltou ? 'Sinal só para quem já faltou a um horário (a ficha diz): ' + reais : 'Sinal de todo horário novo: ' + reais) + ', por Pix, descontado do valor do serviço no dia.' + (s.regra ? ' ' + String(s.regra).trim() : ''); })() }}";

  // ---------- 2. o prompt da loja com os dados no lugar ----------
  for (const nome of Object.keys(valor)) {
    const marca = '@@' + nome + '@@';
    const vezes = texto.split(marca).length - 1;
    if (vezes !== 1) throw new Error(`prompt-inteiro: o prompt da loja precisa ter ${marca} uma vez (tem ${vezes}); sem ela a IA fica sem esse dado`);
    texto = texto.split(marca).join(valor[nome]);
  }
  const sobrou = texto.match(/@@[A-Z_]+@@/);
  if (sobrou) throw new Error(`prompt-inteiro: ${sobrou[0]} no prompt da loja não tem dado correspondente (o módulo que monta esse dado está desligado?)`);

  // ---------- 3. conferência: nada de regra empilhada no que a IA lê ----------
  const semCodigo = expressoes(texto).reduce((t, e) => t.split(e).join(''), texto);
  const erros = PROIBIDO.map(([re, porque]) => { const m = semCodigo.match(re); return m ? `"${m[0]}": ${porque}` : null; }).filter(Boolean);
  if (erros.length) throw new Error('prompt-inteiro: o prompt da loja tem regra empilhada ou recado que não é para a IA:\n- ' + erros.join('\n- '));
  agente.parameters.options.systemMessage = '=' + texto;

  // ---------- 4. descrição das ferramentas: troca inteira, pelo arquivo da loja ----------
  ferramentasDaLoja(workflow, path.join(loja.pasta, 'ferramentas.json'));

  // ---------- 5. cumprimento de volta: o filtro da saída não apaga o "Oi Ana boa tarde" quando ELA cumprimentou ----------
  // (a base tira o cumprimento de quem já recebeu resposta nas últimas 3 h; o prompt da loja manda cumprimentar de volta
  // quem cumprimenta. Vale a regra do prompt: aqui o filtro é trocado, não fica uma regra por cima da outra.)
  const quebrar = workflow.nodes.find((n) => n.name === 'Quebrar mensagens');
  const DE = 'if (jaFalou) {';
  if (!quebrar || quebrar.parameters.jsCode.split(DE).length !== 2) throw new Error('prompt-inteiro: o filtro do cumprimento em "Quebrar mensagens" mudou');
  quebrar.parameters.jsCode = quebrar.parameters.jsCode.replace(DE,
    "const elaCumprimentou = /^\\s*(\\[\\d+\\]\\s*)?(oi+e*|ol[áa]|opa|bom dia|boa tarde|boa noite)(?![a-zà-ú])/i.test(String($('Montar entrada').first().json.texto_cliente || ''));\nif (jaFalou && !elaCumprimentou) {");
};

// A descrição (e a dos campos) de cada ferramenta citada no arquivo da loja é trocada inteira: uma ferramenta que diz
// coisa diferente do prompt é uma segunda regra para o mesmo assunto.
function ferramentasDaLoja(workflow, arq) {
  if (!fs.existsSync(arq)) return;
  for (const [nome, f] of Object.entries(JSON.parse(fs.readFileSync(arq, 'utf8')))) {
    const no = workflow.nodes.find((n) => n.name === nome);
    if (!no) throw new Error(`prompt-inteiro: ${path.basename(arq)} fala de "${nome}", que não existe no agente`);
    // ferramenta que não serve para esta loja (ex.: resultado de avaliação de mega hair numa loja de unhas) sai inteira
    if (f.remover) { workflow.nodes = workflow.nodes.filter((n) => n !== no); delete workflow.connections[nome]; continue; }
    const p = no.parameters;
    const campoDesc = 'description' in p ? 'description' : 'toolDescription' in p ? 'toolDescription' : null;
    if (f.descricao !== undefined) {
      if (!campoDesc) throw new Error(`prompt-inteiro: não achei a descrição de "${nome}"`);
      p[campoDesc] = f.descricao;
    }
    for (const [campo, desc] of Object.entries(f.campos || {})) {
      const v = (p.workflowInputs || { value: {} }).value;
      const antes = String(v[campo] || '');
      const depois = antes.replace(/(\$fromAI\('[^']*',\s*`)[\s\S]*?(`)/, (m, a, b) => a + desc.replace(/`/g, "'") + b);
      if (!antes.includes('$fromAI(') || depois === antes && !antes.includes(desc)) throw new Error(`prompt-inteiro: não consegui trocar a descrição do campo "${campo}" de "${nome}"`);
      v[campo] = depois;
    }
    const texto2 = [f.descricao || '', ...Object.values(f.campos || {})].join('\n');
    const e2 = PROIBIDO.map(([re, porque]) => { const m = texto2.match(re); return m ? `"${m[0]}": ${porque}` : null; }).filter(Boolean);
    if (e2.length) throw new Error(`prompt-inteiro: ${path.basename(arq)}, "${nome}":\n- ` + e2.join('\n- '));
  }
}

// A ASSISTENTE DA DONA (lojas/<slug>/<prompt_assistente> com marcas @@NOME@@): o mesmo caminho. O arquivo da loja é todo o
// texto de regras; dos blocos que os módulos colam (registro do que já fez, conversas das clientes, serviços, chave Pix,
// endereço) fica só o dado. Descrição de ferramenta: lojas/<slug>/ferramentas-assistente.json.
const DADOS_ASSISTENTE = {
  ENDERECO: (e) => e.includes('c.endereco') && e.includes('mapa') && e.length < 900,
  SERVICOS: (e) => e.includes("$('Ler serviços')"),
  PIX: (e) => e.includes('sinal_pix') && e.includes('nome_recebedor'),
  CONVERSAS: (e) => e.includes("$('Ler conversas')"),
  FEITOS: (e) => e.includes("$('Contexto').first().json.texto"),
};
module.exports.assistente = ({ assistenteWorkflow, loja }) => {
  if (!loja.prompt_assistente) return false;
  let texto = fs.readFileSync(path.join(loja.pasta, loja.prompt_assistente), 'utf8').replace(/\r\n/g, '\n').trim();
  if (!/@@[A-Z_]+@@/.test(texto)) return false; // prompt antigo, sem as marcas: fica como está
  // o texto novo manda gravar o horário ditado pela dona com forcar = sim na primeira chamada: isso só vale com o assistente-marcar.js
  if (!loja.assistente_marcar) throw new Error('prompt-inteiro (assistente): ligue "assistente_marcar" no loja.json (sem ele o forcar da primeira chamada é ignorado)');
  const agente = assistenteWorkflow.nodes.find((n) => n.name === 'Agente assistente');
  if (!agente) throw new Error('prompt-inteiro: sem o nó "Agente assistente"');
  const todas = expressoes(String(agente.parameters.options.systemMessage || ''));
  for (const [nome, ehEste] of Object.entries(DADOS_ASSISTENTE)) {
    const e = [...new Set(todas.filter(ehEste))];
    const marca = '@@' + nome + '@@', vezes = texto.split(marca).length - 1;
    if (e.length > 1) throw new Error(`prompt-inteiro (assistente): achei ${e.length} expressões diferentes para ${nome}`);
    if (e.length && vezes !== 1) throw new Error(`prompt-inteiro (assistente): o prompt precisa ter ${marca} uma vez (tem ${vezes})`);
    if (e.length) texto = texto.split(marca).join(e[0]);
  }
  const sobrou = texto.match(/@@[A-Z_]+@@/);
  if (sobrou) throw new Error(`prompt-inteiro (assistente): ${sobrou[0]} não tem dado correspondente (o módulo que monta esse dado está desligado?)`);
  const semCodigo = expressoes(texto).reduce((t, e) => t.split(e).join(''), texto);
  const erros = PROIBIDO.map(([re, porque]) => { const m = semCodigo.match(re); return m ? `"${m[0]}": ${porque}` : null; }).filter(Boolean);
  if (erros.length) throw new Error('prompt-inteiro (assistente): o prompt tem regra empilhada ou recado que não é para a IA:\n- ' + erros.join('\n- '));
  agente.parameters.options.systemMessage = '=' + texto;
  ferramentasDaLoja(assistenteWorkflow, path.join(loja.pasta, 'ferramentas-assistente.json'));

  // mais ágil: a assistente é da dona, não precisa de ritmo de gente digitando. Junta mensagens seguidas por 10 s (eram 15),
  // "lendo" de 0,5 a 1,5 s e "digitando" de 1 a 2,5 s (eram 1,5-4 s e 2-8 s). Valores trocados, não somados.
  const achar = (nome) => { const n = assistenteWorkflow.nodes.find((x) => x.name === nome); if (!n) throw new Error('prompt-inteiro (assistente): sem o nó ' + nome); return n; };
  const juntar = achar('Aguardar (juntar mensagens)').parameters;
  if (juntar.amount !== 15) throw new Error('prompt-inteiro (assistente): a espera de juntar mensagens mudou (' + juntar.amount + ')');
  juntar.amount = 10;
  const ritmo = achar('Ritmo humano').parameters;
  const DE1 = 'const pausa = Math.min(4, 1.5 + dela.length / 120 + (dela.startsWith(\'[áudio]\') ? 1 : 0));';
  const DE2 = 'const delay = Math.round(Math.min(8000, Math.max(2000, texto.length * 30)));';
  if (!ritmo.jsCode.includes(DE1) || !ritmo.jsCode.includes(DE2)) throw new Error('prompt-inteiro (assistente): o "Ritmo humano" mudou');
  ritmo.jsCode = ritmo.jsCode.replace(DE1, 'const pausa = Math.min(1.5, 0.5 + dela.length / 400);')
    .replace(DE2, 'const delay = Math.round(Math.min(2500, Math.max(1000, texto.length * 10)));');
  return true;
};

module.exports.expressoes = expressoes;
module.exports.PROIBIDO = PROIBIDO;
