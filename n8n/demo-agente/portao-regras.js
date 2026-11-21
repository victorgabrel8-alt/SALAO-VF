// Portão de ações (fase 1): confere as ações que a IA fez (gravar, marcar, mandar) contra a FALA de quem pediu.
// É só código (sem IA): a mesma entrada dá sempre o mesmo resultado. Testes em testes/portao.test.js.
// Começo de 21/11/2026: a assistente gravou como aplicação de mega hair a recolocação do cabelo da própria cliente
// (Renata 13/11, Dienne 18/11) e o relatório da negociação saiu errado. Aqui cada ação precisa de prova na fala.
//
// conferirAcoes(ctx) devolve { acoes: [{ ferramenta, entrada, resultado, falhas: [{ tipo, detalhe }] }], n_falhas }.
// ctx:
//   agente  'assistente' (a dona falando com a assistente) ou 'atendimento' (a cliente falando com a IA)
//   passos  intermediateSteps do agente: [{ ferramenta, entrada, resultado }]
//   fala    o que a dona / a cliente escreveu nesta vez (mensagens juntas)
//   ficha   (atendimento) o "Sobre esta cliente": o que ela já contou antes
//
// Este arquivo também roda dentro do n8n: portao.js cola o texto da função no nó "Portão: conferir".
// Por isso: nada de require, nada de variável de fora da função.

