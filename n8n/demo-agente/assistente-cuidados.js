// Assistente da dona: sabe os preços do app e a chave Pix, e não promete lembrar depois (só nas lojas com
// "assistente_cuidados": true no loja.json; a Gleide não passa por aqui). Erros reais da Caroline, 13 a 19/11/2026:
//
// 1. PREÇOS. Em 19/11 a assistente perguntou à Caroline "quais os valores que você quer que eu passe?", com a tabela
//    inteira no app. Agora a lista de serviços e preços do app (tabela servicos) entra no prompt a cada mensagem.
// 2. CHAVE PIX. Em 15/11 a Caroline perguntou "qual foi a chave que você enviou para as minhas clientes" e a assistente
//    disse que não tinha acesso. Agora a chave do sinal (config.loja.sinal_pix) e o nome da recebedora entram no prompt.
// 3. PROMESSA DE LEMBRAR. "Eu te lembro de chamar ela amanhã cedo" (Gabriele, 16/11), "amanhã cedo eu te aviso sobre o
//    Pix dela" (Ana, 17/11), "eu te lembro no dia 23" (Ana, Vanessa e Bruna, 13/11): nada disso aconteceu, porque a
//    assistente só fala quando a dona escreve. A frase de promessa sai da resposta antes de chegar à Caroline (o prompt
//    da loja manda usar combinar_retorno para a IA de atendimento chamar a CLIENTE na data).

module.exports = ({ assistenteWorkflow: A }) => {
  const achar = (nome) => { const n = A.nodes.find((x) => x.name === nome); if (!n) throw new Error('assistente-cuidados: não achei "' + nome + '"'); return n; };

  // ---------- 1 e 2. serviços, preços e chave Pix no prompt ----------
  const dados = achar('Ler dados do salão');
  if (A.connections['Ler dados do salão']?.main?.[0]?.[0]?.node !== 'Contexto') throw new Error('assistente-cuidados: a ligação "Ler dados do salão" -> "Contexto" mudou');
  const servicos = JSON.parse(JSON.stringify(dados));
  delete servicos.id; servicos.name = 'Ler serviços'; servicos.position = [dados.position[0] + 160, dados.position[1]];
  servicos.parameters = { ...servicos.parameters, url: '={{ $env.SUPABASE_URL }}/rest/v1/servicos?select=nome,preco,duracao_min,a_partir_de&ativo=eq.true&order=nome&empresa_id=eq.{{ $env.EMPRESA_ID }}' };
  servicos.executeOnce = true; servicos.alwaysOutputData = true; servicos.onError = 'continueRegularOutput';
  A.nodes.push(servicos);
  A.connections['Ler dados do salão'] = { main: [[{ node: 'Ler serviços', type: 'main', index: 0 }]] };
  A.connections['Ler serviços'] = { main: [[{ node: 'Contexto', type: 'main', index: 0 }]] };

  const op = achar('Agente assistente').parameters.options;
  op.systemMessage += '\n\n' +
    "SERVIÇOS E PREÇOS DO APP (a fonte é esta lista: quando precisar de valor ou duração de serviço, use daqui e NÃO pergunte à Caroline): {{ (() => { try { const s = $('Ler serviços').all().map((i) => i.json).filter((x) => x && x.nome); if (!s.length) return '(não consegui ler agora: diga que confere no app)'; return s.map((x) => x.nome + ' ' + (x.a_partir_de ? 'a partir de ' : '') + 'R$ ' + Number(x.preco).toFixed(0) + (x.duracao_min ? ' (' + x.duracao_min + ' min)' : '')).join('; '); } catch (e) { return '(não consegui ler agora)'; } })() }}.\n" +
    "CHAVE PIX DO SINAL (é a mesma que a IA de atendimento manda às clientes; passe quando a Caroline pedir): {{ (() => { try { const p = ((($('Ler dados do salão').first().json.config || {}).loja || {}).sinal_pix) || {}; if (!p.chave) return 'não cadastrada'; const nomes = [].concat(p.nome_recebedor || []).filter(Boolean); return p.chave + (nomes.length ? ' (em nome de ' + nomes[0] + ')' : '') + (p.valor ? '; sinal de R$ ' + p.valor : '') + (p.ativo === false ? '; sinal DESLIGADO agora' : ''); } catch (e) { return 'não consegui ler agora'; } })() }}. " +
    'Para mandar a chave a alguém, ela vai SOZINHA numa mensagem (sem texto junto), senão a pessoa não consegue copiar no celular.';

  // ---------- 3. promessa de lembrar depois ----------
  const conf = achar('Conferir resposta');
  const DE = 'const promessa = (f) => ';
  if (!conf.parameters.jsCode.includes(DE)) throw new Error('assistente-cuidados: o "Conferir resposta" mudou');
  conf.parameters.jsCode = conf.parameters.jsCode.replace(DE, () => DE +
    '/(eu |vou )?te lembr|lembro voc[eê]|te dou um toque|vou (te )?lembrar|te aviso (amanh|no dia|depois|mais tarde|quando chegar)|te cobro|eu te chamo (amanh|no dia)|te pergunto (amanh|no dia)/i.test(f) || ');
};
