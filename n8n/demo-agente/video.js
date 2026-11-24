// A cliente mandou um VÍDEO: a IA assiste e responde (vale para a Gleide e para as lojas).
// 16/11/2026, pedido do Victor. Até aqui o filtro da entrada só deixava passar texto, áudio e foto: vídeo era descartado
// em silêncio, nem aparecia no app. Caso real (Gleide, 15/11): a IA pediu uma foto do cabelo, a cliente mandou um vídeo
// de 9 segundos e ficou um dia sem resposta.
// Agora o vídeo segue o mesmo caminho do áudio e da foto: baixa na Evolution, o Gemini descreve (e transcreve o que ela
// fala) e a IA recebe "[vídeo da cliente] …". Vídeo longo ou pesado demais não é baixado: a IA recebe
// "[vídeo da cliente que não consegui abrir]" e pede uma foto ou que ela conte por escrito. Nunca fica sem resposta.
// Roda depois dos outros módulos (sinal-pix.js e companhia já mexeram nestes nós): por isso troca pedaços, não o nó todo.

const MAX_SEGUNDOS = 90;
const MAX_BYTES = 14000000; // o pedido ao Gemini com o arquivo embutido não pode passar de ~20 MB (base64 cresce 1/3)
const PEDIDO = 'Uma cliente de um salão mandou este vídeo curto no WhatsApp. Descreva em português, em no máximo 4 frases objetivas, ' +
  'só o que dá para ver e ouvir e importa para o salão: se mostra o cabelo ou as unhas da própria pessoa ou se é um vídeo de referência ' +
  '(modelo, vídeo de internet); comprimento aproximado, cor, textura e volume do cabelo, e se aparenta mega hair, mechas ou química; ' +
  'se ela fala alguma coisa no vídeo, escreva o que ela diz. Se a luz ou o enquadramento não deixam ver direito, diga isso. ' +
  'Não avalie saúde do fio nem couro cabeludo. Não invente.';
const REGRA = `

VÍDEO DA CLIENTE
- "[vídeo da cliente] …" é a descrição de um vídeo que ela mandou (o que aparece e o que ela fala). Trate como trata uma foto:
  responda ao que ela mostrou e siga a conversa. Não diga que não consegue ver vídeo.
- "[vídeo da cliente que não consegui abrir]": ela mandou para mostrar algo dela, então isso ganha atenção na resposta. Agradeça,
  diga com leveza que o vídeo não abriu aqui e peça uma foto ou que ela conte o que queria mostrar, ligando ao que ela quer
  ("Obrigada por mandar! O vídeo não abriu aqui pra mim. Consegue me mandar uma foto ou me contar o que queria mostrar?").
  Não finja que viu e não deixe para "a ligação" ou "o dia".`;

module.exports = ({ workflow, D }) => {
  const achar = (nome) => { const n = workflow.nodes.find((x) => x.name === nome); if (!n) throw new Error(`video: não achei "${nome}"`); return n; };
  const trocar = (texto, de, para, onde) => {
    if (String(texto).split(de).length !== 2) throw new Error(`video: "${onde}" mudou (${de.slice(0, 50)})`);
    return String(texto).replace(de, () => para);
  };
  const campo = (n, nome) => { const a = n.parameters.assignments.assignments.find((x) => x.name === nome); if (!a) throw new Error(`video: "${n.name}" sem o campo ${nome}`); return a; };
  const condicao = (n, id) => { const c = n.parameters.conditions.conditions.find((x) => x.id === id); if (!c) throw new Error(`video: "${n.name}" sem a condição ${id}`); return c; };

  // 1. entrada: legenda do vídeo vale como texto; tamanho e duração para decidir se dá para assistir
  const dados = achar('Extrair dados');
  const texto = campo(dados, 'texto');
  texto.value = trocar(texto.value, '$json.body.data.message?.imageMessage?.caption ||',
    '$json.body.data.message?.imageMessage?.caption || $json.body.data.message?.videoMessage?.caption ||', 'Extrair dados (texto)');
  dados.parameters.assignments.assignments.push(
    { id: 'a-videoSeg', name: 'videoSeg', type: 'number', value: '={{ Number($json.body.data.message?.videoMessage?.seconds || 0) }}' },
    { id: 'a-videoBytes', name: 'videoBytes', type: 'number', value: "={{ Number($json.body.data.message?.videoMessage?.fileLength?.low ?? $json.body.data.message?.videoMessage?.fileLength ?? 0) || 0 }}" });

  // 2. o filtro deixa o vídeo passar
  const c4 = condicao(achar('Filtro'), 'c4');
  c4.leftValue = trocar(c4.leftValue, "['audioMessage', 'imageMessage'].includes($json.tipo)", "['audioMessage', 'imageMessage', 'videoMessage'].includes($json.tipo)", 'Filtro');

  // 3. vídeo curto e leve é baixado e assistido; o resto segue sem baixar
  const a1 = condicao(achar('É áudio ou foto?'), 'a1');
  a1.leftValue = trocar(a1.leftValue, `['audioMessage', 'imageMessage'].includes(${D}.tipo)`,
    `(['audioMessage', 'imageMessage'].includes(${D}.tipo) || (${D}.tipo === 'videoMessage' && ${D}.videoSeg <= ${MAX_SEGUNDOS} && ${D}.videoBytes <= ${MAX_BYTES}))`, 'É áudio ou foto?');

  // 4. o Gemini descreve o vídeo
  const g = achar('Entender mídia (Gemini)');
  g.parameters.jsonBody = trocar(g.parameters.jsonBody, "{ text: $('Extrair dados').first().json.tipo === 'imageMessage' ?",
    `{ text: $('Extrair dados').first().json.tipo === 'videoMessage' ? '${PEDIDO}' : $('Extrair dados').first().json.tipo === 'imageMessage' ?`, 'Entender mídia (pedido)');
  g.parameters.jsonBody = trocar(g.parameters.jsonBody, "String($json.mimetype || 'audio/ogg')",
    "String($json.mimetype || ($('Extrair dados').first().json.tipo === 'videoMessage' ? 'video/mp4' : 'audio/ogg'))", 'Entender mídia (tipo do arquivo)');
  g.parameters.options = { ...(g.parameters.options || {}), timeout: 60000 };

  // 5. o que a IA recebe
  const t = campo(achar('Texto da mensagem'), 'texto');
  t.value = trocar(t.value, "if (!['audioMessage', 'imageMessage'].includes(tipo)) return", "if (!['audioMessage', 'imageMessage', 'videoMessage'].includes(tipo)) return", 'Texto da mensagem (tipos)');
  t.value = trocar(t.value, "if (tipo === 'audioMessage') return r ?",
    `if (tipo === 'videoMessage') return (r ? '[vídeo da cliente] ' + r : '[vídeo da cliente que não consegui abrir]') + (${D}.texto ? ' Legenda: ' + ${D}.texto : ''); if (tipo === 'audioMessage') return r ?`, 'Texto da mensagem (vídeo)');

  // 6. o roteiro sabe o que fazer com o vídeo
  const agente = achar('Agente IA');
  if (!agente.parameters.options?.systemMessage) throw new Error('video: "Agente IA" sem roteiro');
  agente.parameters.options.systemMessage += REGRA;
};
