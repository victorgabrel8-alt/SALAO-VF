// Cadastra (ou atualiza) as fotos do catálogo de cabelos que a IA manda pelo WhatsApp (tool enviar_catalogo).
// Uso:
//   node cadastrar-catalogo.js <pasta> --sugerir   -> só monta/atualiza catalogo-fichas.json (nada vai para o Supabase)
//   node cadastrar-catalogo.js <pasta>             -> otimiza, sobe e grava as fichas de catalogo-fichas.json
//   ex.: node cadastrar-catalogo.js "../../../agente-whatsapp/catalogo_barao" --sugerir
// Cada subpasta com fotos = um cabelo (grupo). Tipo, cor, comprimento e textura saem do info.json da pasta
// (ou do nome dela); o que faltar fica vazio no catalogo-fichas.json para conferir e corrigir à mão antes de subir.
// Correção feita à mão no catalogo-fichas.json não se perde ao rodar --sugerir de novo.
// Faz: foto em JPEG até 1280 px no lado maior, qualidade ~80 (ffmpeg), sobe no Storage (bucket privado "catalogo")
// e grava a ficha na tabela catalogo (supabase/018). Rodar de novo sobrescreve a mesma foto, não duplica.
// Foto repetida (igual ou quase igual, em outro cabelo) sobe uma vez só; pasta com "ativo": false fica fora do envio.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const pasta = process.argv[2];
const sugerir = process.argv.includes('--sugerir');
if (!pasta || !fs.existsSync(pasta)) {
  console.error('Uso: node cadastrar-catalogo.js <pasta> [--sugerir]');
  process.exit(1);
}
const FICHAS = path.join(__dirname, 'catalogo-fichas.json');
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
const TIPOS = ['brasileiro', 'brasileiro do Sul', 'brasileiro regional', 'indiano', 'vietnamita'];
const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const barra = (p) => p.split(path.sep).join('/');

