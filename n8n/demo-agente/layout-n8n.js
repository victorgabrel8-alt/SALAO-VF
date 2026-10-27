// Organização visual dos workflows no n8n (só visual, não muda o que o fluxo faz).
// Chamado pelo montar-workflow.js antes de gravar/enviar. Organiza TODOS os workflows sozinho, então nó novo
// já entra no lugar certo sem precisar de posição escrita à mão:
//   - o fluxo anda da esquerda para a direita, na ordem das ligações (cada coluna = um passo);
//   - quando o fluxo se divide (sim/não), cada saída vai para uma linha diferente, de cima para baixo;
//   - ferramentas, modelo e memória de um agente ficam numa grade logo abaixo dele;
//   - uma nota no topo explica o que o workflow faz e quando ele roda.
// Cores das notas no n8n: 1 amarelo, 2 laranja, 3 vermelho, 4 verde, 5 azul, 6 roxo, 7 cinza

const COLUNA = 300; // distância entre um passo e o seguinte
const LINHA = 200; // distância entre linhas (nós empilhados no mesmo passo)
const SUB_X = 180; // grade das ferramentas do agente
const SUB_Y = 160;
const SUB_COLUNAS = 4;
const POR_LINHA = 14; // passos por faixa: fluxo comprido quebra em faixas, uma embaixo da outra (como um texto)
const ENTRE_FAIXAS = 260;
const NOTA = 'n8n-nodes-base.stickyNote';
const grade = (v) => Math.round(v / 20) * 20;

let nNota = 0;
const nota = (x, y, w, h, color, content) => ({
  id: `00000000-0000-4000-9000-${String(++nNota).padStart(12, '0')}`, name: `Nota ${nNota}`,
  type: NOTA, typeVersion: 1, position: [x, y], parameters: { content, width: w, height: h, color },
});

