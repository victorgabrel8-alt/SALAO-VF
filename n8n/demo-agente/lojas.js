// IA por loja (docs/PLANO-VARIAS-LOJAS.md, fase 5): o mesmo gerador monta um conjunto de workflows
// separado para cada loja. Uso: node montar-workflow.js --loja <slug> [--enviar --ativar]
//
// A loja fica em lojas/<slug>/: loja.json (dados abaixo), prompt-agente.md (prompt da loja, mesmo formato
// do da Gleide) e, depois do 1º envio, os .workflow-*-id DELA. Os workflows da Gleide são gerados sem
// --loja e não passam por aqui (saem idênticos aos de antes).
//
// loja.json:
//   slug          "teste"                        prefixo do Redis, dos webhooks e da pasta
//   nome          "Loja Teste"                   aparece no nome dos workflows e troca "Toda Bonita"
//   empresa_id    uuid da tabela empresas        no lugar de $env.EMPRESA_ID
//   instancia     nome da instância na Evolution no lugar de $env.EVOLUTION_INSTANCE
//   dona          "Ana"                          troca "Gleide" nos textos
//   cidade        "Sinop"                        troca "Sinop"
//   assistente_numeros ["5566…"]                 WhatsApp da dona (assistente e avisos)
//   permitidos    ["5566…"]                      trava de teste: só esses números recebem resposta ([] = todos)
//   trocas        [["texto", "novo"], …]         textos do nicho (ex.: "salão de mega hair")
//
// Tudo é trocado no JSON já montado e depois conferido: se sobrar qualquer coisa da Gleide (empresa,
// instância, número, chave do Redis sem prefixo, webhook, id de workflow), o gerador para com erro.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GLEIDE_ASSISTENTE = '5566999596740';
// endereços de webhook dos workflows (path); na loja viram "<slug>-<path>", inclusive em URL que chama outro
const TODOS_OS_PATHS = ['whatsapp-salao', 'assistente-gleide', 'assistente-pendencias', 'audios-transcrever', 'faltas-avisos', 'retomar-conversa'];
// chaves do Redis usadas pelos workflows (ver montar-workflow.js, pedidos, assistente, faltas, retomar)
const CHAVES = ['memoria', 'pausa', 'buffer_ultima', 'buffer', 'processando', 'pedido', 'assistente', 'alerta'];

// 55 + DDD + número, sem o 9 da frente (o jeito que o WhatsApp manda), para comparar números
const semNove = (n) => { const d = String(n).replace(/\D/g, ''); return /^55\d{2}9\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d; };

