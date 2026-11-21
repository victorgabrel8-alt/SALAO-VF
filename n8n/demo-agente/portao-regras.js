// Portão de ações (fase 1): confere as ações que a IA fez (gravar, marcar, mandar) contra a FALA de quem pediu.
// É só código (sem IA): a mesma entrada dá sempre o mesmo resultado. Testes em testes/portao.test.js.
// Começo de 21/11/2026: a assistente gravou como aplicação de mega hair a recolocação do cabelo da própria cliente
// (Renata 13/11, Dienne 18/11) e o relatório da negociação saiu errado. Aqui cada ação precisa de prova na fala.
// Revisão de 21/11 (testador): "sim"/"pode" confirma o que a IA perguntou; "meu cabelo" de quem nunca usou mega não é
// cabelo da cliente; número solto ("dia 13", "[2]") não prova hora nem valor; negação ("não veio") não prova; mais verbos.
//
// conferirAcoes(ctx) devolve { acoes: [{ ferramenta, entrada, resultado, gravou, falhas: [{ tipo, detalhe }] }], n_falhas }.
// ctx:
//   agente        'assistente' (a dona falando com a assistente) ou 'atendimento' (a cliente falando com a IA)
//   passos        intermediateSteps do agente: [{ ferramenta, entrada, resultado }]
//   fala          o que a dona / a cliente escreveu nesta vez (mensagens juntas)
//   ficha         (atendimento) o "Sobre esta cliente": o que ela já contou antes
//   pediuCancelar (atendimento) o sinal do cancelar-so-se-pediu.js (últimas 2 h e a pergunta da IA)
//
// Este arquivo também roda dentro do n8n: portao.js cola o texto da função no nó "Portão: conferir".
// Por isso: nada de require, nada de variável de fora da função.

