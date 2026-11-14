// Nova loja no motor único (docs/PLANO-MOTOR-UNICO.md, "Entrada de loja nova").
// Um comando cria a loja no banco, a instância do WhatsApp já apontada para o motor do ramo e devolve o QR.
// É a mesma sequência que o botão "Nova loja" do painel vai chamar.
//
//   node nova-loja.js --ramo unhas --nome "Studio da Ana" --dona Ana --whatsapp-dona 5566999990000
//                     [--cidade Sinop] [--limite 200] [--bloco 120] [--email ana@exemplo.com]
//   node nova-loja.js --qr <instancia>             QR novo (o QR vale menos de 1 minuto)
//   node nova-loja.js --status <instancia>         a loja, a conexão do WhatsApp e o uso do mês
//   node nova-loja.js --liberar <instancia>        a IA passa a responder todas as clientes
//   node nova-loja.js --travar <instancia>         volta para a trava de teste (só o número da agência)
//
// A loja nasce no motor com a trava de teste: a IA só responde o número da agência (numero_agencia do
// loja.json do motor) até o --liberar. A dona preenche horários e preços no app.
// --email manda o convite de login do app para a dona (Supabase) e liga o login só a esta loja.

const fs = require('fs');
const path = require('path');

const dir = __dirname;
const env = Object.fromEntries(
  fs.readFileSync(path.join(dir, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
// ramo -> nicho no banco e pasta do motor
const RAMOS = { unhas: { nicho: 'manicure', motor: 'motor-unhas' }, megahair: { nicho: 'mega_hair', motor: 'motor-megahair' } };
const EVO = (env.EVOLUTION_URL_PUBLICA || 'https://evo.oistudio.com.br').replace(/\/$/, '');
const EVO_CHAVE = env.EVOLUTION_API_KEY_SERVIDOR;
// de dentro do servidor a Evolution chama o n8n pelo nome do serviço (igual às lojas com conjunto próprio)
const N8N_INTERNO = (env.N8N_URL_INTERNA || 'http://n8n:5678').replace(/\/$/, '');

const args = process.argv.slice(2);
const arg = (nome) => { const i = args.indexOf(`--${nome}`); return i >= 0 ? (args[i + 1] || '') : null; };
const falha = (msg) => { console.error(`\nNÃO FIZ: ${msg}\n`); process.exit(1); };
const digitos = (s) => String(s || '').replace(/\D/g, '');
const sem9 = (n) => { const d = digitos(n); return /^55\d{2}9\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d; };

const supa = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' };
const banco = async (rota, opcoes = {}) => {
  const r = await fetch(`${env.SUPABASE_URL}${rota}`, { ...opcoes, headers: { ...supa, ...(opcoes.headers || {}) } });
  const texto = await r.text();
  if (!r.ok) throw new Error(`banco ${r.status}: ${texto.slice(0, 300)}`);
  return texto ? JSON.parse(texto) : null;
};
const evo = async (rota, opcoes = {}) => {
  const r = await fetch(`${EVO}${rota}`, { ...opcoes, headers: { apikey: EVO_CHAVE, 'Content-Type': 'application/json', ...(opcoes.headers || {}) } });
  const texto = await r.text();
  let corpo; try { corpo = JSON.parse(texto); } catch { corpo = texto; }
  return { ok: r.ok, status: r.status, corpo };
};

// QR em arquivo PNG (a Evolution devolve "data:image/png;base64,…") e o código de pareamento, quando vier
function guardarQr(instancia, qr) {
  const base64 = (qr && (qr.base64 || qr.qrcode?.base64)) || '';
  const codigo = (qr && (qr.pairingCode || qr.qrcode?.pairingCode)) || '';
  if (!base64) return { arquivo: null, codigo };
  const arquivo = path.join(dir, `qr-${instancia}.png`);
  fs.writeFileSync(arquivo, Buffer.from(base64.replace(/^data:image\/\w+;base64,/, ''), 'base64'));
  return { arquivo, codigo };
}

const lojaDaInstancia = async (instancia) => {
  const l = await banco(`/rest/v1/empresas?select=id,nome,nicho,ativo,instancia_whatsapp,config&instancia_whatsapp=eq.${encodeURIComponent(instancia)}`);
  if (!l.length) falha(`não achei loja com a instância "${instancia}"`);
  return l[0];
};
const mudarIa = async (loja, mudanca) => {
  const ia = { ...(loja.config.ia || {}), ...mudanca };
  await banco(`/rest/v1/empresas?id=eq.${loja.id}`, { method: 'PATCH', body: JSON.stringify({ config: { ...loja.config, ia } }) });
  return ia;
};
const lerMotor = (ramo) => {
  const r = RAMOS[ramo];
  if (!r) falha(`ramo "${ramo}" ainda não tem motor. Ramos com motor: ${Object.keys(RAMOS).join(', ')}`);
  const arq = path.join(dir, 'lojas', r.motor, 'loja.json');
  const motor = JSON.parse(fs.readFileSync(arq, 'utf8'));
  if (!/^\d{12,13}$/.test(motor.numero_agencia || '')) falha(`${arq}: falta "numero_agencia"`);
  return { ...r, numero_agencia: motor.numero_agencia };
};

async function qr(instancia) {
  const r = await evo(`/instance/connect/${encodeURIComponent(instancia)}`);
  if (!r.ok) falha(`a Evolution não devolveu o QR de "${instancia}": ${r.status} ${JSON.stringify(r.corpo).slice(0, 200)}`);
  if (r.corpo?.instance?.state === 'open') { console.log(`"${instancia}" já está conectada. Não precisa de QR.`); return; }
  const g = guardarQr(instancia, r.corpo);
  if (!g.arquivo) falha(`a Evolution não mandou imagem de QR: ${JSON.stringify(r.corpo).slice(0, 200)}`);
  console.log(`QR novo: ${g.arquivo}${g.codigo ? `\nCódigo de pareamento: ${g.codigo}` : ''}\nVale menos de 1 minuto: se passar, rode de novo.`);
}

async function status(instancia) {
  const loja = await lojaDaInstancia(instancia);
  const ia = loja.config.ia || {};
  const c = await evo(`/instance/connectionState/${encodeURIComponent(instancia)}`);
  const uso = await banco('/rest/v1/rpc/motor_uso_mes', { method: 'POST', body: JSON.stringify({ p_empresa_id: loja.id }) });
  const servicos = await banco(`/rest/v1/servicos?select=preco&ativo=eq.true&empresa_id=eq.${loja.id}`);
  console.log([
    `Loja: ${loja.nome} (${loja.id})`,
    `Ramo: ${loja.nicho}${loja.ativo ? '' : ' (loja desativada)'}`,
    `WhatsApp: ${c.ok ? (c.corpo?.instance?.state === 'open' ? 'conectado' : `não conectado (${c.corpo?.instance?.state || '?'})`) : `instância não existe na Evolution (${c.status})`}`,
    `No motor: ${ia.motor === true ? 'sim' : 'não'}`,
    `IA: ${ia.liberada === true ? 'liberada para todas as clientes' : `em teste, só responde ${(ia.permitidos || []).join(', ') || 'ninguém'}`}`,
    `Conversas no mês: ${uso}${ia.limite_mes ? ` de ${ia.limite_mes}` : ' (sem teto)'}`,
    `Serviços: ${servicos.length}, ${servicos.filter((s) => s.preco === null).length} ainda sem preço`,
    `Horário de funcionamento: ${loja.config.horario_funcionamento ? 'preenchido' : 'não preenchido'}`,
  ].join('\n'));
}

async function nova() {
  const ramo = arg('ramo'); const nome = (arg('nome') || '').trim(); const dona = (arg('dona') || '').trim();
  const whatsDona = digitos(arg('whatsapp-dona'));
  if (!ramo || !nome || !dona || !whatsDona) falha('uso: node nova-loja.js --ramo unhas --nome "Studio da Ana" --dona Ana --whatsapp-dona 5566999990000');
  if (!/^55\d{10,11}$/.test(whatsDona)) falha('--whatsapp-dona: use 55 + DDD + número, só números');
  const motor = lerMotor(ramo);
  const limite = arg('limite'); const bloco = arg('bloco'); const email = (arg('email') || '').trim();
  if (limite !== null && !/^\d{1,6}$/.test(limite)) falha('--limite: número de conversas por mês');
  if (bloco !== null && !(Number(bloco) >= 30 && Number(bloco) <= 480)) falha('--bloco: minutos por cliente, de 30 a 480');
  if (!EVO_CHAVE) falha('falta EVOLUTION_API_KEY_SERVIDOR no .env');

  // nome da instância: o nome da loja sem acento + 4 letras, para não repetir
  const base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'loja';
  const instancia = `${base}-${Math.random().toString(36).slice(2, 6)}`;

  // a senha do webhook é a mesma das outras instâncias (o webhook do motor confere esse cabeçalho)
  const modelo = await evo(`/webhook/find/${encodeURIComponent(env.EVOLUTION_INSTANCE_MODELO || 'karol-manicure')}`);
  const token = modelo.corpo?.headers?.['x-webhook-token'];
  if (!token) falha('não consegui ler a senha do webhook numa instância que já existe (EVOLUTION_INSTANCE_MODELO no .env)');

  // 1. instância do WhatsApp, já apontada para o motor do ramo
  const criada = await evo('/instance/create', { method: 'POST', body: JSON.stringify({
    instanceName: instancia, integration: 'WHATSAPP-BAILEYS', qrcode: true,
    webhook: { url: `${N8N_INTERNO}/webhook/${motor.motor}-whatsapp-salao`, byEvents: false, base64: true, headers: { 'x-webhook-token': token }, events: ['MESSAGES_UPSERT'] },
  }) });
  if (!criada.ok) falha(`a Evolution não criou a instância: ${criada.status} ${JSON.stringify(criada.corpo).slice(0, 300)}`);

  // 2. loja no banco (profissional e serviços padrão do ramo, sem preço), já no motor e com a trava de teste
  let empresaId;
  try {
    const ia = { motor: true, dona, permitidos: [motor.numero_agencia] };
    if (limite !== null) ia.limite_mes = Number(limite);
    if (bloco !== null) ia.bloco_min = Number(bloco);
    const config = { ia, assistente_numeros: [whatsDona], whatsapp_alerta: sem9(whatsDona), loja: arg('cidade') ? { cidade: arg('cidade').trim() } : {} };
    empresaId = await banco('/rest/v1/rpc/criar_loja', { method: 'POST', body: JSON.stringify({ p_nome: nome, p_nicho: motor.nicho, p_profissional: dona, p_instancia: instancia, p_config: config }) });
  } catch (e) {
    await evo(`/instance/delete/${encodeURIComponent(instancia)}`, { method: 'DELETE' });
    falha(`não criei a loja no banco (a instância "${instancia}" foi apagada): ${e.message}`);
  }

  // 3. convite de login do app, se pediram
  let convite = 'não pedido (use --email para mandar)';
  if (email) {
    try {
      const u = await banco('/auth/v1/invite', { method: 'POST', body: JSON.stringify({ email }) });
      await banco('/rest/v1/usuarios_empresa', { method: 'POST', body: JSON.stringify({ user_id: u.id, empresa_id: empresaId, papel: 'dona' }) });
      convite = `enviado para ${email}`;
    } catch (e) { convite = `FALHOU (${e.message}). A loja foi criada; mande o convite pelo Supabase.`; }
  }

  const g = guardarQr(instancia, criada.corpo.qrcode || criada.corpo);
  console.log([
    '',
    `Loja criada: ${nome}`,
    `  id: ${empresaId}`,
    `  instância do WhatsApp: ${instancia}`,
    `  convite do app: ${convite}`,
    g.arquivo ? `  QR para escanear: ${g.arquivo}` : `  QR: rode  node nova-loja.js --qr ${instancia}`,
    g.codigo ? `  código de pareamento: ${g.codigo}` : null,
    '',
    'O QR vale menos de 1 minuto. Se passar:  node nova-loja.js --qr ' + instancia,
    'A IA só responde ' + motor.numero_agencia + ' (trava de teste). Depois de testar:  node nova-loja.js --liberar ' + instancia,
    'Falta a dona preencher no app: horários, serviços e preços.',
    `O motor "${motor.motor}" precisa estar ligado no n8n para a loja ser atendida.`,
  ].filter((l) => l !== null).join('\n'));
}

(async () => {
  if (arg('qr') !== null) return qr(arg('qr'));
  if (arg('status') !== null) return status(arg('status'));
  if (arg('liberar') !== null) { const l = await lojaDaInstancia(arg('liberar')); await mudarIa(l, { liberada: true }); return console.log(`${l.nome}: IA liberada para todas as clientes.`); }
  if (arg('travar') !== null) { const l = await lojaDaInstancia(arg('travar')); const ia = await mudarIa(l, { liberada: false }); return console.log(`${l.nome}: IA em teste, só responde ${(ia.permitidos || []).join(', ') || 'ninguém'}.`); }
  return nova();
})().catch((e) => falha(e.message));
