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
  const fala = norm(ctx.fala).replace(/(^|\n)\s*\[\d+\]\s*/g, '$1').replace(/\s+/g, ' ').trim();
  const ficha = norm(ctx.ficha);
  const passos = (Array.isArray(ctx.passos) ? ctx.passos : []).filter((p) => p && typeof p === 'object' && p.ferramenta);
  const LEITURA = ['buscar_cliente', 'agenda_do_dia', 'horarios_livres', 'ver_bloqueios_horario', 'consultar_horarios_livres',
    'ver_agendamentos', 'enviar_catalogo', 'enviar_audio'];

  // resposta curta a uma pergunta da IA ("sim", "pode", "isso", "ok envia"): confirma o que a IA propôs
  const CONFIRMA = /^(sim|s|ss|pode|pode sim|pode ser|isso|isso mesmo|ok|okay|blz|beleza|manda|pode mandar|ok envia|envia|confirmo|confirma|fechado|certo|uhum|aham|claro|perfeito|exato|sim pode|sim por favor|por favor|bora|vai)[\s.!,👍🙏❤️]*$/;
  const confirmou = CONFIRMA.test(fala);
  const soNumero = /^[r$\s]*[\d.,]+\s*(reais|k)?[\s.!]*$/.test(fala);
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
    const out = []; const re = /(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*(k|mil)?/g; let m;
    while ((m = re.exec(fala))) {
      let n = Number(m[1].replace(/\./g, '') + (m[2] ? '.' + m[2] : ''));
      if (m[3]) n *= 1000;
      out.push(n);
    }
    return out;
  };
  const PALAVRA_NUMERO = /\b(mil|cem|cento|duzentos|trezentos|quatrocentos|quinhentos|seiscentos|setecentos|oitocentos|novecentos|cinquenta|sessenta|setenta|oitenta|noventa|vinte|trinta|quarenta)\b/;
  const valorDito = (v) => {
    if (PALAVRA_NUMERO.test(fala)) return true; // por extenso (áudio transcrito): não dá para conferir, não aponta
    const ns = numerosDaFala();
    const igual = (a, b) => Math.abs(a - b) < 0.011;
    if (ns.some((n) => igual(n, v))) return true;
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) if (igual(ns[i] + ns[j], v)) return true;
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
        new RegExp('(^|\\D)' + d + '\\s?(h\\b|hs\\b|hrs\\b|hr\\b|horas?\\b|:\\d{2}|e meia|e quinze|e trinta|e quarenta)'),
        new RegExp('\\b(as|a|pras|pra|para as|umas|la pelas|lá pelas|depois das|antes das|a partir das)\\s+' + d + '(\\D|$)'),
        new RegExp('(^|\\D)' + d + '\\s+(da|de)\\s+(manha|tarde|noite)'),
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
  const CABELO_DELA_CLIENTE = /ja uso (mega|o mega|alongamento)|uso mega|ja tenho (o |a |os |as )?(mega|cabelo|mechas?|fitas?|telas?)|tenho o cabelo|meu mega|minhas mechas|minhas telas|meu proprio cabelo|colocar meu cabelo|colocar o meu cabelo|recoloc|repor|reposicao|caiu (o |meu )?mega|cairam (as |os )?(mechas|fios|cabelos)|trocar (a |de )?tecnica|mudar (a |de )?tecnica|mudar o metodo|passar (pra|para) (a )?fita|levo (os|as) (cabelos?|mechas)|comprei o cabelo|cabelo que (eu )?ja tenho|aproveitar (o |meu )?cabelo/;
  // terceira pessoa (a dona falando da cliente com a assistente)
  const CABELO_DELA_DONA = /cabelos? dela|mechas dela|mega dela|telas dela|ela ja tem o cabelo|ja tem o cabelo|vai trazer o cabelo|traz o cabelo|trouxe o cabelo|reaproveit|comprou o cabelo fora|comprou fora|cabelo que ela ja tem|recoloc|repor|reposicao|caiu o mega|cairam as mechas|trocar (a |de )?tecnica|passar (pra|para) (a )?fita|ja usa mega/;
  const FICHA_JA_USA = /ja usa mega|usa mega|ja uso mega|uso mega|mudar (a )?tecnica|mudar a metodologia|ja tem mega/;
  const PROVA_CABELO_NOVO = /cabelo novo|novo cabelo|mega novo|compr(ar|ou|ei|a|ando) (o |um |de )?cabelo(?! (fora|na internet|pela internet|em outr|com outr|no site|na shopee|no mercado))|cabelo (que )?chegou|chegou o cabelo|encomend|\d+ ?(g|gr|gramas)\b|\bgramas\b|vietnam|europeu|cabelo do salao|cabelo da gleide|cabelo daqui|nunca usei|primeira vez|nunca coloquei/;

  const acoes = [];
  for (const p of passos) {
    const nomeF = String(p.ferramenta);
    if (LEITURA.includes(nomeF)) continue;
    const e = entradaDe(p);
    const res = curto(p.resultado, 300);
    const deuErro = /^\W{0,4}erro|"erro"\s*:|n[aã]o gravado|n[aã]o marquei|n[aã]o consegui/i.test(res);
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
      if ((nomeF === 'concluir' || (nomeF === 'status_atendimento' && /realiz/.test(status))) && !servico && dela) {
        add('concluir_com_cabelo_da_cliente', 'conferir se o horário não está como aplicação');
      }
      // 2. valor que ninguém disse
      const v = val(e, 'valor').replace(/[^\d,.]/g, '');
      const num = v ? Number(v.replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) : 0;
      if (num > 0 && !valorDito(num)) add('valor_sem_prova', 'valor ' + num + ' não aparece na fala');
      // 3. resultado da avaliação
      if (nomeF === 'resultado_avaliacao' && !confirmou) {
        const r = norm(val(e, 'resultado'));
        if (r === 'fechou' && !afirma(/fech|vai fazer|marc|volta|topou|aceit|confirm|quer fazer|agend|vai colocar|bateu o martelo|pagou o sinal|sinal pago|ela quer|ela vai/)) add('fechou_sem_prova', 'a fala não diz que fechou');
        if (/nao.?fechou/.test(r) && !/nao (quis|quer|vai|fechou|fecha|rolou|tem dinheiro|tem condic|pode|deu)|desist|caro|sem condic|achou muito|sem grana|sem dinheiro|nao gostou/.test(fala)) add('nao_fechou_sem_prova', 'a fala não diz que ela desistiu');
        if (r === 'fechou' && /aplica/.test(norm(val(e, 'proximo_passo'))) && dela && !afirma(PROVA_CABELO_NOVO)) add('aplicacao_com_cabelo_da_cliente', 'fechou como aplicação, mas a fala diz que é o cabelo dela');
      }
      // 4. concluir, falta, excluir, envio: cada um com a sua prova ("sim" confirma o que a IA perguntou)
      if (!confirmou) {
        const ehConcluir = nomeF === 'concluir' || (nomeF === 'status_atendimento' && /realiz/.test(status));
        if (ehConcluir && !soNumero && (!afirma(/fez|fiz|atendi|termin|veio|feito|pronto|pronta|conclu|ja foi|saiu|acabei|acabou|finaliz|vieram|fizeram|da baixa|dar baixa|fechei|recoloquei|coloquei|apliquei|realizad/) ||
          /\?$|ainda nao|nao terminei|nao veio|nao fez/.test(fala))) add('concluir_sem_prova', 'a fala não diz que o atendimento aconteceu');
        const ehFalta = nomeF === 'liberar_horario' || (nomeF === 'status_atendimento' && /falt/.test(status));
        if (ehFalta && !/(nao|n|nem) (veio|apareceu|compareceu|vem|chegou|vai vir|vai vim)|faltou|furou|deu bolo|libera(r)? o horario|desistiu/.test(fala)) add('falta_sem_prova', 'a fala não diz que a cliente faltou');
        const ehExcluir = nomeF === 'excluir_horario' || (nomeF === 'status_atendimento' && /cancel/.test(status));
        if (ehExcluir && (!afirma(/cancel|desmarc|tira|exclu|apaga|nao vem|nao vai|remove|desistiu/) || /tira (uma |minha )?duvida/.test(fala))) add('excluir_sem_prova', 'a fala não pede para tirar o horário');
        if (['chamar_cliente', 'avisar_cliente'].includes(nomeF) && !afirma(/chama|avisa|manda (mensagem|msg|pra|para|um|uma|ela)|fala com ela|fala pra ela|fala para ela|pergunta (pra|a|para) ela|pergunta se|lembra ela|lembra a|confirma com|diz pra|diz que|toque|avise|mande|chame|escreve (pra|para)|responde (ela|a)|envia/)) add('envio_sem_pedido', 'a fala não pede para mandar mensagem');
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

if (typeof module !== 'undefined') module.exports = { conferirAcoes };
