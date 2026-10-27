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
const lerIdSeHouver = (arq) => (fs.existsSync(path.join(DIR, arq)) ? lerId(arq) : null);
const WF = { principal: lerId('.workflow-id'), agenda: lerId('.workflow-agenda-id'), pausa: lerId('.workflow-pausa-id'),
  audios: lerIdSeHouver('.workflow-audios-id'), crm: lerIdSeHouver('.workflow-crm-id') };
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

// "+7d 14:00" -> instante ISO no fuso do salão (-04:00); "agora-30m" / "agora+2h" -> relativo a este instante
function quando(expr) {
  const r = expr.match(/^agora([+-]\d+)([mh])$/);
  if (r) return new Date(Date.now() + Number(r[1]) * (r[2] === 'h' ? 3600e3 : 60e3)).toISOString();
  const m = expr.match(/^([+-]\d+)d (\d\d:\d\d)$/);
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(m[1]));
  return `${d.toISOString().slice(0, 10)}T${m[2]}:00-04:00`;
}
const ddmm = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Cuiaba', day: '2-digit', month: '2-digit' });

async function supa(metodo, rota, corpo) {
  let r;
  // 502/503 do Cloudflare na frente do Supabase passa sozinho: tenta de novo antes de derrubar a bateria
  for (let i = 0; i < 4; i++) {
    r = await fetch(`${env.SUPABASE_URL}/rest/v1/${rota}`, { method: metodo, headers: SUPA, body: corpo ? JSON.stringify(corpo) : undefined });
    if (r.status < 500) break;
    await dorme(5000 * (i + 1));
  }
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
        execId: String(e.id),
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

// Ferramentas da agenda e transferências que rodaram depois de `desde`, chamadas pelas execuções `ids` (as das
// mensagens deste cenário): outra bateria (ou cliente) rodando junto não entra na conta. Filtra pela execução que
// chamou a ferramenta, não pelo telefone (o consultar_horarios_livres é chamado sem telefone).
const daCliente = (ids, desde) => (e) => Date.parse(e.startedAt) >= desde && ids.has(String(e.data?.parentExecution?.executionId));
async function ferramentasDesde(desde, ids) {
  const agenda = (await execucoes(WF.agenda, 25)).filter(daCliente(ids, desde)).reverse().map((e) => {
    const r = e.data.resultData.runData;
    // o que a ferramenta devolveu para a IA ("AGENDADO com sucesso…", "acabou de ser ocupado…"): o último nó que respondeu
    const resposta = Object.keys(r).map((no) => saidaDe(r, no)?.resposta).filter(Boolean).at(-1) || '';
    return { acao: saidaDe(r, 'Preparar')?.acao, dur: saidaDe(r, 'Preparar')?.dur, servico: saidaDe(r, 'Preparar')?.servico, resposta };
  });
  const transferiu = (await execucoes(WF.pausa, 10)).some(daCliente(ids, desde));
  // áudios prontos: tema pedido e o que a ferramenta respondeu (com número de teste o envio falha de propósito)
  const audios = !WF.audios ? [] : (await execucoes(WF.audios, 10)).filter(daCliente(ids, desde)).reverse().map((e) => {
    const r = e.data.resultData.runData;
    return { tema: saidaDe(r, 'Recebe pedido da IA')?.tema, resposta: (saidaDe(r, 'Resposta (enviado)') || saidaDe(r, 'Resposta (sem áudio)'))?.resposta || '' };
  });
  // anotar_no_crm: o que a IA mandou anotar (interesse e resumo)
  const anotacoes = !WF.crm ? [] : (await execucoes(WF.crm, 10)).filter(daCliente(ids, desde)).reverse().map((e) => {
    const p = saidaDe(e.data.resultData.runData, 'Recebe pedido do agente') || {};
    return `${p.interesse || ''} | ${p.resumo || ''}`;
  });
  return { agenda, transferiu, audios, anotacoes };
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
  const ags = [];
  for (const a of c.preparar.agendamentos || []) {
    const [s] = await supa('GET', `servicos?select=id&empresa_id=eq.${EMPRESA}&nome=eq.${encodeURIComponent(a.servico)}`);
    const inicio = quando(a.quando);
    // fim_min: duração em minutos (sem ela, o horário conta 1 h)
    const fim = a.fim_min ? new Date(Date.parse(inicio) + a.fim_min * 60e3).toISOString() : undefined;
    const [ag] = await supa('POST', 'agendamentos', { empresa_id: EMPRESA, cliente_id: cliente.id, servico_id: s?.id ?? null,
      inicio, fim, status: a.status, origem: 'manual' });
    ags.push(ag);
  }
  // conversa que já aconteceu (ex.: o áudio pronto que ela já recebeu: com número de teste o envio de verdade falha)
  for (const m of c.preparar.mensagens || []) {
    await supa('POST', 'mensagens', { empresa_id: EMPRESA, cliente_id: cliente.id, direcao: m.autor === 'cliente' ? 'entrada' : 'saida',
      autor: m.autor || 'ia', tipo: m.tipo || 'texto', conteudo: m.conteudo, criado_em: quando(m.quando || 'agora-60m') });
  }
  // "alô" mandado pelo CRM (tabela contatos). alo.agendamento = índice em agendamentos (alô de atraso,
  // remarcação ou vaga: liga o contato ao horário, como o n8n faz)
  if (c.preparar.alo) {
    const ag = c.preparar.alo.agendamento !== undefined ? ags[c.preparar.alo.agendamento] : null;
    await supa('POST', 'contatos', { empresa_id: EMPRESA, cliente_id: cliente.id, tipo: c.preparar.alo.tipo || 'retorno',
      canal: c.preparar.alo.canal || 'manual', mensagem: c.preparar.alo.mensagem, criado_em: quando(c.preparar.alo.quando),
      ...(ag ? { agendamento_id: ag.id, horario_original: ag.inicio } : {}) });
  }
}

// Outra cliente pega o horário no meio da conversa (ex.: entre a IA oferecer e a cliente dizer "sim").
// ocupar: { antes_da_mensagem: índice, telefone, quando, fim_min, servico }
// quando: "oferecido" = o primeiro dia e hora que a IA ofereceu na última resposta (não depende da agenda do dia)
async function ocupar(c, i, ultima) {
  const o = c.ocupar;
  if (!o || o.antes_da_mensagem !== i) return;
  const inicio = o.quando === 'oferecido' ? oferecido(ultima) : quando(o.quando);
  if (!inicio) throw new Error(`não achei dia e hora na resposta da IA para ocupar: "${ultima}"`);
  const [outra] = await supa('POST', 'clientes', { empresa_id: EMPRESA, telefone: telBanco(o.telefone), nome: 'Outra Cliente Teste' });
  const [s] = await supa('GET', `servicos?select=id&empresa_id=eq.${EMPRESA}&nome=eq.${encodeURIComponent(o.servico || 'Manutenção – mão de obra')}`);
  await supa('POST', 'agendamentos', { empresa_id: EMPRESA, cliente_id: outra.id, servico_id: s?.id ?? null, inicio,
    fim: new Date(Date.parse(inicio) + (o.fim_min || 60) * 60e3).toISOString(), status: 'agendado', origem: 'manual' });
  log(`  (outra cliente ocupou ${new Date(inicio).toLocaleString('pt-BR', { timeZone: 'America/Cuiaba', dateStyle: 'short', timeStyle: 'short' })})`);
}

// "dia 27, às 15h" / "27/10 às 15:30" / "amanhã às 9h" -> instante ISO
function oferecido(texto) {
  const t = String(texto || '');
  const h = t.match(/\b(\d{1,2})(?:h(\d\d)?|:(\d\d))/);
  if (!h) return null;
  const d = t.match(/\b(\d{1,2})\/(\d{1,2})\b/) || t.match(/\bdia (\d{1,2})\b/);
  // sem data: "hoje" / "amanhã" / nome do dia da semana (o próximo)
  const semana = ['domingo', 'segunda', 'ter[cç]a', 'quarta', 'quinta', 'sexta', 's[aá]bado'].findIndex((n) => new RegExp(`\\b${n}`, 'i').test(t));
  let dias = d ? null : /\bhoje\b/i.test(t) ? 0 : /amanh[ãa]/i.test(t) ? 1
    : semana >= 0 ? (semana - new Date(`${hoje}T12:00:00Z`).getUTCDay() + 7) % 7 : null;
  if (d) {
    const base = new Date(`${hoje}T12:00:00Z`);
    for (let k = 0; k <= 40 && dias === null; k++) {
      const x = new Date(base.getTime() + k * 864e5);
      if (x.getUTCDate() === Number(d[1]) && (!d[2] || x.getUTCMonth() + 1 === Number(d[2]))) dias = k;
    }
  }
  if (dias === null) return null;
  return quando(`+${dias}d ${h[1].padStart(2, '0')}:${h[2] || h[3] || '00'}`);
}

// A IA diz à cliente que o horário está marcado (pergunta "posso marcar?" não conta)
const DIZ_MARCADO = /\b(marquei|agendei|j[aá] (deixei|t[aá]|est[aá]) (tudo )?(marcad|agendad)|(t[aá]|est[aá]|ficou) (marcad|agendad)|agendad[oa] com sucesso|deixei (tudo )?(marcad|agendad))/i;

// Substitui {data:+7d 14:00} pela data "dd/mm" nos textos esperados
const comDatas = (s) => s.replace(/\{data:([^}]+)\}/g, (_, e) => ddmm(quando(e)).replace('/', '\\/'))
  // {dia:+3d 10:00} -> só o dia do mês ("26"), para aceitar "dia 26" além de "26/10"
  .replace(/\{dia:([^}]+)\}/g, (_, e) => String(Number(ddmm(quando(e)).slice(0, 2))));

