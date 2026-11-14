// Motor único por ramo (docs/PLANO-MOTOR-UNICO.md): um conjunto de workflows atende TODAS as lojas do ramo.
// Uso: node montar-workflow.js --loja motor-unhas [--enviar --ativar]
//
// A pasta lojas/motor-<ramo>/ é uma "loja modelo": o loja.json tem "motor": true e, no lugar dos dados de
// uma loja, MARCAS (MOTORxEMPRESA, MOTORxDONA…). O gerador monta o conjunto como o de qualquer loja
// (lojas.js) e, no fim, este arquivo troca cada marca por uma leitura da FICHA da loja, feita na hora:
//
//   - toda entrada (webhook, subworkflow, rotina) ganha o nó "Loja", que carrega a ficha;
//   - webhook: a ficha vem do banco pela instância do WhatsApp (função motor_loja, supabase/047);
//   - subworkflow: quem chama manda a ficha junto (campo loja_json);
//   - rotinas (faltas, retomada, retorno, pendências): o workflow "Rotinas" dispara no horário e chama
//     cada rotina uma vez por loja ativa no motor (função motor_lojas);
//   - memória, pausa e filas no Redis levam o id da loja na chave.
//
// Só entra no motor a loja com empresas.config.ia.motor = true. As lojas com conjunto próprio (Gleide,
// Caroline) não passam por aqui.

const crypto = require('crypto');

const REF = "$('Loja').first().json";
// marca -> campo da ficha (ver "Loja" abaixo e supabase/047_motor_loja.sql)
const CAMPOS = {
  MOTORxEMPRESA: 'empresa_id', MOTORxINSTANCIA: 'instancia', MOTORxDONA: 'dona', MOTORXDONA: 'dona_maiuscula',
  MOTORxNOME: 'nome', MOTORXNOME: 'nome_maiusculo', MOTORxCIDADE: 'cidade', MOTORxASSISTSEM9: 'assist_sem9', MOTORxASSIST: 'assist',
  MOTORxPERMITIDOS: 'permitidos', MOTORxCATALOGO: 'catalogo_link',
};
const MARCA = /MOTOR[xX][A-Z0-9]+/g;
const campo = (marca) => {
  if (!CAMPOS[marca]) throw new Error(`motor: marca desconhecida ${marca}`);
  return `${REF}.${CAMPOS[marca]}`;
};
// em comentário e em nota: texto fixo
const emPalavras = (s) => s.replace(MARCA, (m) => ({ MOTORxDONA: 'a dona', MOTORXDONA: 'A DONA', MOTORxNOME: 'a loja' }[m] || 'da loja'));

