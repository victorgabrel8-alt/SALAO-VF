// A assistente da dona lê foto e print (só nas lojas com "assistente_fotos": true no loja.json; a Gleide não passa por aqui).
// 13/11/2026, Caroline: ela mandou o print da conversa de uma cliente para mostrar o erro e a assistente respondeu
// "não consigo ver fotos". Agora a foto segue o caminho do áudio: baixa pela Evolution, o Gemini descreve
// (print de conversa, comprovante, agenda, foto de unha) e a descrição entra como texto da mensagem dela.

const PEDIDO_FOTO = 'A dona de um studio de unhas mandou esta imagem para a assistente dela no WhatsApp. Diga em português, de forma objetiva, o que é: ' +
  'print de conversa de WhatsApp, comprovante de pagamento, agenda ou lista de horários, foto de unha ou outra coisa. ' +
  'Se for print de conversa: transcreva as mensagens na ordem em que aparecem, dizendo quem falou em cada uma (a cliente ou o salão) e a hora, se aparecer; diga o nome do contato que aparece no topo. ' +
  'Se for comprovante: valor, data e hora, quem pagou e quem recebeu. ' +
  'Se for agenda ou lista: transcreva nomes, dias e horas como estão. ' +
  'Se for foto de unha: descreva em uma frase (formato, cor, decoração). ' +
  'Não invente o que não dá para ler; diga o que ficou ilegível.';

module.exports = ({ assistenteWorkflow: wf }) => {
  if (PEDIDO_FOTO.includes("'")) throw new Error('assistente_fotos: aspas simples no pedido da foto');
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`assistente_fotos: não achei "${nome}"`); return n; };
  const trocar = (texto, de, para, onde) => { if (!String(texto).includes(de)) throw new Error(`assistente_fotos: "${onde}" mudou`); return String(texto).replace(de, () => para); };
  // 1. foto entra no caminho do áudio
  const c = achar('É áudio?').parameters.conditions.conditions[0];
  c.leftValue = trocar(c.leftValue, "$json.tipo === 'audioMessage'", "['audioMessage', 'imageMessage'].includes($json.tipo)", 'É áudio?');
  // 2. o Gemini recebe o pedido certo para cada tipo
  const g = achar('Transcrever (Gemini)');
  g.parameters.jsonBody = trocar(g.parameters.jsonBody,
    "{ text: 'Transcreva este áudio de WhatsApp em português do Brasil, exatamente como foi falado. Responda só com a transcrição, sem comentários.' }",
    "{ text: $('Extrair dados').first().json.tipo === 'imageMessage' ? '" + PEDIDO_FOTO + "' : 'Transcreva este áudio de WhatsApp em português do Brasil, exatamente como foi falado. Responda só com a transcrição, sem comentários.' }",
    'Transcrever (Gemini)');
  g.parameters.jsonBody = trocar(g.parameters.jsonBody, "String($json.mimetype || 'audio/ogg')", "String($json.mimetype || ($('Extrair dados').first().json.tipo === 'imageMessage' ? 'image/jpeg' : 'audio/ogg'))", 'Transcrever (Gemini) mime');
  // 3. o texto que chega ao agente
  const t = achar('Texto da mensagem').parameters.assignments.assignments.find((a) => a.name === 'texto');
  if (!t) throw new Error('assistente_fotos: "Texto da mensagem" sem o campo texto');
  t.value = trocar(t.value, "if ($('Extrair dados').first().json.tipo !== 'audioMessage') return $('Extrair dados').first().json.texto;",
    "const tipoMsg = $('Extrair dados').first().json.tipo; if (!['audioMessage', 'imageMessage'].includes(tipoMsg)) return $('Extrair dados').first().json.texto;", 'Texto da mensagem (início)');
  t.value = trocar(t.value, "return r ? '[áudio] ' + r : '[áudio que não consegui ouvir]';",
    "if (tipoMsg === 'imageMessage') { const legenda = String($('Extrair dados').first().json.texto || '').replace('[foto que não consigo ver]', '').trim(); " +
    "return (r ? '[foto que ela mandou; o que aparece nela] ' + r : '[foto que não consegui abrir]') + (legenda ? ' | Legenda dela: ' + legenda : ''); } " +
    "return r ? '[áudio] ' + r : '[áudio que não consegui ouvir]';", 'Texto da mensagem (fim)');
};