async function pedir(url, opcoes = {}) {
  const r = await fetch(url, opcoes);
  const t = await r.text();
  if (!r.ok) throw new Error(`${opcoes.method || 'GET'} ${url}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

// ---------- 1. Ler a pasta: um grupo por subpasta com fotos ----------
function lerPasta() {
  const grupos = [];
  const andar = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) andar(path.join(d, e.name));
    const fotos = fs.readdirSync(d).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort();
    if (!fotos.length) return;
    let info = {};
    try { info = JSON.parse(fs.readFileSync(path.join(d, 'info.json'), 'utf8')); } catch (e) { /* sem info.json: usa o nome da pasta */ }
    grupos.push({ grupo: barra(path.relative(pasta, d)) || path.basename(d), info, fotos: fotos.map((f) => barra(path.relative(pasta, path.join(d, f)))) });
  };
  andar(pasta);
  return grupos.sort((a, b) => a.grupo.localeCompare(b.grupo));
}

// tipo, cor, textura e comprimento pelo título (ou nome da pasta)
function sugerirFicha({ grupo, info }) {
  const t = sem(`${info.titulo || ''} ${grupo.replace(/[-/]/g, ' ')}`);
  const tipo = /vietnamit|vietnamir/.test(t) ? 'vietnamita' : /indian/.test(t) ? 'indiano'
    : /brasileir/.test(t) || info.origem === 'brasileiro' ? 'brasileiro' : (info.origem === 'indiano' || info.origem === 'vietnamita' ? info.origem : '');
  const cor = (t.match(/loiro mel dourado|loiro medio dourado|loiro mel mesclado|loiro mel|loiro mesclado raiz esfumada|loiro raiz esfumada|loiro ondulado mesclado|loiro mesclado|loiro ombre|loiro|castanho|catanho|chocolate raiz esfumada|ruivo|morena iluminad[oa] mesclado|morena iluminad[oa]|grisalho|mesclado/) || [''])[0]
    .replace('catanho', 'castanho').replace(/morena iluminad[oa]/, 'morena iluminada').replace(/^mesclado$/, 'loiro mesclado')
    .replace('loiro medio', 'loiro médio').replace('loiro ombre', 'loiro ombré').replace('loiro ondulado mesclado', 'loiro mesclado');
  const textura = (t.match(/cacheado tipo \d|cacho caipira|caipira|cacheado|levemente ondu?alado|levemente ondulado|ondulado|liso/) || [''])[0]
    .replace('ondualado', 'ondulado').replace(/^caipira$/, 'cacho caipira');
  const cm = Number((t.match(/(\d{2})\s?cm/) || [])[1]) || info.comprimento_cm || null;
  const ativo = !/pagamento personalizado/.test(t);
  return { tipo, cor, comprimento_cm: cm, textura, ativo };
}
const legendaDe = (f) => [f.cor && f.cor[0].toUpperCase() + f.cor.slice(1), f.textura, f.comprimento_cm && `${f.comprimento_cm} cm`].filter(Boolean).join(', ');

// ---------- Foto repetida: mesma foto em dois cabelos, às vezes com outro recorte ou compressão ----------
// Assinatura = contorno (foto 17x16 em cinza, claro/escuro vizinho) + cor média (foto 8x8). Repetida = contorno
// parecido E cor quase igual. Só o contorno junta foto diferente (feixe preto e feixe loiro no fundo branco).
function assinatura(arquivo) {
  const ff = (vf) => execFileSync('ffmpeg', ['-v', 'error', '-i', arquivo, '-vf', vf, '-f', 'rawvideo', '-']);
  const g = ff('scale=17:16:flags=area,format=gray');
  const bits = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) bits.push(g[y * 17 + x] > g[y * 17 + x + 1] ? 1 : 0);
  return { bits, cor: [...ff('scale=8:8:flags=area,format=rgb24')] };
}
const repetida = (a, b) => {
  const contorno = a.bits.reduce((s, v, i) => s + (v !== b.bits[i]), 0);
  const cor = a.cor.reduce((s, v, i) => s + Math.abs(v - b.cor[i]), 0) / a.cor.length;
  return (contorno <= 45 && cor <= 10) || (contorno <= 60 && cor <= 6);
};

// ---------- 2. Otimizar: JPEG até 1280 px, qualidade ~80 (não aumenta foto pequena) ----------
const tmp = path.join(require('os').tmpdir(), 'catalogo-otimizado.jpg');
function otimizar(arquivo) {
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', arquivo,
    '-vf', "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease", '-q:v', '4', tmp]);
  return fs.readFileSync(tmp);
}

(async () => {
  const grupos = lerPasta();
  const antigas = fs.existsSync(FICHAS) ? JSON.parse(fs.readFileSync(FICHAS, 'utf8')) : [];
  const porGrupo = Object.fromEntries(antigas.map((f) => [f.grupo, f]));

  if (sugerir) {
    const fichas = grupos.map((g) => {
      const velha = porGrupo[g.grupo];
      const nova = sugerirFicha(g);
      const f = velha ? { ...velha, fotos: g.fotos } : { grupo: g.grupo, titulo: g.info.titulo || g.grupo, ...nova, legenda: '', fotos: g.fotos };
      if (!velha) f.legenda = legendaDe(f);
      return f;
    });
    fs.writeFileSync(FICHAS, JSON.stringify(fichas, null, 2) + '\n');
    const conferir = fichas.filter((f) => f.ativo && (!TIPOS.includes(f.tipo) || !f.cor || !f.textura || !f.comprimento_cm));
    console.log(`catalogo-fichas.json: ${fichas.length} cabelo(s), ${fichas.reduce((a, f) => a + f.fotos.length, 0)} foto(s)`);
    if (conferir.length) console.log(`Conferir/completar ${conferir.length}:\n` + conferir.map((f) => `- ${f.grupo} (tipo "${f.tipo}", cor "${f.cor}", textura "${f.textura}", ${f.comprimento_cm || '?'} cm)`).join('\n'));
    return;
  }

  // ---------- 3. Subir e gravar (só com as fichas conferidas) ----------
  if (!antigas.length) throw new Error('rode primeiro com --sugerir e confira o catalogo-fichas.json');
  const erradas = antigas.filter((f) => f.ativo && !TIPOS.includes(f.tipo));
  if (erradas.length) throw new Error(`tipo inválido (use ${TIPOS.join(' / ')}) em: ${erradas.map((f) => f.grupo).join(', ')}`);

  const buckets = await pedir(`${env.SUPABASE_URL}/storage/v1/bucket`, { headers: H });
  if (!buckets.some((b) => b.id === 'catalogo')) {
    await pedir(`${env.SUPABASE_URL}/storage/v1/bucket`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'catalogo', name: 'catalogo', public: false, allowed_mime_types: ['image/jpeg'] }) });
    console.log('bucket "catalogo" criado (privado)');
  }

  const vistos = new Set(); const guardadas = [];
  const linhas = [];
  let enviadas = 0; let bytes = 0; let repetidas = 0;
  for (const f of antigas) {
    for (const [i, foto] of f.fotos.entries()) {
      const origem = path.join(pasta, foto);
      if (!fs.existsSync(origem)) continue;
      const arquivo = foto.replace(/\.(jpe?g|png|webp)$/i, '.jpg');
      let ativo = f.ativo !== false && !(f.fotos_fora || []).includes(foto);
      if (ativo) {
        // a 1ª vez que a foto aparece fica; as outras (iguais ou quase iguais) ficam fora do envio
        const hash = crypto.createHash('md5').update(fs.readFileSync(origem)).digest('hex');
        const ass = vistos.has(hash) ? null : assinatura(origem);
        if (!ass || guardadas.some((g) => repetida(g, ass))) { ativo = false; repetidas++; } else guardadas.push(ass);
        vistos.add(hash);
      }
      if (ativo) {
        const dados = otimizar(origem);
        await pedir(`${env.SUPABASE_URL}/storage/v1/object/catalogo/${arquivo.split('/').map(encodeURIComponent).join('/')}`, { method: 'POST',
          headers: { ...H, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: dados });
        enviadas++; bytes += dados.length;
        if (enviadas % 25 === 0) console.log(`  ${enviadas} foto(s) enviadas...`);
      }
      linhas.push({ empresa_id: env.EMPRESA_ID, arquivo, grupo: f.grupo, tipo: TIPOS.includes(f.tipo) ? f.tipo : 'brasileiro',
        cor: f.cor || '', comprimento_cm: f.comprimento_cm || null, textura: f.textura || '', legenda: f.legenda || '',
        ativo, ordem: i + 1, atualizado_em: new Date().toISOString() });
    }
  }
  // mesma foto de novo = atualiza a ficha (on_conflict), não duplica
  for (let i = 0; i < linhas.length; i += 200) {
    await pedir(`${env.SUPABASE_URL}/rest/v1/catalogo?on_conflict=empresa_id,arquivo`, { method: 'POST',
      headers: { ...H, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(linhas.slice(i, i + 200)) });
  }
  // foto que saiu da pasta/das fichas deixa de ser enviada (fica no histórico, só desativa)
  const atuais = new Set(linhas.map((l) => l.arquivo));
  const noBanco = await pedir(`${env.SUPABASE_URL}/rest/v1/catalogo?select=arquivo&ativo=eq.true&empresa_id=eq.${env.EMPRESA_ID}`, { headers: H });
  const sairam = noBanco.map((r) => r.arquivo).filter((a) => !atuais.has(a));
  for (let i = 0; i < sairam.length; i += 50) {
    await pedir(`${env.SUPABASE_URL}/rest/v1/catalogo?empresa_id=eq.${env.EMPRESA_ID}&arquivo=in.(${sairam.slice(i, i + 50).map((a) => `"${a}"`).join(',')})`, {
      method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ ativo: false }) });
  }
  const ativas = linhas.filter((l) => l.ativo).length;
  console.log(`catálogo: ${ativas} foto(s) ativas de ${linhas.length} (${enviadas} enviadas, média ${Math.round(bytes / Math.max(1, enviadas) / 1024)} KB, ${repetidas} repetida(s) fora)` +
    (sairam.length ? `; ${sairam.length} desativada(s) por terem saído da pasta` : ''));
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
