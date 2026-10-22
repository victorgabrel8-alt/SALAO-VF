// Bateria de testes da IA de atendimento (docs/PLANO-PROMPT-E-AUDIOS.md, Fase 0).
// Manda conversas simuladas pelo webhook da Evolution, espera a resposta da IA e confere cada cenário
// de cenarios.json: o que a resposta deve / não deve dizer, ferramentas usadas, pausa, o que ficou no banco.
// Também soma os tokens do Gemini (o n8n guarda em cada execução).
//
// Uso (com o docker compose da demo no ar):  node testes/bateria-ia.js [rótulo] [só-estes-ids,separados]
//   ex.:  node testes/bateria-ia.js linha-de-base
//         node testes/bateria-ia.js teste-rapido preco,rajada
// Resultado: testes/resultados/AAAA-MM-DD-<rótulo>.txt
//
// Segurança: só usa números de cenarios.json que NÃO existem no WhatsApp (confere antes e para se algum
// existir). No fim apaga as clientes de teste do CRM e limpa a memória da IA delas.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DIR = path.resolve(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(DIR, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const lerId = (arq) => fs.readFileSync(path.join(DIR, arq), 'utf8').trim();
const WF = { principal: lerId('.workflow-id'), agenda: lerId('.workflow-agenda-id'), pausa: lerId('.workflow-pausa-id'),
  audios: fs.existsSync(path.join(DIR, '.workflow-audios-id')) ? lerId('.workflow-audios-id') : null };
const EMPRESA = env.EMPRESA_ID;
const N8N = { 'X-N8N-API-KEY': env.N8N_API_KEY };
const SUPA = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const EVO = { apikey: env.EVOLUTION_API_KEY, 'Content-Type': 'application/json' };

const rotulo = process.argv[2] || 'teste';
const so = process.argv[3] ? process.argv[3].split(',') : null;
const cenarios = JSON.parse(fs.readFileSync(process.env.CENARIOS || path.join(__dirname, 'cenarios.json'), 'utf8')).filter((c) => !so || so.includes(c.id));
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Cuiaba' });
fs.mkdirSync(path.join(__dirname, 'resultados'), { recursive: true });
const arquivo = path.join(__dirname, 'resultados', `${hoje}-${rotulo}.txt`);
const linhas = [];
const log = (t = '') => { linhas.push(t); console.log(t); };
const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// Mesmo formato do banco (supabase-workflows.js): celular antigo de MT chega sem o 9
const telBanco = (t) => (/^55\d{2}[6-9]\d{7}$/.test(t) ? t.slice(0, 4) + '9' + t.slice(4) : t);

// "+7d 14:00" -> instante ISO no fuso do salão (-04:00)
function quando(expr) {
  const m = expr.match(/^([+-]\d+)d (\d\d:\d\d)$/);
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(m[1]));
  return `${d.toISOString().slice(0, 10)}T${m[2]}:00-04:00`;
}
const ddmm = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit' });

async function supa(metodo, rota, corpo) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${rota}`, { method: metodo, headers: SUPA, body: corpo ? JSON.stringify(corpo) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`Supabase ${metodo} ${rota}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

async function execucoes(wf, n) {
  const r = await fetch(`http://localhost:5678/api/v1/executions?workflowId=${wf}&limit=${n}&includeData=true`, { headers: N8N });
  return (await r.json()).data || [];
}
const saidaDe = (r, no) => r[no]?.[0]?.data?.main?.[0]?.[0]?.json;

async function enviar(tel, texto, id) {
  await fetch('http://localhost:5678/webhook/whatsapp-salao', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: 'messages.upsert', instance: env.EVOLUTION_INSTANCE,
      data: { key: { remoteJid: `${tel}@s.whatsapp.net`, fromMe: false, id }, pushName: 'Teste', messageType: 'conversation', message: { conversation: texto } } }),
  });
}

