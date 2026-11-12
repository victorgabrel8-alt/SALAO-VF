import { supabase } from "@/lib/supabase/client";

// Fotos das mensagens (supabase/040_fotos_na_conversa.sql): o n8n guarda a foto da cliente (e da dona)
// no bucket privado "midias" e grava o caminho em mensagens.midia. As fotos do catálogo que a IA manda
// já estão no bucket "catalogo" e vêm marcadas no texto como "[foto do catálogo: <arquivo>]".
// O app mostra com link assinado (o Storage só libera para quem é da empresa).

const VALIDADE_S = 6 * 60 * 60; // 6 h: a tela de conversa pode ficar aberta o dia todo
const RENOVAR_MS = (VALIDADE_S - 30 * 60) * 1000;

export type Foto = { bucket: "midias" | "catalogo"; caminho: string };

const MARCA_CATALOGO = /\[foto do catálogo: ([^\]]+)\]/;

export function fotoDaMensagem(m: { midia?: string | null; conteudo: string | null }): Foto | null {
  if (m.midia) return { bucket: "midias", caminho: m.midia };
  const cat = m.conteudo?.match(MARCA_CATALOGO);
  return cat ? { bucket: "catalogo", caminho: cat[1].trim() } : null;
}

// O texto que acompanha a foto, sem o que só servia para a IA:
//  cliente: "[foto da cliente] <o que o Gemini viu> Legenda: <legenda>" -> legenda + o que a IA viu
//  dona:    "[mídia]" (foto sem legenda) -> nada
//  catálogo: "📷 Foto do catálogo [foto do catálogo: x]: <legenda>" -> legenda
export function textoDaFoto(conteudo: string | null): { legenda: string; iaViu: string } {
  const t = (conteudo ?? "").trim();
  if (t === "[mídia]") return { legenda: "", iaViu: "" };
  if (MARCA_CATALOGO.test(t)) return { legenda: t.replace(/^[\s\S]*?\[foto do catálogo: [^\]]*\]:?\s*/, ""), iaViu: "" };
  const m = t.match(/^\[foto da cliente(?: que não consegui ver)?\]\s*([\s\S]*?)(?:\s*Legenda: ([\s\S]*))?$/);
  if (m) return { legenda: (m[2] ?? "").trim(), iaViu: m[1].trim() };
  return { legenda: t, iaViu: "" };
}

const cache = new Map<string, { url: string; ate: number }>();
const chave = (f: Foto) => `${f.bucket}/${f.caminho}`;

// Links assinados das fotos (reaproveita os que ainda valem, para a foto não piscar a cada mensagem nova)
export async function linksDasFotos(fotos: Foto[]): Promise<Record<string, string>> {
  const agora = Date.now();
  const faltam = fotos.filter((f) => (cache.get(chave(f))?.ate ?? 0) < agora);
  for (const bucket of ["midias", "catalogo"] as const) {
    const caminhos = [...new Set(faltam.filter((f) => f.bucket === bucket).map((f) => f.caminho))];
    if (!caminhos.length) continue;
    const { data } = await supabase().storage.from(bucket).createSignedUrls(caminhos, VALIDADE_S);
    for (const d of data ?? []) {
      if (d.signedUrl && d.path) cache.set(`${bucket}/${d.path}`, { url: d.signedUrl, ate: agora + RENOVAR_MS });
    }
  }
  const links: Record<string, string> = {};
  for (const f of fotos) {
    const c = cache.get(chave(f));
    if (c) links[chave(f)] = c.url;
  }
  return links;
}

export const chaveDaFoto = chave;
