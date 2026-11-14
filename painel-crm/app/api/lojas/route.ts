import type { NextRequest } from "next/server";
import { conferirAgencia } from "@/lib/servidor/acesso";
import { criarLoja, listarCadastros, listarLojas, type NovaLoja } from "@/lib/servidor/lojas";
import { comErro } from "@/lib/servidor/resposta";

// Lojas do motor único: lista e cria. Só a agência (lib/servidor/acesso.ts).
export async function GET(request: NextRequest) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    const [lojas, pedidos] = await Promise.all([listarLojas(), listarCadastros()]);
    return Response.json({ lojas, cadastros: pedidos.cadastros, cadastrosPendentes: pedidos.pendentes });
  } catch (e) {
    return comErro(e);
  }
}

export async function POST(request: NextRequest) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    const dados = (await request.json().catch(() => null)) as NovaLoja;
    return Response.json(await criarLoja(dados, acesso.userId));
  } catch (e) {
    return comErro(e);
  }
}
