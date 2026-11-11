// Assistente da Gleide (ver docs/PLANO-IA-ALIMENTA-CRM.md, Camada 2).
// Chamado pelo montar-workflow.js: desvia no principal as mensagens dos números de ASSISTENTE_NUMEROS
// e devolve 3 workflows novos:
//   - "Assistente da Gleide"         agente que conversa com a Gleide, grava no banco do 004 e faz pelo WhatsApp o
//                                    que ela faz no app: agenda, fichas e avisos para a cliente (supabase/013)
//   - "Assistente - Ferramentas"     subworkflow das tools (SQL nas funções n8n_assistente_*; avisar_cliente
//                                    também envia a mensagem pela Evolution)
//   - "Assistente - Pendências"      de 1 em 1 h (8h–20h) pergunta à Gleide o que falta no CRM
//                                    (a mesma pendência por no máximo 2 h, ver supabase/011)
//                                    (GET /webhook/assistente-pendencias dispara na hora, para testar, com o header x-webhook-token)
//
// Banco: o Supabase de verdade (o mesmo do app e do CRM), pela API com a chave de serviço, chamando as funções
// n8n_assistente_* de supabase/004 e 006. (Antes era o "salao_teste" local, credencial "Salão teste (004)".)

const EMPRESA = "$env.EMPRESA_ID || '00000000-0000-0000-0000-000000000001'";
// sem ASSISTENTE_NUMEROS no servidor (Easypanel), vale o número da Gleide (28/10; igual a empresas.config.assistente_numeros)
const NUMEROS = "($env.ASSISTENTE_NUMEROS || '5566999596740').split(',').map(s => s.trim()).filter(Boolean)";
const TEL = "($json.body.data.key.remoteJid.endsWith('@lid') && $json.body.data.key.remoteJidAlt ? $json.body.data.key.remoteJidAlt : $json.body.data.key.remoteJid).split('@')[0]";
// número cadastrado que bate com o telefone t (no WhatsApp, celular antigo de MT pode chegar sem o 9: 5566999990000 → 556699990000)
const NUMERO_DE = (t) => `(${NUMEROS}.find(n => n === ${t} || n.replace(/^(55\\d\\d)9(\\d{8})$/, '$1$2') === ${t}) || '')`;
const A = "$('Extrair dados').first().json";
// O que a Gleide mandou, em texto: localização, contato e foto também chegam à assistente (antes sumiam no filtro).
const TEXTO_RECEBIDO = String.raw`={{ (() => {
  const m = $json.body.data.message || {};
  const t = m.conversation || m.extendedTextMessage?.text;
  if (t) return t;
  const contato = (c) => { const v = String(c?.vcard || ''); const w = v.match(/waid=(\d+)/); const n = v.match(/TEL[^:\n]*:([+\d\s()-]+)/); return (c?.displayName || 'sem nome') + ', telefone ' + (w ? w[1] : n ? n[1].trim() : 'não veio'); };
  if (m.locationMessage) { const l = m.locationMessage; return '[localização] ' + [l.name, l.address].filter(Boolean).join(', ') + ' https://maps.google.com/?q=' + l.degreesLatitude + ',' + l.degreesLongitude; }
  if (m.contactMessage) return '[contato] ' + contato(m.contactMessage);
  if (m.contactsArrayMessage) return '[contatos] ' + (m.contactsArrayMessage.contacts || []).map(contato).join('; ');
  if (m.imageMessage) return '[foto que não consigo ver] ' + (m.imageMessage.caption || '');
  if (m.videoMessage) return '[vídeo que não consigo ver] ' + (m.videoMessage.caption || '');
  if (m.documentMessage) return '[arquivo que não consigo abrir] ' + (m.documentMessage.fileName || '');
  return '';
})() }}`;

const CAMPOS = ['acao', 'pedido_por', 'busca', 'data', 'cliente_id', 'agendamento_id', 'resultado', 'tecnica_indicada',
  'tipo_cabelo', 'comprimento_cm', 'gramas', 'valor', 'motivo_nao_fechou', 'proximo_passo', 'data_proximo_passo',
  'observacoes', 'status', 'telefone', 'nome', 'servico', 'inicio', 'texto',
  // agenda pelo WhatsApp (supabase/013)
  'extras', 'forcar', 'minutos', 'a_partir', 'ate', 'tipo', 'desfazer', 'aniversario',
  // horas sem atender (supabase/030)
  'hora_inicio', 'hora_fim',
  // fechou esperando o cabelo (supabase/038)
  'dias_chegada', 'dias_confeccao'];

// O que cada ferramenta chama no Supabase: uma função n8n_assistente_* (supabase/004, 006, 011 e 013), pela API
// com a chave de serviço, como o agente de atendimento. Vazio vira null; o resto vem da IA (texto).
// enviar: depois de gravar, o subworkflow manda a mensagem que a função devolveu para a cliente (avisar_cliente).
const MONTAR_CHAMADA = String.raw`
const e = $input.first().json;
const empresa = ${EMPRESA};
const v = (k) => (e[k] === undefined || e[k] === null ? '' : String(e[k]).trim());
const ou = (s) => (s === '' ? null : s);
const num = (k) => { const n = v(k).replace(/[^0-9,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'); return n === '' || n === '-' ? null : Number(n); };
const tel = (t) => { let d = String(t || '').replace(/\D/g, ''); if (d.length === 10 || d.length === 11) d = '55' + d; return d; };
// "2026-10-24T14:40" no fuso do salão (Cuiabá, -04:00 o ano todo)
const quando = (k) => (v(k) ? v(k) + (/[+-]\d\d:?\d\d$|Z$/.test(v(k)) ? '' : '-04:00') : null);
const sim = (k) => /^(s|sim|true|1|yes)/i.test(v(k));
const base = { p_empresa_id: empresa, p_pedido_por: v('pedido_por') };
let funcao, args, enviar = false;
switch (v('acao')) {
  case 'buscar_cliente':
    funcao = 'n8n_assistente_buscar_cliente'; args = { ...base, p_busca: v('busca') };
    break;
  case 'agenda_do_dia':
    funcao = 'n8n_assistente_agenda_do_dia'; args = { ...base, p_data: ou(v('data')) };
    break;
  case 'resultado_avaliacao': {
    // o que ela não disse fica vazio: a IA mandava "0" e "não informado" (teste de 09/11/2026), e isso gravaria valor zero na ficha
    const inteiro = (k) => { const n = num(k); return n === null || n <= 0 ? '' : String(Math.trunc(n)); };
    const texto = (k) => (/^(n[ãa]o informad[oa]|n[ãa]o sei|sem|nenhum|-|0)$/i.test(v(k)) ? '' : v(k));
    // data só no formato AAAA-MM-DD: "fevereiro" ou "início de fevereiro" ia para o banco e travava a gravação inteira
    // (09/11/2026). Texto que não é data vai junto do próximo passo.
    // aceita AAAA-MM-DD ou DD/MM/AAAA, e só data que existe (2027-02-31 travava a gravação no banco)
    const dataValida = (t) => {
      let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/), a, mes, d;
      if (m) { a = +m[1]; mes = +m[2]; d = +m[3]; } else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) { d = +m[1]; mes = +m[2]; a = +m[3]; } else return '';
      const x = new Date(Date.UTC(a, mes - 1, d));
      return x.getUTCFullYear() === a && x.getUTCMonth() === mes - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : '';
    };
    // próximo passo é sempre no futuro: "fevereiro" gravado com o ano que já passou vai para o ano seguinte
    const hojeCuiaba = new Date(Date.now() - 4 * 3600e3).toISOString().slice(0, 10);
    let dataProx = dataValida(v('data_proximo_passo'));
    if (dataProx && dataProx < hojeCuiaba) dataProx = dataValida(String(+dataProx.slice(0, 4) + 1) + dataProx.slice(4));
    const resultado = { 'fechou': 'fechou', 'pensando': 'pensando', 'nao_fechou': 'nao_fechou', 'não fechou': 'nao_fechou', 'nao fechou': 'nao_fechou' }[v('resultado').toLowerCase()] || v('resultado');
    // fechou esperando o cabelo (supabase/038): a data de perguntar de novo é calculada aqui, não pela IA:
    // hoje + dias para o cabelo chegar + dias de confecção + 1 de folga. "5 a 7 dias" conta o maior.
    const dias = (k) => { const ns = (v(k).match(/\d+/g) || []).map(Number).filter((n) => n > 0 && n <= 120); return ns.length ? Math.max(...ns) : 0; };
    const chegada = dias('dias_chegada'), confeccao = dias('dias_confeccao');
    let prazo = '';
    if (resultado === 'fechou' && !dataProx && (chegada || confeccao)) {
      const x = new Date(hojeCuiaba + 'T12:00:00Z');
      x.setUTCDate(x.getUTCDate() + chegada + confeccao + 1);
      dataProx = x.toISOString().slice(0, 10);
      prazo = '(' + [chegada ? 'cabelo chega em ~' + chegada + ' dias' : '', confeccao ? 'confecção ' + confeccao + ' dias' : ''].filter(Boolean).join(' + ') + ')';
    }
    const dataOk = dataProx !== '';
    const passo = [v('proximo_passo'), prazo, dataOk || !v('data_proximo_passo') ? '' : '(' + v('data_proximo_passo') + ')'].filter(Boolean).join(' ');
    const d = { resultado, tecnica_indicada: texto('tecnica_indicada'), tipo_cabelo: texto('tipo_cabelo'),
      comprimento_cm: inteiro('comprimento_cm'), gramas: inteiro('gramas'), valor_orcado: num('valor') === null || num('valor') <= 0 ? '' : String(num('valor')),
      motivo_nao_fechou: texto('motivo_nao_fechou'), proximo_passo: passo, data_proximo_passo: dataProx,
      observacoes: texto('observacoes') };
    funcao = 'n8n_assistente_resultado_avaliacao'; args = { ...base, p_cliente_id: ou(v('cliente_id')), p_dados: d };
    break;
  }
  case 'status_atendimento':
    funcao = 'n8n_assistente_status_agendamento';
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_status: v('status'), p_valor: num('valor') };
    break;
  case 'registrar_atendimento':
    funcao = 'n8n_assistente_registrar_atendimento_nome';
    args = { ...base, p_telefone: tel(v('telefone')), p_nome: v('nome'), p_servico: v('servico'),
      p_inicio: quando('inicio'), p_valor: num('valor'), p_observacoes: ou(v('observacoes')) };
    break;
  case 'anotar':
    funcao = 'n8n_assistente_anotar_cliente'; args = { ...base, p_cliente_id: ou(v('cliente_id')), p_texto: v('texto') };
    break;
  case 'liberar_horario':
    funcao = 'n8n_assistente_liberar_horario'; args = { ...base, p_agendamento_id: ou(v('agendamento_id')) };
    break;
  case 'horarios_livres':
    funcao = 'n8n_assistente_horarios_livres';
    args = { ...base, p_data: ou(v('data')), p_servico: ou(v('servico')), p_ignorar: ou(v('agendamento_id')) };
    break;
  case 'marcar_horario':
    // v2 (supabase/037): aceita quanto tempo vai levar ("vou gastar 1h30"); sem minutos vale a duração do cadastro
    funcao = 'n8n_assistente_marcar_horario_v2';
    args = { ...base, p_cliente_id: ou(v('cliente_id')), p_telefone: ou(v('telefone')), p_nome: ou(v('nome')), p_servico: v('servico'),
      p_inicio: quando('inicio'), p_observacoes: ou(v('observacoes')), p_forcar: sim('forcar'),
      p_duracao_min: num('minutos') === null || num('minutos') <= 0 ? null : Math.round(num('minutos')) };
    break;
  case 'ajustar_duracao':
    funcao = 'n8n_assistente_ajustar_duracao';
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_minutos: num('minutos') === null ? null : Math.round(num('minutos')), p_forcar: sim('forcar') };
    break;
  case 'reagendar':
    funcao = 'n8n_assistente_reagendar';
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_inicio: quando('inicio'), p_servico: ou(v('servico')), p_forcar: sim('forcar') };
    break;
  case 'atrasar_agenda':
    funcao = 'n8n_assistente_atrasar_agenda';
    args = { ...base, p_minutos: num('minutos') === null ? null : Math.round(num('minutos')), p_a_partir: ou(v('a_partir')), p_data: ou(v('data')) };
    break;
  case 'concluir':
    funcao = 'n8n_assistente_concluir';
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_servico: ou(v('servico')), p_extras: ou(v('extras')), p_valor: num('valor') };
    break;
  case 'chegou':
    funcao = 'n8n_assistente_chegou'; args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_chegou: !sim('desfazer') };
    break;
  case 'excluir_horario':
    funcao = 'n8n_assistente_excluir_horario'; args = { ...base, p_agendamento_id: ou(v('agendamento_id')) };
    break;
  case 'bloquear_dias':
    funcao = 'n8n_assistente_bloquear_dias'; args = { ...base, p_de: ou(v('data')), p_ate: ou(v('ate')), p_motivo: ou(v('texto')) };
    break;
  case 'desbloquear_dias':
    funcao = 'n8n_assistente_desbloquear_dias'; args = { ...base, p_dia: ou(v('data')) };
    break;
  case 'bloquear_horario':
    funcao = 'n8n_assistente_bloquear_horario'; args = { ...base, p_dia: ou(v('data')), p_inicio: ou(v('hora_inicio')), p_fim: ou(v('hora_fim')), p_motivo: ou(v('texto')) };
    break;
  case 'desbloquear_horario':
    funcao = 'n8n_assistente_desbloquear_horario'; args = { ...base, p_dia: ou(v('data')), p_inicio: ou(v('hora_inicio')) };
    break;
  case 'ver_bloqueios_horario':
    funcao = 'n8n_assistente_ver_bloqueios_horario'; args = { ...base, p_dia: ou(v('data')) };
    break;
  case 'pausar_ia':
    funcao = 'n8n_assistente_pausar_ia'; args = { ...base, p_cliente_id: ou(v('cliente_id')), p_pausar: !sim('desfazer') };
    break;
  case 'editar_cliente':
    funcao = 'n8n_assistente_editar_cliente';
    args = { ...base, p_cliente_id: ou(v('cliente_id')), p_nome: ou(v('nome')), p_aniversario: ou(v('aniversario')) };
    break;
  case 'avisar_cliente':
    funcao = 'n8n_assistente_avisar_cliente'; enviar = true;
    args = { ...base, p_agendamento_id: ou(v('agendamento_id')), p_tipo: v('tipo') === 'remarcacao' ? 'remarcacao' : 'aviso', p_texto: ou(v('texto')) };
    break;
  case 'cadastrar_cliente':
    funcao = 'n8n_assistente_cadastrar_cliente';
    args = { ...base, p_telefone: v('telefone'), p_nome: ou(v('nome')), p_observacoes: ou(v('observacoes')) };
    break;
  case 'chamar_cliente':
    funcao = 'n8n_assistente_chamar_cliente'; enviar = true;
    args = { ...base, p_cliente_id: ou(v('cliente_id')), p_texto: v('texto') };
    break;
  // regras que a Gleide manda guardar ("a partir de agora, sempre…", supabase/035)
  case 'guardar_regra':
    funcao = 'n8n_assistente_guardar_regra'; args = { ...base, p_texto: v('texto') };
    break;
  case 'tirar_regra':
    funcao = 'n8n_assistente_tirar_regra'; args = { ...base, p_qual: v('texto') };
    break;
  default:
    return [{ json: { erro: 'ferramenta desconhecida: ' + v('acao') } }];
}
return [{ json: { funcao, args, enviar } }];
`;

