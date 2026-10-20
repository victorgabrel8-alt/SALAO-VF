import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const ROTAS_PUBLICAS = ["/login"];

// Renova a sessão do Supabase a cada requisição e manda para o login quem não entrou.
export async function atualizarSessao(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const publica = ROTAS_PUBLICAS.includes(request.nextUrl.pathname);

  // Sem .env.local: deixa abrir só o login, que mostra o aviso de configuração.
  if (!url || !chave) {
    return publica ? NextResponse.next() : NextResponse.redirect(new URL("/login", request.url));
  }

  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookies, headers) {
        cookies.forEach(({ name, value }) => request.cookies.set(name, value));
        resposta = NextResponse.next({ request });
        cookies.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options));
        Object.entries(headers).forEach(([chave, valor]) => resposta.headers.set(chave, valor));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const logado = Boolean(data?.claims);

  if (!logado && !publica) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (logado && publica) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return resposta;
}
