import type { NextRequest } from "next/server";
import { conferirAgencia } from "@/lib/servidor/acesso";
import { aprovarCadastro, recusarCadastro } from "@/lib/servidor/lojas";
import { comErro } from "@/lib/servidor/resposta";

// Pedido de cadastro feito pela dona no app: aprovar (cria a loja e devolve o QR) ou recusar.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    const corpo = (await request.json().catch(() => null)) as { acao?: string; limiteMes?: number | null } | null;
    const { id } = await params;
    if (corpo?.acao === "aprovar") return Response.json(await aprovarCadastro(id, acesso.userId, corpo.limiteMes ?? null));
    if (corpo?.acao === "recusar") {
      await recusarCadastro(id);
      return Response.json({ ok: true });
    }
    return Response.json({ erro: "Ação inválida." }, { status: 400 });
  } catch (e) {
    return comErro(e);
  }
}