const uuid = (texto) => {
  const h = crypto.createHash('md5').update(`motor:${texto}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// ---------- JavaScript: troca as marcas dentro dos textos por leitura da ficha ----------
// Lê o código caractere a caractere para saber se a marca está em '…', "…", `…`, comentário ou solta.
// 'oi MOTORxDONA' vira ('oi ' + ficha.dona + ''); `oi MOTORxDONA` vira `oi ${ficha.dona}`.
// `ate`: para em "}}" fora de texto (fim de uma expressão do n8n). Devolve { saida, fim }.
function converterJs(codigo, { ate = false, onde = '' } = {}) {
  let i = 0;
  let saida = '';
  let ultimo = ''; // último caractere que não é espaço, fora de texto (para saber se "/" abre regex)
  let palavra = '';
  const n = codigo.length;
  const erro = (msg) => { throw new Error(`motor (${onde}): ${msg}: …${codigo.slice(Math.max(0, i - 60), i + 60)}…`); };

  const texto = (aspa) => {
    // codigo[i] é a aspa de abertura
    let j = i + 1;
    while (j < n && codigo[j] !== aspa) { if (codigo[j] === '\\') j++; if (codigo[j] === '\n') break; j++; }
    if (codigo[j] !== aspa) erro(`texto com ${aspa} sem fechar`);
    const miolo = codigo.slice(i + 1, j);
    i = j + 1;
    if (!MARCA.test(miolo)) { MARCA.lastIndex = 0; return aspa + miolo + aspa; }
    MARCA.lastIndex = 0;
    const partes = [];
    let p = 0;
    for (const m of miolo.matchAll(MARCA)) {
      partes.push(aspa + miolo.slice(p, m.index) + aspa, campo(m[0]));
      p = m.index + m[0].length;
    }
    partes.push(aspa + miolo.slice(p) + aspa);
    return `(${partes.join(' + ')})`;
  };

  const modelo = () => {
    // codigo[i] é a crase de abertura; ${ … } é código de novo
    let r = '`';
    i++;
    while (i < n && codigo[i] !== '`') {
      if (codigo[i] === '\\') { r += codigo.slice(i, i + 2); i += 2; continue; }
      if (codigo[i] === '$' && codigo[i + 1] === '{') {
        i += 2;
        const dentro = converterJs(codigo.slice(i), { ate: 'chave', onde });
        r += '${' + dentro.saida + '}';
        i += dentro.fim + 1;
        continue;
      }
      const m = /^MOTOR[xX][A-Z0-9]+/.exec(codigo.slice(i, i + 40));
      if (m) { r += '${' + campo(m[0]) + '}'; i += m[0].length; continue; }
      r += codigo[i++];
    }
    if (codigo[i] !== '`') erro('texto com crase sem fechar');
    i++;
    return r + '`';
  };

  let fundo = 0; // chaves abertas (para achar o fim de ${ … } e de {{ … }})
  while (i < n) {
    const c = codigo[i];
    const d = codigo[i + 1];
    if (ate === true && c === '}' && d === '}' && fundo === 0) return { saida, fim: i };
    if (ate === 'chave' && c === '}' && fundo === 0) return { saida, fim: i };
    if (c === '/' && d === '/') {
      let j = codigo.indexOf('\n', i); if (j < 0) j = n;
      saida += emPalavras(codigo.slice(i, j)); i = j; continue;
    }
    if (c === '/' && d === '*') {
      let j = codigo.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      saida += emPalavras(codigo.slice(i, j)); i = j; continue;
    }
    if (c === "'" || c === '"') { saida += texto(c); ultimo = c; palavra = ''; continue; }
    if (c === '`') { saida += modelo(); ultimo = '`'; palavra = ''; continue; }
    if (c === '/') {
      const abreRegex = ultimo === '' || '(,=:[!&|?{};+-*%<>~^'.includes(ultimo) || /^(return|typeof|case|in|of|delete|void)$/.test(palavra);
      if (abreRegex) {
        let j = i + 1; let classe = false;
        while (j < n && (codigo[j] !== '/' || classe)) {
          if (codigo[j] === '\\') j++; else if (codigo[j] === '[') classe = true; else if (codigo[j] === ']') classe = false;
          else if (codigo[j] === '\n') erro('regex sem fechar');
          j++;
        }
        while (j + 1 < n && /[a-z]/i.test(codigo[j + 1])) j++;
        const re = codigo.slice(i, j + 1);
        if (MARCA.test(re)) {
          // /… MOTORxDONA …/i vira new RegExp(String.raw`… ${nome da dona, com os caracteres de regex protegidos} …`, 'i')
          MARCA.lastIndex = 0;
          const fecha = re.lastIndexOf('/');
          const fonte = re.slice(1, fecha);
          if (fonte.includes('`') || fonte.includes('${')) erro('regex com crase ou ${ e marca do motor');
          const protegido = (m) => '${String(' + campo(m) + ")" + ".replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}";
          saida += 'new RegExp(String.raw`' + fonte.replace(MARCA, protegido) + '`, ' + JSON.stringify(re.slice(fecha + 1)) + ')';
        } else saida += re;
        MARCA.lastIndex = 0; i = j + 1; ultimo = '/'; palavra = ''; continue;
      }
    }
    if (c === 'M') {
      const m = /^MOTOR[xX][A-Z0-9]+/.exec(codigo.slice(i, i + 40));
      if (m) erro(`marca ${m[0]} fora de texto`);
    }
    if (c === '{') fundo++;
    if (c === '}') fundo--;
    if (/[A-Za-z0-9_$]/.test(c)) palavra = /[A-Za-z0-9_$]/.test(codigo[i - 1] || '') ? palavra + c : c;
    else if (!/\s/.test(c)) palavra = '';
    if (!/\s/.test(c)) ultimo = c;
    saida += c; i++;
  }
  if (ate) erro(ate === true ? 'expressão {{ sem fechar' : '${ sem fechar');
  return { saida, fim: n };
}

