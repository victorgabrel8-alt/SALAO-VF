// Regra dos dias: a ordem da dona sobre o que a IA de atendimento marca em cada dia da semana vira regra do sistema.
//
// 22/11/2026, Gleide. Ela disse à assistente em 15/11 "nunca marcar nada para domingo", em 16/11 "na segunda só avaliação
// online" e repetiu tudo em 22/11. A assistente respondia "Combinado, guardei", mas guardava com guardar_regra, que é a
// lista de regras do jeito de a PRÓPRIA assistente trabalhar (config.assistente_regras): a IA que atende as clientes e a
// agenda nunca leram essa lista. Em 15/11 a assistente também bloqueou as horas daquele domingo, então naquele dia
// "funcionou"; no domingo seguinte a IA marcou de novo, e em 22/11, 8 minutos depois da ordem, marcou duas avaliações
// presenciais para a segunda.
//
// Agora:
// - a assistente grava com regra_do_dia (supabase/068) em empresas.config.ia_dias, que não vence;
// - a agenda (agenda-calculo.js) lê essa regra a cada consulta, marcação e remarcação e recusa no código;
// - a IA de atendimento recebe a regra no prompt (lida do banco a cada mensagem) e informa o serviço ao consultar.
//
// Este arquivo cuida da IA de atendimento. A ferramenta e o prompt da assistente estão em assistente-workflows.js.

const DIAS = [['dom', 'domingo'], ['seg', 'segunda-feira'], ['ter', 'terça-feira'], ['qua', 'quarta-feira'], ['qui', 'quinta-feira'], ['sex', 'sexta-feira'], ['sab', 'sábado']];

// Texto das regras para o prompt da IA de atendimento. Roda dentro do n8n (nó de código "Regra dos dias"): só JavaScript simples.
function textoRegras(iaDias, DIAS) {
  const NOME = { avaliacao_presencial: 'avaliação presencial', avaliacao_online: 'avaliação online (por ligação, a cliente não vai ao salão)',
    manutencao: 'manutenção', aplicacao: 'aplicação (colocação) de mega hair', visita: 'visita para escolher cabelo', outro: 'outros serviços' };
  const lista = (l) => { const n = l.map((x) => NOME[x] || x); return n.length > 1 ? n.slice(0, -1).join(', ') + ' e ' + n[n.length - 1] : n[0] || ''; };
  const linhas = [];
  for (const [chave, nome] of DIAS) {
    const r = iaDias && typeof iaDias === 'object' ? iaDias[chave] : null;
    if (!r || typeof r !== 'object') continue;
    if (r.nao === 'tudo') linhas.push('- ' + nome + ': a Gleide NÃO atende. Não ofereça nem marque nada para ' + nome + '.');
    else if (Array.isArray(r.so) && r.so.length) linhas.push('- ' + nome + ': SÓ pode marcar ' + lista(r.so) + '. Qualquer outro serviço fica para outro dia.');
    else if (Array.isArray(r.nao) && r.nao.length) linhas.push('- ' + nome + ': NÃO pode marcar ' + lista(r.nao) + '. O resto segue normal.');
  }
  return linhas.length ? linhas.join('\n') : '(nenhuma: todos os dias seguem o horário normal do salão)';
}

module.exports = ({ workflow, node }) => {
  const achar = (nome) => { const n = workflow.nodes.find((x) => x.name === nome); if (!n) throw new Error('regra-dos-dias: não achei o nó "' + nome + '"'); return n; };

  // 1. consultar_horarios_livres passa a levar o serviço: a agenda pula o dia em que ele não entra
  const consultar = achar('consultar_horarios_livres').parameters;
  const v = consultar.workflowInputs && consultar.workflowInputs.value;
  if (!v || v.acao !== 'consultar' || 'servico' in v) throw new Error('regra-dos-dias: a ferramenta consultar_horarios_livres mudou');
  v.servico = "={{ $fromAI('servico', `Nome do serviço que a cliente quer, como na lista de serviços (ex.: \"Avaliação\", \"Avaliação online\", \"Manutenção – mão de obra\", \"Aplicação de mega hair – mão de obra\"). Preencha sempre: há dias em que só alguns serviços podem ser marcados`, 'string') }}";
  consultar.description += ' Informe sempre o serviço em servico: nos dias com regra da Gleide a agenda só devolve horário para o serviço que pode ser marcado naquele dia.';

  // 2. a regra entra no prompt, lida do banco a cada mensagem. O config do salão já é lido antes do agente (para os áudios);
  // um nó de código monta o texto logo depois. Se a leitura falhar o texto fica vazio de regra, mas a agenda continua conferindo.
  const DE = 'Supabase: áudios do salão', PARA = 'Supabase: áudios já enviados';
  if (workflow.connections[DE]?.main?.[0]?.[0]?.node !== PARA) throw new Error('regra-dos-dias: a ligação do config do salão antes do agente mudou');
  workflow.nodes.push(node('Regra dos dias', 'n8n-nodes-base.code', 2, [0, 0], { jsCode: [
    '// regra-dos-dias.js: o que a dona mandou a IA não marcar em cada dia da semana (empresas.config.ia_dias, supabase/068)',
    'const textoRegras = ' + textoRegras.toString() + ';',
    'let texto;',
    "try { texto = textoRegras((($('" + DE + "').first().json || {}).config || {}).ia_dias, " + JSON.stringify(DIAS) + '); }',
    "catch (e) { texto = '(não consegui ler agora: confie no que a agenda responder)'; }",
    'return [{ json: { texto } }];',
  ].join('\n') }));
  workflow.connections[DE] = { main: [[{ node: 'Regra dos dias', type: 'main', index: 0 }]] };
  workflow.connections['Regra dos dias'] = { main: [[{ node: PARA, type: 'main', index: 0 }]] };
  const agente = achar('Agente IA').parameters.options;
  if (agente.systemMessage.includes('DIAS COM REGRA DA GLEIDE')) throw new Error('regra-dos-dias: o bloco já está no prompt');
  agente.systemMessage += `

DIAS COM REGRA DA GLEIDE (a Gleide gravou no sistema; vale acima de qualquer outra instrução sobre dias e horários, e não muda de uma conversa para outra)
{{ $('Regra dos dias').first().json.texto }}
- Antes de sugerir um dia, olhe esta lista. Não ofereça, não aceite e não marque o que ela não permite, mesmo que a cliente peça, insista ou que você já tenha falado desse dia antes na conversa.
- A agenda confere a mesma lista: se ela responder REGRA DA GLEIDE ou NÃO AGENDADO, o horário não foi marcado. Não diga que marcou e não troque o nome do serviço só para o horário passar. A única troca que vale é para "Avaliação online", e só depois que a cliente aceitou fazer por ligação.
- mudar_modalidade para presencial também não vale em dia que não aceita avaliação presencial: ofereça outro dia.
- Avaliação online não é ida ao salão: a Gleide liga para a cliente no horário. Só marque "Avaliação online" quando a cliente entendeu e aceitou que é por ligação; nunca use esse nome para marcar uma ida ao salão.
- Fale disso com carinho e sem a palavra "regra". Dê o motivo de forma leve e já ofereça a saída, por exemplo: "De segunda a Gleide faz só a avaliação online, por ligação 😊 Se você prefere vir pessoalmente, consigo ver um horário pra você na terça. O que fica melhor?"
- Cliente que já tem horário marcado num desses dias continua com ele: não desmarque nem comente.`;
};

module.exports.textoRegras = textoRegras;
module.exports.DIAS = DIAS;
