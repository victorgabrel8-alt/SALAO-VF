// Alerta de erro no WhatsApp do Victor (docs/CHECKLIST-ENTREGA.md: "Alerta de erro do n8n chegando no WhatsApp").
// Chamado pelo montar-workflow.js: devolve o workflow "Alerta de erro", que o n8n roda sozinho quando uma execução
// de qualquer workflow nosso falha (settings.errorWorkflow), e acrescenta no principal um aviso quando a IA falha
// e a cliente recebe só o pedido de desculpas (essa execução não "falha", então o n8n não chamaria o alerta).
// A mensagem sai pelo número do salão (Evolution). No máximo 1 alerta por workflow a cada 10 min.
// Outro número: ALERTA_NUMERO no .env (só números, 55 + DDD + número).

module.exports = ({ env, node, main, workflow }) => {
  const NUMERO = env.ALERTA_NUMERO || '556699270860';
  const enviar = (name, position, texto, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: '={{ $env.EVOLUTION_URL }}/message/sendText/{{ $env.EVOLUTION_INSTANCE }}',
    sendHeaders: true, headerParameters: { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] },
    sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify({ number: '${NUMERO}', text: ${texto} }) }}`, options: {},
  }, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, ...extra });

  const alertaWorkflow = {
    name: 'Alerta de erro',
    nodes: [
      node('Execução falhou', 'n8n-nodes-base.errorTrigger', 1, [0, 0], {}),
      node('Montar alerta', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: String.raw`
const e = $input.first().json;
const wf = e.workflow?.name || '?';
const no = e.execution?.lastNodeExecuted || e.trigger?.error?.node?.name || '?';
const erro = String(e.execution?.error?.message || e.trigger?.error?.message || 'sem mensagem').slice(0, 300);
// no máximo 1 alerta por workflow a cada 10 min (vários erros seguidos não viram enxurrada)
const visto = $getWorkflowStaticData('global');
if (visto[wf] && Date.now() - visto[wf] < 10 * 60 * 1000) return [];
visto[wf] = Date.now();
const hora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' });
return [{ json: { texto: '⚠️ Erro no n8n (' + hora + ')\nWorkflow: ' + wf + '\nNó: ' + no + '\nErro: ' + erro +
  (e.execution?.url ? '\n' + e.execution.url : '') } }];
` }),
      enviar('Avisar no WhatsApp', [440, 0], '$json.texto'),
    ],
    connections: { 'Execução falhou': main('Montar alerta'), 'Montar alerta': main('Avisar no WhatsApp') },
    settings: { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all' },
  };

  // ---------- Principal: a IA falhou e a cliente só recebeu o pedido de desculpas ----------
  // "Quebrar mensagens" marca falhou=true quando usa a mensagem de desculpas
  workflow.nodes.push(
    node('IA falhou? (alerta)', 'n8n-nodes-base.if', 2.2, [3180, -240], {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: [{ id: 'falhou', leftValue: '={{ $json.falhou === true }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
        combinator: 'and',
      },
      options: {},
    }),
    enviar('Avisar Victor (IA falhou)', [3400, -260],
      "'⚠️ A IA falhou e mandou o pedido de desculpas para ' + $('Montar entrada').first().json.telefone + ': «' + String($('Montar entrada').first().json.texto_cliente || '').slice(0, 200) + '». Veja em n8n → Executions.'",
      { onError: 'continueRegularOutput', executeOnce: true }),
  );
  workflow.connections['Quebrar mensagens'].main[0].push({ node: 'IA falhou? (alerta)', type: 'main', index: 0 });
  workflow.connections['IA falhou? (alerta)'] = main('Avisar Victor (IA falhou)');

  // liga o "Alerta de erro" em todos os workflows (depois de saber o id dele no n8n)
  const ligarEm = (wfs, id) => { for (const wf of wfs) wf.settings = { ...wf.settings, errorWorkflow: id }; };

  return { alertaWorkflow, ligarEm, idFile: require('path').join(__dirname, '.workflow-alerta-id') };
};