const organizar = (wf, titulo, texto, cor = 7) => {
  const nos = wf.nodes.filter((n) => n.type !== NOTA);
  const porNome = Object.fromEntries(nos.map((n) => [n.name, n]));

  // ligações: "main" é o caminho do fluxo; ai_tool/ai_memory/ai_languageModel ligam um sub-nó ao agente
  const saidas = {}; const entradas = {}; const subs = {}; const temMain = new Set();
  for (const [origem, porTipo] of Object.entries(wf.connections || {})) {
    if (!porNome[origem]) continue;
    for (const [tipo, listas] of Object.entries(porTipo)) {
      (listas || []).forEach((lista, i) => (lista || []).forEach((l) => {
        if (!porNome[l.node]) return;
        if (tipo === 'main') {
          (saidas[origem] ||= []).push({ no: l.node, saida: i });
          (entradas[l.node] ||= []).push(origem);
          temMain.add(origem); temMain.add(l.node);
        } else if (!(subs[l.node] ||= []).includes(origem)) subs[l.node].push(origem);
      }));
    }
  }
  const eSub = new Set(Object.values(subs).flat().filter((n) => !temMain.has(n)));
  const principais = nos.map((n) => n.name).filter((n) => !eSub.has(n));

  // ligações que voltam para trás (laço de nova tentativa) não contam para a ordem das colunas
  const volta = new Set(); const visto = new Set(); const naPilha = new Set();
  const dfs = (n) => {
    visto.add(n); naPilha.add(n);
    for (const { no } of saidas[n] || []) {
      if (naPilha.has(no)) volta.add(`${n}>${no}`);
      else if (!visto.has(no)) dfs(no);
    }
    naPilha.delete(n);
  };
  for (const n of principais) if (!(entradas[n] || []).length && !visto.has(n)) dfs(n);
  for (const n of principais) if (!visto.has(n)) dfs(n);
  const antes = (n) => (entradas[n] || []).filter((o) => !volta.has(`${o}>${n}`));

  // coluna = o caminho mais longo desde o começo do fluxo
  const coluna = {};
  const calcular = (n, seen = new Set()) => {
    if (coluna[n] !== undefined) return coluna[n];
    if (seen.has(n)) return 0;
    seen.add(n);
    const ps = antes(n);
    coluna[n] = ps.length ? Math.max(...ps.map((p) => calcular(p, seen) + 1)) : 0;
    return coluna[n];
  };
  principais.forEach((n) => calcular(n));

  // largura de cada coluna e altura de cada nó (agente com ferramentas ocupa mais)
  const nCol = Math.max(0, ...Object.values(coluna)) + 1;
  const largura = Array(nCol).fill(COLUNA);
  const altura = {};
  for (const n of principais) {
    const k = (subs[n] || []).filter((s) => eSub.has(s)).length;
    const cols = Math.min(k, SUB_COLUNAS);
    altura[n] = LINHA + (k ? Math.ceil(k / SUB_COLUNAS) * SUB_Y + 60 : 0);
    if (k) largura[coluna[n]] = Math.max(largura[coluna[n]], (cols - 1) * SUB_X + COLUNA);
  }
  const xCol = []; largura.reduce((x, w, i) => { xCol[i] = x; return x + w; }, 0);

  // linha: cada nó tenta ficar na altura de quem vem antes dele (a 2ª saída de um "sim/não" desce uma linha)
  const y = {};
  for (let c = 0; c < nCol; c++) {
    const daColuna = principais.filter((n) => coluna[n] === c).map((n, i) => {
      const desejos = antes(n).filter((p) => y[p] !== undefined).map((p) => {
        const s = (saidas[p] || []).find((l) => l.no === n);
        return y[p] + (s ? s.saida : 0) * LINHA;
      });
      return { n, desejo: desejos.length ? Math.min(...desejos) : Infinity, i };
    }).sort((a, b) => a.desejo - b.desejo || a.i - b.i);
    let cursor = -Infinity;
    for (const { n, desejo } of daColuna) {
      const alvo = desejo === Infinity ? (cursor === -Infinity ? 0 : cursor) : desejo;
      y[n] = Math.max(alvo, cursor === -Infinity ? alvo : cursor);
      cursor = y[n] + altura[n];
    }
  }

  // faixas: a coluna 14 volta para a esquerda, embaixo de tudo o que veio antes
  const faixa = (n) => Math.floor(coluna[n] / POR_LINHA);
  const nFaixas = Math.max(0, ...principais.map(faixa)) + 1;
  const topo = []; let base = 0;
  for (let f = 0; f < nFaixas; f++) {
    const da = principais.filter((n) => faixa(n) === f);
    if (!da.length) { topo[f] = base; continue; }
    const minY = Math.min(...da.map((n) => y[n]));
    const maxY = Math.max(...da.map((n) => y[n] + altura[n]));
    topo[f] = base - minY;
    base += maxY - minY + ENTRE_FAIXAS;
  }
  for (const n of principais) {
    const f = faixa(n);
    porNome[n].position = [grade(xCol[coluna[n]] - xCol[f * POR_LINHA]), grade(y[n] + topo[f])];
  }
  // sub-nós (modelo, memória, ferramentas) numa grade embaixo do agente
  for (const [alvo, lista] of Object.entries(subs)) {
    if (!porNome[alvo] || !porNome[alvo].position) continue;
    const [ax, ay] = porNome[alvo].position;
    lista.filter((s) => eSub.has(s)).forEach((s, i) => {
      porNome[s].position = [grade(ax + (i % SUB_COLUNAS) * SUB_X), grade(ay + LINHA - 20 + Math.floor(i / SUB_COLUNAS) * SUB_Y)];
    });
  }
  // sub-nó solto (sem agente no fluxo) vai para o fim, para não cair em cima de ninguém
  const soltos = nos.filter((n) => eSub.has(n.name) && !Object.entries(subs).some(([a, l]) => porNome[a] && porNome[a].position && l.includes(n.name)));
  soltos.forEach((n, i) => { n.position = [grade(i * SUB_X), grade(base)]; });

  const xs = nos.map((n) => n.position[0]);
  const ys = nos.map((n) => n.position[1]);
  const larguraTotal = Math.max(...xs) - Math.min(...xs) + COLUNA;
  const linhas = texto.split('\n').length + (nFaixas > 1 ? 2 : 0);
  const alturaNota = 120 + linhas * 26;
  wf.nodes = [
    nota(Math.min(...xs) - 40, Math.min(...ys) - alturaNota - 60, Math.max(520, Math.min(larguraTotal, 1400)), alturaNota, cor,
      `## ${titulo}\n${texto}${nFaixas > 1 ? '\n\n➡️ O fluxo é lido da esquerda para a direita e continua na faixa de baixo.' : ''}`),
    ...nos,
  ];
};

module.exports = organizar;