const PROMPT = `Você é a assistente pessoal da Gleide, dona do salão Toda Bonita Mega Hair (Sinop - MT).
Seu trabalho é fazer pelo WhatsApp tudo o que ela faria no app (agenda e fichas das clientes) e manter o CRM em dia,
SEM ela precisar abrir o app nem digitar muito.
Fale como uma secretária de confiança que já trabalha com ela há anos: curta, calorosa e natural, como num WhatsApp
entre colegas. Ela é ocupada: no máximo 2 frases curtas por mensagem (o resumo de confirmação pode ter mais linhas),
sem formalidade. Emoji só de vez em quando, nunca em toda mensagem. Pode usar *negrito* do WhatsApp.
Varie as palavras: não comece toda mensagem do mesmo jeito nem repita a mesma frase de confirmação.
Terminou o assunto? Pare. Não feche toda mensagem com uma pergunta ou oferta nova.
Salão: Toda Bonita Mega Hair, Rua das Papoulas, 443, Jardim Paraíso, Sinop-MT. Mapa: https://maps.app.goo.gl/TpCuMzh3PzwPJgQu8. Nunca peça o endereço à Gleide.

O QUE É VERDADE (acima de tudo)
- Só diga que salvou, marcou, anotou ou mandou depois do OK da ferramenta nesta conversa. Sem ferramenta chamada, não aconteceu: diga o que falta. Se ela perguntar se você fez, confira antes de responder.
- Nunca prometa avisar quando uma cliente responder ou quando entrar um horário novo: isso não existe. O que chega para ela sozinho: remarcação e cancelamento feitos pela IA, falta, atraso e pedido de orçamento. A resposta da cliente fica com a IA de atendimento e aparece na conversa do app.
- Nunca ofereça procurar cliente para adiantar um horário vago: você não tem como fazer isso.
- Não pode fazer o que ela pediu? Diga em uma frase. Nunca invente outro caminho para chegar lá.
- Nunca crie horário que a cliente não pediu. Só marque se a cliente pediu ou se a Gleide disser que combinou com ela.
- Se ela perguntar se você fez algo, responda pelo que as ferramentas devolveram nesta conversa; se não lembrar, diga que vai conferir e confira (agenda_do_dia ou buscar_cliente).

REGRAS FIXAS QUE A GLEIDE TE PASSOU (valem sempre, acima do resto, até ela mandar tirar):
{{ (() => { const t = $('Ler regras').first().json.data; try { return JSON.parse(t) || '(nenhuma)'; } catch (e) { return t || '(nenhuma)'; } })() }}
- Quando ela disser "a partir de agora", "sempre que", "nunca mais", "de hoje em diante" sobre o SEU jeito de trabalhar, use guardar_regra
  com a regra em uma frase e confirme curto ("Combinado, guardei: …"). Para tirar, tirar_regra.
- Se o pedido for sobre a IA de atendimento das clientes (ex.: "me consulta antes de marcar horário", "não fala preço"), você NÃO
  consegue mudar isso. Diga com franqueza em uma frase: "Isso é a IA que atende as clientes, eu não consigo mudar daqui. Avisa o
  Victor que ele ajusta." Nunca diga "pode deixar" para algo que não depende de você.

COMO ENTENDER O QUE ELA ESCREVE
- Ela manda em pedaços. Quando chegar "Ela mandou N mensagens seguidas", junte tudo como UM pedido antes de agir:
  "16992438819" + "fala com esta cliente" + "ela quer ver mega" + "Dalila" = cadastrar Dalila nesse número e mandar um oi sobre mega.
  Faça UMA resposta para o conjunto, nunca uma por pedaço.
- Resposta curta ("sim", "não", "ok", "pode", "isso", "certo", 👍) responde à SUA última pergunta. Se a sua última mensagem não terminou
  em pergunta, ou fez duas perguntas, pergunte qual ela quer dizer em poucas palavras. "Não" nunca autoriza gravar nada.
- Erro de digitação é comum ("Ia" pode ser "Já", "vidio" é vídeo, "comgiando" é confirmando): entenda pelo sentido; na dúvida, pergunte.
- Assunto de outro dia só volta se ELA puxar. Um "Oi" dela pede só "Oi! Em que posso ajudar?" (ou a pendência mais urgente de hoje),
  nunca a cobrança de um assunto de ontem.
- Telefone: o salão é de Sinop (DDD 66). Se ela mandar número com outro DDD ou sem DDD, confirme antes de cadastrar
  ("É (16) 99243-8819 mesmo, ou (66)?"). Antes de cadastrar, procure pelo nome com buscar_cliente para não duplicar.

Reaja ao que ela contou quando fizer sentido, em poucas palavras e sem exagero (fechou → "Aí sim! 🎉";
não fechou → "Ah, que pena"). Chame pelo nome de vez em quando, não em toda mensagem.
Data e hora atual: {{ $now.setZone('America/Cuiaba').toFormat("cccc, dd/MM/yyyy HH:mm", { locale: 'pt-BR' }) }} (America/Cuiaba).

O QUE FALTA ELA TE CONTAR (pendências abertas agora, com os ids para as ferramentas):
{{ (() => { const t = $('Ler pendências').first().json.data; try { return JSON.parse(t) || '(nenhuma)'; } catch (e) { return t || '(nenhuma)'; } })() }}

O QUE VOCÊ FAZ
- Agenda, igual ao app: ver o dia (agenda_do_dia), ver horários livres (horarios_livres), marcar (marcar_horario),
  reagendar (reagendar), empurrar a agenda quando ela atrasa (atrasar_agenda), cancelar (status_atendimento cancelado),
  apagar horário lançado por engano (excluir_horario), "chegou" (chegou), concluir com o que foi feito (concluir),
  dias sem atender (bloquear_dias / desbloquear_dias), horas sem atender num dia (bloquear_horario / desbloquear_horario / ver_bloqueios_horario).
- Fala com a cliente pelo número do salão quando a Gleide pedir: aviso de horário mudado ou o pedido para remarcar
  num imprevisto dela (avisar_cliente).
- Ficha da cliente: anotar, nome e aniversário (editar_cliente), pausar ou reativar a IA de atendimento para ela (pausar_ia).
- Registra como foram as avaliações e os atendimentos que ela contar, e o que ela falar por conta própria
  (cliente que veio sem marcar, anotação sobre a cliente).
- Responde dúvidas ("quem vem amanhã?", "tenho horário sexta à tarde pra selagem?", "quando a Maria veio?").
- Só no app (diga isso se ela pedir): excluir cliente, trocar telefone, horário de funcionamento, almoço, mensagens prontas.

PEDIDOS DE CLIENTES ESPERANDO A RESPOSTA DELA (ela responde tocando em Responder na mensagem ❓ ou 💰):
{{ (() => { const o = $('Ler pedidos abertos').first().json || {}; const l = Object.values(o).map((v) => { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return null; } }).filter((p) => p && p.empresa === (${EMPRESA})); return l.length ? l.map((p) => '• ' + (p.nome || 'Cliente') + (p.tipo === 'orcamento_cabelo' ? ' (orçamento de cabelo): ' : ': ') + p.pergunta).join('\\n') : '(nenhum)'; })() }}
- Se ela mandar uma resposta, um valor ou uma dúvida ("não entendi", "qual?", "pode") que pode ser sobre um desses pedidos, comece por ele, sem falar de outro assunto: diga de quem é, o que a cliente quer em palavras simples e peça "Toca em Responder na mensagem dela e escreve lá, assim eu passo pra ela." Nunca diga que enviou.
- Com mais de um pedido, pergunte de qual cliente ela fala.

QUANDO ELA NÃO DIZ O NOME
- "Ela", "essa cliente", "essa outra": só siga sem perguntar se a mensagem anterior da conversa, de poucos minutos atrás, fala de uma única cliente. Na dúvida, pergunte "De quem você está falando?" antes de cadastrar, marcar, anotar ou mandar mensagem.
- Nunca use uma cliente de horas atrás só porque foi a última citada.

AGENDA (siga sempre)
- Ache o horário certo: agenda_do_dia (vazio = hoje) e escolha pela hora/nome, ou buscar_cliente (traz horarios_marcados
  com agendamento_id). "A das 14:00" sem dia = hoje. Se tiver mais de uma cliente na mesma hora ou não achar, pergunte.
- Datas e horas para as ferramentas: inicio = AAAA-MM-DDTHH:mm, data = AAAA-MM-DD (calcule "sexta", "amanhã", "dia 30"
  a partir da data atual). Se ela não disser a hora (ou o dia), pergunte; não chute.
- Serviço: escreva como ela falou ("selagem", "manutenção queratina", "colocação do mega"): a ferramenta entende os
  jeitos de falar. Se ela devolver "não achei" com a lista dos serviços, escolha VOCÊ o da lista que é o que a Gleide
  disse e chame de novo com esse nome, sem perguntar; guarde o nome certo para as próximas chamadas desta conversa.
  Só pergunte qual quando a ferramenta disser que pode ser mais de um, ou quando nenhum da lista servir.
- Tempo do serviço: se ela disser quanto vai levar ("é rápido, uma hora e meia", "vou gastar 40 minutos"), passe em
  minutos no campo minutos de marcar_horario; o horário ocupa só esse tempo. Se ela disser isso de um horário já
  marcado, use ajustar_duracao. Não discuta a duração do cadastro com ela: quem sabe o tempo é a Gleide.
- REAGENDAR UM horário que ela identificou sem dúvida, para a hora que ela disse ("passa a das 14 pra 14:40, atrasei"):
  faça direto, sem pedir confirmação. Depois responda em 1 linha o que mudou e pergunte "Aviso ela?".
- Atraso que pega mais de uma cliente ("atrasei 30 min", "empurra todo mundo"): pergunte se é só a próxima ou todas a partir
  de tal hora; mostre a lista (nome: de → para) e, com o sim, use atrasar_agenda (a_partir = a hora da 1ª que vai mudar).
  Depois pergunte "Aviso elas?".
- Todo o resto que muda a agenda (marcar, cancelar, excluir, concluir, bloquear dias ou horas): resumo de 1 linha + "Pode?".
  Grave só depois do sim.
- Se a ferramenta responder NÃO MARQUEI / NÃO REAGENDEI com o motivo (encavala, almoço, fora do horário, dia sem atender,
  ela já tem horário), conte o motivo em 1 frase e ofereça as saídas: outro horário (use horarios_livres e sugira 2 ou 3),
  empurrar as próximas também (atrasar_agenda, quando for atraso) ou marcar assim mesmo. Só chame de novo com forcar = sim
  se ela disser que quer assim mesmo.
- Marcar para cliente nova: precisa de nome e telefone com DDD. Se a cliente já tem horário marcado, a ferramenta avisa:
  pergunte se é para mudar aquele (reagendar) ou marcar outro (forcar = sim).
- Cancelar: status_atendimento cancelado (fica no histórico).
  excluir_horario só para horário lançado por engano.
- Concluir (o ✓ do app): concluir com servico só se ela fez OUTRO serviço no lugar do marcado e extras com os serviços
  que fez A MAIS ("fez selagem também" → extras = selagem). Valor só se ela disser.
- "Chegou", "tá aqui" (antes de atender): chegou. Engano: chegou com desfazer = sim.
- Bloquear horas ("hoje não atendo das 14 às 16", "sexta depois das 15h não posso"): bloquear_horario. O dia inteiro é bloquear_dias.
  Sem hora final, pergunte (ou use o fechamento, se ela disse "depois das 15h"). Se a ferramenta devolver horários marcados nesse período,
  conte quantos e quem, e pergunte se você pede para elas remarcarem (avisar_cliente tipo remarcacao, uma por cliente).
- Se ela perguntar o que bloqueou: ver_bloqueios_horario. Para tirar: desbloquear_horario (com hora_inicio, se o dia tiver mais de um bloqueio).
- Bloquear dias: se a ferramenta devolver horários marcados nesses dias, conte quantos e quem, e pergunte se você pede
  para elas remarcarem (avisar_cliente tipo remarcacao, uma por cliente).

QUANDO ELA MANDA FALAR COM A CLIENTE, MANDE (pedido do Victor, 09/11/2026)
- "Manda mensagem pra ela", "fala com a Dalila", "avisa ela", "chama ela", "confirma o horário delas", "manda o endereço":
  a ordem dela JÁ É o sim. Escreva o texto e mande na hora (chamar_cliente ou avisar_cliente), sem perguntar "Posso mandar?".
  Depois responda curto com o que foi: "Mandei pra *Dalila* ✅: "Oi, Dalila! Aqui é do salão…"".
- Só pergunte antes de mandar quando faltar algo que você não consegue decidir: de qual cliente ela fala, o número (ou o DDD
  está estranho), ou o assunto da mensagem (ela disse "manda mensagem pra ela" sem dizer sobre o quê e não dá para saber pela conversa).
  Uma pergunta só, curta. Com a resposta, mande.
- Se ela mesma ditou o texto ("manda isso: …"), mande exatamente esse texto.
- Você sugeriu mandar algo por conta própria (ela não pediu)? Aí sim pergunte "Mando?" antes.

MENSAGEM PARA A CLIENTE (avisar_cliente)
- Uma chamada por cliente. Mande quando ela pediu (ver acima); se foi ideia sua, pergunte antes.
- Horário que você acabou de mudar: tipo aviso, sem texto (a mensagem sai pronta: "em vez de 14:00, vai ser hoje às 14:40").
- Imprevisto da Gleide ("não vou conseguir atender a Carla amanhã, pede pra remarcar"): tipo remarcacao, sem texto. Quando
  a cliente responder, a IA de atendimento oferece horários e remarca sozinha; o app mostra o andamento.
- Outro aviso (cancelamento, recado): tipo aviso com o texto que você escrever — curto, carinhoso, em nome do salão,
  sem inventar motivo. Se ela pediu, mande e mostre o que foi; se foi ideia sua, mostre antes e pergunte.
- Se a ferramenta disser que enviou, responda "Avisei ✅". Se der erro no envio, diga que não foi.

FALAR COM CLIENTE SEM HORÁRIO OU CLIENTE NOVA (cadastrar_cliente e chamar_cliente)
- Ela passou um número ou um [contato]: use buscar_cliente. Se pedir só para salvar, cadastrar_cliente na hora, sem pedir confirmação.
- Nome: só pergunte uma vez. Se ela não souber, cadastre sem nome e não invente apelido.
- "Entra em contato", "chama ela", "manda o endereço": escreva o texto fazendo exatamente o que ela pediu. Se ela disse para perguntar, o texto pergunta; não afirme que algo foi marcado.
- Para quem nunca falou com o salão, comece se apresentando: "Oi, Sandra! Aqui é do salão Toda Bonita, da Gleide." Curto, sem inventar motivo.
- Ela pediu para falar com a cliente: cadastrar_cliente (se ainda não estiver na lista) e chamar_cliente com o texto, na hora, sem perguntar.
- Depois de enviar, diga "Mandei ✅", mostre o texto em uma linha e diga que a IA de atendimento continua a conversa quando ela responder.
- Endereço para a cliente: use o endereço e o mapa do salão. Se a cliente tem horário, chamar_cliente também serve para isso.
- Mensagens que começam com [localização], [contato], [foto], [vídeo] ou [arquivo] são o que ela mandou. Foto, vídeo e arquivo você não consegue ver: diga isso em uma frase.
- Pedir confirmação do dia ("confirma as de hoje"): olhe a agenda antes. Quem já respondeu ao lembrete (lembrete "respondeu") não recebe outra mensagem: diga à Gleide quem já confirmou e mande só para quem não respondeu.
- Na agenda, lembrete diz se o lembrete foi enviado e respondido, e resposta_ao_lembrete traz a resposta dela. "Respondeu" não quer dizer que confirmou: leia a resposta. Nunca diga que ela confirmou ou não confirmou sem olhar isso.

COMO GRAVAR AVALIAÇÕES E ATENDIMENTOS QUE ELA CONTA
1. Descubra a cliente. Se ela estiver nas pendências acima, use o cliente_id/agendamento_id de lá.
   Senão, use buscar_cliente. Se vier mais de uma com o mesmo nome, pergunte qual (mostre os 4 últimos dígitos do telefone).
2. ANTES de gravar, mostre um resumo curto do que vai anotar e pergunte se está certo. Exemplo:
   "Anotei pra *Juliana Souza (…2222)*:
   ✅ Fechou — queratina, vietnamita 70 cm, 150 g
   📦 Cabelo chega em ~7 dias + 3 de confecção
   Tá certo?"
   Se ela respondeu VÁRIAS pendências de uma vez (comum em áudio), faça UM resumo só, uma linha por cliente, e peça um único
   "Tá certo?". O que ela não falou (valor, gramas, cm) fica de fora — NÃO segure o resumo esperando isso
   e não peça valor.
3. Só depois do "sim" (ou "isso", "pode", 👍) chame as ferramentas — TODAS as necessárias para o resumo confirmado, uma por cliente/ação.
   Se ela corrigir, ajuste e confirme de novo.
4. Se a ferramenta devolver ERRO, diga em uma frase que não conseguiu gravar e o motivo. Nunca diga que gravou sem o OK da ferramenta.
5. Depois de gravar, confirme em poucas palavras que ficou no CRM, variando (ex.: "Pronto, tá no CRM ✅", "Anotado ✅", "Feito, já tá na ficha dela 👍") e, se ainda houver pendência, pergunte a próxima (uma por vez).

REGRAS
- Nunca invente valor, gramas, técnica, data ou resultado. Use só o que ela disse. Não pergunte valor: se ela falar, grave; se não, siga sem.
- "fechou" = vai fazer o serviço; "pensando" = ficou de decidir (pergunte quando chamar de novo e grave em data_proximo_passo); "nao_fechou" = desistiu (pergunte o motivo uma vez).
- A cliente decidiu e só falta o cabelo chegar ou ser confeccionado: é "fechou" (veja FECHOU abaixo).
- Ainda depende de algo (da cliente ou da Gleide) é "pensando", nunca "fechou". Sempre com proximo_passo e uma data AAAA-MM-DD:
  nessa data você pergunta para a Gleide como ficou.
  "Ela vai querer pra fevereiro" → pensando, proximo_passo "chamar para marcar a aplicação", data = primeiro dia útil do mês que ela disse.
  "Vou procurar o cabelo pra ela" → pensando, proximo_passo "Gleide procurar o cabelo e avisar a cliente", data = daqui a 3 dias
  (ou o prazo que ela disser). Quando ela disser que achou, ofereça chamar a cliente; se ela mandar chamar, chame na hora.
  data_proximo_passo é só data, sempre no futuro: "fevereiro" vira o próximo 1º de fevereiro a partir de hoje (nunca um que já passou),
  "semana que vem" vira a segunda que vem. Campo que ela não disse (valor, cm, gramas, técnica, tipo de cabelo) vai vazio, nunca 0 nem "não informado".
- Mostre isso no resumo antes de gravar, ex.: "*Elisângela*: ficou pra fevereiro — te pergunto dia 01/02 💬".
- Avaliação que fechou e já marcou a aplicação: grave o resultado com proximo_passo "aplicação marcada DD/MM às HH:mm" e
  data_proximo_passo nessa data (calcule "terça que vem" a partir da data atual). Se a aplicação ainda não está na agenda,
  ofereça marcar (marcar_horario com o serviço de aplicação da técnica que fechou).
- FECHOU sem aplicação na agenda: antes do resumo, pergunte numa mensagem só (uma vez) o que ficou combinado com a cliente
  e quando ela volta. Se depende do cabelo: "O cabelo já tá aí? Se não, chega em uns quantos dias? Vai precisar confeccionar?
  Quantos dias?". Grave fechou com proximo_passo = o combinado (ex.: "aplicação queratina 70 cm, cabelo vem pela
  transportadora"), dias_chegada e dias_confeccao com os números que ela disse e data_proximo_passo VAZIA: o sistema calcula
  o dia (chegada + confecção + 1) e devolve em data_proximo_passo; depois de gravar, diga esse dia ("te pergunto dia DD/MM"). Se ela já disser o dia da
  aplicação, ofereça marcar. Se ela não souber prazo nenhum, use dias_chegada 7. Não insista na mesma conversa.
- Pendência [fechou_sem_data]: chegou o dia de saber se o cabelo chegou. Se já tem dia, ofereça marcar a aplicação
  (marcar_horario). Se ainda não chegou, pergunte a nova previsão e grave fechou de novo com dias_chegada/dias_confeccao
  novos (sem previsão: dias_chegada 5). Ela respondeu "depois eu vejo"? Tudo bem, não cobre de novo agora: o sistema
  pergunta de novo em 3 dias.
- Fez um serviço A MAIS do que estava na agenda (ex.: marcou hidratação e fez selagem também): concluir no horário agendado
  com extras (nunca um horário novo para o serviço a mais).
- Pediu para chamar a cliente daqui X dias: calcule a data e grave com anotar ("Chamar em DD/MM: motivo"). Diga que ficou anotado
  na ficha (o envio automático ainda não existe — não prometa que você vai mandar).
- Uma pergunta por mensagem. Se ela não responder algo, não insista.
- Cliente que NÃO veio: depois da confirmação, grave status faltou. A IA de atendimento chama a cliente sozinha (em até
  5 min, no horário do salão) para marcar outro horário, e você avisa a Gleide quando ela remarcar ou se não responder.
  Diga isso numa frase curta ("Anotei a falta. Vou chamar ela pra remarcar e te aviso 👍").
- Cliente ATRASADA (pendência atraso_confirmar, ou o aviso "⏰ … não chegou nem respondeu. Ela está aí?"): aqui a resposta
  dela já é a confirmação, não peça "tá certo?" (é na hora, ela está ocupada).
  "veio", "tá aqui", "chegou" → status_atendimento realizado e responda "Beleza ✅".
  "libera", "não veio", "pode liberar" → liberar_horario e diga em uma frase o que a ferramenta respondeu sobre a vaga.
  Se não ficou claro, pergunte só "Ela veio?". Nunca libere sem ela dizer: sem resposta, o horário continua da cliente.
- Se ela disser que uma cliente que você liberou apareceu depois, use status_atendimento realizado (o sistema avisa se outra
  já tinha adiantado para aquele horário).
- Você só fala com clientes por avisar_cliente e chamar_cliente, quando a Gleide pediu (o pedido dela já vale como sim). Não existe envio agendado: se ela pedir para
  chamar a cliente num dia futuro, anote e diga que o envio automático ainda não existe.
- Avisos que você mandou ("✅ Remarquei…", "⚠️ … não respondeu") ficam na conversa: se ela responder a eles, entenda pelo contexto.
- Mensagens que começam com [áudio] são a transcrição de um áudio dela.`;

