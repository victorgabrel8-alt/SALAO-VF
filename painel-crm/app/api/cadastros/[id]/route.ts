import type { NextRequest } from "next/server";
import { conferirAgencia } from "@/lib/servidor/acesso";
import { aprovarCadastro, reabrirCadastro, recusarCadastro, recusarTodosCadastros } from "@/lib/servidor/lojas";
import { comErro } from "@/lib/servidor/resposta";

// Pedido de cadastro feito pela dona no app: aprovar (cria a loja e devolve o QR), recusar ou reabrir um preso.
// Com o id "todos" e a ação "recusar", recusa todos os pendentes de uma vez.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    const corpo = (await request.json().catch(() => null)) as { acao?: string; limiteMes?: number | null; email?: string } | null;
    const { id } = await params;
    if (id === "todos") {
      if (corpo?.acao !== "recusar") return Response.json({ erro: "Ação inválida." }, { status: 400 });
      return Response.json({ recusados: await recusarTodosCadastros() });
    }
    if (corpo?.acao === "aprovar") {
      const email = typeof corpo.email === "string" ? corpo.email : undefined;
      return Response.json(await aprovarCadastro(id, acesso.userId, corpo.limiteMes ?? null, email));
    }
    if (corpo?.acao === "recusar") {
      await recusarCadastro(id);
      return Response.json({ ok: true });
    }
    if (corpo?.acao === "reabrir") {
      await reabrirCadastro(id);
      return Response.json({ ok: true });
    }
    return Response.json({ erro: "Ação inválida." }, { status: 400 });
  } catch (e) {
    return comErro(e);
  }
}