// Espera a execução da mensagem `id` terminar; devolve a resposta da IA e os tokens do Gemini.
// O envio tem "ritmo humano" (digitando…, balões com pausa): resposta longa passa de 2,5 min.
// ESPERA_MIN=6 node testes/bateria-ia.js ... muda o limite (padrão 4 min).
const ESPERA_MIN = Number(process.env.ESPERA_MIN) || 4;
async function respostaDe(id) {
  for (let i = 0; i < ESPERA_MIN * 20; i++) {
    await dorme(3000);
    for (const e of await execucoes(WF.principal, 20)) {
      const r = e.data?.resultData?.runData || {};
      if (saidaDe(r, 'Extrair dados')?.msgId !== id || !e.stoppedAt) continue;
      const chamadas = (r['Gemini Flash'] || []).map((c) => c.data?.ai_languageModel?.[0]?.[0]?.json?.tokenUsage).filter(Boolean);
      return {
        // o que a cliente recebe (depois do filtro de frases de robô); sem envio, o que a IA escreveu
        // todos os balões (resposta longa vira 2 ou 3), não só o primeiro
        texto: (r['Quebrar mensagens']?.[0]?.data?.main?.[0] || []).map((b) => b.json?.texto).filter(Boolean).join(' ') || saidaDe(r, 'Agente IA')?.output || null,
        chamadas: chamadas.length,
        entrada: chamadas.reduce((s, t) => s + (t.promptTokens || 0), 0),
        saida: chamadas.reduce((s, t) => s + (t.completionTokens || 0), 0),
        erros: Object.entries(r).filter(([, v]) => v[0].error).map(([k, v]) => `${k}: ${v[0].error.message}`),
      };
    }
  }
  return { texto: null, chamadas: 0, entrada: 0, saida: 0, erros: [`sem resposta em ${ESPERA_MIN} min`] };
}

// Ferramentas da agenda e transferências que rodaram depois de `desde`
async function ferramentasDesde(desde) {
  const agenda = (await execucoes(WF.agenda, 15)).filter((e) => Date.parse(e.startedAt) >= desde).reverse().map((e) => {
    const r = e.data.resultData.runData;
    return { acao: saidaDe(r, 'Preparar')?.acao, dur: saidaDe(r, 'Preparar')?.dur, servico: saidaDe(r, 'Preparar')?.servico };
  });
  const transferiu = (await execucoes(WF.pausa, 5)).some((e) => Date.parse(e.startedAt) >= desde);
  // áudios prontos: tema pedido e o que a ferramenta respondeu (com número de teste o envio falha de propósito)
  const audios = !WF.audios ? [] : (await execucoes(WF.audios, 5)).filter((e) => Date.parse(e.startedAt) >= desde).reverse().map((e) => {
    const r = e.data.resultData.runData;
    return { tema: saidaDe(r, 'Recebe pedido da IA')?.tema, resposta: (saidaDe(r, 'Resposta (enviado)') || saidaDe(r, 'Resposta (sem áudio)'))?.resposta || '' };
  });
  return { agenda, transferiu, audios };
}

function limparMemoria(tel) {
  for (const chave of [`memoria:${tel}`, `pausa:${tel}`, `buffer:${tel}`, `buffer_ultima:${tel}`, `processando:${tel}`]) {
    execSync(`docker exec demo-salao-redis-1 redis-cli DEL ${chave}`, { stdio: 'ignore' });
  }
}

// Cria a cliente e os horários que o cenário precisa já ter no CRM
async function preparar(c) {
  if (!c.preparar) return;
  const [cliente] = await supa('POST', 'clientes', { empresa_id: EMPRESA, telefone: telBanco(c.telefone), nome: c.preparar.nome || 'Teste' });
  for (const a of c.preparar.agendamentos || []) {
    const [s] = await supa('GET', `servicos?select=id&empresa_id=eq.${EMPRESA}&nome=eq.${encodeURIComponent(a.servico)}`);
    await supa('POST', 'agendamentos', { empresa_id: EMPRESA, cliente_id: cliente.id, servico_id: s?.id ?? null,
      inicio: quando(a.quando), status: a.status, origem: 'manual' });
  }
  // "alô" de retorno mandado pelo CRM do José Paulo (tabela contatos)
  if (c.preparar.alo) await supa('POST', 'contatos', { empresa_id: EMPRESA, cliente_id: cliente.id, tipo: c.preparar.alo.tipo || 'retorno',
    canal: 'manual', mensagem: c.preparar.alo.mensagem, criado_em: quando(c.preparar.alo.quando) });
}

