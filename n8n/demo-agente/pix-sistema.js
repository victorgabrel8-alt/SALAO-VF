// Pix do sinal pelo sistema (só nas lojas com "pix_sistema": true no loja.json; precisa de sinal_pix com o bloco do
// prompt, ou seja, sem sinal_sem_bloco; a Gleide não passa por aqui).
//
// Erro real da Caroline (relatório de 20/11/2026, erro 1): em 7 dias, 25 mensagens com a chave Pix saíram erradas:
// grudada no fim do texto (14), sozinha sem dizer o que é (9) ou repetida (3). Duas clientes mandaram a chave de volta
// sem entender. Causa: a IA decide como escreve a chave e o "Quebrar mensagens" junta tudo em no máximo 2 balões.
//
// Agora a IA não escreve mais a chave. Quando for pedir o sinal ela escreve só a marca [[PIX: serviço; dia e hora]]
// e o sistema troca a marca por 3 mensagens, sempre iguais, montadas com o cadastro:
//   1. "A manicure fica R$ 50. Pra garantir sábado às 8h é um sinal de R$ 20 no Pix, que fica descontado. No dia você
//      paga R$ 30." (preço da tabela servicos; sinal de config.loja.sinal_pix.valor). Serviço que não bate com a lista
//      ou horário que não apareceu na conversa ficam de fora: sai a versão curta, sem inventar.
//   2. a chave sozinha (config.loja.sinal_pix.chave), para copiar no celular;
//   3. "Chave aleatória em nome de Caroline. Me manda o print do comprovante por aqui 🙏" (tipo da chave e nome da
//      recebedora do cadastro; config.loja.sinal_pix.tipo_chave, se existir, vale mais que o tipo adivinhado).
// A chave nunca sai de novo se o salão já mandou ela a esta cliente nas últimas horas (config.loja.sinal_pix.
// chave_repetir_horas, padrão 12, o mesmo prazo das "últimas mensagens"): sai só "É a mesma chave Pix que te mandei
// acima 🙏". Só manda de novo se a cliente pedir a chave ("não achei a chave", "manda de novo o pix").
// Também não sai Pix quando o horário acabou de ser gravado (AGENDADO) ou quando a cliente já mandou o comprovante
// depois da última chave (a não ser que ela peça a chave de novo).
// Se a IA ainda escrever a chave por conta própria (memória antiga), o sistema assume do mesmo jeito: chave sozinha,
// a mensagem 3 e nada repetido.
//
// Onde: só no código do "Quebrar mensagens" (nenhum nó novo, nenhuma ligação nova) e no prompt (bloco PIX PELO
// SISTEMA, que só aparece quando o sinal está ligado e com chave e valor). Não cria pergunta para a dona.
// Ordem no montar-workflow.js: depois do sinal-pix.js (troca duas linhas do bloco SINAL PARA RESERVAR) e de qualquer
// módulo que mexa no "Quebrar mensagens"; a parte 2 entra antes da "Pontuação grudada", depois do saida-limpa.js.

const MARCA = '⟦PIX⟧';

