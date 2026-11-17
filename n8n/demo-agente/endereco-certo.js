// A assistente da dona nunca manda à cliente um endereço ou link de mapa que não seja o do cadastro (lojas).
// 17/11/2026, Caroline: a dona pediu para a assistente mandar a localização a duas clientes. O prompt da assistente
// só dizia "o endereço está nos Dados do salão do app", sem o endereço, e ela INVENTOU: "Rua das Orquídeas, 123
// [Link do Mapa]" e depois "Rua das Primaveras, 3650" com um link de mapa que não existe. Uma cliente foi ao lugar errado.
// (A Gleide não passa por aqui: o endereço dela está escrito no prompt da assistente.)
//
// Duas travas:
// 1. Prompt: o endereço do cadastro (empresas.config.endereco, tela Dados do salão) entra no prompt a cada mensagem.
// 2. Código, antes de gravar ou enviar (chamar_cliente / avisar_cliente): se o texto tem rua/avenida que não é a do
//    cadastro, ou link de mapa que não é o do cadastro (config.loja.mapa), ou "[link…]" de enfeite, NÃO envia e
//    devolve à assistente o endereço certo para ela reescrever.

const CONFERIR = String.raw`
const m = $('Montar chamada').first().json;
let cfg = {}; try { cfg = $('Endereço: cadastro').first().json.config || {}; } catch (e) {}
const t = (v) => (typeof v === 'string' ? v.trim() : '');
const end = t(cfg.endereco), mapa = t((cfg.loja || {}).mapa);
const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ');
const txt = String((m.args && m.args.p_texto) || '');
let bloqueio = '';
if (m.enviar && txt) {
  const n = norm(txt);
  const rua = norm(end.split(',')[0] || '');            // "rua dos angicos"
  const numero = (end.match(/\d+/) || [''])[0];        // "690"
  const falaDeRua = /(^|[^a-z])(rua|r\.|avenida|av\.?|travessa|alameda|rodovia|estrada|pra[cç]a)\s+[a-z0-9]/.test(n);
  const ruaErrada = falaDeRua && (!rua || !n.includes(rua) || (numero && !n.includes(numero)));
  const links = txt.match(/(https?:\/\/|www\.)\S+|\S*(goo\.gl|maps\.|waze\.)\S*/gi) || [];
  const deMapa = (l) => /goo\.gl|maps|waze|localiza/i.test(l);
  const linkErrado = links.some((l) => deMapa(l) && (!mapa || !norm(mapa).includes(norm(l.replace(/[).,;!]+$/, '')).replace(/^https?:\/\//, ''))));
  const enfeite = /\[\s*(link|mapa|localiza)[^\]]*\]/i.test(txt);
  if (ruaErrada || linkErrado || enfeite) {
    bloqueio = 'NÃO ENVIADO (nada chegou à cliente): o texto tem ' + (ruaErrada ? 'um endereço que não é o do cadastro do salão' : 'um link de mapa que não existe no cadastro do salão') + '. ' +
      (end ? 'O ÚNICO endereço que vale é: ' + end + (mapa ? ' | mapa: ' + mapa : ' (não há link de mapa cadastrado: não mande link nenhum)') + '. Reescreva o texto com esse endereço, exatamente assim, e mande de novo agora.'
           : 'Não há endereço cadastrado no app: não mande endereço. Diga à dona que falta preencher o endereço em Dados do salão.');
  }
}
return [{ json: { ...m, bloqueio } }];
`;