// Expressão do n8n ("=texto {{ código }} texto"): fora das chaves a marca vira {{ ficha.campo }}
function converterExpressao(valor, onde) {
  let r = '=';
  let i = 1;
  while (i < valor.length) {
    const abre = valor.indexOf('{{', i);
    const fora = valor.slice(i, abre < 0 ? valor.length : abre);
    r += fora.replace(MARCA, (m) => `{{ ${campo(m)} }}`);
    if (abre < 0) break;
    const dentro = converterJs(valor.slice(abre + 2), { ate: true, onde });
    r += `{{${dentro.saida}}}`;
    i = abre + 2 + dentro.fim + 2;
  }
  return r;
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

// Troca as marcas em todos os parâmetros de um nó
function converterNo(nd, nomeWf) {
  const onde = `${nomeWf} / ${nd.name}`;
  if (nd.type === 'n8n-nodes-base.stickyNote') { nd.parameters.content = emPalavras(nd.parameters.content || ''); return; }
  const visita = (v, chave) => {
    if (typeof v === 'string') {
      if (!MARCA.test(v)) { MARCA.lastIndex = 0; return v; }
      MARCA.lastIndex = 0;
      if (chave === 'jsCode') {
        const novo = converterJs(v, { onde }).saida;
        try { new AsyncFunction(novo); } catch (e) { throw new Error(`motor (${onde}): o código não fecha depois da troca: ${e.message}`); }
        return novo;
      }
      if (v.startsWith('=')) return converterExpressao(v, onde);
      if (v.includes('{{')) throw new Error(`motor (${onde}): texto fixo com "{{" e marca do motor em "${chave}"`);
      return '=' + v.replace(MARCA, (m) => `{{ ${campo(m)} }}`);
    }
    if (Array.isArray(v)) return v.map((x) => visita(x, chave));
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = visita(v[k], k); return v; }
    return v;
  };
  nd.parameters = visita(nd.parameters, '');
}

// ---------- A ficha ----------
// Nó "Loja": normaliza o que veio do banco (ou de quem chamou). Sem loja (instância desconhecida, loja fora
// do motor, IA não liberada): não devolve nada e o workflow para ali.
const CODIGO_LOJA = (origem) => `// Ficha da loja deste atendimento (motor único). Tudo o que muda de uma loja para outra sai daqui.
const bruto = ${origem};
const f = typeof bruto === 'string' ? JSON.parse(bruto || 'null') : bruto;
if (!f || !f.empresa_id) return [];
const sem9 = (n) => { const d = String(n).replace(/\\D/g, ''); return /^55\\d{2}9\\d{8}$/.test(d) ? d.slice(0, 4) + d.slice(5) : d; };
const lista = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
const dona = String(f.dona || 'responsável').trim();
// Trava de teste: números com e sem o 9 (o principal compara como o WhatsApp manda; as rotinas, sem o 9).
// Loja ainda não liberada pela agência (config.ia.liberada) e sem lista: ninguém recebe, só a dona.
let permitidos = [...new Set(lista(f.permitidos).flatMap((n) => [n.replace(/\\D/g, ''), sem9(n)]).filter(Boolean))];
if (f.liberada !== true && !permitidos.length) permitidos = ['0'];
if (f.liberada === true) permitidos = [];
return [{ json: {
  empresa_id: f.empresa_id, nome: f.nome || '', nicho: f.nicho || '', instancia: f.instancia || '',
  dona, dona_maiuscula: dona.toUpperCase(), nome_maiusculo: String(f.nome || '').toUpperCase(), cidade: f.cidade || '', fuso: f.fuso || 'America/Cuiaba',
  assist: lista(f.assist).join(','), assist_sem9: lista(f.assist).map(sem9).join(','),
  permitidos: permitidos.join(','), catalogo_link: f.catalogo_link || '',
} }];`;

