// O lembrete não repete o combinado que a cliente acabou de ouvir (Gleide; ligado no montar-workflow.js para a raiz).
// 14/11/2026: a cliente marcou com a IA às 14:46, ouviu o combinado na conversa (horário só dela, pontualidade,
// sinal) e às 18h do mesmo dia recebeu o lembrete da véspera com o mesmo texto. Victor: "esse não precisa, não fica
// muito profissional".
//   1. marcou com a IA hoje para outro dia: o lembrete da véspera não sai, fica o do próprio dia (banco, supabase/050);
//   2. marcou com a IA há menos de 24 h ("curto"): o lembrete vai só com o horário e a pergunta, sem o combinado.
// As lojas (--loja) não passam por aqui: cada uma tem o lembrete dela (lembrete-loja.js).

module.exports = ({ faltasWorkflow: wf }) => {
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`lembrete-sem-repetir: não achei "${nome}"`); return n; };
  const trocar = (n, campo, de, para) => {
    const t = String(n.parameters[campo] || '');
    if (t.split(de).length !== 2) throw new Error(`lembrete-sem-repetir: "${n.name}" mudou (${de.slice(0, 40)})`);
    n.parameters[campo] = t.replace(de, () => para);
  };
  trocar(achar('Lembretes para mandar'), 'url', 'rpc/n8n_lembretes_para_mandar', 'rpc/n8n_lembretes_sem_repetir');
  const msg = achar('Mensagem do lembrete');
  trocar(msg, 'jsCode', "  const texto = [oi, reserva,", "  const texto = l.curto ? [oi, lembra, 'Posso confirmar a sua presença?'].join('\\n\\n') : [oi, reserva,");
  trocar(msg, 'jsCode', "  const texto = l.curto ?", [
    "  // lembrete-sem-repetir.js: ela ouviu o combinado na conversa há menos de 24 h",
    "  const lembra = l.online",
    "    ? 'Passando para lembrar da sua avaliação online com a Gleide, ' + quando(l.inicio) + '. Ela liga para você por áudio aqui no WhatsApp.'",
    "    : 'Passando para lembrar do seu horário com a Gleide, ' + quando(l.inicio) + servico + '.' + (l.endereco ? ' Estamos na ' + l.endereco + '.' : '');",
    "  const texto = l.curto ?"].join('\n'));
};
