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

function conferir(ctx) {
  const falhas = [];
  const add = (tipo, detalhe) => falhas.push({ tipo, detalhe });
  const texto = String((ctx && ctx.texto) || '');
  if (!texto.trim()) return { ok: true, falhas };
  const passos = Array.isArray(ctx.passos) ? ctx.passos : [];
  const servicos = Array.isArray(ctx.servicos) ? ctx.servicos : [];
  const cfg = (ctx.config && typeof ctx.config === 'object') ? ctx.config : {};
  const loja = cfg.loja || {};
  const anteriores = Array.isArray(ctx.anteriores) ? ctx.anteriores : [];
  const ficha = String(ctx.ficha || '');
  const agora = Number(ctx.agora) || Date.now();
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const resultados = passos.map((p) => String(p.resultado == null ? '' : (typeof p.resultado === 'string' ? p.resultado : JSON.stringify(p.resultado))));
  const deFora = anteriores.filter((m) => m.direcao === 'entrada' || (m.autor && m.autor !== 'ia')).map((m) => String(m.conteudo || ''));
  const daIa = anteriores.filter((m) => m.direcao === 'saida' && (!m.autor || m.autor === 'ia'));
  const recentesIa = daIa.filter((m) => agora - Date.parse(m.criado_em) <= 30 * 60 * 1000).map((m) => String(m.conteudo || ''));

  // ---------- 1. preço: todo valor citado vem da lista (ou é conta com valores da lista e do sinal) ----------
  const numero = (s) => Number(String(s).replace(/\.(?=\d{3}\b)/g, '').replace(',', '.'));
  const valoresDe = (s) => {
    const out = [];
    const re = /R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?|\d+(?:,\d{1,2})?)|\b(\d{2,4}(?:,\d{2})?)\s*reais\b/gi;
    let m;
    while ((m = re.exec(String(s)))) out.push(numero(m[1] || m[2]));
    return out;
  };
  const citados = valoresDe(texto);
  if (citados.length && servicos.length) {
    const lista = servicos.filter((s) => Number(s.preco) > 0);
    const precos = lista.map((s) => Number(s.preco));
    const sinal = Number((loja.sinal_pix || {}).valor) || 0;
    const ok = new Set();
    const somar = (v) => ok.add(Math.round(v * 100));
    // um serviço; os "cada unha"/"cada pé" até 10 unidades; a soma de 2 ou 3 serviços diferentes
    for (const s of lista) if (/cada/i.test(norm(s.nome))) for (let k = 2; k <= 10; k++) somar(Number(s.preco) * k);
    for (let i = 0; i < precos.length; i++) {
      somar(precos[i]);
      for (let j = i + 1; j < precos.length; j++) { somar(precos[i] + precos[j]); for (let k = j + 1; k < precos.length; k++) somar(precos[i] + precos[j] + precos[k]); }
    }
    if (sinal) { somar(sinal); for (const v of [...ok]) somar(v / 100 - sinal); }
    // valor que a cliente, a dona ou a ferramenta escreveu (ex.: "pode fazer por 80", "NÃO AGENDADO ... R$ 20")
    for (const v of [...deFora, ...resultados].flatMap(valoresDe)) somar(v);
    for (const v of citados) if (!ok.has(Math.round(v * 100))) add('preco', `R$ ${v} não está na lista de serviços nem é soma ou sinal`);
  }

  // ---------- 2. "reservei / agendado / remarquei / cancelei" só com a ferramenta confirmando agora ----------
  const n = norm(texto);
  const confirmou = (palavra) => resultados.some((r) => new RegExp('^\\s*' + palavra, 'i').test(r));
  if (/\b(reservei|agendei|marquei|deixei (tudo |ja )?(reservad|marcad|agendad)|agendad[oa] com sucesso|ja (te )?(reservei|agendei|marquei))/.test(n) || /^\s*(agendado|reservado|marcado)\b/.test(n)) {
    if (!confirmou('AGENDADO') && !confirmou('REMARCADO')) add('promessa', 'disse que marcou, mas nenhuma ferramenta respondeu AGENDADO nesta resposta');
  }
  if (/\b(remarquei|ja (te )?remarquei|mudei (o |seu )?horario)/.test(n) && !confirmou('REMARCADO')) add('promessa', 'disse que remarcou, mas a ferramenta não respondeu REMARCADO');
  if (/\b(cancelei|ja (te )?cancelei)\b/.test(n) && !confirmou('CANCELADO')) add('promessa', 'disse que cancelou, mas a ferramenta não respondeu CANCELADO');

  // ---------- 3. horário: todo horário citado veio da agenda, da ficha ou da conversa ----------
  const minutos = (h, m) => Number(h) * 60 + Number(m || 0);
  const horasDe = (s) => {
    const out = [];
    const re = /\b([01]?\d|2[0-3])(?:h|:)([0-5]\d)?\b|\b([01]?\d|2[0-3])\s?h(?:rs?|oras?)?\b|\b[àa]s\s([01]?\d|2[0-3])\b(?![,.]\d)/gi;
    let m;
    while ((m = re.exec(String(s)))) {
      if (m[1] !== undefined) out.push(minutos(m[1], m[2]));
      else if (m[3] !== undefined) out.push(minutos(m[3]));
      else if (m[4] !== undefined) out.push(minutos(m[4]));
    }
    return out;
  };
  // antes das 6h é duração ("leva 1h30", "2 horas antes"), não horário de atendimento
  const horasDoTexto = horasDe(texto.replace(/R\$\s?[\d.,]+/g, '')).filter((v) => v >= 6 * 60);
  if (horasDoTexto.length) {
    const fontes = [...resultados, ficha, ...deFora, ...daIa.map((m) => String(m.conteudo || '')), JSON.stringify(cfg.horario_funcionamento || ''), JSON.stringify(cfg.almoco || ''), JSON.stringify(loja.almoco_flexivel || '')];
    const ok = new Set();
    for (const f of fontes) {
      for (const v of horasDe(f)) ok.add(v);
      for (const m of String(f).matchAll(/"([01]d|2[0-3]):([0-5]d)/g)) ok.add(minutos(m[1], m[2]));
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

  // ---------- 4. nome de outra loja ----------
  if (/\bg[l]eide\b|mega\s*-?\s*hair|toda\s+bonit[a]/i.test(texto)) add('outra_loja', 'nome de outra loja ou de mega hair na resposta');

  // ---------- 5. mesma mensagem nos últimos 30 min ----------
  const chaveTxt = String((loja.sinal_pix || {}).chave || '').trim();
  const igual = (s) => norm(chaveTxt ? String(s).split(chaveTxt).join(' ') : s).replace(/[^a-z0-9]+/g, ' ').trim();
  const pedacos = [texto, ...texto.split(/\n\s*\n|\[\d{1,2}\]|\n-{3,}\n/)].map(igual).filter((p) => p.length >= 25);
  const ditas = new Set(recentesIa.flatMap((s) => [s, ...s.split(/\n\s*\n/)]).map(igual));
  if (pedacos.some((p) => ditas.has(p))) add('repetida', 'a mesma mensagem já foi mandada para ela nos últimos 30 minutos');

  // ---------- 6. chave Pix: uma vez a cada 30 min e sozinha na linha ----------
  const chave = String((loja.sinal_pix || {}).chave || '').trim();
  if (chave && texto.includes(chave)) {
    if (recentesIa.some((s) => s.includes(chave))) add('pix', 'chave Pix mandada de novo em menos de 30 minutos');
    const linha = texto.split('\n').find((l) => l.includes(chave)) || '';
    if (linha.replace(chave, '').replace(/[\s.:,;*_`"'()\-]+/g, '').length > 0) add('pix', 'chave Pix grudada em outro texto (difícil de copiar)');
  }

  // ---------- 7. endereço e link de mapa só os do cadastro (mesma regra do endereco-certo.js) ----------
  const end = String(cfg.endereco || '').trim();
  const mapa = String(loja.mapa || '').trim();
  const nt = norm(texto).replace(/\s+/g, ' ');
  const rua = norm(end.split(',')[0] || '').replace(/\s+/g, ' ');
  const num = (end.match(/\d+/) || [''])[0];
  if (/(^|[^a-z])(rua|r\.|avenida|av\.|travessa|alameda|rodovia|estrada)\s+[a-z0-9]/.test(nt) && (!rua || !nt.includes(rua) || (num && !nt.includes(num)))) {
    add('endereco', 'endereço que não é o do cadastro');
  }
  const links = texto.match(/(https?:\/\/|www\.)\S+|\S*(goo\.gl|maps\.|waze\.)\S*/gi) || [];
  if (links.some((l) => /goo\.gl|maps|waze|localiza/i.test(l) && (!mapa || !norm(mapa).includes(norm(l.replace(/[).,;!]+$/, '')).replace(/^https?:\/\//, ''))))) {
    add('endereco', 'link de mapa que não é o do cadastro');
  }

  // ---------- 8. sobra de sistema na mensagem ----------
  const limpo = texto.replace(/\[\[\s*NAO_ENVIAR\s*\]\]|\[SEM TEXTO\]|\[\d{1,2}\]/gi, '');
  if (/\{[a-z_]{2,}\}|\[\s*(link|mapa|pre[cç]o|nome|valor|hor[aá]rio|data|servi[cç]o|endere[cç]o)[^\]]*\]|data_hora_inicio|consultar_horarios_livres|criar_agendamento|ver_agendamentos|remarcar_agendamento|cancelar_agendamento|transferir_para_humano|perguntar_para_\w+|anotar_no_crm|enviar_(audio|catalogo)/i.test(limpo) ||
      /\bN[AÃ]O (AGENDADO|ENVIADO|PERGUNTADO|REMARCADO|CANCELADO)\b|\bPERGUNTADO:/.test(limpo)) {
    add('sistema', 'texto de sistema, variável ou nome de ferramenta na mensagem');
  }

  return { ok: falhas.length === 0, falhas };
}

module.exports = { conferir };
