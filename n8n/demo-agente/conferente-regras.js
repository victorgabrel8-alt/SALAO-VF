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

function conferir(ctx) {
  const falhas = [];
  const add = (tipo, detalhe) => falhas.push({ tipo, detalhe });
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
  const resultados = passos.map((p) => String(p.resultado == null ? '' : (typeof p.resultado === 'string' ? p.resultado : JSON.stringify(p.resultado))));
  const deFora = anteriores.filter((m) => m.direcao === 'entrada' || (m.autor && m.autor !== 'ia')).map((m) => String(m.conteudo || ''));
  const daIa = anteriores.filter((m) => m.direcao === 'saida' && (!m.autor || m.autor === 'ia'));
  const recentesIa = daIa.filter((m) => agora - Date.parse(m.criado_em) <= 30 * 60 * 1000).map((m) => String(m.conteudo || ''));
  const n = norm(texto);

  // ---------- 1. preço: todo valor citado vem da lista (ou é conta com valores da lista e do sinal) ----------
  const numero = (s) => Number(String(s).replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  const valoresDe = (s) => {
    const out = [];
    const re = /R\$\s?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)|\b(\d{1,4}(?:,\d{2})?)\s*reais\b/gi;
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
    const falaSoma = /\b(total|tudo|junt[oa]s?|soma|somand|ao todo|dois|duas|tres|cada uma|mais o|mais a|com o|com a|e o|e a)\b|\+/.test(n) || citados.length >= 2;
    const falaResto = /\b(restante|resto|no dia|falta|faltam|desconta|descontado|abate|abatido|paga(r)? os|fica(m)? os)\b/.test(n);
    const ok = new Set();
    const somar = (v) => ok.add(Math.round(v * 100));
    const somas = new Set();
    for (const p of precos) somar(p);
    // "cada unha" / "cada pé": até 10 unidades
    for (const s of precosLista) if (/\bcada\b/.test(norm(s.nome))) for (let k = 2; k <= 10; k++) somar(Number(s.preco) * k);
    if (falaSoma) {
      for (let i = 0; i < precos.length; i++) for (let j = i + 1; j < precos.length; j++) {
        somas.add(precos[i] + precos[j]);
        for (let k = j + 1; k < precos.length; k++) somas.add(precos[i] + precos[j] + precos[k]);
      }
      for (const v of somas) somar(v);
      // o mesmo serviço para 2 ou 3 pessoas ("pras duas")
      for (const p of precos) { somar(p * 2); somar(p * 3); }
    }
    if (sinal) {
      somar(sinal);
      if (falaResto) for (const v of [...precos, ...somas]) somar(v - sinal);
    }
    // parcelado ("2x de R$ 55"): o valor dividido pelas parcelas que a resposta cita
    for (const m of n.matchAll(/\b(\d{1,2})\s?x\b/g)) for (const v of [...ok]) somar(v / 100 / Number(m[1]));
    // valor que a cliente, a dona ou a ferramenta escreveu (ex.: "pode fazer por 80", "NÃO AGENDADO ... R$ 20")
    for (const v of [...deFora, ...resultados].flatMap(valoresDe)) somar(v);
    for (const v of citados) if (!ok.has(Math.round(v * 100))) add('preco', `R$ ${v} não está na lista de serviços nem é soma ou sinal`);
  }

  // ---------- 2. "reservei / agendado / remarquei / cancelei" só com a ferramenta confirmando agora ----------
  const confirmou = (palavra) => resultados.some((r) => new RegExp('^\\s*' + palavra, 'i').test(r));
  // horário que ela já tinha (lembrete na ficha ou ver_agendamentos com horário): "está marcado" é verdade
  const jaTemHorario = /AL[OÔ] DE LEMBRETE/i.test(ficha) || resultados.some((r) => /^\s*Agendamentos futuros/i.test(r)) ||
    passos.some((p, i) => p.ferramenta === 'ver_agendamentos' && /\d{1,2}(:|h)\d{0,2}/.test(resultados[i]) && !/N[ãa]o encontrei/i.test(resultados[i]));
  // tira negações ("ainda não marquei", "não cancelei nada") antes de procurar a promessa
  const semNegacao = n.replace(/\b(reservei|agendei|marquei|remarquei|cancelei|desmarquei) nada\b[^.!?\n]*/g, ' ').replace(/\b(nao|ainda nao|nem)\s+(\w+\s+){0,2}?(reservei|agendei|marquei|remarquei|cancelei|desmarquei|troquei|confirmei|esta|ta|foi|ficou)\b[^.!?\n]*/g, ' ');
  const acaoMarcar = /\b(reservei|agendei|marquei|ja (te )?(reservei|agendei|marquei)|deixei (tudo |ja )?(reservad|marcad|agendad)|agendad[oa] com sucesso|agendadissim|reservadissim)/.test(semNegacao) ||
    /(^|[.!?\n,]\s*|prontinho,?\s*|pronto,?\s*|perfeito,?\s*)(agendado|reservado|marcado)\s*[!🙏✅.]/u.test(semNegacao);
  const estadoMarcado = /\b(esta|ta|ja esta|ja ta|ficou|foi) (tudo )?(marcad|agendad|reservad|confirmad)|\bconfirmei\b|\bconfirmado\b/.test(semNegacao);
  if (acaoMarcar && !confirmou('AGENDADO') && !confirmou('REMARCADO')) add('promessa', 'disse que marcou, mas nenhuma ferramenta respondeu AGENDADO nesta resposta');
  else if (estadoMarcado && !confirmou('AGENDADO') && !confirmou('REMARCADO') && !jaTemHorario) add('promessa', 'disse que está marcado/confirmado, mas não há AGENDADO agora nem horário dela na ficha');
  if (/(^|[.!?\n,]\s*|\b(foi|ta|esta|ficou|prontinho,?|pronto,?)\s+)remarcad[oa]\b|\b(remarquei|ja (te )?remarquei|mudei (o |seu )?horario|troquei (o |seu )?horario)/u.test(semNegacao) && !confirmou('REMARCADO')) add('promessa', 'disse que remarcou, mas a ferramenta não respondeu REMARCADO');
  if (/\b(cancelei|desmarquei|ja (te )?cancelei|(foi|esta|ta) cancelad|cancelad[oa]\s*[!✅.])/u.test(semNegacao) && !confirmou('CANCELADO')) add('promessa', 'disse que cancelou, mas a ferramenta não respondeu CANCELADO');

  // ---------- 3. horário: todo horário citado veio da agenda, da ficha ou da conversa ----------
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
      if (!ok.has(v)) add('horario', `${Math.floor(v / 60)}h${v % 60 ? String(v % 60).padStart(2, '0') : ''} não veio da agenda, da ficha nem da conversa`);
    }
  }

  // ---------- 4. nome de outra loja ("toda bonita" minúsculo é elogio comum: só o nome com maiúsculas) ----------
  if (/\bg[l]ei[dz]/i.test(texto) || /mega\s*-?\s*hair/i.test(texto) || /\bToda\s+Bonit[a]\b/.test(texto)) add('outra_loja', 'nome de outra loja ou de mega hair na resposta');

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

module.exports = { conferir };
