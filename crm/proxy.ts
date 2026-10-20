import type { NextRequest } from "next/server";
import { atualizarSessao } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return atualizarSessao(request);
}

export const config = {
  // Tudo, menos arquivos estáticos, ícones e o manifest do PWA.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icone-.*\\.png|apple-icon.png).*)"],
};