module.exports = ({ node, main, ifNode, cond, assistenteWorkflow, ferramentasWorkflow }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('endereco-certo: não achei "' + nome + '"'); return n; };
  const consulta = (nome, modelo) => {
    const n = JSON.parse(JSON.stringify(modelo));
    delete n.id; n.name = nome; n.position = [modelo.position[0], modelo.position[1] + 260];
    n.parameters = { method: 'GET', url: '={{ $env.SUPABASE_URL }}/rest/v1/empresas?select=config&id=eq.{{ $env.EMPRESA_ID }}',
      sendHeaders: true, headerParameters: modelo.parameters.headerParameters, options: {} };
    n.onError = 'continueRegularOutput'; n.alwaysOutputData = true; n.executeOnce = true;
    return n;
  };

  // ---------- 1. o endereço do cadastro no prompt da assistente ----------
  const modeloSupa = achar(ferramentasWorkflow, 'Apagar contato não enviado');
  if (!/apikey/.test(JSON.stringify(modeloSupa.parameters.headerParameters))) throw new Error('endereco-certo: o nó modelo do Supabase mudou');
  assistenteWorkflow.nodes.push(consulta('Ler dados do salão', modeloSupa));
  if (assistenteWorkflow.connections['Ler feitos']?.main?.[0]?.[0]?.node !== 'Contexto') throw new Error('endereco-certo: a ordem antes do "Contexto" mudou');
  assistenteWorkflow.connections['Ler feitos'] = main('Ler dados do salão');
  assistenteWorkflow.connections['Ler dados do salão'] = main('Contexto');
  const prompt = achar(assistenteWorkflow, 'Agente assistente').parameters.options;
  const DE = 'Se perguntarem o endereço, ele está nos Dados do salão do app.';
  if (!prompt.systemMessage.includes(DE)) throw new Error('endereco-certo: a frase do endereço no prompt da assistente mudou');
  prompt.systemMessage = prompt.systemMessage.replace(DE, () =>
    "ENDEREÇO DO SALÃO (do cadastro, o único que vale): {{ (() => { let c = {}; try { c = $('Ler dados do salão').first().json.config || {}; } catch (e) {} const t = (v) => (typeof v === 'string' ? v.trim() : ''); const e = t(c.endereco), m = t((c.loja || {}).mapa); return e ? e + (m ? ' | mapa: ' + m : ' | link de mapa: não cadastrado') : 'NÃO CADASTRADO'; })() }}. " +
    'Quando mandar endereço ou localização para uma cliente, copie EXATAMENTE essa linha. Nunca escreva rua, número, bairro, ponto de referência ou link de mapa que não esteja nela, nem "[link]" de enfeite: endereço inventado manda a cliente para o lugar errado. ' +
    'Sem link de mapa cadastrado, mande só o endereço escrito. Se estiver NÃO CADASTRADO, não mande endereço e diga à dona que falta preencher em Dados do salão no app.');

  // ---------- 2. trava no código, antes de gravar o contato e de enviar ----------
  const F = ferramentasWorkflow;
  if (F.connections['Montar chamada']?.main?.[0]?.[0]?.node !== 'Conferir cliente') throw new Error('endereco-certo: a ordem depois de "Montar chamada" mudou');
  F.nodes.push(
    consulta('Endereço: cadastro', modeloSupa),
    node('Endereço: conferir', 'n8n-nodes-base.code', 2, [330, 260], { jsCode: CONFERIR.trim() }),
    ifNode('Endereço confere?', [440, 260], [cond('ec1', '={{ !$json.bloqueio }}', { type: 'boolean', operation: 'true', singleValue: true })]),
  );
  F.connections['Montar chamada'] = main('Endereço: cadastro');
  F.connections['Endereço: cadastro'] = main('Endereço: conferir');
  F.connections['Endereço: conferir'] = main('Endereço confere?');
  // o nó seguinte lê $json.conferir: o IF repassa o item do "Endereço: conferir", que leva tudo do "Montar chamada"
  F.connections['Endereço confere?'] = { main: [[{ node: 'Conferir cliente', type: 'main', index: 0 }], [{ node: 'Resposta', type: 'main', index: 0 }]] };
  const resp = achar(F, 'Resposta').parameters.assignments.assignments[0];
  const ANTES = "const m = $('Montar chamada').first().json;";
  if (!resp.value.includes(ANTES)) throw new Error('endereco-certo: a "Resposta" das ferramentas mudou');
  resp.value = resp.value.replace(ANTES, () => ANTES + "\n  try { const bq = $('Endereço: conferir').first().json.bloqueio; if (bq) return bq; } catch (e) {}");
};
