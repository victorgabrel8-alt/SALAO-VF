// A assistente da dona enxerga as conversas recentes com as clientes (só nas lojas com "assistente_conversas": true
// no loja.json; a Gleide não passa por aqui).
// 13/11/2026, Caroline: a assistente mandou a mesma oferta duas vezes e mudou um horário sem saber que a cliente já
// tinha recusado e combinado outro com a IA de atendimento. Ela não tinha como ler a conversa da cliente.
// Agora, a cada mensagem da dona, o fluxo lê as mensagens das últimas 3 h (clientes e salão) e põe no prompt.

module.exports = ({ assistenteWorkflow: wf }) => {
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`assistente_conversas: não achei "${nome}"`); return n; };
  // modelo: um GET do Supabase que já existe no fluxo (mesmos cabeçalhos)
  const ler = {
    id: 'c0a5e12a-7e11-4c0a-9d3b-a55157e47e01', name: 'Ler conversas', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [0, 0],
    parameters: {
      method: 'GET', url: '',
      sendHeaders: true, headerParameters: { parameters: [
        { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' }, { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' }] },
      options: { timeout: 15000 },
    },
  };
  ler.parameters.url ="={{ $env.SUPABASE_URL }}/rest/v1/mensagens?select=direcao,autor,conteudo,criado_em,clientes(nome,telefone)&empresa_id=eq.{{ $env.EMPRESA_ID }}" +
    "&criado_em=gte.{{ $now.minus(3, 'hours').toUTC().toISO() }}&order=criado_em.desc&limit=80";
  ler.onError = 'continueRegularOutput'; ler.alwaysOutputData = true; ler.executeOnce = true;
  wf.nodes.push(ler);
  // entra logo antes do agente ler o registro do que já fez
  const antes = 'Ler pedidos abertos';
  achar(antes);
  const depois = wf.connections[antes]?.main?.[0];
  if (!depois || depois.length !== 1) throw new Error('assistente_conversas: a ligação de "Ler pedidos abertos" mudou');
  wf.connections[antes] = { main: [[{ node: ler.name, type: 'main', index: 0 }]] };
  wf.connections[ler.name] = { main: [depois] };

  // texto: por cliente, as últimas 6 mensagens, mais antiga primeiro
  const TEXTO = "{{ (() => { try { const ms = $('Ler conversas').all().map((i) => i.json).filter((m) => m && m.conteudo && m.criado_em); if (!ms.length) return '(nenhuma mensagem de cliente nas últimas 3 horas)'; " +
    "const por = {}; for (const m of ms) { const c = m.clientes || {}; const k = (c.nome || 'sem nome') + ' (…' + String(c.telefone || '').slice(-4) + ')'; (por[k] = por[k] || []).push(m); } " +
    "return Object.entries(por).slice(0, 10).map(([k, l]) => '• ' + k + ': ' + l.slice(0, 6).reverse().map((m) => '[' + DateTime.fromISO(m.criado_em).setZone('America/Cuiaba').toFormat('HH:mm') + '] ' + " +
    "(m.direcao === 'entrada' ? 'CLIENTE' : (m.autor === 'humano' ? 'CAROLINE (celular)' : 'SALÃO (você ou a IA de atendimento)')) + ': «' + String(m.conteudo).split(String.fromCharCode(10)).join(' ').slice(0, 170) + '»').join(' | ')).join(String.fromCharCode(10)); " +
    "} catch (e) { return '(não consegui ler as conversas agora)'; } })() }}";
  const o = achar('Agente assistente').parameters.options;
  if (!String(o.systemMessage).startsWith('=')) throw new Error('assistente_conversas: o prompt da assistente não é expressão');
  o.systemMessage += '\n\nCONVERSAS COM AS CLIENTES NAS ÚLTIMAS 3 HORAS (lidas do sistema agora; é o que foi dito de verdade)\n' + TEXTO + '\n' +
    '- ANTES de mandar mensagem a uma cliente, mudar o horário dela ou responder à Caroline sobre ela, leia aqui o que ela já respondeu.\n' +
    '- Se a cliente já recusou um horário, não ofereça de novo. Se ela já aceitou um horário (com você ou com a IA de atendimento), esse é o horário dela: conte isso à Caroline antes de mexer.\n' +
    '- Se a Caroline perguntar "ela respondeu?", responda com o que está aqui, citando a hora. Não diga "ainda não respondeu" sem olhar.\n' +
    '- Se o salão já mandou a mesma coisa há pouco, não mande de novo.';
};
