// Endereço com foto: quando a mensagem para a cliente tem o link do mapa do cadastro, ela sai como FOTO do salão com o
// texto na legenda (só nas lojas com "foto_endereco": true no loja.json e config.loja.foto_endereco preenchido no banco).
// 18/11/2026, Caroline: a prévia do link do Google Maps saía com um pedaço de mapa genérico, não com a foto do studio
// (o Google entrega a página genérica para quem lê o link como navegador, que é o caso da Evolution). O Victor testou a
// foto com o endereço na legenda no número dele e aprovou.
// Vale para a IA de atendimento ("Enviar mensagem") e para a assistente da dona ("Mandar para a cliente"). Sem foto no
// cadastro, sem link do mapa no texto ou com qualquer erro ao ler o cadastro, sai o texto normal, como antes.

module.exports = ({ workflow, ferramentasWorkflow }) => {
  const achar = (wf, nome) => { const n = wf.nodes.find((x) => x.name === nome); if (!n) throw new Error(`foto_endereco: não achei "${nome}"`); return n; };

  const trocar = (wf, nomeNo, cfgExpr, textoExpr) => {
    const nd = achar(wf, nomeNo);
    const p = nd.parameters;
    if (!/\/message\/sendText\//.test(p.url || '')) throw new Error(`foto_endereco: "${nomeNo}" não é sendText`);
    const m = /^=\{\{ JSON\.stringify\(([\s\S]*)\) \}\}$/.exec(p.jsonBody || '');
    if (!m) throw new Error(`foto_endereco: o corpo de "${nomeNo}" mudou`);
    // a foto do cadastro, só se o texto tem o link do mapa do cadastro; senão ''
    const foto = `(() => { try { const c = ${cfgExpr} || {}; const l = c.loja || {}; const t = String(${textoExpr} || ''); ` +
      `return (typeof l.foto_endereco === 'string' && l.foto_endereco && typeof l.mapa === 'string' && l.mapa && t.includes(l.mapa.trim())) ? l.foto_endereco : ''; } catch (e) { return ''; } })()`;
    // legenda: o próprio texto; se ele não tem o nome da rua do cadastro, o endereço vai em cima
    const legenda = `(() => { const t = String(${textoExpr} || ''); let e = ''; try { e = String((${cfgExpr} || {}).endereco || '').trim(); } catch (x) {} ` +
      `const rua = e.split(',')[0].trim().toLowerCase(); return (!e || !rua || t.toLowerCase().includes(rua)) ? t : e + '\\n' + t; })()`;
    p.url = p.url.replace('/message/sendText/', `/message/send{{ ${foto} ? 'Media' : 'Text' }}/`);
    p.jsonBody = `={{ JSON.stringify((() => { const b = ${m[1]}; const f = ${foto}; if (!f) return b; const r = Object.assign({}, b); delete r.text; ` +
      `return Object.assign(r, { mediatype: 'image', mimetype: 'image/jpeg', fileName: 'endereco.jpg', media: f, caption: ${legenda} }); })()) }}`;
  };

  trocar(workflow, 'Enviar mensagem', "$('Supabase: dados do salão').first().json.config", "$('Um balão por vez').item.json.texto");
  trocar(ferramentasWorkflow, 'Mandar para a cliente', "$('Endereço: cadastro').first().json.config", 'JSON.parse($json.data).mensagem');
};
