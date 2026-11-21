// Alerta de erro no WhatsApp do Victor (docs/CHECKLIST-ENTREGA.md: "Alerta de erro do n8n chegando no WhatsApp").
// Chamado pelo montar-workflow.js: devolve o workflow "Alerta de erro", que o n8n roda sozinho quando uma execução
// de qualquer workflow nosso falha (settings.errorWorkflow), e acrescenta no principal um aviso quando a IA falha
// e a cliente recebe só o pedido de desculpas (essa execução não "falha", então o n8n não chamaria o alerta).
// A mensagem sai pelo número do salão (Evolution). No máximo 1 alerta por workflow a cada 10 min.
// Outro número: ALERTA_NUMERO no .env (só números, 55 + DDD + número).

const { montarResumo } = require('./portao-regras.js');

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
      // Resumo do portão de ações (portao.js, supabase/065): às 20h, só nos dias com alarme, para o Victor
      node('Resumo do portão (20h)', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 300], { rule: { interval: [{ field: 'days', triggerAtHour: 20, triggerAtMinute: 0 }] } }),
      node('Portão: alarmes do dia', 'n8n-nodes-base.httpRequest', 4.2, [220, 300], {
        method: 'GET',
        url: "={{ $env.SUPABASE_URL }}/rest/v1/portao_registros?select=agente,telefone,fala,acoes,n_falhas,criado_em&n_falhas=gt.0&order=criado_em.asc" +
          "&empresa_id=eq.{{ $env.EMPRESA_ID || '00000000-0000-0000-0000-000000000001' }}" +
          "&criado_em=gte.{{ new Date(new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10) + 'T04:00:00Z').toISOString() }}",
        sendHeaders: true,
        headerParameters: { parameters: [
          { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
          { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
        ] },
        options: { timeout: 15000 },
      }, { onError: 'continueRegularOutput' }),
      node('Portão: montar resumo', 'n8n-nodes-base.code', 2, [440, 300], { jsCode: [
        `const montarResumo = ${montarResumo.toString()};`,
        "const regs = $input.all().map((i) => i.json).filter((r) => r && r.n_falhas);",
        "const dia = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10).split('-').reverse().join('/');",
        "const texto = montarResumo(regs, dia);",
        "return texto ? [{ json: { texto } }] : [];",
      ].join('\n') }),
      enviar('Portão: avisar o Victor', [660, 300], '$json.texto', { onError: 'continueRegularOutput' }),
    ],
    connections: { 'Execução falhou': main('Montar alerta'), 'Montar alerta': main('Avisar no WhatsApp'),
      'Resumo do portão (20h)': main('Portão: alarmes do dia'), 'Portão: alarmes do dia': main('Portão: montar resumo'),
      'Portão: montar resumo': main('Portão: avisar o Victor') },
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
      // (21/11) o aviso diz o motivo: nesse dia o Gemini bateu o teto de gasto do mês e a IA ficou fora nas duas lojas;
      // o aviso só dizia "veja em Executions" e parecia falha do portão
      "'⚠️ A IA falhou e mandou o pedido de desculpas para ' + $('Montar entrada').first().json.telefone + ': «' + String($('Montar entrada').first().json.texto_cliente || '').slice(0, 200) + '».' + " +
      "(() => { let e = ''; try { const x = $('Agente IA').first().json.error; e = !x ? '' : typeof x === 'string' ? x : String(x.message || JSON.stringify(x)); } catch (x) {} if (!e) return ''; " +
      // sem os endereços compridos do erro do Google, que comiam os 160 caracteres do motivo
      "return ' Motivo: ' + e.replace(/https?:\\/\\/\\S+/g, '').replace(/\\s+/g, ' ').trim().slice(0, 160) + (/too many requests|quota|spend|429|rate limit/i.test(e) ? ' → o Gemini recusou (limite ou teto de gasto do mês). A IA fica fora para TODAS as clientes até liberar em https://ai.studio/spend' : '') + '.'; })() + " +
      "' Veja em n8n → Executions.'",
      { onError: 'continueRegularOutput', executeOnce: true }),
  );
  workflow.connections['Quebrar mensagens'].main[0].push({ node: 'IA falhou? (alerta)', type: 'main', index: 0 });
  workflow.connections['IA falhou? (alerta)'] = main('Avisar Victor (IA falhou)');

  // liga o "Alerta de erro" em todos os workflows (depois de saber o id dele no n8n)
  const ligarEm = (wfs, id) => { for (const wf of wfs) wf.settings = { ...wf.settings, errorWorkflow: id }; };

  return { alertaWorkflow, ligarEm, idFile: require('path').join(__dirname, '.workflow-alerta-id') };
};
