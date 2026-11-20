// Chave do Gemini só para teste (pedido do Victor, 19/11/2026): a fatura de novembro teve uns 60% de teste misturado com
// o atendimento das clientes. Todo fluxo temporário ("TEMP - ...") criado para testar a IA passa por aqui antes de subir
// para o n8n: troca a credencial do Gemini pela de teste (projeto separado no Google, com limite de gasto próprio).
//
// Uso nos scripts de teste:
//   const { usarGeminiDeTeste } = require('<caminho>/n8n/demo-agente/testes/gemini-teste.js');
//   usarGeminiDeTeste(workflowTemporario, env);   // antes do POST /workflows
//
// env precisa ter N8N_GEMINI_TESTE_CRED_ID (id da credencial "Gemini - testes" no n8n). Sem ele, o teste NÃO roda:
// melhor parar do que gastar na chave das clientes sem ninguém perceber.

function usarGeminiDeTeste(workflow, env) {
  const id = String((env && env.N8N_GEMINI_TESTE_CRED_ID) || '').trim();
  if (!id) throw new Error('Falta N8N_GEMINI_TESTE_CRED_ID no .env: o teste usaria a chave do Gemini das clientes. Crie a credencial "Gemini - testes" no n8n e coloque o id no .env.');
  if (env.N8N_GEMINI_CRED_ID && id === String(env.N8N_GEMINI_CRED_ID).trim()) throw new Error('N8N_GEMINI_TESTE_CRED_ID é igual à credencial das clientes.');
  let trocas = 0;
  for (const n of (workflow && workflow.nodes) || []) {
    if (n.credentials && n.credentials.googlePalmApi) { n.credentials.googlePalmApi = { id, name: 'Gemini - testes' }; trocas++; }
  }
  return trocas;
}

module.exports = { usarGeminiDeTeste };