module.exports = ({ env, node, str, main, toolSub, workflow }) => {
  const REDIS = { redis: { id: env.N8N_REDIS_CRED_ID || '', name: 'Redis local' } };
  // A mesma senha do webhook do WhatsApp (header x-webhook-token): fica na credencial do n8n, não no Git.
  const SENHA_WEBHOOK = { httpHeaderAuth: { id: env.N8N_WEBHOOK_CRED_ID || 'tV8sJuiNWidQ4Dnn', name: 'Webhook WhatsApp (senha da Evolution)' } };
  const GEMINI = env.N8N_GEMINI_CRED_ID ? { googlePalmApi: { id: env.N8N_GEMINI_CRED_ID, name: 'Google Gemini(PaLM) Api account' } } : {};
  const EVO = '={{ $env.EVOLUTION_URL }}';
  const apikey = { parameters: [{ name: 'apikey', value: '={{ $env.EVOLUTION_API_KEY }}' }] };
  // Chama uma função do Supabase (POST /rest/v1/rpc/<funcao>). texto=true devolve a resposta crua em $json.data
  // (sem isso o n8n quebra uma lista em vários itens e uma lista vazia some)
  const supaHeaders = { parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
  ] };
  const rpc = (name, position, funcao, args, { texto = false, ...extra } = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: `={{ $env.SUPABASE_URL }}/rest/v1/rpc/${funcao}`,
    sendHeaders: true, headerParameters: supaHeaders, sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${args}) }}`,
    options: texto ? { response: { response: { responseFormat: 'text', outputPropertyName: 'data' } } } : {},
  }, extra);
  const ifNode = (name, position, conditions) => node(name, 'n8n-nodes-base.if', 2.2, position, {
    conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 }, conditions, combinator: 'and' },
    options: {},
  });
  const cond = (id, left) => ({ id, leftValue: left, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } });
  const evoPost = (name, position, rota, body, extra = {}) => node(name, 'n8n-nodes-base.httpRequest', 4.2, position, {
    method: 'POST', url: `${EVO}/${rota}/{{ $env.EVOLUTION_INSTANCE }}`,
    sendHeaders: true, headerParameters: apikey, sendBody: true, specifyBody: 'json', jsonBody: `={{ JSON.stringify(${body}) }}`, options: {},
  }, extra);
  const settings = { executionOrder: 'v1', timezone: 'America/Cuiaba', saveDataSuccessExecution: 'all', saveManualExecutions: true };

  // ---------- 1. Principal: número da Gleide vai para a assistente (inclusive o eco do que a assistente mandou) ----------
  workflow.nodes.push(
    ifNode('É a Gleide (assistente)?', [440, -520], [cond('g1', `={{ ${NUMERO_DE('$json.telefone')} !== '' }}`)]),
    node('Repassar para a assistente', 'n8n-nodes-base.httpRequest', 4.2, [660, -600], {
      // 127.0.0.1 e não "localhost": dentro do n8n o localhost vira ::1 (IPv6) e a chamada falhava (ECONNREFUSED)
      method: 'POST', url: 'http://127.0.0.1:5678/webhook/assistente-gleide',
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendBody: true, specifyBody: 'json', jsonBody: "={{ JSON.stringify($('Webhook Evolution').item.json.body) }}", options: {},
    }, { credentials: SENHA_WEBHOOK, onError: 'continueRegularOutput' }),
  );
  const depois = workflow.connections['Extrair dados'].main[0][0].node;
  workflow.connections['Extrair dados'] = main('É a Gleide (assistente)?');
  workflow.connections['É a Gleide (assistente)?'] = { main: [
    [{ node: 'Repassar para a assistente', type: 'main', index: 0 }], [{ node: depois, type: 'main', index: 0 }],
  ] };

  // ---------- 2. Subworkflow das ferramentas ----------
  const ferramentasWorkflow = {
    name: 'Assistente - Ferramentas',
    nodes: [
      node('Recebe pedido da assistente', 'n8n-nodes-base.executeWorkflowTrigger', 1.1, [0, 0], {
        workflowInputs: { values: CAMPOS.map((name) => ({ name })) },
      }),
      node('Montar chamada', 'n8n-nodes-base.code', 2, [220, 0], { jsCode: MONTAR_CHAMADA }),
      rpc('Executar no banco', [440, 0], '{{ $json.funcao }}', '$json.args', { texto: true, onError: 'continueRegularOutput' }),
      // avisar_cliente: o banco gravou o contato e devolveu telefone + mensagem; manda pelo número do salão.
      // O eco (fromMe) bate com o contato no principal ("É o alô do CRM?") e não pausa a IA da cliente.
      ifNode('Mandar para a cliente?', [660, 0], [cond('e1', "={{ !!$('Montar chamada').first().json.enviar && !$json.error && !!$json.data }}")]),
      evoPost('Mandar para a cliente', [880, -120], 'message/sendText',
        '{ number: JSON.parse($json.data).telefone, text: JSON.parse($json.data).mensagem }',
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
      // o que a assistente mandou aparece na conversa da cliente no app
      ifNode('Enviou?', [1100, -120], [cond('e2', '={{ !!$json.key?.id }}')]),
      rpc('Registrar na conversa', [1320, -200], 'n8n_registrar_saida',
        `{ p_empresa_id: ${EMPRESA}, p_telefone: JSON.parse($('Executar no banco').first().json.data).telefone, p_conteudo: JSON.parse($('Executar no banco').first().json.data).mensagem, p_autor: 'ia', p_tipo: 'texto', p_wa_message_id: $json.key.id }`,
        { onError: 'continueRegularOutput' }),
      // WhatsApp não aceitou: o contato sai do banco, senão a IA acha que a cliente recebeu e a Gleide não consegue tentar de novo
      node('Apagar contato não enviado', 'n8n-nodes-base.httpRequest', 4.2, [1320, -40], {
        method: 'DELETE', url: "={{ $env.SUPABASE_URL }}/rest/v1/contatos?id=eq.{{ JSON.parse($('Executar no banco').first().json.data).contato_id }}",
        sendHeaders: true, headerParameters: supaHeaders, options: {},
      }, { onError: 'continueRegularOutput' }),
      node('Resposta', 'n8n-nodes-base.set', 3.4, [1540, 0], {
        assignments: { assignments: [str('resposta', `={{ (() => {
  const m = $('Montar chamada').first().json, b = $('Executar no banco').first().json;
  if (m.erro) return 'ERRO: ' + m.erro;
  if (b.error) return 'ERRO: ' + (b.error.message || b.message || JSON.stringify(b.error));
  if (!m.enviar) return 'OK: ' + (b.data || 'feito');
  const r = $('Mandar para a cliente').isExecuted ? $('Mandar para a cliente').first().json : null;
  if (!r || !r.key?.id) return 'ERRO: o WhatsApp não enviou a mensagem (' + (r?.error?.message || 'sem resposta') + '). Nada foi enviado para a cliente.';
  return 'OK: mensagem enviada para a cliente: ' + JSON.parse(b.data).mensagem;
})() }}`)] },
        options: {},
      }),
    ],
    connections: {
      'Recebe pedido da assistente': main('Montar chamada'),
      'Montar chamada': main('Executar no banco'),
      'Executar no banco': main('Mandar para a cliente?'),
      'Mandar para a cliente?': { main: [[{ node: 'Mandar para a cliente', type: 'main', index: 0 }], [{ node: 'Resposta', type: 'main', index: 0 }]] },
      'Mandar para a cliente': main('Enviou?'),
      'Enviou?': { main: [[{ node: 'Registrar na conversa', type: 'main', index: 0 }], [{ node: 'Apagar contato não enviado', type: 'main', index: 0 }]] },
      'Registrar na conversa': main('Resposta'),
      'Apagar contato não enviado': main('Resposta'),
    },
    settings: { ...settings, callerPolicy: 'workflowsFromSameOwner' },
  };

  // ---------- 3. Agente da assistente ----------
  const ferramentasIdFile = require('path').join(__dirname, '.workflow-assistente-ferramentas-id');
  const lerFerramentasId = () => (require('fs').existsSync(ferramentasIdFile) ? require('fs').readFileSync(ferramentasIdFile, 'utf8').trim() : 'ID_DO_WORKFLOW_FERRAMENTAS');
  const fixo = { pedido_por: `={{ ${A}.numero }}` };
  const tool = (name, position, description, acao, ia) => toolSub(name, position, description, lerFerramentasId, CAMPOS, { acao, ...fixo }, ia);
  const ID = (q) => [q, `${q} (uuid exato, das pendências ou de buscar_cliente / agenda_do_dia)`, 'string'];

  const assistenteWorkflow = {
    name: 'Assistente da Gleide',
    nodes: [
      node('Webhook assistente', 'n8n-nodes-base.webhook', 2, [0, 0],
        { httpMethod: 'POST', path: 'assistente-gleide', authentication: 'headerAuth', options: {} },
        { webhookId: '5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a80', credentials: SENHA_WEBHOOK }),
      node('Extrair dados', 'n8n-nodes-base.set', 3.4, [220, 0], {
        assignments: { assignments: [
          str('evento', '={{ $json.body.event }}'),
          str('jid', '={{ $json.body.data.key.remoteJid }}'),
          str('telefone', `={{ ${TEL} }}`),
          // o número como está em ASSISTENTE_NUMEROS / config.assistente_numeros (é o que o banco confere)
          str('numero', `={{ ${NUMERO_DE(TEL)} }}`),
          { id: 'a-fromMe', name: 'fromMe', value: '={{ $json.body.data.key.fromMe }}', type: 'boolean' },
          str('msgId', '={{ $json.body.data.key.id }}'),
          str('tipo', '={{ $json.body.data.messageType }}'),
          str('texto', TEXTO_RECEBIDO),
        ] },
        options: {},
      }),
      ifNode('Filtro', [440, 0], [
        cond('f1', "={{ $json.evento === 'messages.upsert' && !$json.fromMe }}"),
        cond('f2', "={{ $json.numero !== '' }}"),
        cond('f3', "={{ $json.tipo === 'audioMessage' || $json.texto.trim() !== '' }}"),
      ]),
      ifNode('É áudio?', [660, 0], [cond('au', "={{ $json.tipo === 'audioMessage' }}")]),
      evoPost('Baixar áudio (Evolution)', [880, -120], 'chat/getBase64FromMediaMessage',
        `{ message: { key: { id: ${A}.msgId } }, convertToMp4: false }`, { onError: 'continueRegularOutput' }),
      node('Transcrever (Gemini)', 'n8n-nodes-base.httpRequest', 4.2, [1100, -120], {
        method: 'POST', url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent',
        authentication: 'predefinedCredentialType', nodeCredentialType: 'googlePalmApi',
        sendBody: true, specifyBody: 'json',
        jsonBody: "={{ JSON.stringify({ contents: [{ parts: [ { text: 'Transcreva este áudio de WhatsApp em português do Brasil, exatamente como foi falado. Responda só com a transcrição, sem comentários.' }, { inline_data: { mime_type: String($json.mimetype || 'audio/ogg').split(';')[0], data: $json.base64 } } ] }] }) }}",
        options: {},
      }, { credentials: GEMINI, onError: 'continueRegularOutput' }),
      node('Texto da mensagem', 'n8n-nodes-base.set', 3.4, [1320, 0], {
        assignments: { assignments: [str('texto',
          `={{ (() => { if (${A}.tipo !== 'audioMessage') return ${A}.texto; const r = ($json.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join(' ').trim(); return r ? '[áudio] ' + r : '[áudio que não consegui ouvir]'; })() }}`)] },
        options: {},
      }),
      // ---- junta as mensagens seguidas (09/11/2026): a Gleide manda em pedaços ("16992438819", "fala com esta
      // cliente", "Dalila"…) e cada pedaço virava uma resposta e um cadastro. Igual ao atendimento: guarda, espera
      // 15 s sem mensagem nova dela e responde tudo junto; uma trava evita duas respostas ao mesmo tempo.
      node('Buffer: guardar', 'n8n-nodes-base.redis', 1, [1320, 120], {
        // guarda a hora: se uma execução morrer no meio, o Juntar ignora o que tem mais de 10 min
        operation: 'push', list: `=assist_buffer:{{ ${A}.numero }}`, messageData: "={{ JSON.stringify({ texto: $json.texto, em: Date.now() }) }}", tail: true,
      }, { credentials: REDIS }),
      node('Buffer: marcar última', 'n8n-nodes-base.redis', 1, [1380, 120], {
        operation: 'set', key: `=assist_ultima:{{ ${A}.numero }}`, value: `={{ ${A}.msgId }}`, expire: true, ttl: 180,
      }, { credentials: REDIS }),
      node('Aguardar (juntar mensagens)', 'n8n-nodes-base.wait', 1.1, [1400, 120], { resume: 'timeInterval', amount: 15, unit: 'seconds' },
        { webhookId: '3e4f5a6b-7c8d-4e9f-9a0b-1c2d3e4f5a61' }),
      node('Buffer: ler última', 'n8n-nodes-base.redis', 1, [1420, 120], {
        operation: 'get', key: `=assist_ultima:{{ ${A}.numero }}`, propertyName: 'ultima', keyType: 'string', options: {},
      }, { credentials: REDIS }),
      ifNode('É a última mensagem?', [1440, 120], [cond('ul', `={{ $json.ultima === ${A}.msgId }}`)]),
      node('Trava: ler', 'n8n-nodes-base.redis', 1, [1460, 120], {
        operation: 'get', key: `=assist_processando:{{ ${A}.numero }}`, propertyName: 'processando', keyType: 'string', options: {},
      }, { credentials: REDIS }),
      ifNode('Livre?', [1480, 120], [cond('lv', '={{ !$json.processando }}')]),
      node('Aguardar 3s (respondendo)', 'n8n-nodes-base.wait', 1.1, [1500, 220], { resume: 'timeInterval', amount: 3, unit: 'seconds' },
        { webhookId: '4f5a6b7c-8d9e-4f0a-8b1c-2d3e4f5a6b72' }),
      node('Trava: marcar', 'n8n-nodes-base.redis', 1, [1500, 120], {
        operation: 'set', key: `=assist_processando:{{ ${A}.numero }}`, value: `={{ ${A}.msgId }}`, expire: true, ttl: 180,
      }, { credentials: REDIS }),
      node('Buffer: ler mensagens', 'n8n-nodes-base.redis', 1, [1520, 120], {
        operation: 'get', key: `=assist_buffer:{{ ${A}.numero }}`, propertyName: 'mensagens', keyType: 'list', options: {},
      }, { credentials: REDIS }),
      node('Buffer: limpar', 'n8n-nodes-base.redis', 1, [1540, 120], {
        operation: 'delete', key: `=assist_buffer:{{ ${A}.numero }}`,
      }, { credentials: REDIS }),
      node('Juntar mensagens', 'n8n-nodes-base.set', 3.4, [1560, 120], {
        assignments: { assignments: [str('texto',
          "={{ (() => { const agora = Date.now(); const ms = [].concat($('Buffer: ler mensagens').first().json.mensagens || []).map((m) => { try { const o = JSON.parse(m); if (o && typeof o.texto === 'string') return o; } catch (e) {} return { texto: String(m), em: agora }; }).filter((o) => o.texto.trim() && agora - (Number(o.em) || agora) < 600000).map((o) => o.texto); if (!ms.length) return $('Texto da mensagem').first().json.texto; return ms.length > 1 ? 'Ela mandou ' + ms.length + ' mensagens seguidas (leia como um pedido só):\\n' + ms.map((m, i) => '[' + (i + 1) + '] ' + m).join('\\n') : ms[0]; })() }}")] },
        options: {},
      }),
      node('Trava: liberar', 'n8n-nodes-base.redis', 1, [2200, 0], {
        operation: 'delete', key: `=assist_processando:{{ ${A}.numero }}`,
      }, { credentials: REDIS, onError: 'continueRegularOutput' }),
      rpc('Ler pendências', [1540, 0], 'n8n_assistente_pendencias_texto', `{ p_empresa_id: ${EMPRESA} }`,
        { texto: true, alwaysOutputData: true, onError: 'continueRegularOutput' }),
      // regras fixas que ela mandou guardar (supabase/035): valem até ela mandar tirar
      rpc('Ler regras', [1600, -60], 'n8n_assistente_regras_texto', `{ p_empresa_id: ${EMPRESA} }`,
        { texto: true, alwaysOutputData: true, onError: 'continueRegularOutput' }),
      // pedidos da IA que a Gleide ainda não respondeu (somem do Redis quando ela responde ou em 3 dias)
      node('Ler pedidos abertos', 'n8n-nodes-base.redis', 1, [1650, -140], {
        operation: 'keys', keyPattern: 'pedido:*', getValues: true,
      }, { credentials: REDIS, alwaysOutputData: true, onError: 'continueRegularOutput' }),
      node('Agente assistente', '@n8n/n8n-nodes-langchain.agent', 3.1, [1760, 0], {
        promptType: 'define', text: "={{ $('Juntar mensagens').first().json.texto }}",
        // returnIntermediateSteps: dá para ver depois o que ela executou, e o "Conferir resposta" usa para não dizer que mandou sem ter mandado
        options: { systemMessage: '=' + PROMPT, returnIntermediateSteps: true },
      // Gemini falhou: tenta de novo; se ainda falhar, segue sem resposta (o Conferir manda "deu um erro, pode repetir?")
      // e a trava é liberada no fim, em vez de ficar presa 3 min
      }, { retryOnFail: true, maxTries: 2, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
      // Ela dizia "Avisei ✅" / "Mandei" sem ter chamado a ferramenta de envio (05/11/2026: nada saiu para a Sandra).
      // Se a resposta afirma envio e nenhuma ferramenta de envio deu certo nesta vez, troca por uma resposta honesta.
      node('Conferir resposta', 'n8n-nodes-base.code', 2, [1860, 0], { jsCode: [
        "const ag = $('Agente assistente').first().json;",
        "let texto = String(ag.output || '').trim();",
        "const passos = Array.isArray(ag.intermediateSteps) ? ag.intermediateSteps : [];",
        // a ferramenta responde "OK: mensagem enviada…" ou "ERRO: …" (nó Resposta das Ferramentas); o texto da cliente vem junto,
        // então só o começo da resposta diz se saiu
        // a ferramenta pode voltar como texto ou como JSON ({"resposta":"OK: …"} ou [{…}])
        "const lerResposta = (o) => { const t = typeof o === 'string' ? o : JSON.stringify(o || ''); try { const j = JSON.parse(t); const x = Array.isArray(j) ? j[0] : j; if (x && typeof x.resposta === 'string') return x.resposta; } catch (e) {} return t; };",
        "const enviou = passos.some((s) => ['chamar_cliente', 'avisar_cliente'].includes(s.action?.tool) && /^\\s*OK\\b/i.test(lerResposta(s.observation)));",
        "const afirma = /\\b(avisei|mandei|enviei)\\b|mensagem (foi )?enviada|já (falei|chamei) com ela/i.test(texto);",
        "const passado = /\\b(ontem|mais cedo|já tinha)\\b/i.test(texto);",
        "let corrigida = false;",
        "if (afirma && !enviou && !passado) { texto = 'Ainda não mandei nada pra ela, Gleide. Quer que eu mande agora? Me confirma o texto que eu envio.'; corrigida = true; }",
        "if (!texto) texto = 'Desculpa, deu um erro aqui. Pode repetir?';",
        "return [{ json: { texto: texto.replace(/\\*\\*(.+?)\\*\\*/g, '*$1*'), corrigida, ferramentas: passos.map((s) => s.action?.tool) } }];",
      ].join('\n') }),
      node('Gemini Flash', '@n8n/n8n-nodes-langchain.lmChatGoogleGemini', 1, [1640, 220], {
        modelName: 'models/gemini-3-flash-preview', options: { temperature: 0.2 },
      }, { credentials: GEMINI }),
      node('Memória (Redis)', '@n8n/n8n-nodes-langchain.memoryRedisChat', 1.5, [1800, 220], {
        sessionIdType: 'customKey', sessionKey: `=assistente:{{ ${A}.numero }}`, sessionTTL: 259200, contextWindowLength: 20,
      }, { credentials: REDIS }),
      tool('buscar_cliente', [1960, 220], 'Procura clientes pelo nome ou telefone. Devolve id, telefone, status, etapa do funil, pré-avaliação, valor orçado, observações e os horários marcados (com agendamento_id).',
        'buscar_cliente', [['busca', 'Nome (ou parte) ou telefone da cliente', 'string']]),
      tool('agenda_do_dia', [2120, 220], 'Lista os horários de um dia (com agendamento_id, hora, fim, cliente, serviço, status, se chegou e serviços a mais).',
        'agenda_do_dia', [['data', 'Dia AAAA-MM-DD (vazio = hoje)', 'string']]),
      tool('resultado_avaliacao', [2280, 220], 'Grava o resultado de uma avaliação. Só use DEPOIS que a Gleide confirmou o resumo.',
        'resultado_avaliacao', [ID('cliente_id'),
          ['resultado', 'fechou, pensando ou nao_fechou', 'string'],
          ['tecnica_indicada', 'Técnica que a Gleide indicou (ex.: queratina, fita adesiva)', 'string'],
          ['tipo_cabelo', 'Tipo de cabelo (ex.: brasileiro, vietnamita)', 'string'],
          ['comprimento_cm', 'Comprimento em cm, só o número', 'string'],
          ['gramas', 'Gramas, só o número', 'string'],
          ['valor', 'Valor orçado em reais, só o número (ex.: 2800). Vazio se ela não disse (nunca 0)', 'string'],
          ['motivo_nao_fechou', 'Se não fechou: motivo', 'string'],
          ['proximo_passo', 'Próximo passo combinado (ex.: chamar sexta). Se fechou: o que ficou combinado com a cliente', 'string'],
          ['data_proximo_passo', 'Data do próximo passo AAAA-MM-DD. Se fechou esperando o cabelo, deixe vazio e use dias_chegada/dias_confeccao', 'string'],
          ['dias_chegada', 'Se fechou e o cabelo ainda vai chegar: em quantos dias chega, só o número (o maior, se ela disse "5 a 7")', 'string'],
          ['dias_confeccao', 'Se fechou e precisa confeccionar: quantos dias de confecção, só o número', 'string'],
          ['observacoes', 'Outras observações da Gleide', 'string']]),
      tool('status_atendimento', [2440, 220], 'Marca um horário como realizado (veio), faltou ou cancelado. Só use DEPOIS da confirmação.',
        'status_atendimento', [ID('agendamento_id'),
          ['status', 'realizado, faltou ou cancelado', 'string'],
          ['valor', 'Valor cobrado em reais, só o número (se ela disse)', 'string']]),
      tool('registrar_atendimento', [2600, 220], 'Registra um atendimento que já aconteceu e não estava na agenda (cliente veio sem marcar). Só use DEPOIS da confirmação.',
        'registrar_atendimento', [
          ['telefone', 'Telefone da cliente (de buscar_cliente, ou o que a Gleide disser)', 'string'],
          ['nome', 'Nome da cliente', 'string'],
          ['servico', 'Serviço feito (ex.: manutenção, aplicação, avaliação)', 'string'],
          ['inicio', 'Quando foi, AAAA-MM-DDTHH:mm (vazio = agora)', 'string'],
          ['valor', 'Valor cobrado em reais, só o número', 'string'],
          ['observacoes', 'Observações', 'string']]),
      tool('anotar', [2760, 220], 'Acrescenta uma anotação na ficha da cliente (alergia, preferência, combinado). Não apaga as anteriores. Só use DEPOIS da confirmação.',
        'anotar', [ID('cliente_id'), ['texto', 'A anotação, curta', 'string']]),
      tool('liberar_horario', [2920, 220], 'Cliente atrasada que NÃO veio: marca falta e oferece o resto do horário para quem tem horário mais tarde hoje. ' +
        'Só use quando a Gleide disser "libera" ou "não veio" para essa cliente. Nunca por conta própria.',
        'liberar_horario', [ID('agendamento_id')]),
      // Ritmo de gente, como no atendimento das clientes: marca como lida, "lê" a mensagem dela,
      // mostra "digitando…" e só então responde (antes a resposta chegava na hora, parecendo robô)
      evoPost('Marcar como lida', [1430, -120], 'chat/markMessageAsRead',
        `{ readMessages: [{ remoteJid: ${A}.jid, fromMe: false, id: ${A}.msgId }] }`, { onError: 'continueRegularOutput' }),
      // lendo: 1,5 s + um pouco pelo tamanho do que ela mandou (áudio conta mais), até 4 s
      // digitando: ~30 ms por letra, entre 2 e 8 s (o WhatsApp apaga o "digitando…" em ~10 s)
      node('Ritmo humano', 'n8n-nodes-base.code', 2, [1900, -120], { jsCode: [
        "const dela = String($('Juntar mensagens').first().json.texto || '');",
        "const texto = String($json.texto || '');",
        "const pausa = Math.min(4, 1.5 + dela.length / 120 + (dela.startsWith('[áudio]') ? 1 : 0));",
        "const delay = Math.round(Math.min(8000, Math.max(2000, texto.length * 30)));",
        'return [{ json: { pausa, delay } }];',
      ].join('\n') }),
      node('Pausa (lendo)', 'n8n-nodes-base.wait', 1.1, [1950, -120], { resume: 'timeInterval', amount: '={{ $json.pausa }}', unit: 'seconds' },
        { webhookId: '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0e' }),
      evoPost('Digitando...', [1980, -120], 'chat/sendPresence',
        `{ number: ${A}.jid, presence: 'composing', delay: $('Ritmo humano').first().json.delay }`, { onError: 'continueRegularOutput' }),
      // ---- agenda pelo WhatsApp (supabase/013) ----
      tool('horarios_livres', [1960, 440], 'Horários livres de um dia para um serviço, de 30 em 30 min (mesmas regras do app: expediente, almoço, dias sem atender, sem encavalar).',
        'horarios_livres', [['data', 'Dia AAAA-MM-DD (vazio = hoje)', 'string'],
          ['servico', 'Serviço como a Gleide falou (define a duração)', 'string'],
          ['agendamento_id', 'Se for para reagendar: o agendamento_id que vai mudar (o horário dele não conta como ocupado). Senão vazio', 'string']]),
      tool('marcar_horario', [2120, 440], 'Marca um horário novo na agenda. Cliente da lista (cliente_id) ou nova (nome + telefone). Só use DEPOIS do sim da Gleide. Nunca use para conseguir falar com uma cliente: para isso existe chamar_cliente.',
        'marcar_horario', [
          ['cliente_id', 'cliente_id de buscar_cliente (vazio se for cliente nova)', 'string'],
          ['nome', 'Nome da cliente nova', 'string'],
          ['telefone', 'Telefone com DDD da cliente nova', 'string'],
          ['servico', 'Serviço como a Gleide falou', 'string'],
          ['inicio', 'Dia e hora AAAA-MM-DDTHH:mm', 'string'],
          ['observacoes', 'Observação do horário (se ela disse)', 'string'],
          ['minutos', 'Quanto tempo vai levar, em minutos, SÓ se a Gleide disse (ex.: "uma hora e meia" = 90); senão vazio (vale o tempo do cadastro)', 'string'],
          ['forcar', '"sim" só se a Gleide mandou marcar mesmo com o problema que a ferramenta apontou; senão vazio', 'string']]),
      tool('ajustar_duracao', [2440, 660], 'Muda quanto tempo leva um horário JÁ marcado, sem mudar o início (ex.: "a da Vitória vai levar só uma hora e meia"). Pode usar direto quando ela disse qual horário e quanto tempo.',
        'ajustar_duracao', [ID('agendamento_id'), ['minutos', 'Quanto tempo vai levar, em minutos (ex.: 90)', 'string'],
          ['forcar', '"sim" só se a Gleide mandou mudar mesmo com o problema que a ferramenta apontou; senão vazio', 'string']]),
      tool('reagendar', [2280, 440], 'Muda o horário (e o serviço, se ela pedir) do MESMO agendamento. Pode usar direto quando ela disse qual horário e para quando.',
        'reagendar', [ID('agendamento_id'),
          ['inicio', 'Novo dia e hora AAAA-MM-DDTHH:mm', 'string'],
          ['servico', 'Novo serviço, só se ela pediu para trocar; senão vazio', 'string'],
          ['forcar', '"sim" só se a Gleide mandou mudar mesmo com o problema que a ferramenta apontou; senão vazio', 'string']]),
      tool('atrasar_agenda', [2440, 440], 'Empurra (ou adianta, minutos negativos) todos os horários a atender do dia a partir de uma hora. Só use DEPOIS do sim da Gleide.',
        'atrasar_agenda', [['minutos', 'Quantos minutos (ex.: 30; negativo adianta)', 'string'],
          ['a_partir', 'Hora HH:mm do primeiro horário que muda', 'string'],
          ['data', 'Dia AAAA-MM-DD (vazio = hoje)', 'string']]),
      tool('concluir', [2600, 440], 'O ✓ do app: marca o horário como realizado, com o serviço feito e os serviços a mais. Só use DEPOIS do sim da Gleide.',
        'concluir', [ID('agendamento_id'),
          ['servico', 'Só se ela fez OUTRO serviço no lugar do marcado; senão vazio', 'string'],
          ['extras', 'Serviços feitos A MAIS, separados por vírgula (ex.: selagem, hidratação); senão vazio', 'string'],
          ['valor', 'Valor cobrado em reais, só o número (se ela disse)', 'string']]),
      tool('chegou', [2760, 440], 'A cliente chegou ao salão (botão "Chegou" do app): a IA não cobra atraso dela.',
        'chegou', [ID('agendamento_id'), ['desfazer', '"sim" para desfazer um "chegou" marcado por engano; senão vazio', 'string']]),
      tool('excluir_horario', [2920, 440], 'Apaga de vez um horário lançado por engano (cliente que desmarcou é status_atendimento cancelado). Só use DEPOIS do sim da Gleide.',
        'excluir_horario', [ID('agendamento_id')]),
      tool('bloquear_dias', [3080, 440], 'Marca dias sem atender (viagem, folga, curso): o app e a IA de atendimento param de oferecer horário. Devolve os horários já marcados nesses dias. Só use DEPOIS do sim da Gleide.',
        'bloquear_dias', [['data', 'Primeiro dia AAAA-MM-DD', 'string'], ['ate', 'Último dia AAAA-MM-DD (vazio = só um dia)', 'string'],
          ['texto', 'Motivo (ex.: viagem)', 'string']]),
      tool('desbloquear_dias', [3240, 440], 'Tira o bloqueio que cobre um dia (o salão volta a atender). Só use DEPOIS do sim da Gleide.',
        'desbloquear_dias', [['data', 'Um dia do bloqueio, AAAA-MM-DD', 'string']]),
      tool('bloquear_horario', [3400, 440], 'Marca um período sem atender num dia (ex.: das 14:00 às 16:00): o app e a IA de atendimento param de oferecer esse período. Devolve os horários já marcados nele. Só use DEPOIS do sim da Gleide.',
        'bloquear_horario', [['data', 'Dia AAAA-MM-DD', 'string'], ['hora_inicio', 'Início HH:mm', 'string'], ['hora_fim', 'Fim HH:mm', 'string'], ['texto', 'Motivo (ex.: médico)', 'string']]),
      tool('desbloquear_horario', [3560, 440], 'Tira os períodos sem atender de um dia; com hora_inicio, só o que cobre essa hora. Só use DEPOIS do sim da Gleide.',
        'desbloquear_horario', [['data', 'Dia AAAA-MM-DD', 'string'], ['hora_inicio', 'Uma hora dentro do bloqueio, HH:mm (vazio = todos do dia)', 'string']]),
      tool('ver_bloqueios_horario', [3720, 440], 'Lista os períodos sem atender de um dia ou, sem data, de hoje em diante.',
        'ver_bloqueios_horario', [['data', 'Dia AAAA-MM-DD (vazio = de hoje em diante)', 'string']]),
      tool('pausar_ia', [3080, 220], 'Pausa por 12 h (ou reativa) a IA de atendimento para uma cliente, como no app.',
        'pausar_ia', [ID('cliente_id'), ['desfazer', '"sim" para reativar a IA; vazio para pausar', 'string']]),
      tool('editar_cliente', [3240, 220], 'Corrige o nome ou grava o aniversário da cliente. Só use DEPOIS do sim da Gleide.',
        'editar_cliente', [ID('cliente_id'), ['nome', 'Nome certo (vazio = não muda)', 'string'],
          ['aniversario', 'Aniversário AAAA-MM-DD (se não souber o ano, use 1900) (vazio = não muda)', 'string']]),
      tool('cadastrar_cliente', [3560, 220], 'Salva uma cliente na lista, sem criar horário e sem mandar mensagem. Se o número já existir, usa a ficha que já existe. Devolve o cliente_id.',
        'cadastrar_cliente', [['telefone', 'Telefone com DDD', 'string'], ['nome', 'Nome, só se a Gleide disse (vazio se não souber)', 'string'],
          ['observacoes', 'O que a cliente quer, como a Gleide contou (ex.: quer cabelo vietnamita)', 'string']]),
      tool('chamar_cliente', [3720, 220], 'Manda pelo número do salão uma mensagem para uma cliente, sem precisar de horário. Use quando a Gleide pediu para falar com a cliente (o pedido dela já é o sim).',
        'chamar_cliente', [ID('cliente_id'), ['texto', 'O texto da mensagem (o que a Gleide ditou, ou o que você escreveu fazendo o que ela pediu)', 'string']]),
      tool('avisar_cliente', [3400, 220], 'Manda mensagem para a cliente pelo número do salão sobre um horário dela. Use quando a Gleide pediu (o pedido dela já é o sim).',
        'avisar_cliente', [ID('agendamento_id'),
          ['tipo', '"aviso" (horário mudado, cancelamento, recado) ou "remarcacao" (imprevisto da Gleide: pede para a cliente remarcar)', 'string'],
          ['texto', 'Vazio para a mensagem pronta (horário mudado / remarcação). Outro aviso: o texto da mensagem', 'string']]),
      // regras fixas (supabase/035): o que ela pede para valer "a partir de agora" no jeito da ASSISTENTE trabalhar
      tool('guardar_regra', [3880, 220], 'Guarda uma regra fixa que a Gleide pediu para você seguir sempre ("a partir de agora…", "sempre que…", "nunca mais…"). Fica valendo até ela pedir para tirar. Só para o jeito de VOCÊ trabalhar; regra para a IA de atendimento das clientes você não consegue mudar.',
        'guardar_regra', [['texto', 'A regra, curta e clara, como ela pediu (ex.: "antes de marcar qualquer horário novo, mostrar o resumo e esperar o ok")', 'string']]),
      tool('tirar_regra', [3880, 440], 'Tira uma regra fixa que a Gleide não quer mais.',
        'tirar_regra', [['texto', 'O número da regra (1, 2…) ou um pedaço do texto dela', 'string']]),
      evoPost('Responder a Gleide', [2000, 0], 'message/sendText',
        // **negrito** de markdown aparece com os asteriscos no WhatsApp: vira *negrito*
        // a resposta vem do agente (o $json que chega aqui é o do "digitando…")
        `{ number: ${A}.jid, text: $('Conferir resposta').first().json.texto }`,
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000, onError: 'continueRegularOutput' }),
    ],
    connections: {
      'Webhook assistente': main('Extrair dados'),
      'Extrair dados': main('Filtro'),
      'Filtro': main('É áudio?'),
      'É áudio?': { main: [[{ node: 'Baixar áudio (Evolution)', type: 'main', index: 0 }], [{ node: 'Texto da mensagem', type: 'main', index: 0 }]] },
      'Baixar áudio (Evolution)': main('Transcrever (Gemini)'),
      'Transcrever (Gemini)': main('Texto da mensagem'),
      'Texto da mensagem': main('Buffer: guardar'),
      'Buffer: guardar': main('Buffer: marcar última'),
      'Buffer: marcar última': main('Aguardar (juntar mensagens)'),
      'Aguardar (juntar mensagens)': main('Buffer: ler última'),
      'Buffer: ler última': main('É a última mensagem?'),
      // não é a última: outra execução (a da mensagem mais nova) responde tudo junto
      'É a última mensagem?': { main: [[{ node: 'Trava: ler', type: 'main', index: 0 }], []] },
      'Trava: ler': main('Livre?'),
      // respondendo outra rajada dela: espera 3 s e confere de novo se ainda é a última
      'Livre?': { main: [[{ node: 'Trava: marcar', type: 'main', index: 0 }], [{ node: 'Aguardar 3s (respondendo)', type: 'main', index: 0 }]] },
      'Aguardar 3s (respondendo)': main('Buffer: ler última'),
      'Trava: marcar': main('Buffer: ler mensagens'),
      'Buffer: ler mensagens': main('Buffer: limpar'),
      'Buffer: limpar': main('Juntar mensagens'),
      'Juntar mensagens': main('Marcar como lida'),
      'Marcar como lida': main('Ler pendências'),
      'Ler pendências': main('Ler regras'),
      'Ler regras': main('Ler pedidos abertos'),
      'Ler pedidos abertos': main('Agente assistente'),
      'Agente assistente': main('Conferir resposta'),
      'Conferir resposta': main('Ritmo humano'),
      'Ritmo humano': main('Pausa (lendo)'),
      'Pausa (lendo)': main('Digitando...'),
      'Digitando...': main('Responder a Gleide'),
      'Responder a Gleide': main('Trava: liberar'),
      'Gemini Flash': { ai_languageModel: [[{ node: 'Agente assistente', type: 'ai_languageModel', index: 0 }]] },
      'Memória (Redis)': { ai_memory: [[{ node: 'Agente assistente', type: 'ai_memory', index: 0 }]] },
      ...Object.fromEntries(['buscar_cliente', 'agenda_do_dia', 'resultado_avaliacao', 'status_atendimento', 'registrar_atendimento', 'anotar', 'liberar_horario',
        'horarios_livres', 'marcar_horario', 'ajustar_duracao', 'reagendar', 'atrasar_agenda', 'concluir', 'chegou', 'excluir_horario', 'bloquear_dias',
        'desbloquear_dias', 'bloquear_horario', 'desbloquear_horario', 'ver_bloqueios_horario', 'pausar_ia', 'editar_cliente', 'avisar_cliente', 'cadastrar_cliente', 'chamar_cliente',
        'guardar_regra', 'tirar_regra']
        .map((t) => [t, { ai_tool: [[{ node: 'Agente assistente', type: 'ai_tool', index: 0 }]] }])),
    },
    settings,
  };

  // ---------- 4. Pendências: a assistente puxa a conversa ----------
  const pendenciasWorkflow = {
    name: 'Assistente - Pendências',
    nodes: [
      node('A cada 1 h', 'n8n-nodes-base.scheduleTrigger', 1.2, [0, 0], { rule: { interval: [{ field: 'hours', hoursInterval: 1, triggerAtMinute: 0 }] } }),
      ifNode('Horário do salão?', [220, 0], [cond('h1', "={{ $now.setZone('America/Cuiaba').hour >= 8 && $now.setZone('America/Cuiaba').hour < 20 }}")]),
      node('Disparar agora (teste)', 'n8n-nodes-base.webhook', 2, [0, 200],
        { httpMethod: 'GET', path: 'assistente-pendencias', authentication: 'headerAuth', responseMode: 'lastNode', options: {} },
        // mesma senha do webhook do WhatsApp (header x-webhook-token): sem ela, ninguém dispara de fora
        { webhookId: '6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b91', credentials: { httpHeaderAuth: { id: env.N8N_WEBHOOK_CRED_ID || 'tV8sJuiNWidQ4Dnn', name: 'Webhook WhatsApp (senha da Evolution)' } } }),
      // a mesma pendência: na hora, +1 h e +2 h, depois para (a função já filtra, supabase/011)
      rpc('Pendências novas', [440, 100], 'n8n_assistente_pendencias_novas', `{ p_empresa_id: ${EMPRESA} }`, { onError: 'continueRegularOutput' }),
      node('Montar mensagem', 'n8n-nodes-base.code', 2, [660, 100], { jsCode: String.raw`
const ps = $input.all().map((i) => i.json).filter((p) => p.tipo);
if (!ps.length) return [];
// "Roseli de Souza" vira "Roseli Souza" (antes saía "Roseli de")
const nome = (p) => (p.nome || 'cliente').split(' ').filter((w) => w && !/^(de|da|do|das|dos|e)$/i.test(w)).slice(0, 2).join(' ');
// "hoje às 18:27", "ontem às 18:27" ou "20/10 às 18:27": sem o dia, um horário de ontem confunde
const diaDe = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/Cuiaba' });
const hora = (p) => {
  if (!p.inicio) return '';
  const d = new Date(p.inicio);
  const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Cuiaba' });
  const hoje = diaDe(new Date()), ontem = diaDe(new Date(Date.now() - 86400000)), dia = diaDe(d);
  return (dia === hoje ? 'hoje' : dia === ontem ? 'ontem' : dia.slice(8) + '/' + dia.slice(5, 7)) + ' às ' + h;
};
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const linha = (p) => {
  if (p.tipo === 'avaliacao_sem_resultado') return '• Como foi a avaliação de *' + nome(p) + '* (' + hora(p) + ')? Fechou?';
  if (p.tipo === 'atraso_confirmar') return '• *' + nome(p) + '* (' + hora(p) + ') não chegou nem respondeu. Ela está aí? *veio* ou *libera*';
  if (p.tipo === 'atendimento_sem_status') return '• *' + nome(p) + '* (' + hora(p) + (p.servico ? ', ' + p.servico.toLowerCase() : '') + ') veio?';
  // supabase/038: fechou e a aplicação ainda não está na agenda
  if (p.tipo === 'fechou_sem_data') return p.proximo_passo
    ? '• *' + nome(p) + '* fechou — ' + p.proximo_passo + '. O cabelo já chegou? Já dá pra marcar a aplicação?'
    : '• *' + nome(p) + '* fechou. O que ficou combinado e quando ela volta? Se depende do cabelo: chega em quantos dias e precisa confeccionar?';
  return '• *' + nome(p) + '* ficou de pensar' + (p.valor_orcado ? ' (' + brl(p.valor_orcado) + ')' : '') + '. Alguma novidade?';
};
const texto = 'Oi, Gleide! Pra deixar o CRM em dia:\n' + ps.map(linha).join('\n') + '\n\nPode responder em áudio, do seu jeito 🙂';
const ids = ps.map((p) => p.pendencia_id);
const numeros = ${NUMEROS};
return numeros.map((tel) => ({ json: { tel, texto, ids,
  // mesma estrutura que o nó de memória do n8n grava, para o agente saber o que perguntou
  memoria: JSON.stringify({ type: 'ai', data: { content: texto, additional_kwargs: {}, response_metadata: {}, tool_calls: [], invalid_tool_calls: [] } }) } }));
` }),
      evoPost('Mandar para a Gleide', [880, 100], 'message/sendText', '{ number: $json.tel, text: $json.texto }',
        { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 }),
      node('Guardar na memória do agente', 'n8n-nodes-base.redis', 1, [1100, 100], {
        operation: 'push', list: "=assistente:{{ $('Montar mensagem').item.json.tel }}",
        messageData: "={{ $('Montar mensagem').item.json.memoria }}", tail: false,
      }, { credentials: REDIS }),
      rpc('Marcar como perguntado', [1320, 100], 'n8n_assistente_marcar_perguntado',
        `{ p_empresa_id: ${EMPRESA}, p_pedido_a: $('Montar mensagem').item.json.tel, p_ids: $('Montar mensagem').item.json.ids }`),
    ],
    connections: {
      'A cada 1 h': main('Horário do salão?'),
      'Horário do salão?': main('Pendências novas'),
      'Disparar agora (teste)': main('Pendências novas'),
      'Pendências novas': main('Montar mensagem'),
      'Montar mensagem': main('Mandar para a Gleide'),
      'Mandar para a Gleide': main('Guardar na memória do agente'),
      'Guardar na memória do agente': main('Marcar como perguntado'),
    },
    settings,
  };

  return { assistenteWorkflow, ferramentasWorkflow, pendenciasWorkflow, ferramentasIdFile };
};
