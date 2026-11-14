import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { faltandoNoServidor } from "@/lib/servidor/lojas";

// Quem pode mexer nas lojas do motor: só a agência. O login é o mesmo do painel (cookie do Supabase);
// o e-mail precisa estar em AGENCIA_EMAILS, no .env.local do servidor do painel.
export type Acesso = { ok: true; userId: string } | { ok: false; status: number; erro: string };

export async function conferirAgencia(request: NextRequest): Promise<Acesso> {
  // pedidos que mudam alguma coisa só valem vindos do próprio painel
  // (o endereço do painel é o do cabeçalho Host ou, atrás de proxy, X-Forwarded-Host; request.nextUrl não serve:
  // atrás de proxy ele traz o endereço interno do servidor)
  const origem = request.headers.get("origin");
  if (request.method !== "GET" && origem) {
    const hosts = [request.headers.get("x-forwarded-host"), request.headers.get("host")]
      .flatMap((h) => (h ?? "").split(","))
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
    let hostDaOrigem = "";
    try {
      hostDaOrigem = new URL(origem).host.toLowerCase();
    } catch {
      // Origin: null ou inválido
    }
    if (!hostDaOrigem || !hosts.includes(hostDaOrigem)) return { ok: false, status: 403, erro: "Pedido de fora do painel." };
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return { ok: false, status: 503, erro: "Painel sem configuração." };
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: () => {
        // a sessão é renovada pelo proxy.ts; aqui só lemos
      },
    },
  });
  // getUser confere o login com o servidor do Supabase (não confia só no cookie)
  const { data, error } = await supabase.auth.getUser();
  const usuario = data?.user;
  if (error || !usuario) return { ok: false, status: 401, erro: "Entre no painel de novo." };

  const permitidos = (process.env.AGENCIA_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!usuario.email || !permitidos.includes(usuario.email.toLowerCase())) {
    return { ok: false, status: 403, erro: "Só a agência pode criar e configurar lojas." };
  }
  // só a agência fica sabendo o que falta configurar no servidor
  const faltam = faltandoNoServidor();
  if (faltam.length) return { ok: false, status: 503, erro: `Falta configurar no .env.local do painel: ${faltam.join(", ")}.` };
  return { ok: true, userId: usuario.id };
}
