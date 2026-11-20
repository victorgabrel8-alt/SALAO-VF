// "Confirmo" ao lembrete vai para a agenda (só nas lojas com "confirmou_presenca": true no loja.json; a Gleide não
// passa por aqui). PDF "IA da Carol · Erros", erro 3: na véspera a cliente responde "confirmo" ao lembrete, a IA
// agradece e nada muda no app (9 de 9). Agora cada mensagem da cliente, logo depois de registrada no app, passa por
// n8n_confirmar_presenca (supabase/055): resposta curta que confirma, a um lembrete das últimas 30 h, grava
// agendamentos.confirmado_em e o app mostra "Confirmou". O resto da conversa não muda (a IA continua respondendo).
//
// Ramo à parte depois de "Supabase: registrar entrada"; erro aqui não segura nada. Fica acima e à esquerda do
// "Foto: é foto?" para rodar antes (executionOrder v1): a gravação sai antes de a IA responder.

module.exports = ({ node, workflow: W, empresaId }) => {
  const achar = (nome) => { const n = W.nodes.find((x) => x.name === nome); if (!n) throw new Error('confirmou-presenca: sem o nó ' + nome); return n; };
  achar('Supabase: registrar entrada');
  achar('Texto da mensagem');
  const saida = W.connections['Supabase: registrar entrada']?.main?.[0];
  if (!saida || !saida.length) throw new Error('confirmou-presenca: "Supabase: registrar entrada" sem saída');
  const [fx, fy] = achar(saida[0].node).position;
  W.nodes.push(node('Presença: confirmou?', 'n8n-nodes-base.httpRequest', 4.2, [fx - 300, fy - 300], {
    method: 'POST', url: '={{ $env.SUPABASE_URL }}/rest/v1/rpc/n8n_confirmar_presenca',
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
    ] },
    sendBody: true, specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ p_empresa_id: '${empresaId}', p_cliente_id: $('Supabase: registrar entrada').first().json.cliente_id || null, p_texto: String($('Texto da mensagem').first().json.texto || '') }) }}`,
    options: { timeout: 3000 },
  }, { onError: 'continueRegularOutput' }));
  saida.push({ node: 'Presença: confirmou?', type: 'main', index: 0 });
};
