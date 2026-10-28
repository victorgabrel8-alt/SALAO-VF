// Baixa as fotos do catálogo (bucket "catalogo" do Supabase) para montar o Catálogo do WhatsApp Business:
// uma pasta por tipo de cabelo, com a foto principal de cada cabelo daquele tipo.
// As 8 que a vitrine escolhe (cabelos diferentes, variando cor e comprimento) vêm marcadas com ★;
// as outras ficam de reserva para trocar alguma que tenha marca d'água ou não ficou boa.
// Uso (Git Bash, nesta pasta, com o .env do VPS):  node baixar-catalogo-whatsapp.js
// Resultado: pasta catalogo-whatsapp/ (fora do Git). Fotos de técnica (TECNICAS-MEGAHAIR) ficam de fora.

const fs = require('fs');
const path = require('path');

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
const POR_TIPO = 8;
const TIPOS = [['brasileiro do Sul', 'Brasileiro do Sul'], ['brasileiro regional', 'Brasileiro regional'], ['indiano', 'Indiano'], ['vietnamita', 'Vietnamita']];
const SAIDA = path.join(__dirname, 'catalogo-whatsapp');

// mesma família de cor e mesma ordem da vitrine (catalogo-workflows.js)
const sem = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const FAMILIA = [['loir', 'mel', 'dourad', 'platin', 'claro', 'ombre'], ['castanh', 'moren', 'escur', 'pret', 'chocolate', 'natural'],
  ['ruiv', 'acobread', 'cobre', 'ruiva', 'vermelh'], ['grisalh', 'cinza', 'branc'], ['iluminad', 'luzes', 'mechas']];
const corFam = (f) => { const i = FAMILIA.findIndex((x) => x.some((p) => sem(f.cor).includes(p))); return i < 0 ? 9 : i; };
// nome de arquivo que o Windows aceita
const limpo = (s) => String(s || '').replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();

(async () => {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error('Falta SUPABASE_URL ou SUPABASE_SERVICE_KEY no .env');
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/catalogo?select=arquivo,grupo,tipo,cor,comprimento_cm,legenda,ordem&ativo=eq.true&empresa_id=eq.${env.EMPRESA_ID}&order=grupo,ordem`, { headers: H });
  if (!r.ok) throw new Error(`Supabase respondeu ${r.status}: ${await r.text()}`);
  const fotos = await r.json();
  const lista = [];
  for (const [t, nome] of TIPOS) {
    const porCabelo = {};
    for (const f of fotos) {
      if (f.tipo !== t || f.arquivo.startsWith('TECNICAS-MEGAHAIR/')) continue;
      if (!porCabelo[f.grupo] || f.ordem < porCabelo[f.grupo].ordem) porCabelo[f.grupo] = f;
    }
    const base = Object.values(porCabelo).sort((a, b) => corFam(a) - corFam(b) || (a.comprimento_cm || 0) - (b.comprimento_cm || 0) || a.grupo.localeCompare(b.grupo));
    const n = Math.min(POR_TIPO, base.length);
    const escolhidos = new Set(Array.from({ length: n }, (_, i) => base[Math.floor(i * base.length / n)]));
    const pasta = path.join(SAIDA, `${TIPOS.findIndex((x) => x[0] === t) + 1} - ${nome}`);
    fs.mkdirSync(pasta, { recursive: true });
    let k = 0;
    // as escolhidas primeiro, na ordem da vitrine; depois as reservas
    for (const f of [...escolhidos, ...base.filter((x) => !escolhidos.has(x))]) {
      k++;
      const marca = escolhidos.has(f) ? '★ ' : '';
      const nomeArq = limpo(`${marca}${String(k).padStart(2, '0')} - ${f.legenda || f.cor} - ${f.grupo.split('/').pop().slice(0, 50)}`) + '.jpg';
      lista.push({ tipo: nome, escolhida: !!marca, arquivo: f.arquivo, destino: path.join(pasta, nomeArq) });
    }
  }
  console.log(`${lista.length} fotos para baixar (${lista.filter((x) => x.escolhida).length} escolhidas com ★)...`);
  let ok = 0;
  for (const x of lista) {
    if (fs.existsSync(x.destino)) { ok++; continue; }
    const img = await fetch(`${env.SUPABASE_URL}/storage/v1/object/catalogo/${x.arquivo.split('/').map(encodeURIComponent).join('/')}`, { headers: H });
    if (!img.ok) { console.log(`  falhou (${img.status}): ${x.arquivo}`); continue; }
    fs.writeFileSync(x.destino, Buffer.from(await img.arrayBuffer()));
    ok++;
  }
  console.log(`Pronto: ${ok} de ${lista.length} fotos em ${SAIDA}`);
})().catch((e) => { console.error('Erro:', e.message); process.exit(1); });