function conferirAcoes(ctx) {
  ctx = ctx || {};
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const agente = ctx.agente === 'atendimento' ? 'atendimento' : 'assistente';
  // "[1] ... [2] ..." é a numeração do buffer de mensagens, não número dito
  const fala = norm(ctx.fala).replace(/^[^\n]*mandou \d+ mensagens[^\n]*\n?/, '').replace(/(^|\n)\s*\[\d+\]\s*/g, '$1').replace(/\s+/g, ' ').trim();
  // a ficha traz a conversa antiga com as falas da IA ("voce: ..."): só vale o que é da cliente
  const ficha = norm(ctx.ficha).split('\n').filter((l) => !/^\s*(voce|ia|assistente)\s*:/.test(l)).join('\n');
  const passos = (Array.isArray(ctx.passos) ? ctx.passos : []).filter((p) => p && typeof p === 'object' && p.ferramenta);
  const LEITURA = ['buscar_cliente', 'agenda_do_dia', 'horarios_livres', 'ver_bloqueios_horario', 'consultar_horarios_livres',
    'ver_agendamentos', 'enviar_catalogo', 'enviar_audio'];

  // resposta curta a uma pergunta da IA ("sim", "pode", "isso", "ok envia"): confirma o que a IA propôs
  const CONFIRMA = /^(sim+|s|ss|pode|isso|ok|okay|blz|beleza|manda|envia|confirmo|confirma|fechado|certo|uhum|aham|claro|perfeito|exato|bora|por favor|pode marcar|pode mandar|pode ser)\b/;
  const confirmou = CONFIRMA.test(fala) && fala.length <= 60 && !/\b(nao|n|nem)\b/.test(fala);
  // resposta a "quanto foi?": número e poucas palavras ("350", "350 no pix", "foi 350", "ela pagou 350")
  const soNumero = /\d/.test(fala) && fala.length <= 30;
  // "não", "nem", "ainda não", "n" até 2 palavras antes anulam a prova
  const NEG = /(?:^|\s)(nao|n|nem|ainda nao|nunca)(\s+\S+){0,2}\s*$/;
  const afirma = (re) => {
    const g = new RegExp(re.source, 'g'); let m;
    while ((m = g.exec(fala))) { if (!NEG.test(fala.slice(Math.max(0, m.index - 25), m.index))) return true; if (!m[0].length) g.lastIndex++; }
    return false;
  };
  const curto = (x, n) => { const s = typeof x === 'string' ? x : JSON.stringify(x == null ? '' : x); return s.length > n ? s.slice(0, n) + '…' : s; };
  const entradaDe = (p) => {
    let e = p.entrada;
    if (typeof e === 'string') { try { e = JSON.parse(e); } catch (er) { e = { texto: e }; } }
    return e && typeof e === 'object' && !Array.isArray(e) ? e : {};
  };
  const val = (e, k) => (e[k] == null ? '' : String(e[k]).trim());
  const sim = (t) => /^\s*(sim|true|1|yes)\b(?!.*\b(dela|nao|mas)\b)|^\s*s\s*[.!]?\s*$/i.test(norm(t));

  // ---------- números ditos (hora e valor) ----------
  const numerosDaFala = () => {
    const out = []; const re = /(\d+[.,]\d)\s*k\b|(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(k\b|mil\b)?/g; let m;
    while ((m = re.exec(fala))) {
      if (m[1]) { out.push(Number(m[1].replace(',', '.')) * 1000); continue; }
      let n = Number(m[2].replace(/\./g, '') + (m[3] ? '.' + m[3] : ''));
      if (m[4]) n *= 1000;
      out.push(n);
    }
    return out;
  };
  // valor por extenso (áudio transcrito): "mil e duzentos", "trezentos e cinquenta reais"
  const PALAVRA_NUMERO = /\b(mil|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos)\b|\b(cinquenta|sessenta|setenta|oitenta|noventa|vinte|trinta|quarenta) reais\b/;
  const valorDito = (v) => {
    if (PALAVRA_NUMERO.test(fala)) return true; // por extenso (áudio transcrito): não dá para conferir, não aponta
    const ns = numerosDaFala();
    const igual = (a, b) => Math.abs(a - b) < 0.011;
    if (ns.some((n) => igual(n, v))) return true;
    for (let i = 0; i < ns.length; i++) for (let j = 0; j < ns.length; j++) if (i !== j && (igual(ns[i] + ns[j], v) || igual(ns[i] - ns[j], v))) return true;
    return false;
  };
  const HORA_PALAVRA = ['', 'uma', 'duas', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze'];
  const horaDita = (h) => {
    if (/mesmo horario|mesma hora|no mesmo hor/.test(fala)) return true;
    if (h === 12 && /meio.?dia/.test(fala)) return true;
    const alvo = [h, h > 12 ? h - 12 : h].filter((x, i, a) => a.indexOf(x) === i);
    return alvo.some((x) => {
      const d = '0?' + x;
      const w = HORA_PALAVRA[x] || '';
      const pads = [
        new RegExp('(^|[^\\d/])' + d + '\\s?(h\\d{0,2}\\b|hs\\b|hrs\\b|hr\\b|horas?\\b|[:.]\\d{2}\\b|e meia|e quinze|e trinta|e quarenta)'),
        new RegExp('\\b(as|a|pras|pra|para as|umas|la pelas|depois das|antes das|a partir das|das|no horario das|horario das)\\s+' + d + '(\\D|$)'),
        new RegExp('(^|[^\\d/])(?<!dia\\s)' + d + '\\s+(da|de)\\s+(manha|tarde|noite)'),
        new RegExp('\\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|hoje|amanha)(-feira)?\\s+(as\\s+)?' + d + '(?!\\s*(de|/|\\d))(\\D|$)'),
      ];
      if (w) {
        pads.push(new RegExp('\\b' + w + '\\s+(hora|horas|da manha|da tarde|da noite|e meia)\\b'));
        pads.push(new RegExp('\\b(as|pras|umas)\\s+' + w + '\\b'));
      }
      return pads.some((re) => re.test(fala));
    });
  };

  // ---------- cabelo novo x cabelo da cliente ----------
  // aplicação = colocação de cabelo novo; unha não entra (Alongamento F1, gel...)
  const ehAplicacao = (s) => /aplica|coloca|instala|bota|mega novo|cabelo novo|alongamento/.test(norm(s)) &&
    !/manuten|recoloc|repor|reposi|avalia|retir|aperto|apertar|reapert|tirar e colocar|visita|escolher/.test(norm(s)) &&
    !/unha|molde|\bf1\b|\bgel\b|esmalt|manicure|pedicure|cuticula/.test(norm(s));
  // a cliente já tem o cabelo (primeira pessoa, na conversa com a cliente)
  const CABELO_DELA_CLIENTE = /ja uso (mega|o mega|alongamento)|uso mega|ja tenho (o |a |os |as )?(mega|mechas?|fitas?|telas?)\b|(ja )?tenho o cabelo (ja\b|pra colocar|para colocar|comprado|aqui|em casa)|ja tenho o cabelo(?! (bem |muito |meio )?(curto|fino|longo|ralo|cacheado|liso|crespo|grosso|ondulado|comprido|medio|quimica|danificado|seco))|ja comprei o cabelo|meu mega|minhas mechas|minhas telas|meu proprio cabelo|colocar meu cabelo|colocar o meu cabelo|recoloc|repor (as |os |minhas |meus )?(mechas|fios|fitas|telas|mega)|reposicao (das|de) (mechas|fitas|telas)|caiu (o |meu )?mega|cairam (as |os )?(mechas|fios|cabelos)|trocar (a |de )?tecnica|mudar (a |de )?tecnica|mudar o metodo|passar (pra|para) (a )?fita|levo (os|as) (cabelos?|mechas)|comprei o cabelo|cabelo que (eu )?ja tenho|aproveitar (o |meu )?cabelo/;
  // terceira pessoa (a dona falando da cliente com a assistente)
  const CABELO_DELA_DONA = /cabelos? dela|mechas dela|mega dela|telas dela|ela ja tem o cabelo|ja tem o cabelo|vai trazer o cabelo|traz o cabelo|trouxe o cabelo|reaproveit|comprou o cabelo fora|comprou fora|cabelo que ela ja tem|recoloc|repor (as |os )?(mechas|fios|fitas|telas|mega)|caiu o mega|cairam as mechas|trocar (a |de )?tecnica|passar (pra|para) (a )?fita|ja usa mega/;
  // ficha: frase sobre a própria cliente ("Já usa mega", "Usa mega há 2 anos"), sem "não usa" e sem "a irmã usa"
  const FICHA_JA_USA = /(^|[.;\n:]\s*|cliente\s+)(ja\s+)?usa mega|(^|[.;\n:]\s*)ja uso mega|quer mudar (a )?(tecnica|metodologia)|ja tem mega/;
  const PROVA_CABELO_NOVO = /cabelo novo|novo cabelo|mega novo|compr(ar|ou|ei|a|ando) (o |um |de )?cabelo(?! (fora|na internet|pela internet|em outr|com outr|no site|na shopee|no mercado))|cabelo (que )?chegou|chegou o cabelo|cabelo dela chegou|pag(ou|ar|ou o) (o )?cabelo|encomend|\d+ ?(g|gr|gramas)\b|\bgramas\b|vietnam|europeu|cabelo do salao|cabelo da gleide|cabelo daqui|nunca usei|primeira vez|nunca coloquei/;

  const acoes = [];
  for (const p of passos) {
    const nomeF = String(p.ferramenta);
    if (LEITURA.includes(nomeF)) continue;
    const e = entradaDe(p);
    const res = curto(p.resultado, 300);
    const deuErro = /^\W{0,4}(erro|n[aã]o gravado|n[aã]o marquei)|^\W{0,4}"?erro"?\s*:|^\{\s*"erro"/i.test(res);
    const falhas = [];
    const add = (tipo, detalhe) => falhas.push({ tipo, detalhe });
    const servico = val(e, 'servico');
    const status = norm(val(e, 'status'));

    if (agente === 'assistente') {
      const dela = afirma(CABELO_DELA_DONA);
      // 1. aplicação: cabelo novo dito; o portão da fase 0 já barra sem cabelo_novo, aqui fica o registro
      if (['marcar_horario', 'reagendar', 'concluir', 'registrar_atendimento'].includes(nomeF) && servico && ehAplicacao(servico)) {
        if (!sim(val(e, 'cabelo_novo'))) add('aplicacao_sem_cabelo_novo', servico);
        else if (!confirmou && !afirma(PROVA_CABELO_NOVO)) add('cabelo_novo_sem_prova', 'cabelo_novo = sim, mas a fala não diz que é cabelo novo');
        if (dela && !afirma(PROVA_CABELO_NOVO)) add('aplicacao_com_cabelo_da_cliente', 'a fala diz que é o cabelo dela');
      }
      // concluir sem trocar o serviço (o horário pode já estar como aplicação): se a fala diz cabelo dela, conferir
      const recolocou = afirma(/recoloc|reaproveit|trouxe o cabelo|colocar o cabelo dela|coloquei o cabelo dela|passa(r|ei|mos) (pra|para) (a )?fita|troca(r|mos)? (a |de )?tecnica|trocou a tecnica/) && !/manuten|reposic|repus|apert/.test(fala);
      if ((nomeF === 'concluir' || (nomeF === 'status_atendimento' && /realiz/.test(status))) && !servico && recolocou) {
        add('concluir_com_cabelo_da_cliente', 'conferir se o horário não está como aplicação');
      }
      // conferência da semana (conferencia-vendas.js, supabase/066). Cada cliente é conferida pelo TRECHO da fala que fala
      // dela ("a Renata foi o cabelo dela, o resto tá certo": o "dela" é só da Renata). "Tá certo" / "o resto tá certo"
      // confirma o que a LISTA mostrou (o banco devolve o sugerido): gravar diferente da lista sem ela dizer é alarme.
      if (nomeF === 'conferir_venda') {
        const tipo = norm(val(e, 'tipo'));
        const nomeCli = norm(val(e, 'cliente_nome')).split(/[^a-z]+/).filter((w) => w.length >= 3);
        const partes = fala.split(/[,.;!?\n]+|\s+(?:e|mas|ja|agora)\s+(?=a |o |as |os |\w+ (?:foi|fez|veio|nao))/).map((s) => s.trim()).filter(Boolean);
        const daCliente = partes.filter((s) => nomeCli.some((w) => new RegExp('\\b' + w).test(s))).join(' ');
        const temDela = (s) => CABELO_DELA_DONA.test(s) || /\b(dela|dela mesmo|proprio cabelo|cabelo que ela ja tinha)\b/.test(s);
        const temNovo = (s) => PROVA_CABELO_NOVO.test(s);
        const LISTA_OK = /^(sim+|isso|ok|certo|certinho|certissimo|correto|exato|perfeito|e isso|isso mesmo|(ta|esta|tudo|ta tudo|esta tudo) (certo|certinho|ok)( sim)?)\b|\b(resto|outras?|demais|as outras|o restante)\b[^,.;]{0,20}\b(certo|certinho|ok|isso|isso mesmo|correto)\b/;
        const listaOk = LISTA_OK.test(fala);
        const r = String(typeof p.resultado === 'string' ? p.resultado : JSON.stringify(p.resultado || ''));
        const sug = (r.match(/"sugerido"\s*:\s*"(\w+)"/) || [])[1] || '';
        if (/mega|novo/.test(tipo)) {
          if (daCliente && temDela(daCliente) && !temNovo(daCliente)) add('venda_mega_com_cabelo_da_cliente', 'a fala diz que é o cabelo dela');
          else if (!(daCliente && temNovo(daCliente)) && !(listaOk && sug === 'mega_novo' && !(daCliente && /manuten|recoloc|dela/.test(daCliente))))
            add('venda_mega_sem_prova', sug && sug !== 'mega_novo' ? 'a lista dizia ' + sug + ' e ela não disse cabelo novo' : 'ninguém disse que foi cabelo novo');
        }
        if (/nao.?(fez|veio)/.test(tipo)) {
          const alvo = daCliente || fala;
          const disse = /\b(nao|n|nem)\s+(\S+\s+)?(veio|vindo|vem|fez|feito|apareceu|compareceu|rolou|aconteceu|teve|chegou|fizemos|fiz)\b|desist|cancel|desmarc|remarc/.test(alvo) ||
            (/\b(faltou|furou|deu bolo)\b/.test(alvo) && !/\b(nao|n|nem) (faltou|furou)\b/.test(alvo));
          if (!disse) add('venda_nao_fez_sem_prova', 'a fala não diz que não aconteceu');
        }
      }
      // 2. valor que ninguém disse
      const v = val(e, 'valor').replace(/[^\d,.]/g, '');
      const num = v ? Number(v.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : 0;
      if (num > 0 && !valorDito(num)) add('valor_sem_prova', 'valor ' + num + ' não aparece na fala');
      // 3. resultado da avaliação
      if (nomeF === 'resultado_avaliacao' && !confirmou) {
        const r = norm(val(e, 'resultado'));
        if (r === 'fechou' && !afirma(/fech|vai fazer|marc|volta|topou|aceit|confirm|quer fazer|agend|vai colocar|bateu o martelo|pagou o sinal|sinal pago|ela quer|ela vai/)) add('fechou_sem_prova', 'a fala não diz que fechou');
        if (/nao.?fechou/.test(r) && !/\b(nao|n) (quis|quer|vai|fechou|fecha|rolou|tem dinheiro|tem condic|pode|deu)|desist|caro|sem condic|achou muito|sem grana|sem dinheiro|nao gostou/.test(fala)) add('nao_fechou_sem_prova', 'a fala não diz que ela desistiu');
        if (r === 'fechou' && /aplica/.test(norm(val(e, 'proximo_passo'))) && dela && !afirma(PROVA_CABELO_NOVO)) add('aplicacao_com_cabelo_da_cliente', 'fechou como aplicação, mas a fala diz que é o cabelo dela');
      }
      // 4. concluir, falta, excluir, envio: cada um com a sua prova ("sim" confirma o que a IA perguntou)
      if (!confirmou) {
        const ehConcluir = nomeF === 'concluir' || (nomeF === 'status_atendimento' && /realiz/.test(status));
        if (ehConcluir && !soNumero && (!afirma(/fez|fiz|atendi|termin|veio|feito|pronto|pronta|conclu|ja foi|saiu|acabei|acabou|finaliz|vieram|fizeram|da baixa|dar baixa|fechei|recoloquei|coloquei|apliquei|realizad/) ||
          /^.{0,30}\?$|ainda nao (terminei|acabei|veio|chegou|fiz)|\b(nao|n) (terminei|acabei|veio|apareceu)\b|\b(nao|n) fez (a|o) (manutenc|aplicac|servico)/.test(fala))) add('concluir_sem_prova', 'a fala não diz que o atendimento aconteceu');
        const ehFalta = nomeF === 'liberar_horario' || (nomeF === 'status_atendimento' && /falt/.test(status));
        if (ehFalta && !/(nao|n|nem) (veio|apareceu|compareceu|vem|chegou|vai vir|vai vim)|faltou|furou|deu bolo|\blibera(r)?\b|desistiu/.test(fala)) add('falta_sem_prova', 'a fala não diz que a cliente faltou');
        const ehExcluir = nomeF === 'excluir_horario' || (nomeF === 'status_atendimento' && /cancel/.test(status));
        if (ehExcluir && (!afirma(/cancel|desmarc|remarc|\btira\b|exclu|apaga|nao vem|nao vai|remove|desistiu|errado|engano/) || /tira (uma |minha )?duvida/.test(fala))) add('excluir_sem_prova', 'a fala não pede para tirar o horário');
        if (['chamar_cliente', 'avisar_cliente'].includes(nomeF) && !afirma(/\b(chama|chame|avisa|avise|manda|mande|envia|envie|fala (com|pra|para)|pergunta|lembra|confirma|diz (pra|que|a)|toque|escreve|responde|cobra|da um oi|agradece|ve com|ver com|pede (pra|para|a|o)|convida|oferece)\b/)) add('envio_sem_pedido', 'a fala não pede para mandar mensagem');
      }
      // 5. hora marcada que ninguém disse
      if (['marcar_horario', 'reagendar'].includes(nomeF) && !confirmou) {
        const m = val(e, 'inicio').match(/T(\d{2}):(\d{2})/);
        if (m && !horaDita(Number(m[1]))) add('hora_sem_prova', 'a hora ' + m[1] + ':' + m[2] + ' não aparece na fala');
      }
    } else {
      // atendimento: quem já tem o cabelo não faz "aplicação" (Dienne, 16/11: "pra colocar meu cabelo")
      if (['criar_agendamento', 'remarcar_agendamento'].includes(nomeF) && servico && ehAplicacao(servico) &&
        (afirma(CABELO_DELA_CLIENTE) || FICHA_JA_USA.test(ficha)) && !afirma(PROVA_CABELO_NOVO)) {
        add('aplicacao_com_cabelo_da_cliente', 'a cliente já usa mega / falou do cabelo dela');
      }
      if (nomeF === 'cancelar_agendamento' && ctx.pediuCancelar !== true && !confirmou) {
        const pediu = afirma(/cancel|desmarc|desist|remarc|outro dia|imprevisto|tirar meu horario|tira meu horario|fiquei doente|to doente|estou doente/) ||
          /(nao|n) (vou|vai) (poder )?(ir|dar|rolar|conseguir)|(nao|n) (consigo|posso) (ir|mais)|nao da (mais|pra ir)\b(?!.*\?)|nao vou mais/.test(fala);
        const contrario = /nao vou (faltar|cancelar|esquecer)|nao (quero|precisa) cancelar|nao posso esquecer|mais cedo\?/.test(fala);
        if (!pediu || contrario) add('cancelar_sem_prova', 'a cliente não pediu para cancelar');
      }
    }
    if (deuErro && !falhas.length) continue; // a ferramenta não gravou e nada a apontar
    const entrada = {};
    for (const [k, x] of Object.entries(e)) entrada[k] = curto(x, 300);
    acoes.push({ ferramenta: nomeF, entrada, resultado: res, gravou: !deuErro, falhas });
  }
  return { acoes, n_falhas: acoes.reduce((s, a) => s + a.falhas.length, 0) };
}

// Resumo do dia para o Victor (alerta-workflows.js, às 20h, só nos dias com alarme). registros = linhas de portao_registros
// com n_falhas > 0. Devolve o texto da mensagem ou '' quando não tem nada a contar. Também é colado no n8n: sem require.
function montarResumo(registros, dia) {
  const lista = (Array.isArray(registros) ? registros : []).filter((r) => r && Number(r.n_falhas) > 0);
  if (!lista.length) return '';
  const NOMES = {
    aplicacao_sem_cabelo_novo: 'marcou aplicação sem confirmar cabelo novo',
    cabelo_novo_sem_prova: 'disse cabelo novo, mas ninguém falou isso',
    aplicacao_com_cabelo_da_cliente: 'aplicação, mas é o cabelo da própria cliente',
    concluir_com_cabelo_da_cliente: 'concluiu recolocação: conferir se o horário não está como aplicação',
    valor_sem_prova: 'gravou um valor que ninguém disse',
    fechou_sem_prova: 'gravou "fechou" sem a Gleide dizer',
    nao_fechou_sem_prova: 'gravou "não fechou" sem a Gleide dizer',
    concluir_sem_prova: 'deu baixa sem a Gleide dizer que atendeu',
    falta_sem_prova: 'marcou falta sem a Gleide dizer',
    excluir_sem_prova: 'tirou um horário sem pedido',
    envio_sem_pedido: 'mandou mensagem para cliente sem a Gleide pedir',
    hora_sem_prova: 'marcou uma hora que ninguém disse',
    cancelar_sem_prova: 'cancelou o horário sem a cliente pedir',
    venda_mega_com_cabelo_da_cliente: 'conferência: gravou mega hair novo, mas a Gleide falou do cabelo da cliente',
    venda_nao_fez_sem_prova: 'conferência: gravou que o atendimento não aconteceu sem a Gleide dizer',
    venda_mega_sem_prova: 'conferência: gravou mega hair novo sem a Gleide dizer cabelo novo',
  };
  const corta = (s, n) => { s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const total = lista.reduce((s, r) => s + Number(r.n_falhas), 0);
  const linhas = [];
  let i = 0;
  for (const r of lista) {
    const acoes = Array.isArray(r.acoes) ? r.acoes : [];
    for (const a of acoes) {
      for (const f of (Array.isArray(a.falhas) ? a.falhas : [])) {
        i++;
        if (i > 10) continue;
        const quem = r.agente === 'assistente' ? 'Assistente (Gleide)' : 'Atendimento, cliente …' + String(r.telefone || '').slice(-4);
        const hora = r.criado_em ? new Date(new Date(r.criado_em).getTime() - 4 * 3600e3).toISOString().slice(11, 16) : '';
        linhas.push(i + ') ' + hora + ' ' + quem + ': ' + (NOMES[f.tipo] || f.tipo) + ' (' + a.ferramenta + ')\n   Fala: «' + corta(r.fala, 120) + '»');
      }
    }
  }
  if (i > 10) linhas.push('… e mais ' + (i - 10) + '. O resto está na tabela portao_registros.');
  return '🛡️ Portão ' + (dia || '') + ': ' + total + (total === 1 ? ' alarme' : ' alarmes') + ' em ' + lista.length +
    (lista.length === 1 ? ' conversa' : ' conversas') + ' (só observando, nada foi barrado)\n\n' + linhas.join('\n');
}

if (typeof module !== 'undefined') module.exports = { conferirAcoes, montarResumo };
