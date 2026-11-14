import type { NextRequest } from "next/server";
import { conferirAgencia } from "@/lib/servidor/acesso";
import { estadoDoWhatsapp, mudarLoja, type Mudanca } from "@/lib/servidor/lojas";
import { comErro } from "@/lib/servidor/resposta";

// Uma loja do motor: o WhatsApp já conectou? (GET) e mudar trava, teto, tempo por cliente e sinal (PATCH).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    return Response.json(await estadoDoWhatsapp((await params).id));
  } catch (e) {
    return comErro(e);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    await mudarLoja((await params).id, (await request.json().catch(() => null)) as Mudanca);
    return Response.json({ ok: true });
  } catch (e) {
    return comErro(e);
  }
}
