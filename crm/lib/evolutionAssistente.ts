// Só no servidor (app/api/assistente/route.ts): lê da Evolution a conversa entre o WhatsApp do studio e um número.
// Recebe a chave por parâmetro; nunca importar numa tela.
//
// Onde a Evolution guarda a conversa: o que a assistente manda fica no número da pessoa (com ou sem o 9 depois do DDD)
// e o que a pessoa manda fica num número escondido do WhatsApp ("...@lid"), ligado ao número em key.remoteJidAlt.
// Aqui as duas partes viram uma conversa só, em ordem de hora.

import { formasDoNumero, lerMensagem, type MensagemAssistente, type PaginaAssistente } from "./assistente";

export const POR_PAGINA = 40;
// O filtro de data da Evolution só vale com começo e fim
const DESDE_SEMPRE = "2020-01-01T00:00:00.000Z";

type Registro = Parameters<typeof lerMensagem>[0] & { key?: { remoteJid?: string; remoteJidAlt?: string } };
type Achadas = { registros: Registro[]; total: number };
export type Evolution = { base: string; chave: string; instancia: string };

async function buscar(evo: Evolution, filtro: Record<string, string>, quantas: number, ate: number | null): Promise<Achadas> {
  const where: Record<string, unknown> = { key: filtro };
  if (ate) where.messageTimestamp = { gte: DESDE_SEMPRE, lte: new Date(ate * 1000).toISOString() };
  const r = await fetch(`${evo.base}/chat/findMessages/${encodeURIComponent(evo.instancia)}`, {
    method: "POST",
    headers: { apikey: evo.chave, "Content-Type": "application/json" },
    // "offset" é o tamanho da página na Evolution ("limit" não vale)
    body: JSON.stringify({ where, offset: quantas, page: 1 }),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`a Evolution respondeu ${r.status}`);
  const j = (await r.json()) as { messages?: { records?: Registro[]; total?: number } };
  const registros = Array.isArray(j?.messages?.records) ? j.messages.records : [];
  return { registros, total: Number(j?.messages?.total) || registros.length };
}

// Número escondido ("@lid") da pessoa nesta instância. Muda raramente: guarda por 6 h (sem nenhum, por 10 min).
const lids = new Map<string, { lids: string[]; ate: number }>();
async function lidsDoNumero(evo: Evolution, numero: string): Promise<string[]> {
  const chave = `${evo.instancia}|${numero}`;
  const guardado = lids.get(chave);
  if (guardado && guardado.ate > Date.now()) return guardado.lids;
  const achadas = await Promise.all(formasDoNumero(numero).map((n) => buscar(evo, { remoteJidAlt: `${n}@s.whatsapp.net` }, 5, null)));
  const lista = [...new Set(achadas.flatMap((a) => a.registros.map((r) => r.key?.remoteJid ?? "")).filter((j) => j.endsWith("@lid")))];
  lids.set(chave, { lids: lista, ate: Date.now() + (lista.length ? 6 * 3600_000 : 600_000) });
  return lista;
}

// Uma página da conversa: as mais novas até "ate" (segundos; vazio = agora), da mais antiga para a mais nova
export async function lerConversa(evo: Evolution, numero: string, ate: number | null): Promise<PaginaAssistente> {
  const lidsDela = await lidsDoNumero(evo, numero);
  const filtros = [...formasDoNumero(numero).map((n) => `${n}@s.whatsapp.net`), ...lidsDela].map((jid) => ({ remoteJid: jid }));
  const partes = await Promise.all(filtros.map((f) => buscar(evo, f, POR_PAGINA, ate)));

  // Junta as partes, sem repetir, da mais nova para a mais antiga, e fica com uma página
  const porId = new Map<string, MensagemAssistente>();
  let nomeWhatsApp: string | null = null;
  let nomeEm = 0;
  for (const r of partes.flatMap((a) => a.registros)) {
    const m = lerMensagem(r);
    if (!m || porId.has(m.id)) continue;
    porId.set(m.id, m);
    if (!m.daAssistente && r.pushName && m.em > nomeEm) {
      nomeWhatsApp = r.pushName;
      nomeEm = m.em;
    }
  }
  const todas = [...porId.values()].sort((a, b) => b.em - a.em);
  // a página na ordem da conversa: a mais antiga primeiro
  const pagina = todas.slice(0, POR_PAGINA).reverse();
  // Sobrou alguma? (uma parte com mais do que trouxe, ou a junção passou de uma página). O "ate" inclui o próprio
  // segundo: a próxima página pode repetir as do mesmo segundo, e a tela tira as repetidas.
  const mais = todas.length > POR_PAGINA || partes.some((a) => a.total > a.registros.length);
  return { mensagens: pagina, mais, antes: pagina[0]?.em ?? null, nomeWhatsApp };
}
