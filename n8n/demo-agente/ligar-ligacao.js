// Liga (ou desliga) o tratamento de ligação numa instância do WhatsApp na Evolution. Ver ligacao.js.
//   node ligar-ligacao.js <instancia>            só mostra como está (não muda nada)
//   node ligar-ligacao.js <instancia> --ligar    webhook passa a mandar o evento CALL e a mensagem automática fica vazia
//   node ligar-ligacao.js <instancia> --voltar "<mensagem automática de antes>"   desfaz
// Só rodar --ligar DEPOIS de publicar o workflow com o ligacao.js: sem ele, o evento de ligação quebra a entrada.
// O webhook é regravado com o MESMO endereço e a MESMA senha (lidos da própria Evolution); nada disso é impresso.
const fs = require('fs');
const path = require('path');
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const EVO = env.EVOLUTION_URL || 'https://evo.oistudio.com.br';
const H = { apikey: env.EVOLUTION_API_KEY_SERVIDOR || env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' };
const [inst, modo, msgAntes] = process.argv.slice(2);
if (!inst) { console.log('uso: node ligar-ligacao.js <instancia> [--ligar | --voltar "<mensagem>"]'); process.exit(1); }
const api = async (metodo, rota, corpo) => {
  const r = await fetch(`${EVO}/${rota}/${encodeURIComponent(inst)}`, { method: metodo, headers: H, body: corpo ? JSON.stringify(corpo) : undefined });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch (e) { j = { cru: t.slice(0, 200) }; }
  if (!r.ok) throw new Error(`${rota}: ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
const ler = async () => {
  const s = await api('GET', 'settings/find'); const w0 = await api('GET', 'webhook/find'); const w = w0.webhook || w0;
  return { s, w };
};
const mostrar = ({ s, w }) => console.log(JSON.stringify({ recusaLigacao: s.rejectCall, mensagemAutomatica: s.msgCall, webhookLigado: w.enabled, eventos: w.events,
  caminho: String(w.url || '').split('/').slice(3).join('/'), temSenha: !!(w.headers && Object.keys(w.headers).length) }));
(async () => {
  const antes = await ler();
  console.log('antes: '); mostrar(antes);
  if (modo !== '--ligar' && modo !== '--voltar') return;
  const { s, w } = antes;
  if (!w.url || !w.headers || !Object.keys(w.headers).length) throw new Error('o webhook atual não tem endereço ou senha: não mexo');
  const ligar = modo === '--ligar';
  if (!ligar && !msgAntes) throw new Error('--voltar precisa da mensagem automática de antes');
  const eventos = [...new Set([...(w.events || []).filter((e) => e !== 'CALL'), ...(ligar ? ['CALL'] : [])])];
  await api('POST', 'webhook/set', { webhook: { enabled: w.enabled, url: w.url, headers: w.headers, byEvents: !!w.webhookByEvents, base64: !!w.webhookBase64, events: eventos } });
  await api('POST', 'settings/set', { rejectCall: true, msgCall: ligar ? '' : msgAntes, groupsIgnore: !!s.groupsIgnore, alwaysOnline: !!s.alwaysOnline,
    readMessages: !!s.readMessages, readStatus: !!s.readStatus, syncFullHistory: !!s.syncFullHistory });
  const depois = await ler();
  console.log('depois:'); mostrar(depois);
  const ok = depois.w.url === w.url && JSON.stringify(depois.w.headers) === JSON.stringify(w.headers) && depois.w.enabled === w.enabled &&
    depois.w.events.includes('MESSAGES_UPSERT') && depois.w.events.includes('CALL') === ligar && !!depois.w.webhookBase64 === !!w.webhookBase64 &&
    depois.s.rejectCall === true && String(depois.s.msgCall || '') === (ligar ? '' : msgAntes);
  console.log(ok ? 'CONFERIDO: endereço, senha e mensagens continuam iguais; só mudou a ligação.' : 'ATENÇÃO: o resultado não bate com o esperado. Conferir agora.');
  if (!ok) process.exit(2);
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