// Substitui {data:+7d 14:00} pela data "dd/mm" nos textos esperados
const comDatas = (s) => s.replace(/\{data:([^}]+)\}/g, (_, e) => ddmm(quando(e)).replace('/', '\\/'));

async function conferir(c, respostas, ferr) {
  const falhas = [];
  const tudo = respostas.map((r) => r.texto || '').join('\n');
  const ultima = respostas.at(-1)?.texto || '';
  for (const e of c.espera || []) {
    const alvo = e.em === 'ultima' ? ultima : tudo;
    if (e.deve && !new RegExp(comDatas(e.deve), 'i').test(alvo)) falhas.push(`devia dizer /${comDatas(e.deve)}/`);
    if (e.nao_deve && new RegExp(comDatas(e.nao_deve), 'i').test(alvo)) falhas.push(`não devia dizer /${comDatas(e.nao_deve)}/`);
    if (e.ferramenta && !ferr.agenda.some((f) => f.acao === e.ferramenta)) falhas.push(`devia usar a ferramenta "${e.ferramenta}"`);
    if (e.sem_ferramenta && ferr.agenda.some((f) => f.acao === e.sem_ferramenta)) falhas.push(`não devia usar "${e.sem_ferramenta}"`);
    if (e.duracao_max && ferr.agenda.some((f) => f.acao === 'consultar' && f.dur > e.duracao_max)) falhas.push(`consultou serviço de mais de ${e.duracao_max} min`);
    if (e.duracao_min && !ferr.agenda.some((f) => f.acao === 'consultar' && f.dur >= e.duracao_min)) falhas.push(`devia consultar horário de pelo menos ${e.duracao_min} min`);
    if (e.audio === true && !ferr.audios.length) falhas.push('devia usar enviar_audio');
    if (e.audio === false && ferr.audios.length) falhas.push('não devia mandar áudio');
    if (e.audio_tema && !ferr.audios.some((a) => new RegExp(e.audio_tema, 'i').test(`${a.tema} ${a.resposta}`))) falhas.push(`devia escolher o áudio /${e.audio_tema}/`);
    if (e.transferiu === true && !ferr.transferiu) falhas.push('devia transferir para humano');
    if (e.transferiu === false && ferr.transferiu) falhas.push('não devia transferir para humano');
    if (e.respostas !== undefined && respostas.filter((r) => r.texto).length !== e.respostas) falhas.push(`devia responder ${e.respostas}x`);
    if (e.banco_horario) {
      const ags = await supa('GET', `agendamentos?select=inicio,observacoes,clientes!inner(telefone)&clientes.telefone=eq.${telBanco(c.telefone)}&status=eq.agendado`);
      const alvoIso = Date.parse(quando(e.banco_horario));
      const ok = ags.find((a) => Date.parse(a.inicio) === alvoIso);
      if (!ok) falhas.push(`no CRM devia ter horário em ${ddmm(quando(e.banco_horario))} ${e.banco_horario.slice(-5)}`);
      else if (e.banco_obs && !new RegExp(e.banco_obs, 'i').test(ok.observacoes || '')) falhas.push(`observação do horário devia ter /${e.banco_obs}/`);
    }
  }
  return falhas;
}

async function limpar(tels) {
  const lista = tels.map(telBanco).join(',');
  await supa('DELETE', `clientes?empresa_id=eq.${EMPRESA}&telefone=in.(${lista})`);
  for (const t of tels) limparMemoria(t);
}

