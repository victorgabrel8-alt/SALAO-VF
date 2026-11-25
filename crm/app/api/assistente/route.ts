import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import type { ConversaAssistente } from "@/lib/assistente";
import { lerConversa } from "@/lib/evolutionAssistente";

// Conversa da assistente com a dona no WhatsApp do studio (supabase/079). Só leitura: nada aqui envia mensagem.
// GET /api/assistente?empresa=<id>&numero=<5566...>&ate=<segundos>  -> PaginaAssistente (as mais novas até "ate")
//
// Quem pode ler: a função assistente_conversas() do banco, chamada com o login de quem pediu (o cookie da sessão).
// A chave da Evolution fica só no servidor (EVOLUTION_URL e EVOLUTION_API_KEY no Easypanel); o navegador nunca a vê.

function erro(status: number, mensagem: string) {
  return Response.json({ erro: mensagem }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const base = process.env.EVOLUTION_URL?.trim().replace(/\/+$/, "");
  const chave = process.env.EVOLUTION_API_KEY?.trim();
  const p = request.nextUrl.searchParams;
  const empresa = p.get("empresa") ?? "";
  const numero = (p.get("numero") ?? "").replace(/\D/g, "");
  const ateTexto = p.get("ate");
  const ate = ateTexto && /^\d{9,11}$/.test(ateTexto) ? Number(ateTexto) : null;
  if (!url || !anon) return erro(500, "O app está sem a ligação com o banco.");
  if (!empresa || !numero) return erro(400, "Faltou dizer qual conversa.");

  // O banco diz se este login pode ler esta conversa (e qual a instância)
  const db = createServerClient(url, anon, { cookies: { getAll: () => request.cookies.getAll(), setAll() {} } });
  const { data, error } = await db.rpc("assistente_conversas");
  if (error) return erro(500, "Não deu para conferir o acesso. Tente de novo.");
  const conversa = ((data ?? []) as ConversaAssistente[]).find((c) => c.empresa_id === empresa && c.numero === numero);
  if (!conversa) return erro(403, "Essa conversa não está liberada para o seu login.");
  if (!base || !chave) return erro(503, "O servidor do app ainda não tem a ligação com o WhatsApp (EVOLUTION_URL e EVOLUTION_API_KEY).");

  try {
    const pagina = await lerConversa({ base, chave, instancia: conversa.instancia }, numero, ate);
    return Response.json(pagina, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("assistente: leitura da Evolution falhou:", e instanceof Error ? e.message : e);
    return erro(502, "O WhatsApp do studio não respondeu agora. Tente atualizar daqui a pouco.");
  }
}
