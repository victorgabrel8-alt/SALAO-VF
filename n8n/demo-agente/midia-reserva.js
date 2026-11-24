// Leitura de foto, áudio e vídeo com modelo reserva (pedido do Victor, 24/11/2026).
// Em 24/11 o Gemini 3 Flash (prévia) ficou sobrecarregado: a foto baixava em 0,1 s, mas o "Entender mídia (Gemini)"
// respondia "Service unavailable" ou estourava os 60 s, e a IA dizia à cliente que a foto não abriu (Paula 2495,
// Noraneuza 4712). A conversa já tinha "Gemini reserva" (needsFallback no Agente IA); a mídia não tinha.
// Agora:
//   - o principal tenta 2 vezes, com 20 s cada (antes 1 vez de 60 s);
//   - se não veio texto, "Entender mídia (reserva)" faz o mesmo pedido em outro modelo (a sobrecarga é por modelo);
//   - "Texto da mensagem" continua lendo $json: recebe a resposta de quem respondeu.
// Roda por último, depois de todos os módulos que mexem no pedido (sinal-pix, vídeo), para a reserva copiar o pedido final.
module.exports = ({ workflow: wf, ifNode, cond, modelo }) => {
  const achar = (nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error('midia-reserva: sem o nó ' + nome); return n; };
  const g = achar('Entender mídia (Gemini)');
  achar('Texto da mensagem');
  const lig = wf.connections['Entender mídia (Gemini)']?.main?.[0] || [];
  if (lig.length !== 1 || lig[0].node !== 'Texto da mensagem') throw new Error('midia-reserva: esperava Entender mídia (Gemini) -> Texto da mensagem');
  const m = String(g.parameters.url || '').match(/\/models\/([^:]+):generateContent/);
  if (!m) throw new Error('midia-reserva: a url do Entender mídia mudou');
  const reserva = String(modelo || '').replace(/^models\//, '');
  if (!reserva || reserva === m[1]) throw new Error('midia-reserva: modelo reserva igual ao principal');
  const BAIXAR = "$('Baixar mídia (Evolution)').first().json";
  const corpo = String(g.parameters.jsonBody);
  if (!corpo.includes('$json.mimetype') || !corpo.includes('$json.base64')) throw new Error('midia-reserva: o pedido não lê mais $json.mimetype/$json.base64');

  // principal: 2 tentativas curtas
  g.parameters.options = { ...(g.parameters.options || {}), timeout: 20000 };
  g.retryOnFail = true; g.maxTries = 2; g.waitBetweenTries = 1000;

  // veio texto do principal?
  const TEXTO = "($json.candidates?.[0]?.content?.parts || []).some((p) => !p.thought && String(p.text || '').trim())";
  const falhou = ifNode('Mídia: principal falhou?', [g.position[0] + 110, g.position[1] - 160], [
    cond('mr1', '={{ !' + TEXTO + ' }}', { type: 'boolean', operation: 'true', singleValue: true }),
  ]);
  const r = JSON.parse(JSON.stringify(g));
  r.id = g.id.replace(/.{4}$/, 'f1a5');
  r.name = 'Entender mídia (reserva)';
  r.position = [g.position[0] + 220, g.position[1] - 160];
  r.parameters.url = g.parameters.url.replace('/models/' + m[1] + ':', '/models/' + reserva + ':');
  // a entrada da reserva é a saída do principal (sem o arquivo): lê o arquivo direto do "Baixar mídia"
  r.parameters.jsonBody = corpo.split('$json.mimetype').join(BAIXAR + '.mimetype').split('$json.base64').join(BAIXAR + '.base64');
  r.parameters.options = { ...(r.parameters.options || {}), timeout: 40000 };
  r.retryOnFail = false; delete r.maxTries; delete r.waitBetweenTries;
  r.onError = 'continueRegularOutput';
  wf.nodes.push(falhou, r);
  wf.connections['Entender mídia (Gemini)'] = { main: [[{ node: 'Mídia: principal falhou?', type: 'main', index: 0 }]] };
  wf.connections['Mídia: principal falhou?'] = { main: [[{ node: 'Entender mídia (reserva)', type: 'main', index: 0 }], [{ node: 'Texto da mensagem', type: 'main', index: 0 }]] };
  wf.connections['Entender mídia (reserva)'] = { main: [[{ node: 'Texto da mensagem', type: 'main', index: 0 }]] };
};
