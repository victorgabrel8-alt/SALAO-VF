import type { NextRequest } from "next/server";
import { conferirAgencia } from "@/lib/servidor/acesso";
import { novoQr } from "@/lib/servidor/lojas";
import { comErro } from "@/lib/servidor/resposta";

// QR novo para conectar o WhatsApp da loja (o QR vale menos de 1 minuto).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const acesso = await conferirAgencia(request);
  if (!acesso.ok) return Response.json({ erro: acesso.erro }, { status: acesso.status });
  try {
    return Response.json(await novoQr((await params).id));
  } catch (e) {
    return comErro(e);
  }
}
