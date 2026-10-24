// Cadastra (ou troca) um áudio pronto da Gleide (docs/PLANO-PROMPT-E-AUDIOS.md, Fase 4).
// Uso (com o docker compose da demo no ar e os workflows publicados):
//   node cadastrar-audio.js <arquivo.mp3|.ogg> "<tema>" "<quando usar>"
//   ex.: node cadastrar-audio.js manutencao.mp3 "de quanto em quanto tempo fazer a manutenção" \
//          "quando perguntar de quanto em quanto tempo faz a manutenção ou quanto tempo dura o mega"
// Faz: sobe o arquivo no Supabase Storage (bucket privado "audios"), mede a duração (ffprobe do container
// da Evolution), transcreve pelo n8n (Gemini) e grava/atualiza o item em empresas.config.audios_prontos.
// O mesmo tema de novo = troca o áudio (útil quando a Gleide regravar).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)
  .filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const [arquivo, tema, quandoUsar] = process.argv.slice(2);
if (!arquivo || !tema) {
  console.error('Uso: node cadastrar-audio.js <arquivo> "<tema>" "<quando usar>"');
  process.exit(1);
}
const H = { apikey: env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}` };
const mime = arquivo.toLowerCase().endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg';
// nome no Storage: só letras, números e hífen (o tema vira o nome)
const nome = tema.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  + path.extname(arquivo).toLowerCase();

async function pedir(url, opcoes) {
  const r = await fetch(url, opcoes);
  const t = await r.text();
  if (!r.ok) throw new Error(`${opcoes.method || 'GET'} ${url}: ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

(async () => {
  const dados = fs.readFileSync(arquivo);

  // 1. bucket privado (só o n8n, com a service key, consegue baixar)
  const buckets = await pedir(`${env.SUPABASE_URL}/storage/v1/bucket`, { headers: H });
  if (!buckets.some((b) => b.id === 'audios')) {
    await pedir(`${env.SUPABASE_URL}/storage/v1/bucket`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'audios', name: 'audios', public: false }) });
    console.log('bucket "audios" criado (privado)');
  }
  await pedir(`${env.SUPABASE_URL}/storage/v1/object/audios/${nome}`, { method: 'POST',
    headers: { ...H, 'Content-Type': mime, 'x-upsert': 'true' }, body: dados });
  console.log(`enviado para o Storage: audios/${nome}`);

  // 2. duração
  execFileSync('docker', ['cp', path.resolve(arquivo), 'demo-salao-evolution-1:/tmp/audio-pronto']);
  const duracao = Number(execFileSync('docker', ['exec', 'demo-salao-evolution-1', 'ffprobe', '-v', 'error',
    '-show_entries', 'format=duration', '-of', 'csv=p=0', '/tmp/audio-pronto']).toString().trim());
  execFileSync('docker', ['exec', 'demo-salao-evolution-1', 'rm', '-f', '/tmp/audio-pronto']);
  console.log(`duração: ${duracao.toFixed(1)} s`);

  // 3. transcrição (workflow "Áudios prontos - Transcrever")
  const { transcricao } = await pedir(`${env.N8N_URL || 'http://localhost:5678'}/webhook/audios-transcrever`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ base64: dados.toString('base64'), mime }) });
  if (!transcricao) throw new Error('a transcrição veio vazia');
  console.log(`transcrição: ${transcricao}`);

  // 4. catálogo em empresas.config.audios_prontos (mesmo tema = substitui)
  const [{ config }] = await pedir(`${env.SUPABASE_URL}/rest/v1/empresas?select=config&id=eq.${env.EMPRESA_ID}`, { headers: H });
  const item = { tema, quando_usar: quandoUsar || tema, arquivo: nome, duracao_s: Math.round(duracao), transcricao };
  const lista = (config.audios_prontos || []).filter((a) => a.tema !== tema).concat(item);
  await pedir(`${env.SUPABASE_URL}/rest/v1/empresas?id=eq.${env.EMPRESA_ID}`, { method: 'PATCH',
    headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ config: { ...config, audios_prontos: lista } }) });
  console.log(`catálogo: ${lista.length} áudio(s) — ${lista.map((a) => a.tema).join(' · ')}`);
})().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });
