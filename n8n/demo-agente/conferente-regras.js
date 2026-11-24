// Conferente: as regras que conferem a resposta da IA ANTES de ela ir para a cliente (orquestrador, fase A).
// É só código (sem IA): a mesma resposta dá sempre o mesmo resultado. As regras de cada loja vêm do cadastro
// (tabela servicos, empresas.config), nada é escrito loja por loja.
//
// conferir(ctx) devolve { ok, falhas: [{ tipo, detalhe }] }. ctx:
//   texto      resposta do agente (o "output", antes do "Quebrar mensagens")
//   passos     ferramentas desta resposta: [{ ferramenta, entrada, resultado }] (intermediateSteps)
//   servicos   [{ nome, preco, a_partir_de }] da tabela servicos
//   config     empresas.config (endereco, loja.mapa, loja.sinal_pix.{valor, chave})
//   anteriores mensagens das últimas 12 h: [{ direcao: 'entrada'|'saida', autor, conteudo, criado_em }]
//   ficha      texto do "Sobre esta cliente" (horários dela, alô de lembrete...)
//   agora      Date (ms) do momento da resposta
//
// Este arquivo também roda dentro do n8n: conferente.js cola o texto da função no nó "Conferente: conferir".
// Por isso: nada de require, nada de variável de fora, e o nome da outra loja escrito sem a palavra inteira
// (o lojas.paraLoja troca a palavra pelo nome da dona da loja).
// Revisão de 20/11 (testador): preço mais justo, mais jeitos de "marquei", menos falso alarme em rua, "toda bonita"
// e duração.
// Revisão de 20/11 (modo ligado): o voucher da esmaltação em gel (config.loja.voucher_gel, R$ 20) e o valor da linha
// VOUCHER da ficha passam; adicional por dedo/unha ("decoração R$ 15 por dedo", "2 dedos R$ 30") e serviço com
// adicional ("manicure com francesinha") contam como conta. Cada falha também diz o que achou (valor, minutos, acao).
//
// Modo ligado (conferente.js): versaoSegura, montarPedido e escolher, no fim do arquivo. Também vão coladas no nó
// do n8n, com a mesma regra (só podem usar conferir e umas às outras).