(async () => {
  const tels = [...new Set(cenarios.map((c) => c.telefone))];
  // números de teste não podem existir no WhatsApp (senão uma pessoa de verdade receberia as mensagens)
  const r = await fetch(`http://localhost:8080/chat/whatsappNumbers/${env.EVOLUTION_INSTANCE}`, { method: 'POST', headers: EVO, body: JSON.stringify({ numbers: tels }) });
  const existentes = (await r.json()).filter((x) => x.exists).map((x) => x.number);
  if (existentes.length) { console.error(`PARADO: estes números existem no WhatsApp: ${existentes.join(', ')}`); process.exit(1); }

  await limpar(tels);
  log(`Bateria IA — ${rotulo} — ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Cuiaba' })}`);
  const placar = [];
  const tok = { mensagens: 0, chamadas: 0, entrada: 0, saida: 0 };
  let n = 0;

  for (const c of cenarios) {
    log(`\n=== ${c.id} — ${c.nome} ===`);
    try { await preparar(c); } catch (e) { log(`ERRO ao preparar: ${e.message}`); placar.push([c.id, false]); continue; }
    const desde = Date.now();
    const respostas = [];
    if (c.rajada) {
      const ids = c.mensagens.map(() => `BAT${Date.now()}${++n}`);
      for (let i = 0; i < c.mensagens.length; i++) { log(`> ${c.mensagens[i]}`); await enviar(c.telefone, c.mensagens[i], ids[i]); await dorme(1500); }
      // Qualquer uma das mensagens pode ser a que responde (a que for marcada por último no buffer leva
      // todas juntas): espera as execuções de todas e conta quantas responderam (o certo é 1).
      for (const r of await Promise.all(ids.map((id) => respostaDe(id)))) if (r.texto) respostas.push(r);
      if (!respostas.length) respostas.push({ texto: null, chamadas: 0, entrada: 0, saida: 0, erros: ['nenhuma mensagem da rajada foi respondida'] });
    } else {
      for (const m of c.mensagens) {
        const id = `BAT${Date.now()}${++n}`;
        const texto = m.replace(/{data:([^}]+)}/g, (_, e) => ddmm(quando(e)));
        log(`> ${texto}`);
        await enviar(c.telefone, texto, id);
        respostas.push(await respostaDe(id));
        log(`IA: ${respostas.at(-1).texto}`);
      }
    }
    if (c.rajada) log(`IA: ${respostas[0].texto}`);
    for (const x of respostas) {
      if (x.erros.length) log(`  erros no n8n: ${x.erros.join(' | ')}`);
      tok.mensagens++; tok.chamadas += x.chamadas; tok.entrada += x.entrada; tok.saida += x.saida;
    }
    const ferr = await ferramentasDesde(desde);
    for (const f of ferr.agenda) log(`  [agenda] ${f.acao}${f.dur ? ` ${f.dur} min` : ''}${f.servico ? ` "${f.servico}"` : ''}`);
    if (ferr.transferiu) log('  [transferiu para humano]');
    for (const a of ferr.audios) log(`  [áudio] "${a.tema}" -> ${a.resposta.slice(0, 110)}`);
    const falhas = await conferir(c, respostas, ferr);
    const tk = respostas.reduce((s, x) => s + x.entrada, 0);
    log(`  tokens: ${respostas.reduce((s, x) => s + x.chamadas, 0)} chamadas, ${tk} de entrada`);
    log(falhas.length ? `❌ FALHOU: ${falhas.join('; ')}` : '✅ passou');
    placar.push([c.id, !falhas.length]);
  }

  await limpar(tels);
  const ok = placar.filter(([, p]) => p).length;
  log('\n=== RESUMO ===');
  log(placar.map(([id, p]) => `${p ? '✅' : '❌'} ${id}`).join('\n'));
  log(`\n${ok}/${placar.length} passaram`);
  log(`Tokens: ${tok.mensagens} mensagens · ${tok.chamadas} chamadas ao Gemini (${(tok.chamadas / tok.mensagens).toFixed(1)} por mensagem)`);
  log(`  entrada: ${tok.entrada} no total · ${Math.round(tok.entrada / tok.mensagens)} por mensagem · ${Math.round(tok.entrada / Math.max(1, tok.chamadas))} por chamada`);
  log(`  saída:   ${tok.saida} no total · ${Math.round(tok.saida / tok.mensagens)} por mensagem`);
  log('  (o n8n não mostra quanto veio do cache do Gemini)');
  fs.writeFileSync(arquivo, linhas.join('\n') + '\n');
  console.log(`\nSalvo em ${arquivo}`);
})().catch((e) => { console.error(e); process.exit(1); });
