import { PREFIXO_SISTEMA } from "@/lib/origem";
import type { StatusCliente } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";

// Status escolhido à mão no CRM (arrastando a cliente para uma opção do quadro).
// Fica nas etiquetas internas, como a exclusão (sem mudar o banco):
//   "sistema:status:inativa" + "sistema:status_em:2026-10-21T14:00:00.000Z"
// Vale até ela marcar horário ou voltar ao salão depois da mudança; aí volta o status
// calculado pelo banco. Se um dia o banco ganhar uma coluna própria, só este arquivo muda.
export type StatusManual = "em_dia" | "retorno_chegando" | "retorno_atrasado" | "inativa";

const PREFIXO = `${PREFIXO_SISTEMA}status:`;
const PREFIXO_EM = `${PREFIXO_SISTEMA}status_em:`;
const TODOS: StatusManual[] = ["em_dia", "retorno_chegando", "retorno_atrasado", "inativa"];

function lerManual(etiquetas: string[]): { status: StatusManual; em: string } | null {
  const status = etiquetas.find((e) => e.startsWith(PREFIXO))?.slice(PREFIXO.length) as StatusManual | undefined;
  const em = etiquetas.find((e) => e.startsWith(PREFIXO_EM))?.slice(PREFIXO_EM.length);
  return status && TODOS.includes(status) && em ? { status, em } : null;
}

// Status que a tela mostra: o manual, se ainda vale; senão, o do banco
export function statusEfetivo(c: {
  status: StatusCliente;
  etiquetas: string[];
  proximo_agendamento: string | null;
  ultima_visita: string | null;
}): StatusCliente {
  const manual = lerManual(c.etiquetas);
  if (!manual || c.proximo_agendamento) return c.status;
  if (c.ultima_visita && Date.parse(c.ultima_visita) >= Date.parse(manual.em)) return c.status;
  return manual.status;
}

// null = volta para o status automático
export async function mudarStatus(clienteId: string, status: StatusManual | null) {
  const db = supabase();
  // Lê as etiquetas atuais do banco para não perder nenhuma
  const atual = await db.from("clientes").select("etiquetas").eq("id", clienteId).single();
  if (atual.error) return atual.error.message;
  const outras = (atual.data.etiquetas as string[]).filter((e) => !e.startsWith(PREFIXO) && !e.startsWith(PREFIXO_EM));
  const etiquetas = status ? [...outras, PREFIXO + status, PREFIXO_EM + new Date().toISOString()] : outras;
  const { error } = await db.from("clientes").update({ etiquetas }).eq("id", clienteId);
  return error?.message;
}