function conferir(ctx) {
  const falhas = [];
  const add = (tipo, detalhe, extra) => falhas.push(Object.assign({ tipo, detalhe }, extra || {}));
  ctx = ctx || {};
  const texto = String(ctx.texto || '');
  if (!texto.trim()) return { ok: true, falhas };
  const lista = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
  const passos = lista(ctx.passos);
  const servicos = lista(ctx.servicos);
  const cfg = (ctx.config && typeof ctx.config === 'object') ? ctx.config : {};
  const loja = (cfg.loja && typeof cfg.loja === 'object') ? cfg.loja : {};
  const anteriores = lista(ctx.anteriores);
  const ficha = String(ctx.ficha || '');
  const agora = Number(ctx.agora) || Date.now();
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  // (21/11) No n8n a resposta da ferramenta chega embrulhada: '[{"resposta":"AGENDADO com sucesso…"}]' (texto JSON) ou o
  // objeto já aberto. Sem abrir, "AGENDADO" nunca estava no começo e toda confirmação certa virava "promessa": numa loja com o
  // Conferente ligado a cliente já agendada recebeu "Posso reservar esse horário pra você?" (20/11 18:14); no observar, alarme falso.
  const abrir = (o) => {
    let t = o;
    for (let i = 0; i < 4; i++) {
      if (typeof t === 'string') { const s = t.trim(); if (!/^[[{"]/.test(s)) return t; try { t = JSON.parse(s); } catch (e) { return t; } continue; }
      if (Array.isArray(t)) { if (!t.length) return ''; if (t.length > 1) return t.map((x) => abrir(x)).join('\n'); t = t[0]; continue; }
      if (t && typeof t === 'object') { const k = ['resposta', 'response', 'output', 'text'].find((c) => typeof t[c] === 'string'); if (!k) return JSON.stringify(t); t = t[k]; continue; }
      break;
    }
    return t == null ? '' : String(t);
  };
  const resultados = passos.map((p) => abrir(p.resultado));
  // (21/11) o orçamento que a dona passou chega à cliente por um recado automático gravado como 'ia'
  // ("A ... passou o valor: R$ 2.800", pedidos-workflows.js): esse valor é da dona, vale como fonte
  const deFora = anteriores.filter((m) => m.direcao === 'entrada' || (m.autor && m.autor !== 'ia') || /^\W*(a \w+ passou o (valor|orcamento)|sobre o seu pedido, a \w+ mandou|falei com a \w+ sobre isso)\b/.test(norm(m.conteudo)))
    .map((m) => String(m.conteudo || ''));
  const daIa = anteriores.filter((m) => m.direcao === 'saida' && (!m.autor || m.autor === 'ia'));
  const recentesIa = daIa.filter((m) => agora - Date.parse(m.criado_em) <= 30 * 60 * 1000).map((m) => String(m.conteudo || ''));
  const n = norm(texto);

  // ---------- 1. preço: todo valor citado vem da lista (ou é conta com valores da lista e do sinal) ----------
  const numero = (s) => Number(String(s).replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  const valoresDe = (s) => {
    const out = [];
    // "1.200 reais" é mil e duzentos (antes lia só o "200")
    const re = /R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)|\b(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d{1,4}(?:,\d{2})?)\s*reais\b/gi;
    let m;
    while ((m = re.exec(String(s)))) out.push(numero((m[1] || m[2]).replace(/\.(\d{1,2})$/, ',$1')));
    return out;
  };
  const citados = valoresDe(texto);
  const precosLista = servicos.filter((s) => Number(s.preco) > 0);
  if (citados.length && precosLista.length) {
    const precos = precosLista.map((s) => Number(s.preco));
    const sinal = Number((loja.sinal_pix || {}).valor) || 0;
    // só aceita conta quando a resposta fala de conta (senão quase todo número redondo passaria)
    // dois serviços da lista citados na resposta ("manicure com francesinha") também é conta
    const nomeLimpo = (s) => norm(s).replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const nomesCitados = precosLista.map((s) => nomeLimpo(s.nome)).filter((s) => s.length >= 4 && n.includes(s));
    // "com a Duda", "com a Caroline" (quem atende, 20/11) não é conta: sai antes de procurar "com a"
    const nSoma = norm(texto.replace(/\b(com|e) (a|o)\s+[A-ZÀ-Ú][a-zà-ú]+/g, ' '));
    const falaSoma = /\b(total|tudo|junt[oa]s?|soma|somand|ao todo|dois|duas|tres|cada uma|mais o|mais a|com o|com a|e o|e a|adiciona\w*|acrescent\w*|a mais)\b|\+/.test(nSoma) || citados.length >= 2 || nomesCitados.length >= 2;
    const falaResto = /\b(restante|resto|no dia|falta|faltam|desconta|descontado|abate|abatido|paga(r)? os|fica(m)? os)\b/.test(n);
    const ok = new Set();
    const somar = (v) => ok.add(Math.round(v * 100));
    const somas = new Set();
    for (const p of precos) somar(p);
    // "cada unha" / "por dedo": até 10 unidades, só quando a resposta fala do serviço ou de dedos/unhas
    // (senão "decoração R$ 15 por dedo" deixava passar 30, 45, 60... em qualquer frase)
    for (const s of precosLista) {
      if (!/\bcada\b|\bpor (unha|dedo|pe|mao)\b/.test(norm(s.nome))) continue;
      const palavra = nomeLimpo(s.nome).split(' ')[0];
      if (!(palavra.length >= 4 && n.includes(palavra)) && !/\b(dedos|unhas)\b/.test(n)) continue;
      for (let k = 2; k <= 10; k++) somar(Number(s.preco) * k);
    }
    // "em 2 dedos", "4 unhas": a quantidade citada vezes o preço de cada (e entra na conta com os outros serviços)
    const extenso = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
    const qtds = [...n.matchAll(/\b(\d{1,2}|uma?|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(dedos?|unhas?)\b/g)]
      .map((m) => extenso[m[1]] || Number(m[1])).filter((k) => k >= 2 && k <= 10);
    for (const k of qtds) for (const s of precosLista) { const v = Number(s.preco) * k; somar(v); if (!precos.includes(v)) precos.push(v); }
    if (falaSoma) {
      for (let i = 0; i < precos.length; i++) for (let j = i + 1; j < precos.length; j++) {
        somas.add(precos[i] + precos[j]);
        for (let k = j + 1; k < precos.length; k++) somas.add(precos[i] + precos[j] + precos[k]);
      }
      for (const v of somas) somar(v);
      // o mesmo serviço para 2 ou 3 pessoas ("pras duas")
      for (const p of precos) { somar(p * 2); somar(p * 3); }
    }
    // voucher da esmaltação em gel (supabase/057: config.loja.voucher_gel.ativo; o voucher sai de R$ 20)
    const voucher = (loja.voucher_gel && typeof loja.voucher_gel === 'object') ? loja.voucher_gel : null;
    if (voucher && (voucher.ativo === true || voucher.ativo === 'true')) somar(Number(voucher.valor) || 20);
    if (sinal) {
      somar(sinal);
      if (falaResto) for (const v of [...precos, ...somas]) somar(v - sinal);
    }
    // parcelado ("2x de R$ 55"): o valor dividido pelas parcelas que a resposta cita
    for (const m of n.matchAll(/\b(\d{1,2})\s?x\b/g)) for (const v of [...ok]) somar(v / 100 / Number(m[1]));
    // valor que a cliente, a dona ou a ferramenta escreveu (ex.: "pode fazer por 80", "NÃO AGENDADO ... R$ 20")
    // ...e a ficha da cliente (linha VOUCHER: "R$ 20 no próximo serviço")
    for (const v of [...deFora, ...resultados, ficha].flatMap(valoresDe)) somar(v);
    for (const v of citados) if (!ok.has(Math.round(v * 100))) add('preco', `R$ ${v} não está na lista de serviços nem é soma ou sinal`, { valor: v });
  }

  const minutos = (h, m) => Number(h) * 60 + Number(m || 0);
  const horasDe = (s) => {
    const out = [];
    const re = /\b([01]?\d|2[0-3])(?:h|:)([0-5]\d)?\b|\b([01]?\d|2[0-3])\s?h(?:rs?|oras?)?\b|(?:^|[^\wÀ-ú])[àa]s\s([01]?\d|2[0-3])\b(?![,.:]\d)/gi;
    let m;
    while ((m = re.exec(String(s)))) {
      if (m[1] !== undefined) out.push(minutos(m[1], m[2]));
      else if (m[3] !== undefined) out.push(minutos(m[3]));
      else if (m[4] !== undefined) out.push(minutos(m[4]));
    }
    return out;
  };

  // ---------- 2. "reservei / agendado / remarquei / cancelei" só com a ferramenta confirmando agora ----------
  const textosDe = (r) => {
    const out = [r];
    const abrir = (v) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(abrir); };
    try { abrir(JSON.parse(r)); } catch (e) { /* texto comum */ }
    return out;
  };
  // o resultado da ferramenta pode vir em JSON ('[{"resposta":"AGENDADO com sucesso..."}]', 20/11): confere cada texto de dentro
  const confirmou = (palavra) => resultados.some((r) => textosDe(r).some((t) => new RegExp('^\\s*' + palavra, 'i').test(t)));
  // (21/11) "Reservei seu pé e mão pra amanhã, sábado, às 8h" um minuto DEPOIS de agendar: a ferramenta não rodou nesta
  // resposta, mas o horário já está na ficha ("Horário marcado: sábado, 21/11 às 08:00 — …"). Repetir o que já está
  // marcado não é promessa. Regra fechada (Conferente ligado: um "reservei" falso é pior que uma pergunta a mais): só vale
  // quando o texto diz UMA hora e o dia, e os dois são os do mesmo horário da ficha.
  const reafirma = (() => {
    // outra ferramenta rodou NESTA resposta (criar, remarcar, cancelar, consultar, transferir…): quem diz o que aconteceu é
    // ela, não a ficha, que é de antes. Só olhar os horários dela ou anotar não muda nada.
    if (passos.some((p) => !['ver_agendamentos', 'anotar_no_crm'].includes(String(p.ferramenta || '')))) return false;
    // outro dia ("que vem", "próximo", "depois de amanhã", "daqui 15 dias"), outra pessoa ("da sua filha"), a mais ("também",
    // "mais um", "outro") ou toda semana ("todo sábado"): não é repetir o que está na ficha
    if (/\bque (vem|entra)\b|\bproxim[oa]s?\b|\bdepois de amanha\b|\bseguinte\b|\bdaqui\b|\bem \d+ dias\b|\boutr[oa]s?\b|\btambem\b|\bmais uma?\b|\btod[oa]s?\b|\b(filh[ao]s?|mae|irma|irmao|amig[ao]s?|prim[ao]|tia|sogra|nora|cunhada|marido|espos[ao]|namorad[ao]|acompanhante)\b/.test(n)) return false;
    // hora por extenso ("às nove e meia", "ao meio-dia"): pode ser uma segunda hora que a conta de baixo não enxerga
    if (/\bmeio.?dia\b|\b(uma|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|onze|doze)\s+(e meia|horas?|da manha|da tarde|da noite)\b/.test(n)) return false;
    const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const MESES = ['janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    // hoje em Cuiabá (-04:00 o ano todo), como dia inteiro
    const hojeD = new Date(agora - 4 * 3600e3);
    const hoje0 = Date.UTC(hojeD.getUTCFullYear(), hojeD.getUTCMonth(), hojeD.getUTCDate());
    const chave = (ms) => { const d = new Date(ms); return d.getUTCDate() + '/' + (d.getUTCMonth() + 1); };
    const marcados = [];
    for (const l of ficha.split('\n')) {
      // só a linha da ficha (no começo da linha) e só até o travessão: o nome do serviço não entra na conta
      const m = l.match(/^\s*Hor[aá]rios? marcados?:\s*([^—]*)/i);
      if (!m) continue;
      const hs = horasDe(m[1]); const dt = m[1].match(/\b(\d{1,2})\/(\d{1,2})\b/);
      if (!hs.length || !dt) continue;
      // a data da ficha é a próxima com esse dia e mês (a ficha só lista horários futuros)
      let ms = Date.UTC(hojeD.getUTCFullYear(), Number(dt[2]) - 1, Number(dt[1]));
      if (ms < hoje0) ms = Date.UTC(hojeD.getUTCFullYear() + 1, Number(dt[2]) - 1, Number(dt[1]));
      marcados.push({ min: hs[0], data: Number(dt[1]) + '/' + Number(dt[2]), dias: Math.round((ms - hoje0) / 86400e3), semana: DIAS[new Date(ms).getUTCDay()] });
    }
    const limpo = texto.replace(/R\$\s?[\d.,]+/g, ' ');
    const hsTexto = horasDe(limpo).filter((v) => v >= 6 * 60).filter((v, i, a) => a.indexOf(v) === i);
    // uma hora só: com duas não dá para saber qual é de qual dia
    if (!marcados.length || hsTexto.length !== 1) return false;
    // o dia que o texto diz, de cada jeito: data (21/11, 21-11, 21 de novembro), "dia 21", hoje/amanhã e dia da semana
    const datas = [...limpo.matchAll(/\b(\d{1,2})[\/-](\d{1,2})\b/g)].map((m) => Number(m[1]) + '/' + Number(m[2]));
    for (const m of n.matchAll(/\b(\d{1,2})\s+de\s+([a-z]+)/g)) { const i = MESES.indexOf(m[2]); if (i >= 0) datas.push(Number(m[1]) + '/' + (i + 1)); }
    if (/\bhoje\b/.test(n)) datas.push(chave(hoje0));
    if (/\bamanha\b/.test(n)) datas.push(chave(hoje0 + 86400e3));
    const diasDoMes = [...n.matchAll(/\bdia (\d{1,2})\b(?![\/-])/g)].map((m) => Number(m[1]));
    const semanas = DIAS.filter((d) => new RegExp('\\b' + d).test(n));
    // sem dizer o dia não dá para saber se é o da ficha: barra
    if (!datas.length && !diasDoMes.length && !semanas.length) return false;
    return marcados.some((x) => x.min === hsTexto[0] &&
      datas.every((d) => d === x.data) &&
      diasDoMes.every((d) => d === Number(x.data.split('/')[0])) &&
      // dia da semana sozinho é o próximo: só vale para horário de hoje até daqui a 6 dias
      semanas.every((d) => d === x.semana && x.dias >= 0 && x.dias <= 6));
  })();
  // horário que ela já tinha (lembrete na ficha ou ver_agendamentos com horário): "está marcado" é verdade
  // (21/11) a ficha também traz "Horário marcado: sexta-feira, 13/11 às 08:00 — …"
  const jaTemHorario = /AL[OÔ] DE LEMBRETE/i.test(ficha) || /Hor[aá]rios? marcados?:\s*\S/i.test(ficha) || resultados.some((r) => /^\s*Agendamentos futuros/i.test(r)) ||
    passos.some((p, i) => p.ferramenta === 'ver_agendamentos' && /\d{1,2}(:|h)\d{0,2}/.test(resultados[i]) && !/N[ãa]o encontrei/i.test(resultados[i]));
  // tira negações ("ainda não marquei", "não cancelei nada") antes de procurar a promessa
  const semNegacao = n.replace(/\b(reservei|agendei|marquei|remarquei|cancelei|desmarquei) nada\b[^.!?\n]*/g, ' ').replace(/\b(nao|ainda nao|nem)\s+(\w+\s+){0,2}?(reservei|agendei|marquei|remarquei|cancelei|desmarquei|troquei|confirmei|esta|ta|foi|ficou)\b[^.!?\n]*/g, ' ');
  const acaoMarcar = /\b(reservei|agendei|marquei|ja (te )?(reservei|agendei|marquei)|deixei (tudo |ja )?(reservad|marcad|agendad)|agendad[oa] com sucesso|agendadissim|reservadissim)/.test(semNegacao) ||
    /(^|[.!?\n,]\s*|prontinho,?\s*|pronto,?\s*|perfeito,?\s*)(agendado|reservado|marcado)\s*[!🙏✅.]/u.test(semNegacao) ||
    // "Agendado pra você amanhã às 9h", "Reservado com a Duda" (começo da frase, sem pergunta)
    /(^|[.!?\n]\s*|prontinho,?\s*|pronto,?\s*|perfeito,?\s*)(agendad[oa]|reservad[oa]|marcad[oa])\s+(pra|para|com|no|na|amanha|hoje|dia|as)\b[^?\n]*([.!🙏✅\n]|$)/u.test(semNegacao);
  const estadoMarcado = /\b(esta|ta|ja esta|ja ta|ficou|foi) (tudo )?(marcad|agendad|reservad|confirmad)|\bconfirmei\b|\bconfirmado\b/.test(semNegacao);
  if (acaoMarcar && !confirmou('AGENDADO') && !confirmou('REMARCADO') && !reafirma) add('promessa', 'disse que marcou, mas nenhuma ferramenta respondeu AGENDADO nesta resposta', { acao: 'marcar' });
  else if (estadoMarcado && !confirmou('AGENDADO') && !confirmou('REMARCADO') && !jaTemHorario) add('promessa', 'disse que está marcado/confirmado, mas não há AGENDADO agora nem horário dela na ficha', { acao: 'marcar' });
  if (/(^|[.!?\n,]\s*|\b(foi|ta|esta|ficou|prontinho,?|pronto,?)\s+)remarcad[oa]\b|\b(remarquei|ja (te )?remarquei|mudei (o |seu )?horario|troquei (o |seu )?horario)/u.test(semNegacao) && !confirmou('REMARCADO')) add('promessa', 'disse que remarcou, mas a ferramenta não respondeu REMARCADO', { acao: 'remarcar' });
  if (/\b(cancelei|desmarquei|ja (te )?cancelei|(foi|esta|ta) cancelad|cancelad[oa]\s*[!✅.])/u.test(semNegacao) && !confirmou('CANCELADO')) add('promessa', 'disse que cancelou, mas a ferramenta não respondeu CANCELADO', { acao: 'cancelar' });

  // ---------- 3. horário: todo horário citado veio da agenda, da ficha ou da conversa ----------
  // fora o que é duração ("leva 1h30", "fica pronto em 6h", "2 horas antes") e preço
  const semDuracao = texto.replace(/R\$\s?[\d.,]+/g, ' ')
    .replace(/\b(em|leva\w*|dura\w*|demora\w*|uns|umas|cerca de|por|at[eé]|de|mais de|menos de)\s+(\d{1,2}(?:h\d{0,2}|:\d{2})?\s?(?:h|hrs?|horas?)?(?:\s?e\s?(?:meia|\d+ ?min\w*))?)/gi, ' ')
    .replace(/\b\d{1,2}\s?(h|hrs?|horas?)\s+(antes|depois|de dura\w*|de anteced\w*)/gi, ' ');
  // antes das 6h também é duração, não horário de atendimento
  const horasDoTexto = horasDe(semDuracao).filter((v) => v >= 6 * 60);
  if (horasDoTexto.length) {
    const fontes = [...resultados, ficha, ...deFora, ...daIa.map((m) => String(m.conteudo || '')), JSON.stringify(cfg.horario_funcionamento || ''), JSON.stringify(cfg.almoco || ''), JSON.stringify(loja.almoco_flexivel || '')];
    const ok = new Set();
    for (const f of fontes) {
      for (const v of horasDe(f)) ok.add(v);
      for (const m of String(f).matchAll(/"([01]\d|2[0-3]):([0-5]\d)/g)) ok.add(minutos(m[1], m[2]));
    }
    // só a agenda e a ficha abrem faixas (a do horário de funcionamento liberaria qualquer horário)
    for (const f of [...resultados, ficha]) {
      // "data_hora_inicio: 2026-11-21T09:00"
      for (const m of String(f).matchAll(/T([01]\d|2[0-3]):([0-5]\d)/g)) ok.add(minutos(m[1], m[2]));
      // faixa "das 9h às 11h30" / "9h às 10h30": qualquer início de 30 em 30 min dentro dela
      for (const m of String(f).matchAll(/\b([01]?\d|2[0-3])(?:h|:)([0-5]\d)?\s*(?:às|as|a|-|até)\s*([01]?\d|2[0-3])(?:h|:)([0-5]\d)?/gi)) {
        for (let t = minutos(m[1], m[2]); t <= minutos(m[3], m[4]); t += 30) ok.add(t);
      }
    }
    for (const v of horasDoTexto) {
      if (!ok.has(v)) add('horario', `${Math.floor(v / 60)}h${v % 60 ? String(v % 60).padStart(2, '0') : ''} não veio da agenda, da ficha nem da conversa`, { minutos: v });
    }
  }

  // ---------- 4. nome de outra loja ("toda bonita" minúsculo é elogio comum: só o nome com maiúsculas) ----------
  // na loja que é a dona desses nomes a regra não vale: ctx.semOutraLoja (conferente.js, loja.outra_loja === false)
  if (!ctx.semOutraLoja && (/\bg[l]ei[dz]/i.test(texto) || /mega\s*-?\s*hair/i.test(texto) || /\bToda\s+Bonit[a]\b/.test(texto))) add('outra_loja', 'nome de outra loja ou de mega hair na resposta');

  // ---------- 5. mesma mensagem nos últimos 30 min ----------
  const chaveTxt = String((loja.sinal_pix || {}).chave || '').trim();
  const igual = (s) => norm(chaveTxt ? String(s).split(chaveTxt).join(' ') : s).replace(/[^a-z0-9]+/g, ' ').trim();
  const pedacos = [texto, ...texto.split(/\n\s*\n|\[\d{1,2}\]|\n-{3,}\n/)].map(igual).filter((p) => p.length >= 25);
  const ditas = new Set(recentesIa.flatMap((s) => [s, ...s.split(/\n\s*\n/)]).map(igual));
  if (pedacos.some((p) => ditas.has(p))) add('repetida', 'a mesma mensagem já foi mandada para ela nos últimos 30 minutos');

  // ---------- 6. chave Pix: uma vez a cada 30 min e sozinha na linha (pode ter "Chave Pix:" ou seta antes) ----------
  if (chaveTxt && texto.includes(chaveTxt)) {
    if (recentesIa.some((s) => s.includes(chaveTxt))) add('pix', 'chave Pix mandada de novo em menos de 30 minutos');
    const linha = texto.split('\n').find((l) => l.includes(chaveTxt)) || '';
    // o nome de quem recebe ao lado da chave ("chave (Caroline Ferreira)") não atrapalha copiar
    const recebedor = [].concat((loja.sinal_pix || {}).nome_recebedor || []).map(norm).filter(Boolean);
    let resto = norm(linha.replace(chaveTxt, ''));
    for (const r of recebedor) resto = resto.split(r).join(' ');
    resto = resto.replace(/\b(a )?(chave( pix)?|pix)\b/g, '').replace(/[\s.:,;*_`"'()\-👉➡️⬇️↓→]+/gu, '');
    if (resto.length > 0) add('pix', 'chave Pix grudada em outro texto (difícil de copiar)');
  }

  // ---------- 7. endereço e link de mapa só os do cadastro ----------
  const end = String(cfg.endereco || '').trim();
  const mapa = String(loja.mapa || '').trim();
  const nt = n.replace(/\s+/g, ' ');
  const rua = norm(end.split(',')[0] || '').replace(/\s+/g, ' ');
  const num = (end.match(/\d+/) || [''])[0];
  // só conta como endereço quando tem rua/avenida E número ("tô na rua agora" e "perto da avenida X" não são)
  for (const m of nt.matchAll(/(?:^|[^a-z])(rua|r\.|avenida|av\.|travessa|alameda|rodovia|estrada)\s+([^\n,.;!?]{2,40}?)[,\s]+(?:n[ºo°.]?\s*)?(\d{1,5})\b/g)) {
    const citada = (m[1] + ' ' + m[2]).trim();
    if (!rua || !(citada.includes(rua) || rua.includes(citada)) || (num && m[3] !== num)) { add('endereco', 'endereço que não é o do cadastro'); break; }
  }
  const semProto = (s) => norm(s).replace(/[).,;!]+$/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const links = texto.match(/(https?:\/\/|www\.)\S+|\S*(goo\.gl|maps\.|waze\.)\S*/gi) || [];
  if (links.some((l) => /goo\.gl|maps|waze|localiza/i.test(l) && (!mapa || semProto(l) !== semProto(mapa)))) add('endereco', 'link de mapa que não é o do cadastro');

  // ---------- 8. sobra de sistema na mensagem ----------
  const limpo = texto.replace(/\[\[\s*NAO_ENVIAR\s*\]\]|\[SEM TEXTO\]|\[\d{1,2}\]/gi, '');
  if (/\{[a-z_]{2,}\}|\{\{|\}\}|\$json|\[\s*(link|mapa|pre[cç]o|nome|valor|hor[aá]rio|data|servi[cç]o|endere[cç]o)[^\]]*\]|data_hora_inicio|consultar_horarios_livres|criar_agendamento|ver_agendamentos|remarcar_agendamento|cancelar_agendamento|transferir_para_humano|perguntar_para_\w+|anotar_no_crm|enviar_(audio|catalogo)/i.test(limpo) ||
      /\bN[AÃ]O (AGENDADO|ENVIADO|PERGUNTADO|REMARCADO|CANCELADO)\b|\bPERGUNTADO:/.test(limpo)) {
    add('sistema', 'texto de sistema, variável ou nome de ferramenta na mensagem');
  }

  return { ok: falhas.length === 0, falhas };
}

// ======================= modo ligado =======================
// Barrou: o Gemini reescreve só o trecho errado (montarPedido); a reescrita é conferida de novo (escolher); se ainda
// barrar, ou o Gemini falhar ou demorar, sai a versaoSegura: a resposta sem a parte errada. Nunca trava a resposta
// e nunca manda pergunta para a dona.
// ctx é o mesmo do conferir, mais: mensagem (o que a cliente acabou de mandar), dona e nomeLoja (para o pedido).

// Versão segura, só com código: tira o que está errado e põe no lugar só o que vem do cadastro.
//   - link de mapa errado: troca pelo do cadastro; chave Pix grudada: vai para uma linha só dela;
//   - "Reservei pra você sábado às 8h" sem AGENDADO: vira "Posso reservar pra você sábado às 8h?" (oferta);
//   - frase com preço inventado: sai, e no fim vai o preço da lista dos serviços que a frase citava;
//   - frase com horário inventado, nome de outra loja, endereço errado, texto de sistema: sai;
//   - sobrou nada: oferta, preço da lista ou pergunta do dia; mensagem repetida inteira fica como veio (repetir
//     não é informação errada). Devolve { texto, cortes, falhas } (falhas = o que ainda sobrou, para o registro).
function versaoSegura(ctx, falhas) {
  ctx = ctx || {};
  const original = String(ctx.texto || '');
  const conf = (t) => conferir(Object.assign({}, ctx, { texto: t }));
  if (!Array.isArray(falhas)) falhas = conf(original).falhas;
  falhas = falhas.filter((f) => f && typeof f === 'object');
  const tipos = new Set(falhas.map((f) => f.tipo));
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const cfg = (ctx.config && typeof ctx.config === 'object') ? ctx.config : {};
  const loja = (cfg.loja && typeof cfg.loja === 'object') ? cfg.loja : {};
  const chave = String((loja.sinal_pix || {}).chave || '').trim();
  const mapa = String(loja.mapa || '').trim();
  const servicos = (Array.isArray(ctx.servicos) ? ctx.servicos : []).filter((s) => s && s.nome && Number(s.preco) > 0);
  // a resposta da ferramenta chega embrulhada ('[{"resposta":"NÃO AGENDADO…"}]'): o mesmo "abrir" do conferir
  const abrir = (o) => {
    let t = o;
    for (let i = 0; i < 4; i++) {
      if (typeof t === 'string') { const s = t.trim(); if (!/^[[{"]/.test(s)) return t; try { t = JSON.parse(s); } catch (e) { return t; } continue; }
      if (Array.isArray(t)) { if (!t.length) return ''; if (t.length > 1) return t.map((x) => abrir(x)).join('\n'); t = t[0]; continue; }
      if (t && typeof t === 'object') { const k = ['resposta', 'response', 'output', 'text'].find((c) => typeof t[c] === 'string'); if (!k) return JSON.stringify(t); t = t[k]; continue; }
      break;
    }
    return t == null ? '' : String(t);
  };
  const resultados = (Array.isArray(ctx.passos) ? ctx.passos : []).filter(Boolean).map((p) => abrir(p.resultado));
  const cortes = [];
  const fim = [];
  const reais = (v) => 'R$ ' + (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','));
  const tem = (t, tipo) => conf(t).falhas.some((f) => f.tipo === tipo);
  // texto em linhas, cada linha em frases (o fim da frase fica com ela: ".", "?", emoji)
  const FRASE = /(?<=[.!?🙏😊😉🥰🥹😍])\s+/u;
  const porFrase = (t, fn) => t.split('\n').map((l) => (l.trim() ? l.split(FRASE).map(fn).filter((f) => f && f.trim()).join(' ') : l)).join('\n');
  const arrumar = (t) => t.split('\n').map((l) => l.replace(/[ \t]+$/, '')).join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  let t = original;

  // 1. consertos diretos: link do mapa e chave Pix
  if (tipos.has('endereco')) {
    const semProto = (s) => norm(s).replace(/[).,;!]+$/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    t = t.replace(/(https?:\/\/|www\.)\S+|\S*(goo\.gl|maps\.|waze\.)\S*/gi, (l) => {
      if (!/goo\.gl|maps|waze|localiza/i.test(l) || (mapa && semProto(l) === semProto(mapa))) return l;
      cortes.push(l);
      return mapa;
    });
  }
  if (chave && tipos.has('pix') && t.includes(chave)) {
    t = t.split('\n').map((l) => {
      if (!l.includes(chave) || l.trim() === chave) return l;
      const i = l.indexOf(chave);
      return [l.slice(0, i).replace(/[\s:–-]+$/, ''), chave, l.slice(i + chave.length).replace(/^[\s.:,;–-]+/, '')].filter((x) => x.trim()).join('\n');
    }).join('\n');
  }

  // 2. promessa sem a ferramenta confirmar: a frase vira oferta
  if (tipos.has('promessa')) {
    // o resultado pode vir em JSON ('[{"resposta":"NÃO AGENDADO: ..."}]'): olha cada texto de dentro
    const textos = resultados.flatMap((r) => {
      const out = [r];
      const abrir = (v) => { if (typeof v === 'string') out.push(v); else if (v && typeof v === 'object') Object.values(v).forEach(abrir); };
      try { abrir(JSON.parse(r)); } catch (e) { /* texto comum */ }
      return out;
    });
    const naoFez = textos.find((r) => /^\s*N[ÃA]O (AGENDADO|REMARCADO|CANCELADO)/i.test(r));
    const acoes = falhas.filter((f) => f.tipo === 'promessa').map((f) => f.acao || 'marcar');
    const oferta = naoFez
      ? 'Esse horário ainda não ficou reservado' + (/comprovante/i.test(naoFez) ? '. Pra reservar eu preciso do print do comprovante do Pix do sinal' : '')
      : acoes.includes('cancelar') ? 'Quer que eu cancele esse horário?'
        : acoes.includes('remarcar') ? 'Quer que eu troque seu horário pra esse?' : 'Posso reservar esse horário pra você?';
    let tirou = false;
    t = porFrase(t, (f) => {
      // a ferramenta disse que não marcou: "te espero sábado às 9h" também sai
      if (naoFez && /\bte (espero|aguardo)\b/i.test(f)) { cortes.push(f); return ''; }
      if (!tem(f, 'promessa')) return f;
      cortes.push(f);
      if (!naoFez) {
        let g = f.replace(/\b(j[aá]\s+)?(te\s+)?(reservei|agendei|marquei|deixei\s+(tudo\s+|j[aá]\s+)?(reservad|marcad|agendad)[oa])\b/gi, 'posso reservar')
          .replace(/\b(j[aá]\s+)?(te\s+)?(remarquei|troquei|mudei)\b/gi, 'posso trocar')
          .replace(/\b(j[aá]\s+)?(te\s+)?(cancelei|desmarquei)\b/gi, 'posso cancelar')
          .replace(/^(\s*(?:\[\d{1,2}\]\s*)?(?:(?:prontinho|pronto|perfeito)\s*[,!.]?\s*)?)(agendad[oa]|reservad[oa]|marcad[oa])\s+(?=(pra|para|com|no|na|amanh[aã]|hoje|dia|[àa]s)\b)/i, '$1posso reservar ');
        if (g !== f) {
          g = g.replace(/^\s*(\[\d{1,2}\]\s*)?(prontinho|pronto|perfeito|feito|certo|ok)\s*[,!.]?\s*/i, '$1').replace(/[\s.!,;🙏✅😊]+$/u, '').trim();
          g = g.replace(/^(\[\d{1,2}\]\s*)?(\p{Ll})/u, (m, a, l) => (a || '') + l.toUpperCase()) + '?';
          if (!tem(g, 'promessa') && norm(g).replace(/[^a-z]/g, '').length >= 18) return g;
        }
      }
      tirou = true;
      return '';
    });
    if (tirou || naoFez) fim.push(oferta);
  }

  // 3. o que ainda está errado sai frase por frase
  const cortar = (f) => {
    cortes.push(f);
    // endereço errado: no fim vai o do cadastro
    if (tipos.has('endereco') && cfg.endereco && /\b(rua|r\.|avenida|av\.|travessa|alameda|rodovia|estrada)\s/i.test(f)) {
      const frase = 'O endereço é ' + String(cfg.endereco).trim();
      if (!fim.includes(frase)) fim.push(frase);
    }
    // preço errado: no fim vai o preço da lista de cada serviço que a frase citava
    if (tipos.has('preco') && /R\$|\breais\b/i.test(f)) {
      const nf = norm(f);
      const achados = servicos.map((s) => ({ s, k: norm(s.nome).replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() }))
        .filter((x) => x.k.length >= 4 && nf.includes(x.k));
      const unicos = achados.filter((x) => !achados.some((y) => y !== x && y.k.length > x.k.length && y.k.includes(x.k))).slice(0, 3);
      for (const x of unicos) {
        const frase = x.s.nome.replace(/\s*\([^)]*\)/g, '').trim() + ' fica ' + (x.s.a_partir_de ? 'a partir de ' : '') + reais(Number(x.s.preco));
        if (!fim.includes(frase)) fim.push(frase);
      }
    }
  };
  // 3a. a frase que, conferida sozinha, tem o mesmo erro (mesmo valor, mesmo horário) sai
  const agora = conf(t).falhas.filter((x) => x.tipo !== 'repetida' && x.tipo !== 'erro_conferente');
  const mesmo = (x) => agora.some((y) => y.tipo === x.tipo && (y.valor === undefined || y.valor === x.valor) && (y.minutos === undefined || y.minutos === x.minutos));
  if (agora.length) t = porFrase(t, (f) => { if (!conf(f).falhas.some(mesmo)) return f; cortar(f); return ''; });
  // 3b. o resto (repetida, erro que só aparece com o texto inteiro): sai a frase que, tirada, mais diminui as falhas
  for (let volta = 0; volta < 12; volta++) {
    const r = conf(arrumar(t));
    if (r.ok) break;
    const linhas = t.split('\n').map((l) => (l.trim() ? l.split(FRASE) : []));
    let melhor = null;
    linhas.forEach((fs, li) => fs.forEach((f, fi) => {
      const sem = arrumar(linhas.map((x, i) => (i === li ? x.filter((_, j) => j !== fi) : x).join(' ')).join('\n'));
      const n = conf(sem).falhas.length;
      if (n < r.falhas.length && (!melhor || n < melhor.n)) melhor = { n, sem, f };
    }));
    if (!melhor) break;
    cortar(melhor.f);
    t = melhor.sem;
  }
  t = arrumar(t);

  // 4. o que vai no fim (oferta, preço da lista) e o que sai quando não sobrou nada
  const extra = fim.filter((f) => !conf(f).falhas.length);
  if (extra.length) t = arrumar(t + (t ? '\n\n' : '') + extra.join('\n'));
  if (!t.replace(/\[\d{1,2}\]|\[\[\s*NAO_ENVIAR\s*\]\]|[\s😊😉🙏.!?]/gu, '')) {
    if (tipos.size === [...tipos].filter((x) => x === 'repetida' || x === 'pix').length) t = original;
    else if (tipos.has('horario')) t = 'Me fala o dia e o período que fica melhor pra você que eu vejo os horários livres';
    else if (tipos.has('preco')) t = 'Me fala qual serviço você quer que eu te passo o valor certinho';
    else t = '';
  }
  return { texto: t, cortes, falhas: conf(t).falhas };
}

// Pedido ao Gemini: a resposta original, o que está errado e os dados certos que o Conferente tem.
// tom = a seção do prompt da loja com o jeito de escrever (conferente.js tira do prompt-agente.md).
function montarPedido(ctx, falhas, tom) {
  ctx = ctx || {};
  const corta = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n) + '…' : s; };
  const cfg = (ctx.config && typeof ctx.config === 'object') ? ctx.config : {};
  const loja = (cfg.loja && typeof cfg.loja === 'object') ? cfg.loja : {};
  const dona = String(ctx.dona || 'a dona');
  const reais = (v) => 'R$ ' + (Number.isInteger(v) ? String(v) : Number(v).toFixed(2).replace('.', ','));
  const servicos = (Array.isArray(ctx.servicos) ? ctx.servicos : []).filter((s) => s && s.nome);
  const passos = (Array.isArray(ctx.passos) ? ctx.passos : []).filter(Boolean);
  const anteriores = (Array.isArray(ctx.anteriores) ? ctx.anteriores : []).filter((m) => m && m.conteudo).slice(-6);
  const COMO = {
    preco: 'troque pelo valor certo da LISTA DE SERVIÇOS (pode somar serviços da lista); se não der para saber qual serviço é, tire o valor e pergunte qual serviço ela quer',
    promessa: 'nenhuma ferramenta confirmou nesta resposta. Não diga que marcou, reservou, remarcou, cancelou ou que está confirmado: ofereça ("Posso reservar pra você sábado às 8h?"). Se a ferramenta respondeu NÃO AGENDADO, diga em palavras simples o que falta, sem copiar o texto da ferramenta',
    horario: 'use só os horários que aparecem no RESULTADO DAS FERRAMENTAS, na FICHA ou na conversa, com o nome de quem atende quando vier junto ("às 9h com a Duda"); se não houver, tire o horário e pergunte o dia ou o período que ela prefere',
    outra_loja: 'tire o nome que não é deste studio',
    repetida: 'essa mensagem já foi mandada para ela há pouco: não repita; diga só o que é novo, bem curto',
    pix: 'a chave Pix vai sozinha numa linha; se ela já foi mandada há menos de 30 minutos, não mande de novo (diga que é a mesma chave que mandou)',
    endereco: 'use só o ENDEREÇO e o LINK DO MAPA do cadastro, abaixo',
    sistema: 'tire palavra de sistema, nome de ferramenta, variável ou texto entre colchetes',
  };
  const L = [];
  L.push('Você confere as mensagens de WhatsApp do atendimento de ' + (ctx.nomeLoja || 'um studio') + ' antes de elas irem para a cliente.');
  L.push('A RESPOSTA ORIGINAL abaixo tem erro. Reescreva mudando SÓ o trecho errado; o resto fica igual, palavra por palavra, no mesmo tom.');
  L.push('', 'ERROS ACHADOS (e como corrigir):');
  for (const f of (Array.isArray(falhas) ? falhas : []).filter((x) => x && x.tipo && x.tipo !== 'erro_conferente')) L.push('- ' + f.detalhe + ': ' + (COMO[f.tipo] || 'tire o trecho errado'));
  L.push('', 'REGRAS:');
  L.push('- Use só os dados abaixo. Se o dado certo não está aqui, tire o trecho errado em vez de inventar.');
  L.push('- Não acrescente pergunta para ' + dona + ', não diga que vai ver, confirmar ou perguntar depois, nem que vai avisar. Se a resposta original já dizia "isso ' + dona + ' te explica no dia", pode manter.');
  L.push('- Não invente valor, horário, endereço, desconto nem regra. O voucher da esmaltação em gel e os adicionais da lista podem ficar como estão.');
  L.push('- Mantenha as marcas [1], [2], a linha ---, as quebras de linha e a chave Pix (sozinha na linha) como estão.');
  L.push('- Responda só com o texto da mensagem nova, sem aspas, sem explicação, sem negrito.');
  if (tom) L.push('', 'JEITO DE ESCREVER (siga esta forma):', corta(tom, 7000));
  L.push('', 'LISTA DE SERVIÇOS (a única fonte de valor):');
  for (const s of servicos.slice(0, 60)) L.push('- ' + s.nome + ': ' + (Number(s.preco) > 0 ? (s.a_partir_de ? 'a partir de ' : '') + reais(Number(s.preco)) : 'sem preço na lista'));
  const sp = loja.sinal_pix || {};
  if (Number(sp.valor) > 0) L.push('SINAL para reservar: ' + reais(Number(sp.valor)) + (sp.chave ? ' (chave Pix: ' + sp.chave + ')' : ''));
  const v = loja.voucher_gel;
  if (v && typeof v === 'object' && (v.ativo === true || v.ativo === 'true')) L.push('VOUCHER: quem faz esmaltação em gel ganha ' + reais(Number(v.valor) || 20) + ' de desconto no próximo serviço, vale 30 dias.');
  if (cfg.endereco) L.push('ENDEREÇO: ' + cfg.endereco);
  if (loja.mapa) L.push('LINK DO MAPA: ' + loja.mapa);
  if (passos.length) {
    L.push('', 'RESULTADO DAS FERRAMENTAS NESTA RESPOSTA:');
    for (const p of passos.slice(-6)) L.push('- ' + (p.ferramenta || 'ferramenta') + ': ' + corta(typeof p.resultado === 'string' ? p.resultado : JSON.stringify(p.resultado || ''), 1500));
  }
  if (ctx.ficha) L.push('', 'FICHA DA CLIENTE:', corta(ctx.ficha, 1500));
  if (anteriores.length) {
    L.push('', 'ÚLTIMAS MENSAGENS:');
    for (const m of anteriores) L.push((m.direcao === 'entrada' ? 'Cliente' : (m.autor && m.autor !== 'ia' ? dona : 'Atendimento')) + ': ' + corta(m.conteudo, 300));
  }
  if (ctx.mensagem) L.push('', 'MENSAGEM DA CLIENTE AGORA:', corta(ctx.mensagem, 800));
  L.push('', 'RESPOSTA ORIGINAL:', String(ctx.texto || ''));
  return L.join('\n');
}

// Escolhe o que sai: a reescrita do Gemini se ela passa no Conferente (e não perdeu a chave Pix nem inventou
// "vou ver com a dona"); senão a versaoSegura. erro = o Gemini falhou ou demorou.
// Devolve { texto, usou: 'reescrita'|'segura', motivo, falhas_reescrita, cortes, falhas_final }.
function escolher(ctx, falhas, reescrita, erro) {
  ctx = ctx || {};
  const original = String(ctx.texto || '');
  const cfg = (ctx.config && typeof ctx.config === 'object') ? ctx.config : {};
  const chave = String(((cfg.loja || {}).sinal_pix || {}).chave || '').trim();
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let r = String(reescrita == null ? '' : reescrita).trim().replace(/^```\w*\s*|\s*```$/g, '').replace(/^["“]([\s\S]*)["”]$/, '$1').trim();
  let motivo = '';
  let falhasR = [];
  // "vou ver com a Caroline", "te aviso depois": promessa de voltar que o sistema não cumpre (só vale se já estava)
  const promessaDepois = (s) => /\b(vou|vamos|deixa eu|deixe eu) (ver|confirmar|perguntar|checar|consultar|verificar)\b|\bte (aviso|falo|retorno|respondo)( \w+)? (depois|ja ja|assim que|quando)\b|\bconfirmo (e|com|pra)\b/.test(norm(s));
  if (erro) motivo = 'gemini_falhou';
  else if (!r) motivo = 'reescrita_vazia';
  else if (r.length > original.length * 2 + 300) motivo = 'reescrita_comprida';
  else if (chave && original.includes(chave) && !r.includes(chave) && !falhas.some((f) => f && f.tipo === 'pix')) motivo = 'reescrita_sem_chave';
  else if (promessaDepois(r) && !promessaDepois(original)) motivo = 'reescrita_promete_depois';
  else {
    falhasR = conferir(Object.assign({}, ctx, { texto: r })).falhas;
    if (!falhasR.length) return { texto: r, usou: 'reescrita', motivo: '', falhas_reescrita: [], cortes: [], falhas_final: [] };
    motivo = 'reescrita_barrada';
  }
  const s = versaoSegura(ctx, falhas);
  return { texto: s.texto, usou: 'segura', motivo, falhas_reescrita: falhasR, cortes: s.cortes, falhas_final: s.falhas };
}

module.exports = { conferir, versaoSegura, montarPedido, escolher };
