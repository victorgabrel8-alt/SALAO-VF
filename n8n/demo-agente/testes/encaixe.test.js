// Testes do encaixe na falta (encaixe.js, supabase/067). Rodar: node --test n8n/demo-agente/testes/*.test.js
// O banco é testado à parte: n8n/demo-agente/teste-067-encaixe.sql (Loja Teste, transação desfeita).
// Os nós são os GERADOS de verdade: o teste copia o gerador para uma pasta temporária, gera os workflows da Gleide
// (sem enviar nada) e roda o código dos nós. Os cenários da agenda e da ficha usam o Luxon (como o n8n): sem ele
// instalado, esses ficam pulados. Para rodar todos: npm i luxon numa pasta qualquer e NODE_PATH=<pasta>/node_modules.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const encaixe = require('../encaixe.js');
const { linhaEncaixe, encaixeNaAgenda, REGRAS_PROMPT } = encaixe;
const { conferirAcoes, montarResumo } = require('../portao-regras.js');

let luxon = null;
try { luxon = require('luxon'); } catch (e) { /* sem Luxon: cenários da agenda e da ficha pulados */ }
const semLuxon = luxon ? false : 'sem o Luxon instalado';

// ---------- gera os workflows da Gleide numa pasta temporária ----------
const origem = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'encaixe-teste-'));
for (const f of fs.readdirSync(origem)) {
  if (/\.(js|md|json|txt)$/.test(f) && !/^workflow-/.test(f) && fs.statSync(path.join(origem, f)).isFile()) fs.copyFileSync(path.join(origem, f), path.join(tmp, f));
}
fs.writeFileSync(path.join(tmp, '.env'), '');
execFileSync(process.execPath, ['montar-workflow.js'], { cwd: tmp, stdio: 'pipe' });
const wf = (f) => JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'));
const principal = wf('workflow-demo-salao.json'), agenda = wf('workflow-agenda-salao.json'), assistente = wf('workflow-assistente.json'),
  ferramentas = wf('workflow-assistente-ferramentas.json'), faltas = wf('workflow-faltas.json'), pendencias = wf('workflow-assistente-pendencias.json');
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const no = (w, nome) => { const n = w.nodes.find((x) => x.name === nome); assert.ok(n, 'falta o nó ' + nome); return n; };
const caminho = (w, de) => { const ordem = []; let at = de; while (at && !ordem.includes(at)) { ordem.push(at); at = w.connections[at]?.main?.[0]?.[0]?.node; } return ordem; };
// $('Nó') do n8n: dados = { 'Nó': [json, json…] }
const dolar = (dados) => (nome) => {
  if (!(nome in dados)) throw new Error('nó sem dados no teste: ' + nome);
  const itens = dados[nome];
  if (itens instanceof Error) throw itens;
  return { first: () => ({ json: itens[0] || {} }), all: () => itens.map((json) => ({ json })), isExecuted: true, item: { json: itens[0] || {} } };
};

// ================= textos =================
const OFERTA = { encaixe_id: 'e1', agendamento_id: 'ag-ana', horario_original: '2026-11-21T19:00:00+00:00', janela_inicio: '2026-11-21T17:00:00+00:00',
  enviado_em: '2026-11-21T17:22:00+00:00', servico: 'Manutenção – mão de obra',
  mensagem: 'Oi, Ana! Abriu um horário hoje mais cedo aqui no salão. Se for bom pra você vir antes das 15h, me fala que horas você consegue chegar. Se não der, tudo certo: seu horário das 15h continua garantido 💛' };

test('ficha: ALÔ DE ENCAIXE com a hora dela, o que foi mandado e o passo a passo', () => {
  const t = linhaEncaixe(OFERTA);
  assert.match(t, /^ALÔ DE ENCAIXE \(o salão chamou, ela não pediu\): hoje às 13:22 você mandou: «Oi, Ana! Abriu um horário/);
  assert.match(t, /continua sendo hoje às 15:00 \(data_hora_inicio = 2026-11-21T15:00\) e só muda se ELA quiser vir antes/);
  assert.match(t, /Quem diz a hora é ELA\. Nunca sugira hora, nunca calcule nem pergunte tempo de deslocamento/);
  assert.match(t, /confirme por extenso, numa pergunta só, e NÃO remarque ainda\. Ex\.: "Combinado: você vem hoje às 13h30 em vez das 15h, certo\?"/);
  assert.match(t, /Só depois do sim dela a essa pergunta: remarcar_agendamento com data_hora_inicio = 2026-11-21T15:00/);
  assert.match(t, /o horário das 15h continua garantido\. Não insista e não ofereça de novo/);
  assert.match(t, /não use consultar_horarios_livres para isso e não ofereça outros horários/);
  // meia hora: "15h30"
  assert.match(linhaEncaixe({ ...OFERTA, horario_original: '2026-11-21T19:30:00+00:00' }), /em vez das 15h30, certo\?/);
  assert.strictEqual(linhaEncaixe(null), '');
  assert.strictEqual(linhaEncaixe({ mensagem: 'x' }), '');
});

test('prompt da assistente: pergunta natural, só com o pode, uma cliente só, lê a pergunta do banco', () => {
  assert.match(REGRAS_PROMPT, /\$\('Encaixe: esperando resposta'\)/);
  assert.match(REGRAS_PROMPT, /Quer que eu veja com a Ana \(das 15h\) se ela consegue vir antes\?/);
  assert.match(REGRAS_PROMPT, /sem número, sem "responda sim ou não"/);
  assert.match(REGRAS_PROMPT, /NÃO chame ninguém/);
  assert.match(REGRAS_PROMPT, /nunca chame uma segunda cliente/);
  assert.match(REGRAS_PROMPT, /desfazer = sim \(ninguém recebe mensagem\)/);
  assert.doesNotMatch(REGRAS_PROMPT, /\b(digite|op[çc][ãa]o \d|pedido n[ºo°])/i);
});