function conferirAcoes(ctx) {
  ctx = ctx || {};
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const agente = ctx.agente === 'atendimento' ? 'atendimento' : 'assistente';
  const fala = norm(ctx.fala);
  const ficha = norm(ctx.ficha);
  const passos = (Array.isArray(ctx.passos) ? ctx.passos : []).filter((p) => p && p.ferramenta);
  const LEITURA = ['buscar_cliente', 'agenda_do_dia', 'horarios_livres', 'ver_bloqueios_horario', 'consultar_horarios_livres',
    'ver_agendamentos', 'enviar_catalogo', 'enviar_audio'];
  const tem = (re) => re.test(fala);
  const curto = (x, n) => { const s = typeof x === 'string' ? x : JSON.stringify(x == null ? '' : x); return s.length > n ? s.slice(0, n) + '…' : s; };
  const entradaDe = (p) => {
    let e = p.entrada;
    if (typeof e === 'string') { try { e = JSON.parse(e); } catch (er) { e = { texto: e }; } }
    return e && typeof e === 'object' ? e : {};
  };
  const val = (e, k) => (e[k] == null ? '' : String(e[k]).trim());
  const sim = (t) => /^\s*(sim|true|1|yes)\b(?!.*\b(dela|nao|mas)\b)|^\s*s\s*[.!]?\s*$/i.test(norm(t));

  // aplicação = colocação de cabelo novo; unha não entra (Alongamento F1, gel...)
  const ehAplicacao = (s) => /aplica|coloca|instala|bota|mega novo|cabelo novo|alongamento/.test(norm(s)) &&
    !/manuten|recoloc|repor|reposi|avalia|retir|aperto|apertar|reapert|tirar e colocar|visita|escolher/.test(norm(s)) &&
    !/unha|molde|\bf1\b|\bgel\b|esmalt|manicure|pedicure|cuticula/.test(norm(s));
  // a cliente já tem o cabelo: o que ela vai fazer é manutenção
  const CABELO_DELA = /ja uso|uso mega|ja tenho (mega|o cabelo)|meu (proprio )?cabelo|meu mega|minhas mechas|recoloc|repor|caiu|cairam|trocar (a |de )?tecnica|mudar (a |de )?tecnica|mudar o metodo|passar (pra|para) (a )?fita|levo (os|as) (cabelo|mecha)/;
  const PROVA_CABELO_NOVO = /novo|nova|compr|chegou|encomend|gramas|\d+ ?cm|vietnam|europeu|brasileiro|cabelo do salao|cabelo da gleide|vai levar o cabelo daqui/;

  const acoes = [];
  for (const p of passos) {
    const nomeF = String(p.ferramenta);
    if (LEITURA.includes(nomeF)) continue;
    const e = entradaDe(p);
    const res = curto(p.resultado, 300);
    const falhas = [];
    const add = (tipo, detalhe) => falhas.push({ tipo, detalhe });
    const servico = val(e, 'servico');
    const deuErro = /^\s*\[?\s*"?\s*erro/i.test(res) || /n[aã]o gravado/i.test(res);

    if (agente === 'assistente') {
      // 1. aplicação sem cabelo novo dito (o portão da fase 0 já barra; aqui fica o registro)
      if (['marcar_horario', 'reagendar', 'concluir', 'registrar_atendimento'].includes(nomeF) && servico && ehAplicacao(servico)) {
        if (!sim(val(e, 'cabelo_novo'))) add('aplicacao_sem_cabelo_novo', servico);
        else if (!tem(PROVA_CABELO_NOVO)) add('cabelo_novo_sem_prova', 'cabelo_novo = sim, mas a fala não diz que é cabelo novo');
        if (tem(CABELO_DELA)) add('aplicacao_com_cabelo_da_cliente', 'a fala diz que é o cabelo dela');
      }
      // 2. valor que ninguém disse
      const v = val(e, 'valor').replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
      if (v && Number(v) > 0) {
        const n = String(Math.round(Number(v)));
        const naFala = fala.replace(/\.(?=\d{3}\b)/g, '');
        if (!new RegExp('(^|\\D)' + n + '(\\D|$)').test(naFala)) add('valor_sem_prova', 'valor ' + v + ' não aparece na fala');
      }
      // 3. resultado da avaliação
      if (nomeF === 'resultado_avaliacao') {
        const r = norm(val(e, 'resultado'));
        if (r === 'fechou' && !tem(/fech|vai fazer|marc|volta|topou|aceit|confirm|quer fazer|agend|vai colocar|vai fazer/)) add('fechou_sem_prova', 'a fala não diz que fechou');
        if (/nao.?fechou/.test(r) && !tem(/nao (quis|quer|vai|fechou|fecha|rolou)|desist|caro|sem condic|nao deu/)) add('nao_fechou_sem_prova', 'a fala não diz que ela desistiu');
        if (r === 'fechou' && /aplica/.test(norm(val(e, 'proximo_passo'))) && tem(CABELO_DELA)) add('aplicacao_com_cabelo_da_cliente', 'fechou como aplicação, mas a fala diz que é o cabelo dela');
      }
      // 4. concluir, falta, excluir, envio: cada um com a sua prova
      if (nomeF === 'concluir' && !tem(/fez|fiz|atendi|termin|veio|feito|pronto|conclu|ja foi|saiu|acabei|acabou|finaliz|vieram|fizeram/)) add('concluir_sem_prova', 'a fala não diz que o atendimento aconteceu');
      const status = norm(val(e, 'status'));
      if ((nomeF === 'liberar_horario' || (nomeF === 'status_atendimento' && /falt/.test(status))) &&
        !tem(/nao veio|faltou|nao apareceu|nao vem|furou|nao chegou|nao vai vir|nao vai vim|desistiu de vir/)) add('falta_sem_prova', 'a fala não diz que a cliente faltou');
      if (nomeF === 'excluir_horario' && !tem(/cancel|desmarc|tira|exclu|apaga|nao vem|nao vai|remove/)) add('excluir_sem_prova', 'a fala não pede para tirar o horário');
      if (['chamar_cliente', 'avisar_cliente'].includes(nomeF) && !tem(/chama|avisa|manda|fala com|fala pra|pergunta|lembra|confirma|diz|toque|chamar|avise|mande|chame|escreve|responde/)) add('envio_sem_pedido', 'a fala não pede para mandar mensagem');
      // 5. hora marcada que ninguém disse
      if (['marcar_horario', 'reagendar'].includes(nomeF)) {
        const m = val(e, 'inicio').match(/T(\d{2}):(\d{2})/);
        if (m) {
          const h = Number(m[1]); const h12 = h > 12 ? h - 12 : h;
          const horas = [h, h12].map(String);
          const ditas = horas.some((x) => new RegExp('(^|\\D)0?' + x + '(\\s?(h|hs|hrs|horas|:|\\.)|\\s|$|\\D)').test(fala)) || (h === 12 && /meio.?dia/.test(fala));
          if (!ditas) add('hora_sem_prova', 'a hora ' + m[1] + ':' + m[2] + ' não aparece na fala');
        }
      }
    } else {
      // atendimento: a cliente que já tem o cabelo não faz "aplicação" (Dienne, 16/11: "pra colocar meu cabelo")
      if (['criar_agendamento', 'remarcar_agendamento'].includes(nomeF) && servico && ehAplicacao(servico) &&
        (CABELO_DELA.test(fala) || CABELO_DELA.test(ficha))) add('aplicacao_com_cabelo_da_cliente', 'a cliente já usa mega / falou do cabelo dela');
      if (nomeF === 'cancelar_agendamento' && !tem(/cancel|desmarc|nao vou|nao vai dar|nao consigo|nao posso|nao da|desist|outro dia|remarc/)) add('cancelar_sem_prova', 'a cliente não pediu para cancelar');
    }
    if (deuErro && !falhas.length) continue; // a ferramenta não gravou e nada a apontar
    acoes.push({ ferramenta: nomeF, entrada: curto(e, 600), resultado: res, falhas });
  }
  return { acoes, n_falhas: acoes.reduce((s, a) => s + a.falhas.length, 0) };
}

if (typeof module !== 'undefined') module.exports = { conferirAcoes };
