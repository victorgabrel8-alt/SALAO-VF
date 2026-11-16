// A IA lembra da conversa antiga quando a cliente volta depois de um tempo.
// 16/11/2026, Gleide: uma cliente contou em 30/10 que era a primeira vez, que o cabelo era cacheado e que queria
// alongar. Voltou em 16/11 dizendo "quero marcar um horário" e a IA perguntou tudo de novo. A memória da conversa
// (Redis) dura só alguns dias (sessionTTL); depois disso a IA não tinha nada, embora a conversa esteja no banco.
//
// Como funciona: antes de responder, busca as últimas mensagens dela no banco (120 dias). Se entre duas mensagens
// DELA houve um silêncio maior que o prazo da memória, tudo o que veio antes desse silêncio não está mais no Redis:
// esse trecho (as últimas 24 mensagens dele) entra em "Sobre esta cliente" como CONVERSA ANTERIOR.
// Só olha as mensagens dela porque é a mensagem dela que faz o agente rodar e renovar o prazo da memória.
// Quem conversa sem parar por mais tempo que o prazo não recebe nada a mais (a memória do Redis cobre).

module.exports = ({ workflow, main }) => {
  const achar = (nome) => { const n = workflow.nodes.find((x) => x.name === nome); if (!n) throw new Error('conversa-antiga: não achei "' + nome + '"'); return n; };
  const sobre = achar('Sobre esta cliente');
  const ultimas = achar('Supabase: últimas mensagens');
  const memoria = workflow.nodes.find((n) => n.type.endsWith('memoryRedisChat') && workflow.connections[n.name]?.ai_memory?.[0]?.[0]?.node === 'Agente IA');
  if (!memoria) throw new Error('conversa-antiga: o "Agente IA" não tem memória Redis');
  const prazoSeg = Number(memoria.parameters.sessionTTL);
  if (!(prazoSeg > 0)) throw new Error('conversa-antiga: a memória não tem prazo (sessionTTL)');

  // consulta: cópia da "últimas mensagens", com mais campos, mais mensagens e 120 dias
  const DE = "select=direcao,conteudo,wa_message_id,criado_em&order=criado_em.desc&limit=15";
  const PRAZO_DE = "$now.minus(12, 'hours')";
  if (!ultimas.parameters.url.includes(DE) || !ultimas.parameters.url.includes(PRAZO_DE)) throw new Error('conversa-antiga: a consulta "últimas mensagens" mudou');
  const consulta = JSON.parse(JSON.stringify(ultimas));
  consulta.name = 'Supabase: conversa antiga';
  delete consulta.id;
  consulta.parameters.url = consulta.parameters.url.replace(DE, 'select=direcao,autor,tipo,conteudo,criado_em&order=criado_em.desc&limit=80').replace(PRAZO_DE, "$now.minus(120, 'days')");
  consulta.onError = 'continueRegularOutput'; // se a consulta falhar, a IA responde sem a conversa antiga
  consulta.alwaysOutputData = true;
  workflow.nodes.push(consulta);
  const depois = workflow.connections[ultimas.name];
  workflow.connections[ultimas.name] = main(consulta.name);
  workflow.connections[consulta.name] = depois;

  const trocar = (de, para, todas) => {
    if (!sobre.parameters.jsCode.includes(de)) throw new Error('conversa-antiga: o código de "Sobre esta cliente" mudou (' + de.slice(0, 50) + ')');
    sobre.parameters.jsCode = todas ? sobre.parameters.jsCode.split(de).join(para) : sobre.parameters.jsCode.replace(de, () => para);
  };
  trocar('if (!ficha.id) return', String.raw`// conversa-antiga.js: o que ela conversou antes de a memória (Redis) vencer
const PRAZO_MEMORIA_MS = ${Math.round(prazoSeg * 0.95)} * 1000;
let ANTIGA = '';
try {
  const todas = $('Supabase: conversa antiga').all().map((i) => i.json).filter((m) => m.direcao && m.criado_em && m.conteudo); // mais nova primeiro
  const dela = todas.filter((m) => m.direcao === 'entrada');
  let corte = null; // a mensagem dela logo ANTES do silêncio mais recente maior que o prazo
  for (let i = 0; i + 1 < dela.length; i++) {
    if (DateTime.fromISO(dela[i].criado_em).toMillis() - DateTime.fromISO(dela[i + 1].criado_em).toMillis() > PRAZO_MEMORIA_MS) { corte = dela[i + 1]; break; }
  }
  if (corte) {
    // tudo até a última resposta do salão a essa mensagem (o que saiu antes de ela voltar a escrever)
    const volta = dela[dela.indexOf(corte) - 1];
    const antigas = todas.filter((m) => m.criado_em < volta.criado_em && !/^Desculpa, tive um probleminha/.test(m.conteudo) && !/^\[m[ií]dia\]$/.test(m.conteudo)).slice(0, 24).reverse();
    const quem = (m) => m.direcao === 'entrada' ? 'Ela' : m.autor === 'ia' ? 'Você' : 'Salão';
    if (antigas.length) ANTIGA = '\nCONVERSA ANTERIOR COM ELA (de ' + dia(antigas[0].criado_em).toFormat('dd/LL') + ' a ' + dia(antigas[antigas.length - 1].criado_em).toFormat('dd/LL') +
      '; aconteceu de verdade, mas NÃO está no seu histórico de mensagens):\n' +
      antigas.map((m) => '[' + dia(m.criado_em).toFormat('dd/LL HH:mm') + '] ' + quem(m) + ': ' + String(m.conteudo).replace(/\s*\n\s*/g, ' ').slice(0, 240)).join('\n') +
      '\nUse isso como quem lembra dela: não se apresente de novo e NÃO pergunte de novo o que ela já respondeu ali. Retome de onde parou, citando em poucas palavras o que ela já contou. Horários, valores e ofertas daquela conversa não valem mais: consulte de novo. Só confirme em uma frase algo que pode ter mudado.';
  }
} catch (e) {}
if (!ficha.id) return`);
  trocar('JA_FALOU + SEM_RESPOSTA', 'JA_FALOU + SEM_RESPOSTA + ANTIGA', true);
  if ((sobre.parameters.jsCode.match(/SEM_RESPOSTA \+ ANTIGA/g) || []).length !== 3) throw new Error('conversa-antiga: esperava 3 saídas em "Sobre esta cliente"');
  // "Cliente nova" não combina com quem já conversou antes
  trocar("(ultimaIA ? 'Ainda não veio ao salão e não tem nada marcado.' : NOVA)", "(ultimaIA || ANTIGA ? 'Ainda não veio ao salão e não tem nada marcado.' : NOVA)");
};