module.exports = ({ workflow, loja }) => {
  const achar = (nome) => { const n = workflow.nodes.find((x) => x.name === nome); if (!n) throw new Error(`pix_sistema: não achei "${nome}"`); return n; };
  const trocar = (texto, de, para, onde) => {
    if (String(texto).split(de).length !== 2) throw new Error(`pix_sistema: "${onde}" mudou`);
    return String(texto).replace(de, () => para);
  };
  for (const nome of ['Supabase: dados do salão', 'Supabase: tabela de serviços', 'Supabase: últimas mensagens', 'Sobre esta cliente', 'Montar entrada']) achar(nome);

  // quem atende (para "sábado às 8h com a Duda"): a dona e a segunda profissional do loja.json
  const nomes = [loja && loja.dona, loja && loja.segunda_profissional && loja.segunda_profissional.nome]
    .filter((n) => typeof n === 'string' && /^[A-Za-zÀ-ú]+$/.test(n));
  const dona = (loja && loja.dona) || 'a dona';

  // ---------- 1. Quebrar mensagens ----------
  const q = achar('Quebrar mensagens');
  let js = q.parameters.jsCode;

  // parte 1: logo depois de ler a resposta da IA, a marca vira um parágrafo só com ⟦PIX⟧ (sobrevive à limpeza e ao
  // "no máximo 2 balões"); o que a IA escreveu dentro da marca fica guardado em pixPedido
  js = trocar(js, '// Prompt: se o áudio respondeu tudo, a IA não escreve nada.', String.raw`// ---- pix-sistema.js (1/2): a marca [[PIX: serviço; dia e hora]] da IA; o texto do Pix quem monta é o sistema ----
let pixPedido = null;
t = t.replace(/\[\[\s*PIX\b:?([^\]\n]*)\]\]|\[PIX(?::([^\]\n]*))?\]/g, (m, a, b) => { if (!pixPedido) pixPedido = { args: String(a || b || '') }; return '\n\n${MARCA}\n\n'; }).trim();
// ---- fim pix-sistema.js (1/2) ----
// Prompt: se o áudio respondeu tudo, a IA não escreve nada.`, 'Quebrar mensagens (leitura da resposta)');

  // parte 2: os balões já prontos (depois do saida-limpa.js): a marca vira as 3 mensagens
  js = trocar(js, "// Pontuação grudada no fim de um link (ex.: 'wa.me/c/556696795639.')", String.raw`// ---- pix-sistema.js (2/2) ----
{
  const MARCA = '__MARCA__';
  const tirarMarca = () => { baloes = baloes.map((b) => ({ ...b, t: b.t.split(MARCA).join(' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim() })).filter((b) => b.t); };
  let chaveReserva = '';
  try {
    const sp = ((($('Supabase: dados do salão').first().json.config || {}).loja || {}).sinal_pix) || {};
    const chave = String(sp.chave || '').trim();
    chaveReserva = chave;
    const valor = Number(sp.valor || 0);
    const ligado = !!sp.ativo && !!chave && valor > 0;
    const semEsp = (s) => String(s || '').replace(/\s+/g, '');
    const esc = (s) => s.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&');
    const reChave = new RegExp(semEsp(chave).split('').map(esc).join('\\s*') || '(?!)', 'g');
    const temChave = (s) => !!chave && semEsp(s).includes(semEsp(chave));
    const temMarca = baloes.some((b) => b.t.includes(MARCA));
    const chaveSolta = ligado && !temMarca && baloes.some((b) => temChave(b.t));
    if (!ligado || (!temMarca && !chaveSolta)) { if (temMarca) tirarMarca(); }
    else {
      const pega = (no, f, padrao) => { try { return f($(no)); } catch (e) { return padrao; } };
      const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
      const servicos = pega('Supabase: tabela de serviços', (n) => n.all().map((i) => i.json).filter((s) => s && s.nome), []);
      const recentes = pega('Supabase: últimas mensagens', (n) => n.all().map((i) => i.json).filter((m) => m && m.direcao && m.criado_em), []);
      const ficha = String(pega('Sobre esta cliente', (n) => n.first().json.texto, '') || '');
      const msgDela = String(pega('Montar entrada', (n) => n.first().json.texto_cliente, '') || '');
      const passosPix = pega('Agente IA', (n) => n.first().json.intermediateSteps, []) || [];
      const agoraMs = Date.now();
      const horas = Math.max(0, Number(sp.chave_repetir_horas) || 12);
      const dentro = (m) => agoraMs - Date.parse(m.criado_em) <= horas * 3600e3;
      // a chave já saiu (pela IA, pela assistente ou pela dona) nas últimas horas?
      const ultimaChave = Math.max(0, ...recentes.filter((m) => m.direcao === 'saida' && dentro(m) && temChave(m.conteudo)).map((m) => Date.parse(m.criado_em)));
      const pagouDepois = recentes.some((m) => m.direcao === 'entrada' && dentro(m) && /COMPROVANTE PIX/i.test(String(m.conteudo || '')) && Date.parse(m.criado_em) > ultimaChave);
      // ela pediu a chave de novo ("não achei a chave", "manda o pix de novo", "qual a chave?")
      const pediuChave = /\b(chave|pix)\b/i.test(msgDela) && /(de novo|novamente|outra vez|n[ãa]o (achei|encontrei|veio|chegou|apareceu|consigo|consegui|t[ôo] achando)|reenvi|manda(r|)\s+(a|o|de novo|aqui|a[ií])\b|qual (é |e )?(a|o)\b|me passa|passa (a|o|de novo)|copiar)/i.test(msgDela);
      const gravouAgora = passosPix.some((p) => p && p.action && ['criar_agendamento', 'remarcar_agendamento'].includes(p.action.tool) &&
        /\b(AGENDADO|REMARCADO)\b/.test(String(typeof p.observation === 'string' ? p.observation : JSON.stringify(p.observation || ''))) &&
        !/N[ÃA]O (AGENDADO|REMARCADO)/.test(String(typeof p.observation === 'string' ? p.observation : JSON.stringify(p.observation || ''))));
      // NÃO AGENDADO agora (comprovante recusado): a chave pode precisar sair de novo, não conta como pago
      const recusouAgora = passosPix.some((p) => p && p.action && p.action.tool === 'criar_agendamento' &&
        /N[ÃA]O AGENDADO/.test(String(typeof p.observation === 'string' ? p.observation : JSON.stringify(p.observation || ''))));
      let modo;
      if (chaveSolta) modo = ultimaChave && !pediuChave ? 'repetida' : 'solta';
      else if (gravouAgora || (pagouDepois && !pediuChave && !recusouAgora)) modo = 'sem_pix';
      else modo = ultimaChave && !pediuChave ? 'repetida' : 'completo';

      // ---- mensagem 1: preço da lista, sinal e o que fica pro dia ----
      const fmt = (v) => (Math.round(v * 100) % 100 ? v.toFixed(2).replace('.', ',') : String(Math.round(v)));
      const partes = String((pixPedido && pixPedido.args) || '').split(/[;|]/).map((s) => s.replace(/^\s*(servi[cç]os?|quando|dia|hor[aá]rio)\s*[:=]\s*/i, '').trim()).filter(Boolean);
      const HORA = /\b([01]?\d|2[0-3])(?:h([0-5]\d)?|:([0-5]\d))/;
      let servTxt = partes.find((p) => !HORA.test(p)) || '';
      let quandoTxt = partes.find((p) => HORA.test(p)) || '';
      const acharServ = (nome) => {
        const n = norm(nome).replace(/^(a|o|um|uma)\s+/, '');
        if (!n) return null;
        const igual = servicos.filter((s) => norm(s.nome) === n);
        if (igual.length) return igual.length === 1 ? igual[0] : null;
        const perto = servicos.filter((s) => norm(s.nome).startsWith(n) || n.startsWith(norm(s.nome)));
        return perto.length === 1 ? perto[0] : null;
      };
      const itens = servTxt ? servTxt.split(/\s*\+\s*/).map(acharServ) : [];
      const servOk = itens.length > 0 && itens.every((s) => s && Number(s.preco) > 0);
      // dia e hora: só no formato "sábado às 8h" / "amanhã às 14h30 com a Duda" e só hora que já apareceu na conversa,
      // na ferramenta ou na ficha (a marca não inventa horário)
      const QUEM = __QUEM__;
      const DIA = '(?:hoje|amanh[ãa]|depois de amanh[ãa]|(?:segunda|ter[çc]a|quarta|quinta|sexta)(?:-feira)?|s[áa]bado|domingo)(?:,?\\s*(?:dia\\s+)?\\d{1,2}(?:\\/\\d{1,2})?)?|dia\\s+\\d{1,2}(?:\\/\\d{1,2})?|\\d{1,2}\\/\\d{1,2}';
      const reQuando = new RegExp('^(?:(?:n[oa]|pra|para)\\s+)?(' + DIA + ')\\s*,?\\s*(?:[àa]s\\s+)?([01]?\\d|2[0-3])(?:h([0-5]\\d)?|:([0-5]\\d))(?:\\s+com\\s+a\\s+(' + (QUEM.length ? QUEM.join('|') : '(?!)') + '))?\\.?$', 'i');
      let quando = '';
      const mq = reQuando.exec(quandoTxt.replace(/\s+/g, ' ').trim());
      if (mq) {
        const h = Number(mq[2]), mi = Number(mq[3] || mq[4] || 0);
        const fontes = [...recentes.map((m) => String(m.conteudo || '')), ...passosPix.map((p) => String(p && typeof p.observation === 'string' ? p.observation : JSON.stringify((p && p.observation) || ''))), ficha, msgDela].join('\n');
        let achou = false;
        for (const m of fontes.matchAll(/\b([01]?\d|2[0-3])(?:h([0-5]\d)?|:([0-5]\d))|T([01]\d|2[0-3]):([0-5]\d)/g)) {
          const hh = Number(m[1] !== undefined ? m[1] : m[4]), mm = Number((m[1] !== undefined ? (m[2] || m[3]) : m[5]) || 0);
          if (hh === h && mm === mi) { achou = true; break; }
        }
        if (achou) {
          const quem = mq[5] ? QUEM.find((n) => n.toLowerCase() === mq[5].toLowerCase()) : '';
          quando = mq[1].trim().replace(/^\p{Lu}/u, (l) => l.toLowerCase()) + ' às ' + h + 'h' + (mi ? String(mi).padStart(2, '0') : '') + (quem ? ' com a ' + quem : '');
        }
      }
      const comArtigo = (nome) => {
        const p = norm(nome).split(' ')[0];
        const fem = /(a|cao|sao|cure|gem|ade|ie)$/.test(p) && !/^(spa|dia|mapa|sistema)$/.test(p);
        return (fem ? 'a ' : 'o ') + nome.trim().replace(/^\p{Lu}(?=\p{Ll})/u, (l) => l.toLowerCase());
      };
      const maiuscula = (s) => s.charAt(0).toUpperCase() + s.slice(1);
      const garantir = 'Pra garantir ' + (quando || 'o horário') + ' é um sinal de R$ ' + fmt(valor) + ' no Pix, que fica descontado';
      let m1 = garantir + ' no dia.';
      if (servOk) {
        const total = itens.reduce((a, s) => a + Number(s.preco), 0);
        const aPartir = itens.some((s) => s.a_partir_de || /\bcada\b/i.test(s.nome));
        const desc = maiuscula(itens.map((s) => comArtigo(s.nome)).join(' e ')) + (itens.length > 1 ? ' ficam ' : ' fica ');
        if (aPartir) m1 = desc + 'a partir de R$ ' + fmt(total) + '. ' + garantir + ' no dia.';
        else if (total > valor) m1 = desc + 'R$ ' + fmt(total) + '. ' + garantir + '. No dia você paga R$ ' + fmt(total - valor) + '.';
        else m1 = desc + 'R$ ' + fmt(total) + '. ' + garantir + ' no dia.';
      }
      // ---- mensagem 3: tipo da chave e nome de quem recebe ----
      const k = semEsp(chave);
      const tipo = sp.tipo_chave ? 'Chave ' + String(sp.tipo_chave).trim().replace(/^chave\s+/i, '')
        : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k) ? 'Chave aleatória'
        : /^[^@]+@[^@]+\.[^@]+$/.test(k) ? 'Chave e-mail'
        : /^\+55\d{10,11}$/.test(k) ? 'Chave celular'
        : /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/.test(k) ? 'Chave CNPJ'
        : /^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(k) ? 'Chave CPF' : 'Chave Pix';
      const recebedor = [].concat(sp.nome_recebedor || []).map((n) => String(n || '').trim()).filter(Boolean)[0] || '';
      const m3 = tipo + (recebedor ? ' em nome de ' + recebedor : '') + '. Me manda o print do comprovante por aqui 🙏';
      const mRepetida = 'É a mesma chave Pix que te mandei acima 🙏';

      // ---- o texto da IA em volta: sai o que o sistema já diz (chave, sinal, comprovante) ----
      const FRASE = /(?<=[.!?🙏😊😉🥰])\s+/u;
      const tirarFrases = (txt, sai) => txt.split('\n').map((l) => l.split(FRASE).filter((f) => !sai(f)).join(' ').trim()).filter(Boolean).join('\n');
      // completo: sai a frase do sinal, da chave e do comprovante e, se a mensagem 1 tem o preço, a frase do preço
      // (a do voucher da esmaltação em gel fica)
      const saiCompleto = (f) => /\b(sinal|pix|chave|comprovante|print)\b/i.test(f) ||
        (servOk && /R\$/.test(f) && /\b(fica|ficam|custa|custam|paga|pagar|valor|total|restante|falta|faltam)\b/i.test(f) && !/voucher/i.test(f));
      // frase que apresenta a chave ("Segue a chave:", "Chave Pix:", "Pix em nome de ..."); "confere se usou a chave certa?" fica
      const apresentaChave = (f) => /pix em nome|\b(segue|aqui vai|aqui est[áa]|te mando|te passo|vou te passar|mando|essa [ée]|a chave [ée])\b[^.!?]*\bchave\b|\bchave\b[^.!?]*:\s*$/i.test(f) ||
        /^\s*(a\s+)?(chave|pix)(\s+pix)?\s*[:.]?\s*$/i.test(f);
      const saiSolta = (f) => apresentaChave(f) || /\bcomprovante\b|\bprint\b/i.test(f);
      const saiRepetida = apresentaChave;
      // chave escrita pela IA: vira a marca no primeiro lugar em que aparece e sai do resto
      if (chaveSolta) {
        let pos = false;
        baloes = baloes.map((b) => {
          let txt = b.t;
          if (temChave(txt)) { txt = txt.replace(reChave, () => (pos ? ' ' : (pos = true, MARCA))); }
          return { ...b, t: txt };
        });
      } else baloes = baloes.map((b) => ({ ...b, t: b.t.replace(reChave, ' ') }));
      const i = baloes.findIndex((b) => b.t.includes(MARCA));
      const limpa = (txt) => {
        let s = txt.split(MARCA).join('\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
        if (modo === 'completo') s = tirarFrases(s, saiCompleto);
        else if (modo === 'solta') s = tirarFrases(s, saiSolta);
        else if (modo === 'repetida') s = tirarFrases(s, saiRepetida);
        return s.replace(/[\s/:–-]+$/, '').trim();
      };
      const antes = baloes.slice(0, i).map((b) => ({ ...b, t: limpa(b.t) }));
      const [a0, ...resto] = baloes[i].t.split(MARCA);
      let aqui = limpa(a0);
      const depoisAqui = limpa(resto.join(' '));
      const depois = baloes.slice(i + 1).map((b) => ({ ...b, t: limpa(b.t) }));
      let pix;
      if (modo === 'completo') pix = [m1, chave, m3];
      else if (modo === 'repetida') pix = [mRepetida];
      else if (modo === 'solta') pix = (antes.concat([{ t: aqui }], depois).some((b) => /\bsinal\b/i.test(b.t)) ? [] : [m1]).concat([chave, m3]);
      else pix = [];
      // frase curta antes ("Perfeito, Ana!") vai junto da primeira mensagem do Pix
      // (ela pode estar no balão da marca ou no último balão antes dele)
      const curta = (s) => s && s.length <= 40 && !s.includes('\n') && /[.!?…]$|\p{Extended_Pictographic}$/u.test(s);
      if (pix.length && pix[0] !== chave) {
        if (curta(aqui)) { pix[0] = aqui + ' ' + pix[0]; aqui = ''; }
        else if (!aqui) {
          const ult = antes.map((b) => b.t).filter(Boolean).length ? antes.filter((b) => b.t).slice(-1)[0] : null;
          if (ult && curta(ult.t)) { pix[0] = ult.t + ' ' + pix[0]; ult.t = ''; }
        }
      }
      baloes = antes.concat([{ t: aqui, ref: 0 }], pix.map((t) => ({ t, ref: 0 })), [{ t: depoisAqui, ref: 0 }], depois).filter((b) => b.t);
    }
  } catch (e) {
    // erro aqui não pode mandar a marca para a cliente: tira a marca e manda a chave com o pedido do comprovante
    const tinha = baloes.some((b) => b.t.includes(MARCA));
    tirarMarca();
    if (tinha && chaveReserva) baloes = baloes.concat([{ t: chaveReserva, ref: 0 }, { t: 'Essa é a chave Pix do sinal. Me manda o print do comprovante por aqui 🙏', ref: 0 }]);
  }
  // nada sobrou (só a marca, e o Pix não sai): não manda balão (mesmo caminho do [[NAO_ENVIAR]])
  if (!baloes.length) return [{ json: { jid, semTexto: true } }];
}
// ---- fim pix-sistema.js (2/2) ----
// Pontuação grudada no fim de um link (ex.: 'wa.me/c/556696795639.')`.replace('__MARCA__', MARCA).replace('__QUEM__', JSON.stringify(nomes)), 'Quebrar mensagens (antes da pontuação do link)');
  q.parameters.jsCode = js;

  // ---------- 2. prompt: a IA escreve a marca, não a chave ----------
  const agente = achar('Agente IA').parameters.options;
  let sm = agente.systemMessage;
  // a chave sai do prompt (assim a IA não tem como escrevê-la); sem chave ou sem valor no cadastro fica como era
  const OK = "(String(s.chave || '').trim() && Number(s.valor || 0) > 0)";
  sm = trocar(sm,
    "numa mensagem curta diga que para garantir o horário é um sinal de R$ ' + f(s.valor) + ' no Pix, descontado no dia, e peça o print do comprovante; mande a chave sozinha em outra mensagem (use ---) para ela copiar: ' + (s.chave || '(chave não cadastrada: use transferir_para_humano)') + (nome ? ' (em nome de ' + nome + ')' : '') + '.'",
    "' + (" + OK + " ? 'escreva a marca [[PIX: serviço; dia e hora]] (veja PIX PELO SISTEMA). Quem manda o valor, a chave e o pedido do comprovante é o sistema.' : " +
    "'numa mensagem curta diga que para garantir o horário é um sinal de R$ ' + f(s.valor) + ' no Pix, descontado no dia, e peça o print do comprovante; mande a chave sozinha em outra mensagem (use ---) para ela copiar: ' + (s.chave || '(chave não cadastrada: use transferir_para_humano)') + (nome ? ' (em nome de ' + nome + ')' : '') + '.')",
    'bloco SINAL PARA RESERVAR (Ordem)');
  sm = trocar(sm,
    "'- Na mensagem que pede o sinal diga SEMPRE os três valores:",
    "(" + OK + " ? '- O preço do serviço, o sinal e o que fica para pagar no dia quem escreve é o sistema, junto com a chave (PIX PELO SISTEMA).' : '- Na mensagem que pede o sinal diga SEMPRE os três valores:",
    'bloco SINAL PARA RESERVAR (três valores)');
  sm = trocar(sm, "Nunca mande a chave Pix sem dizer o valor do sinal.'", "Nunca mande a chave Pix sem dizer o valor do sinal.')", 'bloco SINAL PARA RESERVAR (fim dos três valores)');

  const quem = nomes.length > 1 ? ` com a ${nomes[1]}` : '';
  const bloco = [
    `PIX PELO SISTEMA (vale acima de SINAL PARA RESERVAR e de qualquer regra sobre como escrever a chave Pix)`,
    `- Quem manda o Pix do sinal é o sistema, sempre igual, em 3 mensagens: (1) o preço do serviço, o sinal e quanto fica para o dia; (2) a chave sozinha; (3) o tipo da chave, em nome de quem e o pedido do print do comprovante.`,
    `- Na hora de pedir o sinal (ela escolheu o horário e você sabe o serviço), escreva numa linha só a marca [[PIX: serviço; dia e hora]]: o serviço com o nome da lista SERVIÇOS E PREÇOS e o dia e a hora que ela escolheu, com quem é. Ex.: [[PIX: Manicure; sábado às 8h${quem}]]. Dois serviços: [[PIX: Manicure + Pedicure; sábado às 8h${quem}]]. Sem certeza do serviço ou do horário: [[PIX]].`,
    `- Antes da marca, no máximo uma frase curta (ex.: "Perfeito, Ana!"). Você NÃO escreve a chave, o preço, o valor do sinal, o "no dia você paga" nem o pedido do comprovante: o sistema escreve.`,
    `- Uma marca por resposta. [[PIX ...]] numa resposta sua de antes quer dizer que as 3 mensagens já saíram para ela.`,
    `- A chave não sai duas vezes: se já foi mandada a ela nas últimas horas, o sistema responde só "É a mesma chave Pix que te mandei acima". Se ela disser que não achou a chave ou pedir de novo, use a marca outra vez.`,
    `- Sem sinal, sem marca: horário que já está na agenda, horário oferecido pela ${dona}, reparo, remarcação e cliente que já mandou o comprovante.`,
    `- O Pix nunca é motivo para perguntar_para_gleide.`,
  ].join('\n');
  if (bloco.includes('{{') || bloco.includes('}}') || bloco.includes("'")) throw new Error('pix_sistema: o texto do prompt não pode ter {{, }} nem aspas simples');
  // sinal desligado, sem chave ou sem valor: o bloco não aparece e o prompt fica igual ao de antes
  sm += "{{ (() => { const s = ((($('Supabase: dados do salão').first().json.config || {}).loja || {}).sinal_pix) || {}; " +
    "if (!s.ativo || !String(s.chave || '').trim() || !(Number(s.valor || 0) > 0)) return ''; return " + JSON.stringify('\n\n' + bloco) + "; })() }}";
  agente.systemMessage = sm;
};