function carregarLoja(dir, slug, env = {}) {
  const pasta = path.join(dir, 'lojas', slug);
  const arq = path.join(pasta, 'loja.json');
  if (!fs.existsSync(arq)) throw new Error(`loja "${slug}" não existe: crie ${arq}`);
  const loja = JSON.parse(fs.readFileSync(arq, 'utf8'));
  for (const campo of ['slug', 'nome', 'empresa_id', 'instancia', 'dona']) {
    if (!loja[campo]) throw new Error(`lojas/${slug}/loja.json: falta "${campo}"`);
  }
  if (loja.slug !== slug) throw new Error(`lojas/${slug}/loja.json: slug "${loja.slug}" diferente da pasta`);
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error('slug: só letras minúsculas, números e "-"');
  if (loja.empresa_id === '00000000-0000-0000-0000-000000000001') throw new Error('empresa_id é o da Gleide');
  if (!Array.isArray(loja.assistente_numeros) || !loja.assistente_numeros.length) throw new Error('assistente_numeros: coloque o WhatsApp da dona');
  // a assistente da Gleide age nos dados dela para esses números: a dona de outra loja não pode ser um deles
  const daGleide = [GLEIDE_ASSISTENTE, ...String(env.ASSISTENTE_NUMEROS || '').split(',')].map((s) => s.trim()).filter(Boolean).map(semNove);
  const repetido = loja.assistente_numeros.find((n) => daGleide.includes(semNove(n)));
  if (repetido) throw new Error(`assistente_numeros: ${repetido} já é número da assistente da Gleide`);
  return { ...loja, pasta, permitidos: loja.permitidos || [], trocas: loja.trocas || [], cidade: loja.cidade || 'Sinop' };
}

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// webhookId novo e fixo por loja (o mesmo a cada geração, diferente do da Gleide)
const novoUuid = (slug, antigo) => {
  const h = crypto.createHash('md5').update(`${slug}:${antigo}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// Troca no workflow (já montado) tudo o que é da Gleide pelo que é da loja. Muda o objeto no lugar,
// porque o resto do montar-workflow.js continua usando as mesmas referências.
function paraLoja(wf, loja, ids) {
  let s = JSON.stringify(wf);
  for (const [daGleide, daLoja] of ids) s = s.split(daGleide).join(daLoja);
  const lista = (nums) => `'${nums.join(',')}'`;
  // assistente-workflows.js usa "$env.EMPRESA_ID || '<id da Gleide>'": na loja fica só o id dela
  s = s.split("$env.EMPRESA_ID || '00000000-0000-0000-0000-000000000001'").join(`'${loja.empresa_id}'`);
  s = s.split('$env.EMPRESA_ID').join(`'${loja.empresa_id}'`);
  s = s.split('$env.EVOLUTION_INSTANCE').join(`'${loja.instancia}'`);
  s = s.split('$env.ASSISTENTE_NUMEROS').join(lista(loja.assistente_numeros));
  s = s.split(`'${GLEIDE_ASSISTENTE}'`).join(lista(loja.assistente_numeros));
  s = s.split('$env.NUMEROS_PERMITIDOS').join(lista(loja.permitidos));
  const p = `${loja.slug}:`;
  const chaves = CHAVES.join('|');
  // chave em expressão do n8n: "=pausa:{{ … }}"
  s = s.replace(new RegExp(`=(${chaves}):\\{\\{`, 'g'), `=${p}$1:{{`);
  // padrão de busca: "keyPattern":"processando:*"
  s = s.replace(new RegExp(`"keyPattern":"(${chaves}):\\*"`, 'g'), `"keyPattern":"${p}$1:*"`);
  // prefixo em código: 'memoria:' + telefone
  s = s.replace(new RegExp(`'(${chaves}):'`, 'g'), `'${p}$1:'`);
  // webhooks: endereço e id próprios da loja (e quem chama um webhook pela URL, ex.: o agente repassando
  // a mensagem da dona para a assistente, passa a chamar o da loja)
  const paths = [...new Set([...s.matchAll(/"path":"([a-z0-9-]+)"/g)].map((m) => m[1]))];
  for (const p of TODOS_OS_PATHS) s = s.split(`/webhook/${p}`).join(`/webhook/${loja.slug}-${p}`);
  if (paths.some((p) => !TODOS_OS_PATHS.includes(p))) throw new Error(`webhook novo sem cadastro em lojas.js: ${paths.join(', ')}`);
  s = s.replace(/"path":"([a-z0-9-]+)"/g, `"path":"${loja.slug}-$1"`);
  // mensagens já enviadas (áudios e fotos): só as desta loja
  s = s.split('/rest/v1/mensagens?select=').join(`/rest/v1/mensagens?empresa_id=eq.${loja.empresa_id}&select=`);
  s = s.replace(/"webhookId":"([0-9a-f-]{36})"/g, (_, id) => `"webhookId":"${novoUuid(loja.slug, id)}"`);
  // textos
  for (const [de, para] of loja.trocas) s = s.split(JSON.stringify(de).slice(1, -1)).join(JSON.stringify(para).slice(1, -1));
  s = s.split('Toda Bonita Mega Hair').join(loja.nome).split('Toda Bonita').join(loja.nome);
  s = s.split('Gleide').join(loja.dona).split('GLEIDE').join(loja.dona.toUpperCase());
  if (loja.cidade !== 'Sinop') s = s.split('Sinop').join(loja.cidade);
  const novo = JSON.parse(s);
  // CRM antigo (Postgres, tabela clientes só por telefone, sem loja): desligado nas lojas. O CRM é o app
  // (Supabase, por empresa); os nós seguintes leem do pedido, não do resultado daqui.
  for (const nd of novo.nodes || []) {
    if (nd.type === 'n8n-nodes-base.postgres') {
      nd.parameters.query = 'SELECT 1 AS ok -- CRM antigo (só telefone, sem loja): desligado nas lojas';
      if (nd.parameters.options) delete nd.parameters.options.queryReplacement;
    }
  }
  novo.name = `[${loja.nome}] ${novo.name}`;
  for (const k of Object.keys(wf)) delete wf[k];
  Object.assign(wf, novo);
  return wf;
}

// Confere o conjunto da loja: nada da Gleide pode sobrar. Devolve avisos (textos do nicho que sobraram).
function conferirLoja(workflows, loja, idsGleide) {
  const erros = [];
  const avisos = [];
  const chaves = CHAVES.join('|');
  for (const wf of workflows) {
    const s = JSON.stringify(wf);
    const nome = wf.name;
    const tem = (texto, motivo) => { if (s.includes(texto)) erros.push(`${nome}: ${motivo}`); };
    tem('$env.EMPRESA_ID', 'sobrou $env.EMPRESA_ID');
    tem('$env.EVOLUTION_INSTANCE', 'sobrou $env.EVOLUTION_INSTANCE');
    tem('$env.ASSISTENTE_NUMEROS', 'sobrou $env.ASSISTENTE_NUMEROS');
    tem('00000000-0000-0000-0000-000000000001', 'tem o id da empresa da Gleide');
    tem(GLEIDE_ASSISTENTE, 'tem o número da Gleide');
    tem('salao-demo', 'tem a instância da Gleide');
    for (const id of idsGleide) tem(id, `aponta para o workflow da Gleide ${id}`);
    const semPrefixo = s.match(new RegExp(`(=|'|"keyPattern":")(${chaves}):(\\{\\{|'|\\*)`, 'g'));
    if (semPrefixo) erros.push(`${nome}: chave do Redis sem o prefixo da loja: ${[...new Set(semPrefixo)].join(' ')}`);
    for (const m of s.matchAll(/"path":"([^"]+)"/g)) if (!m[1].startsWith(`${loja.slug}-`)) erros.push(`${nome}: webhook sem o prefixo da loja: ${m[1]}`);
    for (const m of s.matchAll(/\/webhook\/([a-z0-9-]+)/g)) if (!m[1].startsWith(`${loja.slug}-`)) erros.push(`${nome}: chama o webhook da Gleide: ${m[1]}`);
    if (/Gleide|GLEIDE/.test(s)) erros.push(`${nome}: ainda fala "Gleide"`);
    for (const nd of wf.nodes) if (nd.type === 'n8n-nodes-base.postgres' && /insert|update|delete/i.test(nd.parameters.query || '')) erros.push(`${nome}: "${nd.name}" grava no CRM antigo (sem loja)`);
    for (const m of s.matchAll(/\/rest\/v1\/mensagens\?([^"]*)/g)) if (!m[1].includes(`empresa_id=eq.${loja.empresa_id}`)) erros.push(`${nome}: lê mensagens sem filtrar pela loja`);
    const nicho = s.match(/[Mm]ega ?[Hh]air/g);
    if (nicho && loja.nicho && loja.nicho !== 'mega_hair') avisos.push(`${nome}: ${nicho.length}x "mega hair" no texto (ajustar em trocas ou no prompt da loja)`);
  }
  return { erros, avisos };
}

// ids dos workflows da Gleide (para garantir que a loja nunca aponta nem grava em cima deles)
const arquivosId = (pasta) => (fs.existsSync(pasta) ? fs.readdirSync(pasta).filter((f) => /^\.workflow(-[a-z-]+)?-id$/.test(f)) : []);
const lerId = (arq) => fs.readFileSync(arq, 'utf8').trim();
function idsDaGleide(dir) {
  return arquivosId(dir).map((f) => lerId(path.join(dir, f))).filter(Boolean);
}

// Na hora de montar, as ferramentas apontam para os subworkflows pelos .workflow-*-id da Gleide. Na loja,
// cada um vira o id do workflow da LOJA com o mesmo papel (mesmo nome de arquivo em lojas/<slug>/) ou,
// antes do 1º envio, um marcador que o --enviar substitui.
function mapaIds(dir, loja) {
  return arquivosId(dir).map((f) => {
    const daLoja = path.join(loja.pasta, f);
    return [lerId(path.join(dir, f)), fs.existsSync(daLoja) ? lerId(daLoja) : `PENDENTE${f}`];
  }).filter(([g]) => g);
}

module.exports = { carregarLoja, paraLoja, conferirLoja, idsDaGleide, mapaIds };