// ================= a conta da agenda (sem Luxon) =================
test('encaixeNaAgenda: só é encaixe para o horário dela, no mesmo dia, antes do horário dela e dentro da vaga', () => {
  const ms = (h) => Date.parse('2026-11-21T' + h + ':00-04:00');
  const sinal = JSON.stringify({ encaixe: true, ag: 'ag-ana', de: '2026-11-21T17:00:00+00:00', ate: '2026-11-21T19:00:00+00:00' }); // vaga 13h, horário dela 15h
  const r = (novo, agora, s = sinal, ag = 'ag-ana', ini = ms('15:00')) => encaixeNaAgenda(s, ag, ini, ms(novo), ms(agora));
  assert.deepStrictEqual(r('13:30', '13:25'), { encaixe: true, passou: false }, 'em cima da hora vale');
  assert.deepStrictEqual(r('13:30', '13:40'), { encaixe: true, passou: false }, 'ela levou 10 min para dizer o sim');
  assert.deepStrictEqual(r('13:30', '13:50'), { encaixe: true, passou: true }, '20 min atrás já passou');
  assert.deepStrictEqual(r('15:00', '13:25'), { encaixe: false }, 'a mesma hora dela não é encaixe');
  assert.deepStrictEqual(r('16:00', '13:25'), { encaixe: false }, 'depois do horário dela é remarcação comum');
  assert.deepStrictEqual(r('12:30', '12:00'), { encaixe: false }, 'antes da vaga não é encaixe');
  assert.deepStrictEqual(r('13:00', '12:50'), { encaixe: true, passou: false }, 'no começo da vaga vale');
  assert.deepStrictEqual(r('13:30', '13:25', sinal, 'ag-outra'), { encaixe: false }, 'outro horário dela');
  assert.deepStrictEqual(r('13:30', '13:25', sinal, 'ag-ana', ms('16:00')), { encaixe: false }, 'o horário dela mudou depois da oferta');
  assert.deepStrictEqual(r('13:30', '13:25', ''), { encaixe: false });
  assert.deepStrictEqual(r('13:30', '13:25', 'cliente quer selagem'), { encaixe: false }, 'motivo comum não é sinal');
  assert.deepStrictEqual(r('13:30', '13:25', JSON.stringify({ encaixe: 'sim', ag: 'ag-ana', de: 'x', ate: 'y' })), { encaixe: false });
  // outro dia, mesma hora
  assert.deepStrictEqual(encaixeNaAgenda(sinal, 'ag-ana', ms('15:00'), Date.parse('2026-11-20T13:30:00-04:00'), ms('13:25')), { encaixe: false });
});

