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
  [/\bEXCEÇÃO\b/, '"EXCEÇÃO": regra com remendo; reescreva a regra inteira'],
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
    "return 'Sinal de todo horário novo: R$ ' + String(Number(s.valor)).replace('.', ',') + ', por Pix, descontado do valor do serviço no dia.' + (s.regra ? ' ' + String(s.regra).trim() : ''); })() }}";

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
  const arq = path.join(loja.pasta, 'ferramentas.json');
  if (fs.existsSync(arq)) {
    for (const [nome, f] of Object.entries(JSON.parse(fs.readFileSync(arq, 'utf8')))) {
      const no = workflow.nodes.find((n) => n.name === nome);
      if (!no) throw new Error(`prompt-inteiro: ferramentas.json fala de "${nome}", que não existe no agente`);
      const p = no.parameters;
      const campoDesc = 'description' in p ? 'description' : 'toolDescription' in p ? 'toolDescription' : null;
      if (!campoDesc) throw new Error(`prompt-inteiro: não achei a descrição de "${nome}"`);
      p[campoDesc] = f.descricao;
      for (const [campo, desc] of Object.entries(f.campos || {})) {
        const v = (p.workflowInputs || { value: {} }).value;
        const antes = String(v[campo] || '');
        const depois = antes.replace(/(\$fromAI\('[^']*',\s*`)[\s\S]*?(`)/, (m, a, b) => a + desc.replace(/`/g, "'") + b);
        if (!antes.includes('$fromAI(') || depois === antes && !antes.includes(desc)) throw new Error(`prompt-inteiro: não consegui trocar a descrição do campo "${campo}" de "${nome}"`);
        v[campo] = depois;
      }
      const texto2 = [f.descricao, ...Object.values(f.campos || {})].join('\n');
      const e2 = PROIBIDO.map(([re, porque]) => { const m = texto2.match(re); return m ? `"${m[0]}": ${porque}` : null; }).filter(Boolean);
      if (e2.length) throw new Error(`prompt-inteiro: ferramentas.json, "${nome}":\n- ` + e2.join('\n- '));
    }
  }

  // ---------- 5. cumprimento de volta: o filtro da saída não apaga o "Oi Ana boa tarde" quando ELA cumprimentou ----------
  // (a base tira o cumprimento de quem já recebeu resposta nas últimas 3 h; o prompt da loja manda cumprimentar de volta
  // quem cumprimenta. Vale a regra do prompt: aqui o filtro é trocado, não fica uma regra por cima da outra.)
  const quebrar = workflow.nodes.find((n) => n.name === 'Quebrar mensagens');
  const DE = 'if (jaFalou) {';
  if (!quebrar || quebrar.parameters.jsCode.split(DE).length !== 2) throw new Error('prompt-inteiro: o filtro do cumprimento em "Quebrar mensagens" mudou');
  quebrar.parameters.jsCode = quebrar.parameters.jsCode.replace(DE,
    "const elaCumprimentou = /^\\s*(\\[\\d+\\]\\s*)?(oi+e*|ol[áa]|opa|bom dia|boa tarde|boa noite)\\b/i.test(String($('Montar entrada').first().json.texto_cliente || ''));\nif (jaFalou && !elaCumprimentou) {");
};

module.exports.expressoes = expressoes;
module.exports.PROIBIDO = PROIBIDO;
