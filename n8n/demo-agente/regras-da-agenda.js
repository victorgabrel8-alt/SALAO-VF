// Regras da agenda pela assistente (loja.json: "regras_agenda": true; a Gleide não passa por aqui). Pedido do Victor
// (24/11/2026, Caroline): o que a dona manda sobre QUANDO a IA de atendimento marca ("segunda nada antes das 11h",
// "dezembro nada às 9h", "sábado primeiro a manhã") virava regra da própria assistente (guardar_regra), que a IA de
// atendimento nunca lê: em 23/11 ela ofereceu à Kelly "segunda dia 21 às 8h".
// Agora:
//   - a assistente tem a ferramenta regra_da_agenda, que grava em config.ia_horas / config.ia_periodo
//     (n8n_assistente_regra_agenda, supabase/071). A agenda confere isso no código (agenda-calculo.js);
//   - a assistente lê essas regras junto com as dela (n8n_assistente_regras_texto_agenda), com o código para tirar (H1, P2);
//   - conta como gravação no registro do que ela já fez e na conferência da resposta.
// O texto do prompt da loja (lojas/<slug>/prompt-assistente.txt) é que diz quando usar.

module.exports = ({ assistenteWorkflow: A, ferramentasWorkflow: F }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('regras-da-agenda: sem o nó ' + nome); return n; };
  const trocarUma = (n, campo, de, para) => {
    const t = String(n.parameters[campo] || '');
    if (t.split(de).length !== 2) throw new Error(`regras-da-agenda: "${n.name}" mudou (${de.slice(0, 60)})`);
    n.parameters[campo] = t.replace(de, () => para);
  };

  // 1. a chamada ao banco
  trocarUma(achar(F, 'Montar chamada'), 'jsCode', '  default:\n', [
    '  // regras de quando a IA de atendimento marca (regras-da-agenda.js, supabase/071)',
    "  case 'regra_da_agenda':",
    "    funcao = 'n8n_assistente_regra_agenda';",
    "    args = { ...base, p_tipo: v('tipo'), p_dias: ou(v('texto')), p_de: ou(v('hora_inicio')), p_ate: ou(v('hora_fim')),",
    "      p_de_dia: ou(v('a_partir').slice(0, 10)), p_ate_dia: ou(v('ate').slice(0, 10)), p_periodo: ou(v('status')), p_estrito: sim('extras'),",
    "      p_qual: ou(v('busca')), p_fala: ou(v('observacoes')) };",
    '    break;',
    '  default:\n',
  ].join('\n'));

  // 2. a ferramenta, feita a partir da guardar_regra (mesmo subworkflow, mesmos campos fixos)
  const molde = achar(A, 'guardar_regra');
  if (A.nodes.some((x) => x.name === 'regra_da_agenda')) throw new Error('regras-da-agenda: a ferramenta já existe');
  const ferramenta = JSON.parse(JSON.stringify(molde));
  ferramenta.name = 'regra_da_agenda';
  ferramenta.id = molde.id.slice(0, -3) + '871';
  ferramenta.position = [molde.position[0], molde.position[1] + 220];
  ferramenta.parameters.description = 'Regras de QUANDO a IA de atendimento oferece e marca horário para as clientes. Ela segue o que você gravar aqui; '
    + 'o que vai em guardar_regra ela não lê. tipo "nao_comeca": a IA não começa horário numa faixa de hora (ex.: segunda antes das 11h; em dezembro às 9h). '
    + 'tipo "primeiro": num dia da semana a IA oferece primeiro a manhã ou a tarde (estrito = a outra só abre quando essa lota). '
    + 'tipo "tirar": tira pelo código (H1, P2) que aparece em REGRAS DA AGENDA. tipo "ver": mostra as regras. '
    + 'Para fechar o dia ou um período de um dia só, use bloquear_dias ou bloquear_horario.';
  const fixos = Object.fromEntries(Object.entries(ferramenta.parameters.workflowInputs.value).filter(([, x]) => !String(x).includes('$fromAI(')));
  if (fixos.acao !== 'guardar_regra') throw new Error('regras-da-agenda: a guardar_regra mudou');
  const ia = (c, d) => "={{ $fromAI('" + c + "', `" + d + "`, 'string') }}";
  ferramenta.parameters.workflowInputs.value = {
    ...fixos,
    acao: 'regra_da_agenda',
    tipo: ia('tipo', 'nao_comeca, primeiro, tirar ou ver'),
    texto: ia('texto', 'Dias da semana separados por vírgula: seg, ter, qua, qui, sex, sab, dom. Vazio = todos os dias'),
    hora_inicio: ia('hora_inicio', 'nao_comeca: começo da faixa em que a IA não começa horário, HH:mm. Vazio = desde a abertura (ex.: "antes das 11h" = vazio)'),
    hora_fim: ia('hora_fim', 'nao_comeca: fim da faixa, HH:mm, sem contar ele (ex.: "antes das 11h" = 11:00; "às 9h" = 09:30)'),
    a_partir: ia('a_partir', 'nao_comeca: primeiro dia em que vale, AAAA-MM-DD (ex.: "em dezembro" = o dia 1º). Vazio = já'),
    ate: ia('ate', 'nao_comeca: último dia em que vale, AAAA-MM-DD (ex.: "em dezembro" = o dia 31). Vazio = sempre'),
    status: ia('status', 'primeiro: manha ou tarde'),
    extras: ia('extras', 'primeiro: "sim" se o outro período só abre quando esse lota ("não abre a tarde até a manhã encher"); vazio se é só preferência'),
    busca: ia('busca', 'tirar: o código da regra (H1, P2...)'),
    observacoes: ia('observacoes', 'O que ela disse, com as palavras dela'),
  };
  A.nodes.push(ferramenta);
  A.connections['regra_da_agenda'] = JSON.parse(JSON.stringify(A.connections['guardar_regra']));

  // 3. a assistente lê as regras da agenda junto com as dela
  trocarUma(achar(A, 'Ler regras'), 'url', 'rpc/n8n_assistente_regras_texto', 'rpc/n8n_assistente_regras_texto_agenda');

  // 4. conta como gravação (registro do que já fez e conferência de "gravei" sem gravar)
  for (const n of A.nodes.filter((x) => String(x.parameters?.jsCode || '').includes('"tirar_regra","ensinar_resposta"'))) {
    trocarUma(n, 'jsCode', '"tirar_regra","ensinar_resposta"', '"tirar_regra","regra_da_agenda","ensinar_resposta"');
  }
  if (!A.nodes.some((x) => String(x.parameters?.jsCode || '').includes('"regra_da_agenda","ensinar_resposta"'))) throw new Error('regras-da-agenda: não achei a lista de gravações');
};