async function conferir(c, respostas, ferr) {
  const falhas = [];
  const tudo = respostas.map((r) => r.texto || '').join('\n');
  const ultima = respostas.at(-1)?.texto || '';
  for (const e of c.espera || []) {
    const alvo = e.em === 'ultima' ? ultima : tudo;
    // caixa: true = maiúscula e minúscula contam (ex.: "REMARCADO" de controle ≠ "Remarcado" normal)
    const flags = e.caixa ? '' : 'i';
    if (e.deve && !new RegExp(comDatas(e.deve), flags).test(alvo)) falhas.push(`devia dizer /${comDatas(e.deve)}/`);
    if (e.nao_deve && new RegExp(comDatas(e.nao_deve), flags).test(alvo)) falhas.push(`não devia dizer /${comDatas(e.nao_deve)}/`);
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
    if (e.audios_max !== undefined && ferr.audios.length > e.audios_max) falhas.push(`mandou ${ferr.audios.length} áudios (máximo ${e.audios_max})`);
    if (e.crm_anotou && !ferr.anotacoes.some((a) => new RegExp(e.crm_anotou, 'i').test(a))) falhas.push(`devia anotar no CRM /${e.crm_anotou}/`);
    // a IA pausada não responde: a última mensagem fica sem resposta
    if (e.sem_resposta && ultima) falhas.push('devia ficar sem resposta (IA pausada)');
    if (e.banco_status || e.banco_qtd !== undefined || e.banco_sem_passado) {
      const ags = await supa('GET', `agendamentos?select=status,inicio,clientes!inner(telefone)&clientes.telefone=eq.${telBanco(c.telefone)}`);
      // remarcou de verdade: nenhum horário marcado ficou para trás (o do atraso tem que ter ido para a frente)
      if (e.banco_sem_passado && ags.some((a) => a.status === 'agendado' && Date.parse(a.inicio) < Date.now())) falhas.push('o horário que já passou continua marcado (não remarcou)');
      if (e.banco_status && !ags.some((a) => a.status === e.banco_status)) falhas.push(`no CRM devia ter um horário "${e.banco_status}"`);
      const marcados = ags.filter((a) => a.status === 'agendado').length;
      if (e.banco_qtd !== undefined && marcados !== e.banco_qtd) falhas.push(`no CRM devia ter ${e.banco_qtd} horário(s) marcado(s), tem ${marcados}`);
    }
    if (e.banco_pausa) {
      const [cl] = await supa('GET', `clientes?select=ia_pausada_ate,motivo_pausa&empresa_id=eq.${EMPRESA}&telefone=eq.${telBanco(c.telefone)}`);
      if (!cl?.ia_pausada_ate || Date.parse(cl.ia_pausada_ate) < Date.now()) falhas.push('no CRM a IA devia estar pausada');
      else if (!new RegExp(e.banco_pausa, 'i').test(cl.motivo_pausa || '')) falhas.push(`motivo da pausa devia ser /${e.banco_pausa}/ (é "${cl.motivo_pausa}")`);
    }
    // criar_ok: quantas vezes o criar_agendamento marcou de fato (resposta AGENDADO). 1 = marcou e não duplicou
    if (e.criar_ok !== undefined) {
      const n = ferr.agenda.filter((f) => f.acao === 'criar' && /^AGENDADO/.test(f.resposta)).length;
      if (n !== e.criar_ok) falhas.push(`criar_agendamento devia marcar ${e.criar_ok}x, marcou ${n}x`);
    }
    // só diz "marquei" na mensagem em que o criar respondeu AGENDADO (ou depois). Precisa das ferramentas por mensagem.
    if (e.marcado_so_com_agendado) {
      const primeiro = respostas.findIndex((r) => (r.agenda || []).some((f) => f.acao === 'criar' && /^AGENDADO/.test(f.resposta)));
      const antes = respostas.findIndex((r, i) => (primeiro < 0 || i < primeiro) && DIZ_MARCADO.test(r.texto || ''));
      if (antes >= 0) falhas.push(`disse que marcou na mensagem ${antes + 1} sem o criar ter respondido AGENDADO`);
    }
    if (e.banco_origem || e.hora_bate) {
      const ags = await supa('GET', `agendamentos?select=inicio,origem,clientes!inner(telefone)&clientes.telefone=eq.${telBanco(c.telefone)}&status=eq.agendado`);
      const daIa = ags.filter((a) => a.origem === e.banco_origem);
      if (e.banco_origem && !daIa.length) falhas.push(`no CRM devia ter horário com origem "${e.banco_origem}"`);
      // a hora que a IA confirmou é a hora que ficou no CRM
      const confirmou = respostas.map((r) => r.texto || '').filter((t) => DIZ_MARCADO.test(t)).at(-1);
      if (e.hora_bate && ags.length === 1 && confirmou) {
        const [h, m] = new Date(ags[0].inicio).toLocaleTimeString('pt-BR', { timeZone: 'America/Cuiaba', hour: '2-digit', minute: '2-digit' }).split(':');
        const hora = new RegExp(`\\b0?${Number(h)}(h|:${m}| horas)${m === '00' ? '' : `|\\b0?${Number(h)}h${m}`}`, 'i');
        if (!hora.test(confirmou)) falhas.push(`a IA confirmou um horário diferente do CRM (${h}:${m})`);
      }
    }
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
  const tels = [...new Set(cenarios.flatMap((c) => [c.telefone, c.ocupar?.telefone].filter(Boolean)))];
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
    const idsDoCenario = new Set();
    if (c.rajada) {
      const ids = c.mensagens.map(() => `BAT${Date.now()}${++n}`);
      for (let i = 0; i < c.mensagens.length; i++) { log(`> ${c.mensagens[i]}`); await enviar(c.telefone, c.mensagens[i], ids[i]); await dorme(1500); }
      // Qualquer uma das mensagens pode ser a que responde (a que for marcada por último no buffer leva
      // todas juntas): espera as execuções de todas e conta quantas responderam (o certo é 1).
      for (const r of await Promise.all(ids.map((id) => respostaDe(id)))) { if (r.execId) idsDoCenario.add(r.execId); if (r.texto) respostas.push(r); }
      if (!respostas.length) respostas.push({ texto: null, chamadas: 0, entrada: 0, saida: 0, erros: ['nenhuma mensagem da rajada foi respondida'] });
    } else {
      for (const [i, m] of c.mensagens.entries()) {
        try { await ocupar(c, i, respostas.at(-1)?.texto); } catch (e) { log(`  ERRO ao ocupar: ${e.message}`); }
        const id = `BAT${Date.now()}${++n}`;
        const texto = m.replace(/{data:([^}]+)}/g, (_, e) => ddmm(quando(e)));
        log(`> ${texto}`);
        const desdeMsg = Date.now();
        await enviar(c.telefone, texto, id);
        const resp = await respostaDe(id);
        // ferramentas da agenda desta mensagem (para saber em que ponto da conversa o criar respondeu)
        resp.agenda = (await ferramentasDesde(desdeMsg, new Set([resp.execId]))).agenda;
        if (resp.execId) idsDoCenario.add(resp.execId);
        respostas.push(resp);
        log(`IA: ${resp.texto}`);
      }
    }
    if (c.rajada) log(`IA: ${respostas[0].texto}`);
    for (const x of respostas) {
      if (x.erros.length) log(`  erros no n8n: ${x.erros.join(' | ')}`);
      tok.mensagens++; tok.chamadas += x.chamadas; tok.entrada += x.entrada; tok.saida += x.saida;
    }
    const ferr = await ferramentasDesde(desde, idsDoCenario);
    for (const f of ferr.agenda) log(`  [agenda] ${f.acao}${f.dur ? ` ${f.dur} min` : ''}${f.servico ? ` "${f.servico}"` : ''}${f.acao === 'criar' ? ` -> ${f.resposta.slice(0, 70)}` : ''}`);
    if (ferr.transferiu) log('  [transferiu para humano]');
    for (const a of ferr.audios) log(`  [áudio] "${a.tema}" -> ${a.resposta.slice(0, 110)}`);
    for (const a of ferr.anotacoes) log(`  [crm] ${a.slice(0, 140)}`);
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
