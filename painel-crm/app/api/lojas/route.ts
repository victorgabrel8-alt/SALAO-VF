import type { NextRequest } from "next/server";
import { conferirAgencia } from "@/lib/servidor/acesso";
import { criarLoja, listarLojas, type NovaLoja } from "@/lib/servidor/lojas";
import { comErro } from "@/lib/servidor/resposta";

// Lojas do motor único: lista e cria. Só a agência (lib/servidor/acesso.ts).
export async function GET(request: NextRequest) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    return Response.json({ lojas: await listarLojas() });
  } catch (e) {
    return comErro(e);
  }
}

export async function POST(request: NextRequest) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    const dados = (await request.json()) as NovaLoja;
    return Response.json(await criarLoja(dados, acesso.userId));
  } catch (e) {
    return comErro(e);
  }
}
