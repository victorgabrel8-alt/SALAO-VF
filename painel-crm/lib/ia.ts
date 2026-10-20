import { supabase } from "@/lib/supabase/client";

// Motivos em que a IA pausou sozinha e a dona precisa responder
export const MOTIVOS_PRECISA: Record<string, string> = {
  pediu_humano: "Pediu para falar com você",
  reclamacao: "Fez uma reclamação",
  fora_escopo: "Perguntou algo que a IA não sabe",
};

export type SituacaoIa = "atendendo" | "pausada" | "precisa";

// Selo da conversa: 🟢 IA atendendo · 🟡 Pausada · 🔴 Precisa de você
export function situacaoIa(iaPausada: boolean, motivo: string | null): SituacaoIa {
  if (!iaPausada) return "atendendo";
  return motivo && motivo in MOTIVOS_PRECISA ? "precisa" : "pausada";
}

export const SELO_IA: Record<SituacaoIa, { rotulo: string; ponto: string }> = {
  atendendo: { rotulo: "IA atendendo", ponto: "bg-green-500" },
  pausada: { rotulo: "Pausada", ponto: "bg-yellow-400" },
  precisa: { rotulo: "Precisa de você", ponto: "bg-red-500" },
};

// Pausar: a IA para de responder esta cliente por 12 horas (o n8n lê ia_pausada_ate).
// Reativar: limpa a pausa.
export async function pausarOuReativarIa(clienteId: string, pausar: boolean) {
  const { error } = await supabase()
    .from("clientes")
    .update(
      pausar
        ? { ia_pausada_ate: new Date(Date.now() + 12 * 3_600_000).toISOString(), motivo_pausa: "manual" }
        : { ia_pausada_ate: null, motivo_pausa: null },
    )
    .eq("id", clienteId);
  return error?.message;
}