// ================= montagem =================
test('montagem: ferramenta nova, pergunta pendente antes do agente, ficha, rotina de vagas e funções do banco', () => {
  const t = no(assistente, 'chamar_para_encaixe');
  assert.strictEqual(t.parameters.workflowInputs.value.acao, 'chamar_para_encaixe');
  assert.deepStrictEqual(Object.keys(t.parameters.workflowInputs.value).sort(), ['acao', 'agendamento_id', 'busca', 'cliente_nome', 'desfazer', 'pedido_por', 'pode_forcar']);
  // o "turno" (a mensagem da Gleide) vai nas três ferramentas: o banco recusa chamar na mesma mensagem em que a pergunta nasceu
  for (const f of ['chamar_para_encaixe', 'liberar_horario', 'status_atendimento']) assert.strictEqual(no(assistente, f).parameters.workflowInputs.value.busca, "={{ $('Extrair dados').first().json.msgId }}", f);
  assert.match(t.parameters.description, /Use SÓ depois que a Gleide responder que pode/);
  assert.strictEqual(assistente.connections.chamar_para_encaixe.ai_tool[0][0].node, 'Agente assistente');
  assert.notStrictEqual(t.id, no(assistente, 'liberar_horario').id);
  const c = caminho(assistente, 'Ler pendências');
  assert.deepStrictEqual(c.slice(0, 3), ['Ler pendências', 'Encaixe: esperando resposta', 'Conferência: esperando resposta']);
  assert.ok(c.includes('Agente assistente'));
  assert.match(no(assistente, 'Encaixe: esperando resposta').parameters.url, /rpc\/n8n_encaixe_pendente_texto$/);
  assert.strictEqual(no(assistente, 'Encaixe: esperando resposta').onError, 'continueRegularOutput', 'banco fora não trava a assistente');

  const p = no(assistente, 'Agente assistente').parameters.options.systemMessage;
  assert.ok(p.includes('ENCAIXE NA FALTA (ver com a próxima cliente do dia'));
  assert.ok(!p.includes('Nunca ofereça procurar cliente para adiantar um horário vago: você não tem como fazer isso.'), 'a regra antiga contradizia o encaixe');
  assert.ok(!p.includes('o que a ferramenta respondeu sobre a vaga'));
  assert.ok(!no(assistente, 'liberar_horario').parameters.description.includes('oferece o resto do horário'), 'a ferramenta não promete mais oferecer sozinha');
  assert.match(no(assistente, 'liberar_horario').parameters.description, /ninguém é chamado sem ela autorizar/);
  const conf = no(assistente, 'Conferir resposta').parameters.jsCode;
  assert.match(conf, /const ENVIO = \["chamar_cliente","avisar_cliente","chamar_para_encaixe"\], ESCRITA = \["chamar_para_encaixe",/);

  // atendimento
  const antes = Object.keys(principal.connections).filter((k) => (principal.connections[k].main || []).some((s) => (s || []).some((x) => x.node === 'Sobre esta cliente')));
  assert.deepStrictEqual(antes, ['Encaixe: oferta aberta']);
  const of = no(principal, 'Encaixe: oferta aberta');
  assert.match(of.parameters.url, /rpc\/n8n_encaixe_da_cliente$/);
  assert.strictEqual(of.onError, 'continueRegularOutput');
  assert.strictEqual(of.alwaysOutputData, true);
  for (const f of ['remarcar_agendamento', 'consultar_horarios_livres']) assert.match(no(principal, f).parameters.workflowInputs.value.motivo, /json\.encaixe/);
  assert.ok(!('motivo' in no(principal, 'cancelar_agendamento').parameters.workflowInputs.value) || !/encaixe/.test(no(principal, 'cancelar_agendamento').parameters.workflowInputs.value.motivo));
  assert.match(no(principal, 'Portão: conferir').parameters.jsCode, /encaixe: pega\(\(\) => \$\('Sobre esta cliente'\)\.first\(\)\.json\.encaixe\)/);

  // a rotina de vagas não oferece mais a vaga de falta sozinha
  assert.match(no(faltas, 'Vagas para oferecer').parameters.url, /rpc\/n8n_vagas_para_oferecer_v2$/);
  // o resto das pendências não mudou
  assert.ok(!pendencias.nodes.some((n) => /encaixe/i.test(n.name)));
  // ids dos nós continuam únicos em cada workflow
  for (const w of [principal, agenda, assistente, ferramentas, faltas]) assert.strictEqual(new Set(w.nodes.map((n) => n.id)).size, w.nodes.length, 'id repetido em ' + w.name);
});

test('montagem: não monta duas vezes e para se o código de origem mudar', () => {
  const copia = () => JSON.parse(JSON.stringify({ workflow: principal, agendaWorkflow: agenda, assistenteWorkflow: assistente, ferramentasWorkflow: ferramentas, faltasWorkflow: faltas }));
  assert.throws(() => encaixe(copia()), /já montado/);
  const semTool = copia();
  semTool.assistenteWorkflow.nodes = semTool.assistenteWorkflow.nodes.filter((n) => n.name !== 'chamar_para_encaixe');
  assert.throws(() => encaixe(semTool), /encaixe: .* mudou/, 'o Montar chamada já foi trocado: o gerador para em vez de montar pela metade');
});

// ================= Assistente - Ferramentas =================
const chamada = (e) => new Function('$input', '$env', no(ferramentas, 'Montar chamada').parameters.jsCode)({ first: () => ({ json: { pedido_por: '5500000000001', ...e } }) }, {})[0].json;
const AG = '11111111-2222-4333-8444-555555555555';

test('Montar chamada: a falta passa pelas funções do encaixe; o resto continua igual', () => {
  const l = chamada({ acao: 'liberar_horario', agendamento_id: AG, cliente_nome: 'Maria' });
  assert.strictEqual(l.funcao, 'n8n_assistente_liberar_horario_encaixe');
  assert.deepStrictEqual({ ...l.args, p_empresa_id: 0 }, { p_empresa_id: 0, p_pedido_por: '5500000000001', p_agendamento_id: AG, p_turno: null });
  assert.strictEqual(chamada({ acao: 'liberar_horario', agendamento_id: AG, cliente_nome: 'Maria', busca: 'MSG1' }).args.p_turno, 'MSG1');
  assert.strictEqual(chamada({ acao: 'chamar_para_encaixe', agendamento_id: AG, cliente_nome: 'Ana', busca: 'MSG2' }).args.p_turno, 'MSG2');
  assert.strictEqual(l.enviar, false);
  const s = chamada({ acao: 'status_atendimento', agendamento_id: AG, cliente_nome: 'Maria', status: 'faltou' });
  assert.strictEqual(s.funcao, 'n8n_assistente_status_agendamento_encaixe');
  assert.deepStrictEqual({ ...s.args, p_empresa_id: 0 }, { p_empresa_id: 0, p_pedido_por: '5500000000001', p_agendamento_id: AG, p_status: 'faltou', p_valor: null, p_turno: null });
  assert.strictEqual(chamada({ acao: 'concluir', agendamento_id: AG, cliente_nome: 'Maria' }).funcao, 'n8n_assistente_concluir');
  assert.strictEqual(chamada({ acao: 'avisar_cliente', agendamento_id: AG, cliente_nome: 'Maria', tipo: 'aviso', texto: 'oi' }).enviar, true);
});

test('Montar chamada: chamar_para_encaixe manda só quando autorizou; "não" só com sim exato em desfazer', () => {
  const ok = chamada({ acao: 'chamar_para_encaixe', agendamento_id: AG, cliente_nome: 'Ana' });
  assert.strictEqual(ok.funcao, 'n8n_assistente_chamar_para_encaixe');
  assert.strictEqual(ok.enviar, true);
  assert.deepStrictEqual({ ...ok.args, p_empresa_id: 0 }, { p_empresa_id: 0, p_pedido_por: '5500000000001', p_agendamento_id: AG, p_nome: 'Ana', p_recusou: false, p_turno: null });
  assert.strictEqual(ok.conferir.p_nome, 'Ana', 'o nome é conferido com o dono do horário antes de executar');
  assert.strictEqual(ok.conferir.p_agendamento_id, AG);
  const nao = chamada({ acao: 'chamar_para_encaixe', agendamento_id: AG, cliente_nome: 'Ana', desfazer: 'Sim' });
  assert.strictEqual(nao.enviar, false, 'ela disse que não: nada é enviado');
  assert.strictEqual(nao.args.p_recusou, true);
  for (const d of ['', 'vazio', 'sem alteração', 'senão vazio', 'não', 'ela autorizou', 'sim, pode chamar']) {
    const r = chamada({ acao: 'chamar_para_encaixe', agendamento_id: AG, cliente_nome: 'Ana', desfazer: d });
    assert.strictEqual(r.args.p_recusou, false, 'desfazer = "' + d + '"');
    assert.strictEqual(r.enviar, true);
  }
  // id que não é uuid (a IA inventou ou deixou vazio): vai sem id, e o banco usa a pergunta pendente e confere o nome
  assert.strictEqual(chamada({ acao: 'chamar_para_encaixe', agendamento_id: 'ana-15h', cliente_nome: 'Ana' }).args.p_agendamento_id, null);
  assert.strictEqual(chamada({ acao: 'chamar_para_encaixe', cliente_nome: 'Ana' }).args.p_agendamento_id, null);
});

test('Registrar na conversa: só a mensagem do encaixe marca o encaixe como oferecido', () => {
  const url = no(ferramentas, 'Registrar na conversa').parameters.url;
  const expr = url.match(/rpc\/\{\{ (.+) \}\}$/)[1];
  const f = (funcao) => new Function('$', 'return ' + expr)(dolar({ 'Montar chamada': [{ funcao }] }));
  assert.strictEqual(f('n8n_assistente_chamar_para_encaixe'), 'n8n_encaixe_registrar_saida');
  assert.strictEqual(f('n8n_assistente_avisar_cliente'), 'n8n_registrar_saida');
  assert.strictEqual(f('n8n_assistente_chamar_cliente'), 'n8n_registrar_saida');
});

// ================= Assistente: o que ela diz à Gleide =================
const conferirResposta = (output, passos, feitos = []) => new Function('$', no(assistente, 'Conferir resposta').parameters.jsCode)(dolar({
  'Agente assistente': [{ output, intermediateSteps: passos.map(([tool, toolInput, observation]) => ({ action: { tool, toolInput }, observation })) }],
  'Contexto': [{ lista: feitos }],
}))[0].json;

test('Conferir resposta: a pergunta do encaixe sai inteira depois da falta gravada', () => {
  const fala = 'Anotei a falta da Maria ✅ A IA chama ela pra remarcar. Quer que eu veja com a Ana (das 15h) se ela consegue vir antes?';
  const r = conferirResposta(fala, [['liberar_horario', { agendamento_id: AG, cliente_nome: 'Maria' }, 'OK: {"status":"faltou","encaixe":{"perguntar":true}}']]);
  assert.strictEqual(r.texto, fala);
  assert.strictEqual(r.corrigida, false);
});

test('Conferir resposta: "Mandei pra Ana" só passa se a mensagem do encaixe saiu de verdade', () => {
  const fala = 'Mandei pra Ana ✅ Se ela conseguir vir antes, você recebe o aviso do horário novo; se não, fica tudo como está.';
  const ok = conferirResposta(fala, [['chamar_para_encaixe', { agendamento_id: AG, cliente_nome: 'Ana' }, 'OK: mensagem enviada para a cliente (tel. 5566900000000): Oi, Ana!']]);
  assert.strictEqual(ok.texto, fala, 'a frase do aviso não é cortada como promessa');
  assert.strictEqual(ok.corrigida, false);
  assert.ok(JSON.parse(ok.feitos).some((f) => f.t === 'chamar_para_encaixe'), 'entra no registro do que já foi feito');
  const semFerramenta = conferirResposta(fala, []);
  assert.strictEqual(semFerramenta.corrigida, true);
  assert.match(semFerramenta.texto, /Ainda não mandei nada/);
  const erro = conferirResposta(fala, [['chamar_para_encaixe', { cliente_nome: 'Ana' }, 'ERRO: não tem pergunta de encaixe esperando a resposta dela agora']]);
  assert.strictEqual(erro.corrigida, true, 'a ferramenta deu erro: não pode dizer que mandou');
});

test('Conferir resposta: a pergunta que a ferramenta devolveu chega à Gleide mesmo se a IA esquecer', () => {
  const obs = 'OK: ' + JSON.stringify({ status: 'faltou', encaixe: { perguntar: true, cliente: 'Ana', pergunta: 'Quer que eu veja com a Ana (das 15h) se ela consegue vir antes?' } });
  const r = conferirResposta('Anotei a falta da Maria ✅ A IA chama ela pra remarcar.', [['status_atendimento', { agendamento_id: AG, status: 'faltou' }, obs]]);
  assert.strictEqual(r.texto, 'Anotei a falta da Maria ✅ A IA chama ela pra remarcar.\nQuer que eu veja com a Ana (das 15h) se ela consegue vir antes?');
  // resposta embrulhada ({"resposta": "OK: …"}) também
  const emb = conferirResposta('Anotei ✅', [['liberar_horario', { agendamento_id: AG }, JSON.stringify([{ resposta: obs }])]]);
  assert.match(emb.texto, /Quer que eu veja com a Ana \(das 15h\) se ela consegue vir antes\?$/);
  // sem pergunta (perguntar = false): nada entra
  const sem = conferirResposta('Anotei a falta ✅', [['liberar_horario', { agendamento_id: AG }, 'OK: {"status":"faltou","encaixe":{"perguntar":false,"motivo":"x"}}']]);
  assert.strictEqual(sem.texto, 'Anotei a falta ✅');
});

test('Conferir resposta: o "não" da Gleide não conta como mensagem enviada', () => {
  const r = conferirResposta('Mandei pra Ana ✅', [['chamar_para_encaixe', { cliente_nome: 'Ana', desfazer: 'sim' }, 'OK: {"nota": "a Gleide não quis", "chamou": false}']]);
  assert.strictEqual(r.corrigida, true);
});

test('ficha: a cliente que faltou apareceu (vaga fechada): a IA não confirma hora nem remarca', () => {
  const t = linhaEncaixe({ ...OFERTA, vaga_aberta: false });
  assert.match(t, /^ALÔ DE ENCAIXE/);
  assert.match(t, /NÃO está mais livre/);
  assert.match(t, /hoje às 15:00, continua garantido/);
  assert.match(t, /NÃO use remarcar_agendamento para adiantar/);
  assert.doesNotMatch(t, /Só depois do sim dela/);
  assert.match(linhaEncaixe({ ...OFERTA, vaga_aberta: true }), /Só depois do sim dela/);
});

// ================= Atendimento: a ficha (Luxon) =================
const sobre = (dados) => new Function('$', 'DateTime', no(principal, 'Sobre esta cliente').parameters.jsCode)(dolar(dados), luxon.DateTime)[0].json;
const hoje = (min) => new Date(Date.now() + min * 60000).toISOString();
const fichaBase = (extra = {}) => ({
  'Supabase: ficha da cliente': [{ id: 'cli-ana', nome: 'Ana Paula', status: 'em_dia', criado_em: '2026-01-10T12:00:00Z', ultima_visita: '2026-09-20', total_visitas: 3 }],
  'Supabase: histórico da cliente': [{ inicio: hoje(90), status: 'agendado', servicos: { nome: 'Manutenção – mão de obra' } }],
  'Montar entrada': [{ mensagens: '[]' }],
  'Supabase: conversa antiga': [],
  'Supabase: último alô': [{}],
  'Supabase: últimas mensagens': [],
  'Encaixe: oferta aberta': [{ data: 'null' }],
  ...extra,
});

test('Sobre esta cliente: com oferta aberta, a ficha traz o ALÔ DE ENCAIXE (e não o ALÔ DE VAGA) e o sinal', { skip: semLuxon }, () => {
  const oferta = { ...OFERTA, horario_original: hoje(90), janela_inicio: hoje(-30), enviado_em: hoje(-5) };
  const r = sobre(fichaBase({
    'Encaixe: oferta aberta': [{ data: JSON.stringify(oferta) }],
    // o contato da oferta é do tipo vaga: sem o encaixe apareceria como ALÔ DE VAGA
    'Supabase: último alô': [{ tipo: 'vaga', canal: 'ia', mensagem: oferta.mensagem, criado_em: hoje(-5), resultado: 'respondeu', horario_original: oferta.horario_original, vagas: { inicio: hoje(10), status: 'expirada', motivo: 'atraso', agendamentos: { status: 'faltou' } } }],
    'Supabase: últimas mensagens': [
      { direcao: 'entrada', conteudo: 'consigo chegar umas 13h30', criado_em: hoje(-1) },
      { direcao: 'saida', conteudo: oferta.mensagem, criado_em: hoje(-5) },
      { direcao: 'entrada', conteudo: 'bom dia, meu horário é hoje né', criado_em: hoje(-200) },
    ],
  }));
  assert.match(r.texto, /ALÔ DE ENCAIXE \(o salão chamou, ela não pediu\)/);
  assert.doesNotMatch(r.texto, /ALÔ DE VAGA/);
  assert.match(r.texto, /Quem diz a hora é ELA/);
  assert.deepStrictEqual({ ...r.encaixe, falas: 0 }, { aberto: true, ag: 'ag-ana', de: oferta.janela_inicio, ate: oferta.horario_original, falas: 0 });
  assert.strictEqual(r.encaixe.falas, 'consigo chegar umas 13h30', 'só o que ela escreveu depois da oferta');
  // o que a ferramenta remarcar_agendamento leva para a agenda
  const expr = no(principal, 'remarcar_agendamento').parameters.workflowInputs.value.motivo.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
  const sinal = new Function('$', 'return ' + expr)(dolar({ 'Sobre esta cliente': [r] }));
  assert.deepStrictEqual(JSON.parse(sinal), { encaixe: true, ag: 'ag-ana', de: oferta.janela_inicio, ate: oferta.horario_original });
});

test('Sobre esta cliente: sem oferta (ou com o banco fora) a ficha é a de sempre', { skip: semLuxon }, () => {
  const vaga = { tipo: 'vaga', canal: 'ia', mensagem: 'Oi! Abriu um horário', criado_em: hoje(-5), resultado: 'pendente', horario_original: hoje(90), vagas: { inicio: hoje(200), status: 'aberta', motivo: 'cancelado', agendamentos: { status: 'cancelado' } } };
  for (const dado of [[{ data: 'null' }], [{ data: '' }], [{}], [{ error: { message: 'timeout' } }], [{ data: '{"mensagem":"sem id"}' }], new Error('nó não rodou')]) {
    const r = sobre(fichaBase({ 'Encaixe: oferta aberta': dado, 'Supabase: último alô': [vaga] }));
    assert.doesNotMatch(r.texto, /ENCAIXE/);
    assert.match(r.texto, /ALÔ DE VAGA/, 'a oferta de vaga comum continua aparecendo');
    assert.strictEqual(r.encaixe, null);
    const expr = no(principal, 'remarcar_agendamento').parameters.workflowInputs.value.motivo.replace(/^=\{\{\s*/, '').replace(/\s*\}\}$/, '');
    assert.strictEqual(new Function('$', 'return ' + expr)(dolar({ 'Sobre esta cliente': [r] })), '');
  }
  // cliente sem ficha: não quebra e não tem sinal
  const nova = sobre(fichaBase({ 'Supabase: ficha da cliente': [{}], 'Supabase: histórico da cliente': [] }));
  assert.strictEqual(nova.encaixe, null);
});

// ================= Agenda: remarcar e consultar (Luxon) =================
// salão aberto o dia todo e sem almoço, para o teste não depender da hora em que roda
const CONFIG = { config: { horario_funcionamento: { dom: '00:00-23:59', seg: '00:00-23:59', ter: '00:00-23:59', qua: '00:00-23:59', qui: '00:00-23:59', sex: '00:00-23:59', sab: '00:00-23:59' }, almoco: null } };
const local = (min) => luxon.DateTime.now().setZone('America/Cuiaba').plus({ minutes: min }).startOf('minute');
const isoLocal = (d) => d.toFormat("yyyy-LL-dd'T'HH:mm");
const rodarAgenda = (entrada, { ocupados = [], dela = [], config = CONFIG } = {}) => {
  const D = luxon.DateTime;
  const prep = new Function('$input', 'DateTime', no(agenda, 'Preparar').parameters.jsCode)({ first: () => ({ json: entrada }) }, D)[0].json;
  return new Function('$', 'DateTime', no(agenda, 'Calcular').parameters.jsCode)(dolar({
    'Preparar': [prep], 'Supabase: config do salão': [config], 'Supabase: horários ocupados': ocupados, 'Supabase: agendamentos da cliente': dela,
  }), D)[0].json;
};
// a Maria faltou (de -20 a +100 min), a Ana tem horário daqui a 60 min (60 min de serviço)
const cenario = () => {
  const ana = local(60), falta = local(-20);
  const dela = [{ id: 'ag-ana', inicio: ana.toISO(), fim: ana.plus({ minutes: 60 }).toISO(), observacoes: null, servicos: { nome: 'Manutenção' } }];
  const ocupados = [{ inicio: falta.toISO(), fim: falta.plus({ minutes: 120 }).toISO(), status: 'faltou' }, { inicio: ana.toISO(), fim: ana.plus({ minutes: 60 }).toISO(), status: 'agendado' }];
  const sinal = JSON.stringify({ encaixe: true, ag: 'ag-ana', de: falta.toUTC().toISO(), ate: ana.toUTC().toISO() });
  return { ana, falta, dela, ocupados, sinal };
};
const foraDeHora = () => { if (!luxon) return semLuxon; const h = luxon.DateTime.now().setZone('America/Cuiaba').hour; return h < 2 || h >= 20 ? 'cenário usa a hora de agora: rodar entre 02h e 20h de Cuiabá' : false; };
const remarcar = (c, min, motivo) => rodarAgenda({ acao: 'remarcar', telefone: '5566900000000', data_hora_inicio: isoLocal(c.ana), data_hora_nova: isoLocal(local(min)), motivo }, c);

test('agenda: com o encaixe, a hora que ela disse vale em cima da hora; sem o encaixe continua pedindo 30 min', { skip: foraDeHora() }, () => {
  const c = cenario();
  const com = remarcar(c, 20, c.sinal);
  assert.strictEqual(com.ok, true, JSON.stringify(com));
  assert.strictEqual(com.acao, 'remarcar');
  assert.strictEqual(com.agendamentoId, 'ag-ana');
  assert.strictEqual(+luxon.DateTime.fromISO(com.patch.start.dateTime), +local(20));
  assert.strictEqual(+luxon.DateTime.fromISO(com.patch.end.dateTime), +local(80), 'mesma duração');
  assert.match(com.observacoes, /Reagendado de \d\d\/\d\d às \d\d:\d\d/);
  const sem = remarcar(c, 20, '');
  assert.strictEqual(sem.ok, false);
  assert.match(sem.resposta, /muito em cima da hora/);
});

test('agenda: o horário de quem faltou não trava o encaixe; ela pode dizer o sim uns minutos depois', { skip: foraDeHora() }, () => {
  const c = cenario();
  assert.strictEqual(remarcar(c, 5, c.sinal).ok, true, 'cai dentro do horário que faltou');
  assert.strictEqual(remarcar(c, -5, c.sinal).ok, true, '5 min atrás: ela demorou para confirmar');
  const passou = remarcar(c, -18, c.sinal);
  assert.strictEqual(passou.ok, false);
  assert.match(passou.resposta, /^NÃO REMARCADO: essa hora já passou\..*CONTINUA GARANTIDO/);
});

test('agenda: encaixe que não cabe NÃO remarca e diz que o horário dela continua garantido', { skip: foraDeHora() }, () => {
  const c = cenario();
  // outra cliente (encaixe da própria Gleide) ocupando daqui a 10 até 40 min
  const outra = { inicio: local(10).toISO(), fim: local(40).toISO(), status: 'agendado' };
  const r = remarcar({ ...c, ocupados: [...c.ocupados, outra] }, 20, c.sinal);
  assert.strictEqual(r.ok, false);
  assert.match(r.resposta, /^NÃO REMARCADO: nessa hora a agenda ainda está ocupada\..*CONTINUA GARANTIDO.*Não ofereça outros horários/);
  // almoço cobrindo a hora que ela disse
  const almoco = { config: { ...CONFIG.config, almoco: { inicio: local(-60).toFormat('HH:mm'), fim: local(40).toFormat('HH:mm') } } };
  const a = remarcar({ ...c, config: almoco }, 20, c.sinal);
  assert.strictEqual(a.ok, false);
  assert.match(a.resposta, /^NÃO REMARCADO: nessa hora o serviço dela não cabe \(almoço ou fechamento do salão\)\..*CONTINUA GARANTIDO/);
});

test('agenda: fora do encaixe valem as regras de sempre', { skip: foraDeHora() }, () => {
  const c = cenario();
  // sinal de outro horário dela
  const outro = JSON.stringify({ ...JSON.parse(c.sinal), ag: 'ag-outro' });
  assert.match(remarcar(c, 20, outro).resposta, /muito em cima da hora/);
  // depois do horário dela (remarcação comum, com 30 min ou mais): remarca pelas regras normais
  const depois = remarcar(c, 150, c.sinal);
  assert.strictEqual(depois.ok, true);
  // antes do começo da vaga: não é encaixe
  const tarde = { ...c, sinal: JSON.stringify({ ...JSON.parse(c.sinal), de: local(25).toUTC().toISO() }) };
  assert.match(remarcar(tarde, 20, tarde.sinal).resposta, /muito em cima da hora/);
  // texto comum no motivo (não é o sinal)
  assert.match(remarcar(c, 20, 'cliente pediu para vir antes').resposta, /muito em cima da hora/);
});

test('agenda: consultar a hora do encaixe não responde "em cima da hora"; sem o encaixe, responde como sempre', { skip: foraDeHora() }, () => {
  const c = cenario();
  const consultar = (min, motivo) => rodarAgenda({ acao: 'consultar', data: isoLocal(local(min)), duracao_minutos: 60, periodo: 'qualquer', motivo }, c);
  const com = consultar(20, c.sinal);
  assert.match(com.resposta, /^ENCAIXE: essa hora é do encaixe que o salão ofereceu a ela, não precisa consultar/);
  assert.match(com.resposta, /só com o sim, use remarcar_agendamento/);
  assert.match(consultar(20, '').resposta, /^INDISPONÍVEL: .*muito em cima da hora/);
  // hora fora da vaga (depois do horário dela): consulta normal
  assert.doesNotMatch(consultar(200, c.sinal).resposta, /^ENCAIXE/);
});

// ================= portão (modo observar) =================
const tipos = (r) => r.acoes.flatMap((x) => x.falhas.map((f) => f.tipo)).sort();
const ass = (fala, ...passos) => conferirAcoes({ agente: 'assistente', fala, passos });
const chamar = (extra = {}, resultado = 'OK: mensagem enviada para a cliente (tel. 5566900000000): Oi, Ana!') => ({ ferramenta: 'chamar_para_encaixe', entrada: { agendamento_id: AG, cliente_nome: 'Ana', ...extra }, resultado });
const falta = { ferramenta: 'liberar_horario', entrada: { agendamento_id: AG, cliente_nome: 'Maria' }, resultado: 'OK: {"status":"faltou","encaixe":{"perguntar":true}}' };

test('portão: chamar para encaixe com a Gleide autorizando na fala não dá alarme', () => {
  for (const f of ['👍', 'fechado', 'certo', 'perfeito', 'pode', 'Pode sim', 'sim', 'chama ela', 'vê sim', 'manda', 'isso', 'pode ver com ela', 'tenta aí', 'ok', 'claro, chama',
    '[áudio] pode chamar a Ana sim', 'a maria não veio, vê se a próxima consegue vir antes', 'a maria nao veio pode ver com a ana se ela vem antes',
    'ela não veio não, mas pode chamar a ana']) assert.deepStrictEqual(tipos(ass(f, chamar())), [], f);
});

test('portão: chamar para encaixe sem autorização (ou com "não") dá alarme', () => {
  for (const f of ['a maria não veio', 'a das 13h faltou', 'não', 'não precisa', 'deixa quieto', 'melhor não', 'pode não', 'não pode', 'agora não', 'quem vem depois?', 'obrigada', 'isso não'])
    assert.deepStrictEqual(tipos(ass(f, chamar())), ['encaixe_sem_autorizacao'], f);
  // falta e chamada na mesma vez, sem a Gleide pedir: a falta está certa, o encaixe não
  assert.deepStrictEqual(tipos(ass('a maria não veio', falta, chamar())), ['encaixe_sem_autorizacao']);
});

test('portão: o "não" da Gleide gravado certo não dá alarme; "pode" gravado como não, dá', () => {
  for (const f of ['não precisa', 'deixa quieto', 'melhor não', 'não']) assert.deepStrictEqual(tipos(ass(f, chamar({ desfazer: 'sim' }, 'OK: {"chamou":false}'))), [], f);
  assert.deepStrictEqual(tipos(ass('pode sim', chamar({ desfazer: 'sim' }, 'OK: {"chamou":false}'))), ['encaixe_recusado_sem_prova']);
});

test('portão: a ferramenta deu erro (ninguém foi chamado): nada a apontar', () => {
  assert.deepStrictEqual(ass('a maria não veio', chamar({}, 'ERRO: não tem pergunta de encaixe esperando a resposta dela agora')).acoes, []);
  assert.deepStrictEqual(ass('a maria não veio', chamar({}, JSON.stringify([{ resposta: 'ERRO: não dá mais para chamar Ana' }]))).acoes, []);
});

// atendimento: a oferta foi para as 15h, a vaga começou às 13h
const ENC = { aberto: true, ag: 'ag-ana', de: '2026-11-21T17:00:00+00:00', ate: '2026-11-21T19:00:00+00:00', falas: 'consigo chegar umas 13h30' };
const ate = (fala, nova, encaixe = ENC, resultado = 'REMARCADO com sucesso: o agendamento saiu de sábado, 21/11 às 15:00 para sábado, 21/11 às 13:30') =>
  conferirAcoes({ agente: 'atendimento', fala, ficha: 'ALÔ DE ENCAIXE', encaixe, passos: [{ ferramenta: 'remarcar_agendamento', entrada: { data_hora_inicio: '2026-11-21T15:00', data_hora_nova: nova }, resultado }] });

test('portão: adiantar o horário depois de ela dizer a hora e responder sim não dá alarme', () => {
  for (const f of ['sim', 'Isso', 'pode', 'combinado', 'Combinado!', 'certinho', 'tá bom', 'isso mesmo', '👍', 'perfeito']) assert.deepStrictEqual(tipos(ate(f, '2026-11-21T13:30')), [], f);
  // disse a hora de vários jeitos
  for (const falas of ['consigo 13:30', 'chego 1 e meia', 'umas 13h30 eu tô aí', 'posso ir 13 e 30']) assert.deepStrictEqual(tipos(ate('sim', '2026-11-21T13:30', { ...ENC, falas })), [], falas);
  // disse em tempo: "daqui 40 min"
  assert.deepStrictEqual(tipos(ate('sim', '2026-11-21T14:10', { ...ENC, falas: 'consigo daqui uns 40 min' })), []);
});

test('portão: adiantar sem o sim, ou para uma hora que ela não disse, dá alarme', () => {
  assert.deepStrictEqual(tipos(ate('consigo chegar umas 13h30', '2026-11-21T13:30')), ['encaixe_sem_confirmacao'], 'remarcou na mesma hora em que ela disse a hora');
  assert.deepStrictEqual(tipos(ate('sim', '2026-11-21T14:00')), ['encaixe_hora_sem_prova'], 'ela disse 13h30 e a IA marcou 14h');
  assert.deepStrictEqual(tipos(ate('consigo sim', '2026-11-21T13:00', { ...ENC, falas: '' })), ['encaixe_hora_sem_prova'], 'ela não disse hora nenhuma');
  assert.deepStrictEqual(tipos(ate('não vou conseguir', '2026-11-21T13:30')), ['encaixe_sem_confirmacao']);
  assert.deepStrictEqual(tipos(ate('que horas?', '2026-11-21T13:30', { ...ENC, falas: '' })), ['encaixe_hora_sem_prova', 'encaixe_sem_confirmacao']);
});

test('portão: remarcação que não é o encaixe, ou que a agenda recusou, não entra na regra', () => {
  assert.deepStrictEqual(tipos(ate('quero mudar pra terça às 10h', '2026-11-24T10:00')), [], 'outro dia, depois do horário dela');
  assert.deepStrictEqual(tipos(ate('pode ser 16h?', '2026-11-21T16:00')), [], 'mais tarde no mesmo dia');
  assert.deepStrictEqual(tipos(ate('quero ir 12h', '2026-11-21T12:00')), [], 'antes da vaga');
  assert.deepStrictEqual(ate('consigo 13h30', '2026-11-21T13:30', ENC, 'NÃO REMARCADO: nessa hora a agenda ainda está ocupada.').acoes, [], 'não gravou');
  // sem oferta aberta, a regra não existe
  assert.deepStrictEqual(tipos(ate('consigo 13h30', '2026-11-21T13:30', null)), []);
  assert.deepStrictEqual(tipos(conferirAcoes({ agente: 'atendimento', fala: 'consigo 13h30', passos: [{ ferramenta: 'remarcar_agendamento', entrada: { data_hora_nova: '2026-11-21T13:30' }, resultado: 'REMARCADO com sucesso' }] })), []);
});

test('portão: o resumo das 20h tem nome para os alarmes do encaixe', () => {
  for (const [tipo, re] of [['encaixe_sem_autorizacao', /chamou a cliente para vir antes sem a Gleide autorizar/], ['encaixe_recusado_sem_prova', /a fala parece autorizar/],
    ['encaixe_sem_confirmacao', /adiantou o horário sem o sim da cliente/], ['encaixe_hora_sem_prova', /hora que a cliente não disse/]]) {
    const t = montarResumo([{ agente: 'assistente', n_falhas: 1, fala: 'x', criado_em: '2026-11-21T17:00:00Z', acoes: [{ ferramenta: 'chamar_para_encaixe', falhas: [{ tipo }] }] }], '21/11');
    assert.match(t, re);
  }
});

test('portão: as regras antigas continuam valendo para as outras ferramentas', () => {
  assert.deepStrictEqual(tipos(ass('a maria não veio', falta)), []);
  assert.deepStrictEqual(tipos(ass('pode', { ferramenta: 'avisar_cliente', entrada: { agendamento_id: AG }, resultado: 'OK: mensagem enviada' })), []);
  assert.deepStrictEqual(tipos(ass('tudo certo', { ferramenta: 'avisar_cliente', entrada: { agendamento_id: AG }, resultado: 'OK: mensagem enviada' })), ['envio_sem_pedido']);
  assert.deepStrictEqual(tipos(ass('marca a ana amanhã às 15h', { ferramenta: 'marcar_horario', entrada: { servico: 'manutenção', inicio: '2026-11-22T15:00' }, resultado: 'OK: feito' })), []);
  assert.deepStrictEqual(tipos(ass('marca a ana amanhã', { ferramenta: 'marcar_horario', entrada: { servico: 'manutenção', inicio: '2026-11-22T15:00' }, resultado: 'OK: feito' })), ['hora_sem_prova']);
});