const noCodigo = (nome, wf, posicao, jsCode) => ({
  id: uuid(`${wf.name}:${nome}`), name: nome, type: 'n8n-nodes-base.code', typeVersion: 2, position: posicao, parameters: { jsCode },
});

const supabaseRpc = (nome, wf, posicao, funcao, corpo) => ({
  id: uuid(`${wf.name}:${nome}`), name: nome, type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: posicao,
  parameters: {
    method: 'POST', url: `={{ $env.SUPABASE_URL }}/rest/v1/rpc/${funcao}`,
    sendHeaders: true,
    headerParameters: { parameters: [
      { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
      { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
    ] },
    sendBody: true, specifyBody: 'json', jsonBody: corpo, options: { timeout: 15000 },
  },
  retryOnFail: true, maxTries: 3, waitBetweenTries: 1000, alwaysOutputData: true,
});

const ehGatilho = (nd) => ['n8n-nodes-base.webhook', 'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.executeWorkflowTrigger'].includes(nd.type);
const destinos = (wf, nome) => ((wf.connections[nome] || {}).main || [[]])[0] || [];

function tirarNo(wf, nome) {
  wf.nodes = wf.nodes.filter((nd) => nd.name !== nome);
  delete wf.connections[nome];
}

// Entrada de cada workflow. Devolve as rotinas (gatilhos de horário) que o workflow "Rotinas" vai disparar.
function entradas(wf, nicho) {
  const gatilhos = wf.nodes.filter(ehGatilho);
  if (!gatilhos.length) return []; // alerta de erro: não tem loja (ver instancia_alerta)
  if (wf.nodes.some((nd) => nd.name === 'Loja' || nd.name === 'Entrada')) throw new Error(`motor: "${wf.name}" já tem um nó chamado Loja ou Entrada`);
  const [x, y] = gatilhos[0].position;
  const horarios = gatilhos.filter((nd) => nd.type.endsWith('scheduleTrigger'));

  // rotina: os gatilhos de horário (e o webhook de teste) saem; entra um só, chamado pelo "Rotinas" para cada loja
  if (horarios.length) {
    const rotinas = [];
    const entrada = {
      id: uuid(`${wf.name}:entrada`), name: 'Entrada do motor', type: 'n8n-nodes-base.executeWorkflowTrigger', typeVersion: 1.1,
      position: [x - 660, y], parameters: { workflowInputs: { values: [{ name: 'loja_json' }, { name: 'gatilho' }] } },
    };
    const loja = noCodigo('Loja', wf, [x - 440, y], CODIGO_LOJA("$('Entrada do motor').first().json.loja_json"));
    const novos = [entrada, loja];
    const saidas = [];
    gatilhos.forEach((g, k) => {
      const nome = `Gatilho: ${g.name}`;
      novos.push({
        id: uuid(`${wf.name}:${nome}`), name: nome, type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [x - 220, y + k * 160],
        parameters: {
          conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
            conditions: [{ id: 'g1', leftValue: `={{ $('Entrada do motor').first().json.gatilho === ${JSON.stringify(g.name)} }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
            combinator: 'and' },
          options: {},
        },
      });
      saidas.push({ node: nome, type: 'main', index: 0 });
      const para = destinos(wf, g.name);
      tirarNo(wf, g.name);
      wf.connections[nome] = { main: [para, []] };
      rotinas.push({ gatilho: g.name, teste: !g.type.endsWith('scheduleTrigger'), no: g });
    });
    wf.nodes.push(...novos);
    wf.connections['Entrada do motor'] = { main: [[{ node: 'Loja', type: 'main', index: 0 }]] };
    wf.connections.Loja = { main: [saidas] };
    return rotinas;
  }

  if (gatilhos.length !== 1) throw new Error(`motor: "${wf.name}" tem ${gatilhos.length} entradas e nenhuma é de horário`);
  const g = gatilhos[0];
  const para = destinos(wf, g.name);
  const ref = `$(${JSON.stringify(g.name)})`;
  const novos = [];
  let primeiro;
  if (g.type.endsWith('webhook')) {
    // mensagem da Evolution (ou repassada pelo principal): a instância diz de qual loja é
    if (!/\/webhook\/|whatsapp|assistente/.test(g.parameters.path || '')) throw new Error(`motor: webhook sem loja em "${wf.name}"`);
    novos.push(supabaseRpc('Buscar loja', wf, [x, y - 200], 'motor_loja', `={{ JSON.stringify({ p_instancia: String(${ref}.first().json.body.instance || ''), p_nicho: ${JSON.stringify(nicho)} }) }}`));
    novos.push(noCodigo('Loja', wf, [x + 220, y - 200], CODIGO_LOJA("$('Buscar loja').first().json")));
    novos.push(noCodigo('Entrada', wf, [x + 440, y - 200], `// devolve a mensagem que chegou, como se o nó "Loja" não existisse no caminho\nreturn ${ref}.all();`));
    wf.connections['Buscar loja'] = { main: [[{ node: 'Loja', type: 'main', index: 0 }]] };
    primeiro = 'Buscar loja';
  } else {
    // subworkflow: quem chama manda a ficha em loja_json
    g.parameters.workflowInputs.values.push({ name: 'loja_json' });
    novos.push(noCodigo('Loja', wf, [x + 220, y - 200], CODIGO_LOJA(`${ref}.first().json.loja_json`)));
    novos.push(noCodigo('Entrada', wf, [x + 440, y - 200], `// devolve o pedido que chegou, sem a ficha da loja\nreturn ${ref}.all().map((i) => { const { loja_json, ...resto } = i.json; return { json: resto }; });`));
    primeiro = 'Loja';
  }
  wf.nodes.push(...novos);
  wf.connections[g.name] = { main: [[{ node: primeiro, type: 'main', index: 0 }]] };
  wf.connections.Loja = { main: [[{ node: 'Entrada', type: 'main', index: 0 }]] };
  wf.connections.Entrada = { main: [para] };
  return [];
}

// Quem chama subworkflow (ferramentas do agente) manda a ficha junto
function mandarFicha(wf) {
  for (const nd of wf.nodes) {
    if (!/toolWorkflow$|executeWorkflow$/.test(nd.type)) continue;
    const wi = nd.parameters.workflowInputs;
    if (!wi || !wi.value) throw new Error(`motor: "${wf.name}" / "${nd.name}" chama subworkflow sem lista de campos`);
    wi.value.loja_json = `={{ JSON.stringify(${REF}) }}`;
    if (Array.isArray(wi.schema)) wi.schema.push({ id: 'loja_json', displayName: 'loja_json', required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false });
  }
}

// Catálogo: loja sem link cadastrado (config.loja.catalogo_link) não manda mensagem vazia; a IA é avisada
function semCatalogo(wf) {
  const para = destinos(wf, 'Entrada');
  if (!para.length) throw new Error('motor: não achei a entrada do workflow do catálogo');
  wf.nodes.push({
    id: uuid(`${wf.name}:tem-catalogo`), name: 'Tem catálogo?', type: 'n8n-nodes-base.if', typeVersion: 2.2, position: [660, -200],
    parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
      conditions: [{ id: 'c1', leftValue: `={{ !!${REF}.catalogo_link }}`, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
  }, {
    id: uuid(`${wf.name}:sem-catalogo`), name: 'Resposta (sem catálogo)', type: 'n8n-nodes-base.set', typeVersion: 3.4, position: [880, -80],
    parameters: { assignments: { assignments: [{ id: 'a-resposta', name: 'resposta', type: 'string',
      value: 'CATÁLOGO NÃO ENVIADO: esta loja não tem catálogo cadastrado. Não diga que enviou nem prometa mandar depois; responda sobre os serviços pela lista de SERVIÇOS E PREÇOS.' }] }, options: {} },
  });
  wf.connections.Entrada = { main: [[{ node: 'Tem catálogo?', type: 'main', index: 0 }]] };
  wf.connections['Tem catálogo?'] = { main: [para, [{ node: 'Resposta (sem catálogo)', type: 'main', index: 0 }]] };
}

// Workflow "Rotinas": cada horário chama a rotina uma vez por loja ativa no motor
function montarRotinas(rotinasPorWf, loja, settings) {
  const wf = { name: `[${loja.rotulo}] Rotinas`, nodes: [], connections: {}, settings };
  const nicho = JSON.stringify(loja.nicho);
  let linha = 0;
  for (const { arquivoId, lista } of rotinasPorWf) {
    for (const r of lista) {
      const y = linha++ * 180;
      const nomeGatilho = `${r.gatilho} · ${arquivoId.replace(/^\.workflow-|-id$/g, '')}`;
      const g = JSON.parse(JSON.stringify(r.no));
      g.name = nomeGatilho; g.id = uuid(`rotinas:${nomeGatilho}`); g.position = [0, y];
      const filtro = r.teste
        // teste: GET …/webhook/<path>?empresa_id=<id> roda a rotina só naquela loja (sem o id não roda em nenhuma)
        ? `={{ JSON.stringify({ p_nicho: ${nicho}, p_empresa_id: ($json.query || {}).empresa_id || ($json.body || {}).empresa_id || '00000000-0000-0000-0000-000000000000' }) }}`
        : `={{ JSON.stringify({ p_nicho: ${nicho} }) }}`;
      if (r.teste) { g.parameters.path = `${loja.slug}-rotina-${arquivoId.replace(/^\.workflow-|-id$/g, '')}`; g.webhookId = uuid(`rotinas:webhook:${nomeGatilho}`); }
      const lojas = supabaseRpc(`Lojas: ${nomeGatilho}`, wf, [220, y], 'motor_lojas', filtro);
      const chamar = {
        id: uuid(`rotinas:chamar:${nomeGatilho}`), name: `Rodar: ${nomeGatilho}`, type: 'n8n-nodes-base.executeWorkflow', typeVersion: 1.2, position: [440, y],
        parameters: {
          workflowId: { __rl: true, mode: 'id', value: `PENDENTE${arquivoId}` },
          workflowInputs: { mappingMode: 'defineBelow', value: { loja_json: '={{ JSON.stringify($json) }}', gatilho: r.gatilho }, matchingColumns: [],
            schema: ['loja_json', 'gatilho'].map((id) => ({ id, displayName: id, required: false, defaultMatch: false, display: true, canBeUsedToMatch: true, type: 'string', removed: false })) },
          mode: 'each', options: { waitForSubWorkflow: false },
        },
        onError: 'continueRegularOutput',
      };
      // sem loja no motor o banco devolve lista vazia: o filtro abaixo não deixa chamar a rotina sem ficha
      const tem = {
        id: uuid(`rotinas:tem:${nomeGatilho}`), name: `Tem loja? ${nomeGatilho}`, type: 'n8n-nodes-base.filter', typeVersion: 2.2, position: [330, y + 80],
        parameters: { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
          conditions: [{ id: 't1', leftValue: '={{ !!$json.empresa_id }}', rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
      };
      wf.nodes.push(g, lojas, tem, chamar);
      wf.connections[g.name] = { main: [[{ node: lojas.name, type: 'main', index: 0 }]] };
      wf.connections[lojas.name] = { main: [[{ node: tem.name, type: 'main', index: 0 }]] };
      wf.connections[tem.name] = { main: [[{ node: chamar.name, type: 'main', index: 0 }]] };
    }
  }
  return wf;
}

// Confere o conjunto do motor: nenhuma marca sobrando, todo código fecha, toda referência a nó existe
function conferir(workflows) {
  const erros = [];
  for (const wf of workflows) {
    const s = JSON.stringify(wf);
    const sobrou = s.match(MARCA);
    MARCA.lastIndex = 0;
    if (sobrou) erros.push(`${wf.name}: sobrou marca do motor: ${[...new Set(sobrou)].join(', ')}`);
    const nomes = new Set(wf.nodes.map((nd) => nd.name));
    for (const m of s.matchAll(/\$\((?:'((?:[^'\\]|\\.)+)'|\\"((?:[^"\\]|\\.)+?)\\")\)/g)) {
      const nome = JSON.parse(`"${(m[1] || m[2]).replace(/\\'/g, "'")}"`);
      if (!nomes.has(nome)) erros.push(`${wf.name}: referência a nó que não existe: ${nome}`);
    }
    for (const [de, c] of Object.entries(wf.connections)) {
      if (!nomes.has(de)) erros.push(`${wf.name}: ligação saindo de nó que não existe: ${de}`);
      for (const tipo of Object.values(c)) for (const saida of tipo || []) for (const l of saida || []) if (!nomes.has(l.node)) erros.push(`${wf.name}: ligação para nó que não existe: ${l.node}`);
    }
    const usaLoja = s.includes("$('Loja')");
    if (usaLoja && !nomes.has('Loja')) erros.push(`${wf.name}: usa a ficha da loja e não tem o nó "Loja"`);
    for (const nd of wf.nodes) {
      const olhar = (v, chave) => {
        if (typeof v === 'string') {
          if (chave === 'jsCode') { try { new AsyncFunction(v); } catch (e) { erros.push(`${wf.name} / ${nd.name}: código não fecha: ${e.message}`); } }
          else if (v.startsWith('=')) {
            // cada {{ … }} tem que ser uma expressão válida
            let i = 1;
            while (i < v.length) {
              const abre = v.indexOf('{{', i);
              if (abre < 0) break;
              let d;
              try { d = converterJs(v.slice(abre + 2), { ate: true, onde: `${wf.name} / ${nd.name}` }); } catch (e) { erros.push(e.message); break; }
              try { new Function(`return (${d.saida}\n)`); } catch (e) { erros.push(`${wf.name} / ${nd.name} (${chave}): expressão não fecha: ${e.message}: ${d.saida.slice(0, 120)}`); }
              i = abre + 2 + d.fim + 2;
            }
          }
        } else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) olhar(x, Array.isArray(v) ? chave : k);
      };
      olhar(nd.parameters, '');
    }
  }
  return erros;
}

// Chamado pelo montar-workflow.js depois de lojas.paraLoja e lojas.travarEnvios.
// `conjunto`: [{ wf, arquivoId }] na ordem de envio. Devolve o workflow "Rotinas".
function aplicar(conjunto, loja) {
  if (!loja.rotulo || !loja.nicho) throw new Error('motor: loja.json precisa de "rotulo" (nome do conjunto) e "nicho"');
  const prefixo = `${loja.slug}:`;
  const rotinasPorWf = [];
  for (const { wf, arquivoId } of conjunto) {
    // nome do conjunto no lugar do nome da loja; chave do Redis com o id da loja no lugar do nome do conjunto
    let s = JSON.stringify(wf).split(`"name":"[MOTORxNOME] `).join(`"name":"[${loja.rotulo}] `);
    s = s.split(prefixo).join('MOTORxEMPRESA:');
    // chaves da assistente da dona (assist_buffer, assist_ultima, assist_processando, assist_feitos): nas lojas com
    // conjunto próprio ficam sem prefixo; no motor duas lojas podem ter o mesmo número de dona, então levam a loja
    s = s.replace(/(=|'|"keyPattern":")(assist_[a-z]+):/g, '$1MOTORxEMPRESA:$2:');
    // link do catálogo: o gerador exige um link de verdade; no motor o link é o de cada loja (ficha)
    if (loja.catalogo_link) s = s.split(loja.catalogo_link).join('MOTORxCATALOGO');
    // nome de nó não pode mudar de uma loja para outra: a marca vira palavra (no nome, nas ligações e nas referências)
    const novo = JSON.parse(s);
    for (const nd of novo.nodes) {
      if (!MARCA.test(nd.name)) { MARCA.lastIndex = 0; continue; }
      MARCA.lastIndex = 0;
      const de = JSON.stringify(nd.name).slice(1, -1);
      const para = JSON.stringify(emPalavras(nd.name)).slice(1, -1);
      s = s.split(`"${de}"`).join(`"${para}"`).split(`$('${de}')`).join(`$('${para}')`).split(`$(\\"${de}\\")`).join(`$(\\"${para}\\")`);
    }
    const pronto = JSON.parse(s);
    for (const k of Object.keys(wf)) delete wf[k];
    Object.assign(wf, pronto);
    wf.name = wf.name.replace(MARCA, (m) => (/DONA/.test(m) ? 'dona' : 'loja'));
    // alerta de erro: não tem loja; sai sempre pela instância da agência
    if (!wf.nodes.some(ehGatilho)) {
      // sem instancia_alerta no loja.json o conjunto é gerado, mas o envio é recusado (montar-workflow.js)
      const t = JSON.stringify(wf).split('MOTORxINSTANCIA').join(loja.instancia_alerta || 'FALTA-INSTANCIA-ALERTA');
      Object.assign(wf, JSON.parse(t));
    }
    // workflow que não usa nada da loja (ex.: transcrever áudio) fica como está
    const usaLoja = /MOTOR[xX][A-Z0-9]+/.test(JSON.stringify(wf)) || wf.nodes.some((nd) => /toolWorkflow$|executeWorkflow$/.test(nd.type));
    if (!usaLoja) continue;
    const lista = entradas(wf, loja.nicho);
    if (lista.length) rotinasPorWf.push({ arquivoId, lista });
    mandarFicha(wf);
    if (arquivoId === '.workflow-catalogo-id') semCatalogo(wf);
    for (const nd of wf.nodes) converterNo(nd, wf.name);
    // toda chave do Redis tem que começar pela loja
    for (const nd of wf.nodes) {
      if (!/redis|memoryRedisChat/i.test(nd.type)) continue;
      for (const k of ['key', 'keyPattern', 'sessionKey', 'list']) {
        const v = nd.parameters[k];
        // chave escrita no workflow ("=pausa:{{…}}"); a que vem de um dado ("={{ $json.chave }}") já foi lida com a loja
        if (typeof v === 'string' && /^=?[a-z_]+:/.test(v)) throw new Error(`motor: chave do Redis sem a loja em "${wf.name}" / "${nd.name}": ${v.slice(0, 80)}`);
      }
    }
  }
  const base = conjunto[0].wf.settings || {};
  const rotinas = montarRotinas(rotinasPorWf, loja, { executionOrder: 'v1', timezone: base.timezone || 'America/Cuiaba', saveManualExecutions: true, saveDataSuccessExecution: 'none' });
  const erros = conferir([...conjunto.map((c) => c.wf), rotinas]);
  if (erros.length) throw new Error(`motor: o conjunto tem problema.\n- ${[...new Set(erros)].join('\n- ')}`);
  return rotinas;
}

// Na hora do envio: o "Rotinas" aponta para os workflows de rotina já criados (ids por arquivo)
function apontarRotinas(rotinas, idDe) {
  for (const nd of rotinas.nodes) {
    if (!nd.type.endsWith('executeWorkflow')) continue;
    const arq = String(nd.parameters.workflowId.value).replace(/^PENDENTE/, '');
    const id = idDe(arq);
    if (!id) throw new Error(`motor: sem id para a rotina ${arq}`);
    nd.parameters.workflowId.value = id;
  }
}

module.exports = { aplicar, apontarRotinas, converterJs, converterExpressao, conferir, CAMPOS };
