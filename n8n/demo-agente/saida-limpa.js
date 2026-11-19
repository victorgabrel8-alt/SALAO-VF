// Últimos ajustes na resposta da IA de atendimento antes de ir para o WhatsApp (só nas lojas com "saida_limpa": true
// no loja.json; a Gleide não passa por aqui). Erros reais da Caroline, 12 a 19/11/2026:
//
// 1. CHAVE PIX SOZINHA NO BALÃO. A chave saía grudada no texto ("...me manda o comprovante / 1dba7948-...") e às vezes
//    com o nome da recebedora na linha de baixo. No celular a cliente não consegue copiar só a chave. A Laila escreveu:
//    "Mande o pix sempre em msg separada de outras coisas se não não tem como copiar". Continuou acontecendo com
//    Leonor, Ana, Iara, Ana Junqueira e Ingrid. Agora a chave vai num balão só dela; o nome da recebedora vai no
//    texto de antes ("Pix em nome de ...").
// 2. "RESERVEI" ANTES DO SINAL. "Perfeito Fernanda, reservei aqui pra você!" e, na mesma resposta, "pra garantir o
//    horário é só um sinal": a cliente entende que já está marcado. Quando a resposta pede o sinal e nenhum horário
//    foi gravado nesta rodada, "reservei / deixei reservado" vira "esse horário está livre pra você".
// 3. PALAVRA SOLTA. "Sucesso lá no novo trabalho viu turn-off" (13/11): sobra de modelo, sai antes de enviar.
//
// Lê a chave e o nome da recebedora de empresas.config.loja.sinal_pix (o mesmo do sinal-pix.js).

module.exports = ({ workflow }) => {
  const q = workflow.nodes.find((n) => n.name === 'Quebrar mensagens');
  if (!q) throw new Error('saida-limpa: não achei "Quebrar mensagens"');
  const PONTO = 'baloes = baloes.filter(b => b.t);';
  if (q.parameters.jsCode.split(PONTO).length !== 2) throw new Error('saida-limpa: o "Quebrar mensagens" mudou (ponto de entrada)');
  if (!workflow.nodes.some((n) => n.name === 'Supabase: dados do salão')) throw new Error('saida-limpa: não achei "Supabase: dados do salão"');

  q.parameters.jsCode = q.parameters.jsCode.replace(PONTO, () => PONTO + String.raw`
// ---- saida-limpa.js ----
try {
  const sp = ((($('Supabase: dados do salão').first().json.config || {}).loja || {}).sinal_pix) || {};
  const chave = String(sp.chave || '').trim();
  const nomes = [].concat(sp.nome_recebedor || []).map((n) => String(n || '').trim()).filter(Boolean).sort((a, b) => b.length - a.length);
  const escapar = (s) => s.replace(/[.*+?^${'$'}{}()|[\]\\]/g, '\\$&');
  // 2. "reservei" antes do sinal: só quando esta resposta pede o sinal e nenhum horário foi gravado agora
  const passosIA = $('Agente IA').first().json.intermediateSteps || [];
  const gravouAgora = passosIA.some((p) => ['criar_agendamento', 'remarcar_agendamento'].includes(p.action?.tool) && /AGENDADO|REMARCADO/.test(JSON.stringify(p.observation || '')));
  const pedeSinal = baloes.some((b) => (chave && b.t.includes(chave)) || /(é só|basta|precis[ao] d[eo]|preciso de)\s+(um |o )?sinal|sinal\s+(de\s+)?R\$\s?\d+[^.!?]*\bagora\b|mand[ae]r?\s+(o\s+|um\s+)?(print|comprovante)/i.test(b.t));
  if (pedeSinal && !gravouAgora) {
    baloes.forEach((b) => {
      b.t = b.t.replace(/\b(j[áa]\s+)?(reservei|deixei\s+reservad[oa])(\s+(ele|esse\s+hor[áa]rio|seu\s+hor[áa]rio))?(\s+aqui)?(\s+(pra|para)\s+(voc[eê]|ti))?(?=[\s!.,;]|$)/gi, 'esse horário está livre pra você');
    });
  }
  // 3. palavra solta em inglês que sobra do modelo
  baloes.forEach((b) => { b.t = b.t.replace(/\s*\bturn[- ]?off\b/gi, '').replace(/\s+([.!?,])/g, '$1').trim(); });
  // 1. chave Pix num balão só dela
  if (chave) {
    const novos = [];
    for (const b of baloes) {
      if (!b.t.includes(chave) || b.t.trim() === chave) { novos.push(b); continue; }
      const i = b.t.indexOf(chave);
      let antes = b.t.slice(0, i), depois = b.t.slice(i + chave.length);
      let nomeJunto = '';
      for (const n of nomes) {
        const re = new RegExp('^[\\s/:–-]*' + escapar(n) + '[\\s.]*', 'i');
        if (re.test(depois)) { depois = depois.replace(re, ' '); nomeJunto = n; break; }
      }
      // tira "chave:" / "Pix:" pendurado no fim do texto de antes (a chave vem logo depois, sozinha)
      antes = antes.replace(/[\s/:–-]+$/, '').trim();
      depois = depois.replace(/^[\s/:–-]+/, '').trim();
      if (nomeJunto && !antes.toLowerCase().includes(nomeJunto.toLowerCase())) antes = (antes ? antes + (/[.!?]$/.test(antes) ? ' ' : '. ') : '') + 'Pix em nome de ' + nomeJunto + ':';
      if (antes) novos.push({ t: antes, ref: 0 });
      novos.push({ t: chave, ref: 0 });
      if (depois) novos.push({ t: depois, ref: 0 });
    }
    baloes = novos;
  }
  baloes = baloes.filter((b) => b.t);
} catch (e) {}
// ---- fim saida-limpa.js ----`);
};
