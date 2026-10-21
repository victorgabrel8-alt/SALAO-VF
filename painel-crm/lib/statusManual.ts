import { supabase } from "@/lib/supabase/client";

// Status escolhido à mão no CRM (arrastando a cliente para uma aba). Vale até ela voltar ao
// salão ou marcar horário; depois o banco volta a calcular sozinho (supabase/004_status_manual.sql).
export type StatusManual = "em_dia" | "inativa";

// null = volta para o status automático
export async function mudarStatus(clienteId: string, status: StatusManual | null) {
  const { error } = await supabase()
    .from("clientes")
    .update({ status_manual: status, status_manual_em: status ? new Date().toISOString() : null })
    .eq("id", clienteId);
  if (error?.message.includes("status_manual"))
    return "o banco ainda não tem o status manual (rodar supabase/004_status_manual.sql no Supabase)";
  return error?.message;
}
