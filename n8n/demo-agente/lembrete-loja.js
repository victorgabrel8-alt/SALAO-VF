// Lembrete da loja em dois momentos, com o texto dela (só nas lojas com "lembrete_duplo": true no loja.json;
// a Gleide não passa por aqui e continua com o lembrete e o texto dela).
// Pedido do Victor (14/11/2026, Caroline): "manda um dia antes confirmando e depois 2 horas antes do horário".
//   - véspera (a partir das 18h): confirma a presença;
//   - 2 horas antes (até 45 min antes): lembra e pede para não atrasar.
// Quem decide o que sai é o banco (n8n_lembretes_para_mandar_c, supabase/048_lembrete_vespera_e_horas_antes.sql):
// ligar em empresas.config.lembretes = {"ligado": true, "so_para": [], "vespera": "18:00", "horas_antes": 2}.
// Limite: a rotina roda das 8h às 20h, então horário antes das 8h45 só recebe o lembrete da véspera.

module.exports = ({ faltasWorkflow: wf, loja }) => {
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`lembrete_duplo: não achei "${nome}"`); return n; };
  if (!loja.nome || !loja.dona) throw new Error('lembrete_duplo: a loja precisa de "nome" e "dona" no loja.json');
  // 1. o banco diz o momento de cada lembrete
  const ler = achar('Lembretes para mandar');
  if (!String(ler.parameters.url).includes('rpc/n8n_lembretes_para_mandar')) throw new Error('lembrete_duplo: "Lembretes para mandar" mudou');
  ler.parameters.url = ler.parameters.url.replace('rpc/n8n_lembretes_para_mandar', 'rpc/n8n_lembretes_para_mandar_c');
  // 2. texto da loja (o começo do código, com as funções de data, fica como está)
  const msg = achar('Mensagem do lembrete');
  const i = msg.parameters.jsCode.indexOf('return $input.all()');
  if (i < 0) throw new Error('lembrete_duplo: "Mensagem do lembrete" mudou');
  msg.parameters.jsCode = msg.parameters.jsCode.slice(0, i) + `
const LOJA = ${JSON.stringify(loja.nome)}, DONA = ${JSON.stringify(loja.dona)};
return $input.all().map((i) => i.json).filter((l) => l.agendamento_id).map((l) => {
  const nome = primeiro(l.nome);
  const oi = 'Oi' + (nome ? ', ' + nome : '') + '!';
  const texto = l.momento === 'horas_antes'
    ? oi + ' Lembrando do seu horário com a ' + DONA + ' ' + quando(l.inicio) + '. A agenda dela está cheia e ela não consegue esperar atraso, tá bom? Te esperamos!'
    : oi + ' Aqui é do ' + LOJA + '. Passando para confirmar o seu horário com a ' + DONA + ' ' + quando(l.inicio) + '. Posso confirmar a sua presença?';
  return { json: { ...l, texto } };
});
`;
};
