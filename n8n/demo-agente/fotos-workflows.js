// Fotos na conversa do app (12/11/2026, ver supabase/040_fotos_na_conversa.sql).
// Chamado pelo montar-workflow.js depois do supabase-workflows.js: encaixa nós no principal.
//   Cliente mandou foto: depois de "Supabase: registrar entrada" guarda a foto no Storage (bucket "midias",
//                        <empresa>/<id da mensagem>.<ext>) e grava o caminho em mensagens.midia.
//   Dona mandou foto pelo celular: o mesmo, depois de "Supabase: dona respondeu".
// A foto vem no próprio webhook da Evolution (message.base64); se não vier, usa a que o "Baixar mídia
// (Evolution)" já baixou para o Gemini. Tudo com onError = continuar: se falhar, a mensagem fica só com o
// texto, como antes, e a IA segue igual.

const EMPRESA = '$env.EMPRESA_ID';

// Code: a foto (base64) vira arquivo para o upload. Sem foto -> ext vazia e os nós seguintes não gravam nada.
const PREPARAR = String.raw`
const msg = ($('Webhook Evolution').first().json.body || {}).data?.message || {};
let b64 = msg.base64 || '';
let mime = msg.imageMessage?.mimetype || '';
if (!b64) {
  try { const b = $('Baixar mídia (Evolution)').first().json; b64 = b.base64 || ''; mime = b.mimetype || mime; } catch (e) {}
}
mime = String(mime || 'image/jpeg').split(';')[0].trim().toLowerCase();
const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[mime] || 'jpg';
if (ext === 'jpg') mime = 'image/jpeg';
if (!b64 || !/^[A-Za-z0-9+/=\s]+$/.test(b64.slice(0, 200))) return [{ json: { ext: '' } }];
return [{ json: { ext, mime }, binary: { foto: { data: b64.replace(/\s/g, ''), mimeType: mime, fileName: 'foto.' + ext } } }];
`;

module.exports = ({ node, main, ifNode, cond, D, workflow }) => {
  const supaH = (extra = []) => ({ parameters: [
    { name: 'apikey', value: '={{ $env.SUPABASE_SERVICE_KEY }}' },
    { name: 'Authorization', value: '=Bearer {{ $env.SUPABASE_SERVICE_KEY }}' },
    ...extra,
  ] });
  const seguir = { onError: 'continueRegularOutput', alwaysOutputData: true };
  const achar = (nome) => { if (!workflow.nodes.some((x) => x.name === nome)) throw new Error(`fotos: não achei "${nome}"`); };

  // cadeia: é foto? -> preparar -> Storage -> mensagens.midia -> depois
  const cadeia = (sufixo, depois) => {
    const n = (nome) => `Foto${sufixo}: ${nome}`;
    const prep = `$('${n('preparar')}').first().json`;
    workflow.nodes.push(
      ifNode(n('é foto?'), [0, 0], [
        cond('f1', `={{ ${D}.tipo === 'imageMessage' }}`, { type: 'boolean', operation: 'true', singleValue: true }),
      ]),
      node(n('preparar'), 'n8n-nodes-base.code', 2, [0, 0], { jsCode: PREPARAR }, seguir),
      node(n('guardar no Storage'), 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
        method: 'POST',
        // sem foto: endereço que não existe (dá erro e segue), para não subir arquivo vazio
        url: `={{ $env.SUPABASE_URL }}/storage/v1/{{ $json.ext ? 'object/midias/' + ${EMPRESA} + '/' + ${D}.msgId + '.' + $json.ext : 'nao_gravar' }}`,
        sendHeaders: true,
        headerParameters: supaH([{ name: 'x-upsert', value: 'true' }, { name: 'Content-Type', value: '={{ $json.mime || "image/jpeg" }}' }]),
        sendBody: true, contentType: 'binaryData', inputDataFieldName: 'foto',
        options: { timeout: 20000 },
      }, seguir),
      node(n('ligar à mensagem'), 'n8n-nodes-base.httpRequest', 4.2, [0, 0], {
        method: 'PATCH',
        // só grava o caminho se o Storage aceitou a foto ($json.Key)
        url: `={{ $env.SUPABASE_URL }}/rest/v1/{{ $json.Key ? 'mensagens?select=id&wa_message_id=eq.' + ${D}.msgId + '&empresa_id=eq.' + ${EMPRESA} : 'nao_gravar' }}`,
        sendHeaders: true, headerParameters: supaH([{ name: 'Prefer', value: 'return=minimal' }]),
        sendBody: true, specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ midia: ${EMPRESA} + '/' + ${D}.msgId + '.' + ${prep}.ext }) }}`,
        options: { timeout: 15000 },
      }, seguir),
    );
    workflow.connections[n('é foto?')] = { main: [[{ node: n('preparar'), type: 'main', index: 0 }], depois ? [{ node: depois, type: 'main', index: 0 }] : []] };
    workflow.connections[n('preparar')] = main(n('guardar no Storage'));
    workflow.connections[n('guardar no Storage')] = main(n('ligar à mensagem'));
    if (depois) workflow.connections[n('ligar à mensagem')] = main(depois);
    return n('é foto?');
  };

  // ---------- cliente: entre "registrar entrada" e a pausa ----------
  achar('Supabase: registrar entrada');
  const depoisEntrada = workflow.connections['Supabase: registrar entrada'].main[0];
  if (!depoisEntrada || depoisEntrada.length !== 1) throw new Error('fotos: esperava uma saída só em "Supabase: registrar entrada"');
  workflow.connections['Supabase: registrar entrada'] = main(cadeia('', depoisEntrada[0].node));

  // ---------- dona: depois de "dona respondeu" (fim da linha) ----------
  achar('Supabase: dona respondeu');
  const depoisDona = workflow.connections['Supabase: dona respondeu']?.main?.[0] || [];
  if (depoisDona.length > 1) throw new Error('fotos: "Supabase: dona respondeu" tem mais de uma saída');
  workflow.connections['Supabase: dona respondeu'] = main(cadeia(' (dona)', depoisDona[0]?.node));
};
