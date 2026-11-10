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
//   trocas        [["texto", "novo"], …]         textos do nicho (ex.: "salão de mega hair"), escritos como no
//                                                código (com "Gleide": a troca pelo nome da dona vem depois).
//                                                Troca que não acha o texto para o gerador (o código mudou)
//   catalogo_pdf  {"arquivo", "nome"}            opcional: PDF no bucket "catalogos" que a IA manda (catalogo-pdf.js)
//   prompt_assistente "arquivo.txt"              opcional: prompt próprio da assistente da dona (na pasta da loja)
//   memoria_horas 12                             opcional: a IA esquece a conversa depois de X horas sem mensagem (padrão 7 dias)
//
// Só nas lojas (a Gleide não muda):
//   - "DADOS DO SALÃO" no fim do prompt, lido a cada mensagem de empresas.config (tela Dados do salão do app);
//     o 1º envio liga config.ia_usa_dados_loja (a tela passa a dizer que a IA usa esses dados)
//   - trava "permitidos" também nas rotinas (faltas, retomada, assistente, pendências): mensagem para número
//     fora da lista (e fora de assistente_numeros) não sai
//
// Tudo é trocado no JSON já montado e depois conferido: se sobrar qualquer coisa da Gleide (empresa,
// instância, número, chave do Redis sem prefixo, webhook, id de workflow), o gerador para com erro.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GLEIDE_ASSISTENTE = '5566999596740';
// endereços de webhook dos workflows (path); na loja viram "<slug>-<path>", inclusive em URL que chama outro
const TODOS_OS_PATHS = ['whatsapp-salao', 'assistente-gleide', 'assistente-pendencias', 'audios-transcrever', 'faltas-avisos', 'retomar-conversa', 'retorno-combinado'];
// chaves do Redis usadas pelos workflows (ver montar-workflow.js, pedidos, assistente, faltas, retomar)
const CHAVES = ['memoria', 'pausa', 'buffer_ultima', 'buffer', 'processando', 'pedido', 'assistente', 'alerta', 'descartes'];

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
  // textos (cada troca conta onde achou; conferirTrocas avisa a que não achou em nenhum workflow)
  loja.trocasAchadas = loja.trocasAchadas || new Set();
  for (const [de, para] of loja.trocas) {
    const de2 = JSON.stringify(de).slice(1, -1);
    if (s.includes(de2)) loja.trocasAchadas.add(de);
    s = s.split(de2).join(JSON.stringify(para).slice(1, -1));
  }
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
    tem('Papoulas', 'tem o endereço da Gleide');
    tem('TpCuMzh3PzwPJgQu8', 'tem o mapa da Gleide');
    if (loja.nicho !== 'mega_hair') {
      tem('pedir_orcamento_cabelo', 'tem a ferramenta de orçamento de cabelo');
      if (wf.nodes.some((nd) => nd.name === 'mudar_modalidade')) erros.push(`${nome}: tem a ferramenta de presencial/online da avaliação`);
    }
    for (const id of idsGleide) tem(id, `aponta para o workflow da Gleide ${id}`);
    const semPrefixo = s.match(new RegExp(`(=|'|"keyPattern":")(${chaves}):(\\{\\{|'|\\*)`, 'g'));
    if (semPrefixo) erros.push(`${nome}: chave do Redis sem o prefixo da loja: ${[...new Set(semPrefixo)].join(' ')}`);
    for (const m of s.matchAll(/"path":"([^"]+)"/g)) if (!m[1].startsWith(`${loja.slug}-`)) erros.push(`${nome}: webhook sem o prefixo da loja: ${m[1]}`);
    for (const m of s.matchAll(/\/webhook\/([a-z0-9-]+)/g)) if (!m[1].startsWith(`${loja.slug}-`)) erros.push(`${nome}: chama o webhook da Gleide: ${m[1]}`);
    if (/Gleide|GLEIDE/.test(s)) erros.push(`${nome}: ainda fala "Gleide"`);
    for (const nd of wf.nodes) if (nd.type === 'n8n-nodes-base.postgres' && /insert|update|delete/i.test(nd.parameters.query || '')) erros.push(`${nome}: "${nd.name}" grava no CRM antigo (sem loja)`);
    for (const m of s.matchAll(/\/rest\/v1\/mensagens\?([^"]*)/g)) if (!m[1].includes(`empresa_id=eq.${loja.empresa_id}`)) erros.push(`${nome}: lê mensagens sem filtrar pela loja`);
    // comentário de código (// … até o fim da linha) não chega na cliente nem no Gemini: não conta como texto
    const nicho = s.replace(/(^|\\n)\s*\/\/.*?(?=\\n)/g, '$1').match(/[Mm]ega ?[Hh]air/g);
    if (nicho && loja.nicho && loja.nicho !== 'mega_hair') avisos.push(`${nome}: ${nicho.length}x "mega hair" no texto (ajustar em trocas ou no prompt da loja)`);
  }
  for (const [de] of loja.trocas) if (!loja.trocasAchadas?.has(de)) erros.push(`troca sem efeito (o texto mudou no código?): "${de.slice(0, 70)}…"`);
  const travados = workflows.filter((wf) => TRAVADOS.has(wf));
  if (loja.permitidos.length) {
    for (const wf of workflows) {
      if (TRAVADOS.has(wf) || LIBERADOS.has(wf)) continue;
      const envio = wf.nodes.find((nd) => /\/message\/send/.test(nd.parameters?.url || ''));
      if (envio) erros.push(`${wf.name}: "${envio.name}" manda mensagem e o workflow não está em travarEnvios nem em semTrava`);
    }
    for (const wf of travados) {
      for (const nd of wf.nodes) {
        if (!/\/message\/send/.test(nd.parameters?.url || '') || /number:\s*'\d+'/.test(nd.parameters.jsonBody || '')) continue;
        const antes = Object.entries(wf.connections).filter(([, c]) => (c.main || []).flat().some((l) => l?.node === nd.name)).map(([k]) => k);
        if (!antes.length || antes.some((k) => !k.startsWith('Trava de teste'))) erros.push(`${wf.name}: "${nd.name}" manda mensagem sem passar pela trava de teste`);
      }
    }
  }
  return { erros, avisos };
}

// "DADOS DO SALÃO" no prompt da loja: config da empresa (tela Dados do salão do app), lida a cada mensagem logo
// depois da tabela de serviços. Usa o mesmo jeito de chamar o Supabase do nó "Supabase: tabela de serviços".
function dadosDoSalao(workflow) {
  const servicos = workflow.nodes.find((nd) => nd.name === 'Supabase: tabela de serviços');
  if (!servicos || !workflow.connections['Supabase: tabela de serviços']) throw new Error('dados do salão: não achei o nó "Supabase: tabela de serviços"');
  const nome = 'Supabase: dados do salão';
  const nd = JSON.parse(JSON.stringify(servicos));
  nd.name = nome;
  nd.id = novoUuid('no', nome);
  nd.position = [servicos.position[0], servicos.position[1] + 200];
  nd.parameters.url = '={{ $env.SUPABASE_URL }}/rest/v1/empresas?select=config&id=eq.{{ $env.EMPRESA_ID }}';
  workflow.nodes.push(nd);
  workflow.connections[nome] = workflow.connections['Supabase: tabela de serviços'];
  workflow.connections['Supabase: tabela de serviços'] = { main: [[{ node: nome, type: 'main', index: 0 }]] };
  const agente = workflow.nodes.find((n) => n.name === 'Agente IA').parameters.options;
  agente.systemMessage += `

DADOS DO SALÃO (preenchidos pela dona no app; valem mais que qualquer outro texto sobre endereço, horário, pagamento e regras)
{{ (() => { const c = $('${nome}').first().json.config || {}; const l = c.loja || {}; const t = (v) => (typeof v === 'string' ? v.trim() : ''); const dias = { seg: 'segunda', ter: 'terça', qua: 'quarta', qui: 'quinta', sex: 'sexta', sab: 'sábado', dom: 'domingo' }; const h = c.horario_funcionamento; const hora = (x) => x.replace(/^0/, '').replace(':00', 'h').replace(':', 'h'); const a = c.almoco === null ? null : (c.almoco && c.almoco.inicio ? c.almoco : { inicio: '11:00', fim: '13:00' }); const linhas = []; linhas.push('- Endereço: ' + (t(c.endereco) ? t(c.endereco) + (t(l.referencia) ? ' (' + t(l.referencia) + ')' : '') : 'não cadastrado (não invente; se perguntarem, perguntar_para_gleide)')); if (t(l.instagram)) linhas.push('- Instagram: @' + t(l.instagram).replace(/^@+/, '')); linhas.push('- Funcionamento: ' + (!h ? 'não cadastrado (não diga dias nem horários; a agenda é que diz se tem vaga)' : Object.keys(dias).map((d) => dias[d] + ' ' + (h[d] ? h[d].split('-').map(hora).join(' às ') : 'fechado')).join('; ') + '.' + (a ? ' Almoço todo dia ' + hora(a.inicio) + ' às ' + hora(a.fim) + ', sem atendimento.' : '') + ' A agenda é que diz se tem vaga.')); if (Array.isArray(c.formas_pagamento) && c.formas_pagamento.length) linhas.push('- Pagamento: ' + c.formas_pagamento.join(', ') + (t(l.parcelamento) ? '; parcelamento: ' + t(l.parcelamento) : '; parcelamento: não cadastrado (não informe)')); else linhas.push('- Pagamento: não cadastrado (não informe forma de pagamento; se perguntarem, perguntar_para_gleide)'); if (l.tolerancia_atraso !== null && l.tolerancia_atraso !== undefined && String(l.tolerancia_atraso).trim() !== '' && Number.isFinite(Number(l.tolerancia_atraso))) linhas.push('- Tolerância de atraso: ' + Number(l.tolerancia_atraso) + ' minutos'); if (t(l.cancelamento)) linhas.push('- Cancelamento: ' + t(l.cancelamento)); if (t(l.sinal)) linhas.push('- Sinal: ' + t(l.sinal)); if (t(l.sobre)) linhas.push('- Recado da dona para você: ' + t(l.sobre)); return linhas.join('\\n'); })() }}
O que não está aqui (sinal, atraso, cancelamento, estacionamento, levar acompanhante…) não está cadastrado: não invente, use perguntar_para_gleide.`;
}

// Venda avulsa de cabelo e avaliação presencial/online só existem em mega hair: as outras lojas ficam sem
// essas ferramentas no agente.
function tirarOrcamentoCabelo(workflow, loja) {
  if (loja.nicho === 'mega_hair') return;
  const soMegaHair = ['pedir_orcamento_cabelo', 'mudar_modalidade'];
  workflow.nodes = workflow.nodes.filter((nd) => !soMegaHair.includes(nd.name));
  for (const nome of soMegaHair) delete workflow.connections[nome];
}

// workflows que passaram por travarEnvios (conferirLoja confere que todo envio deles passa pela trava)
const TRAVADOS = new WeakSet();
// workflows que mandam mensagem sem trava própria, de propósito (ver a lista em montar-workflow.js)
const LIBERADOS = new WeakSet();
function semTrava(workflows) {
  for (const wf of workflows) LIBERADOS.add(wf);
}

// Trava de teste nas rotinas: antes de cada envio para cliente (sendText/sendMedia/áudio com número vindo dos
// dados, não fixo no código) entra um "Trava de teste": só passa número de loja.permitidos ou da dona.
// Com permitidos vazio (loja liberada) não faz nada.
function travarEnvios(workflows, loja) {
  for (const wf of workflows) TRAVADOS.add(wf);
  if (!loja.permitidos.length) return;
  const lista = JSON.stringify([...new Set([...loja.permitidos, ...loja.assistente_numeros].map(semNove))]).replace(/"/g, "'");
  for (const wf of workflows) {
    for (const nd of [...wf.nodes]) {
      if (!/\/message\/send/.test(nd.parameters?.url || '')) continue;
      const corpo = nd.parameters.jsonBody || '';
      if (/number:\s*'\d+'/.test(corpo)) continue; // número fixo do código (ex.: alerta do Victor)
      const m = corpo.match(/number:\s*([^,}]+?)\s*[,}]/);
      if (!m) throw new Error(`${wf.name}: "${nd.name}" manda mensagem e não achei o número para a trava de teste`);
      const nome = `Trava de teste: ${nd.name}`;
      const numero = `(() => { const d = String(${m[1]} || '').split('@')[0].replace(/\\D/g, ''); return /^55\\d{2}9\\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d; })()`;
      wf.nodes.push({
        id: novoUuid(`no:${wf.name}`, nome), name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2,
        position: [nd.position[0], nd.position[1] - 120],
        parameters: {
          conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
            conditions: [{ id: 'trava1', leftValue: `={{ ${lista}.includes(${numero}) }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
            combinator: 'and' },
          options: {},
        },
      });
      for (const c of Object.values(wf.connections)) for (const saida of c.main || []) for (const l of saida || []) if (l.node === nd.name) l.node = nome;
      wf.connections[nome] = { main: [[{ node: nd.name, type: 'main', index: 0 }], []] };
    }
  }
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

module.exports = { carregarLoja, paraLoja, conferirLoja, idsDaGleide, mapaIds, dadosDoSalao, travarEnvios, semTrava, tirarOrcamentoCabelo };
