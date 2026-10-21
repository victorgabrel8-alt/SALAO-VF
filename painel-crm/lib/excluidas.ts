import { PREFIXO_SISTEMA } from "@/lib/origem";
import { supabase } from "@/lib/supabase/client";

// Cliente "excluída" não é apagada do banco: ganha a etiqueta interna "sistema:excluida",
// some do Início, da Agenda, das Conversas e das listas, e fica no Painel CRM, no filtro
// "Excluídas", onde dá para restaurar. Assim nada do histórico (atendimentos, conversas) se perde.
// Se um dia o banco ganhar uma coluna própria (ex.: excluida_em), só este arquivo muda.
const MARCA = `${PREFIXO_SISTEMA}excluida`;

export function estaExcluida(etiquetas: string[] | null | undefined): boolean {
  return (etiquetas ?? []).includes(MARCA);
}

async function trocarMarca(clienteId: string, excluir: boolean) {
  const db = supabase();
  // Lê as etiquetas atuais do banco para não perder nenhuma
  const atual = await db.from("clientes").select("etiquetas").eq("id", clienteId).single();
  if (atual.error) return atual.error.message;
  const etiquetas = (atual.data.etiquetas as string[]).filter((e) => e !== MARCA);
  const { error } = await db
    .from("clientes")
    .update({ etiquetas: excluir ? [...etiquetas, MARCA] : etiquetas })
    .eq("id", clienteId);
  return error?.message;
}

export function excluirCliente(clienteId: string) {
  return trocarMarca(clienteId, true);
}

export function restaurarCliente(clienteId: string) {
  return trocarMarca(clienteId, false);
}

export type ClienteExcluida = { id: string; nome: string | null; telefone: string; atualizado_em: string };

// Todas as excluídas do salão (a mais recente primeiro)
export async function buscarExcluidas(empresaId: string) {
  const { data, error } = await supabase()
    .from("clientes")
    .select("id, nome, telefone, atualizado_em")
    .eq("empresa_id", empresaId)
    .contains("etiquetas", [MARCA])
    .order("atualizado_em", { ascending: false });
  return { excluidas: (data ?? []) as ClienteExcluida[], erro: error?.message };
}

// Texto da confirmação (mostrado com useDialogo)
export function textoExclusao(nome: string | null): string {
  return (
    `Excluir ${nome ?? "esta cliente"}?\n\nEla sai do Início, da Agenda e de Clientes e vai para ` +
    "Clientes excluídas, no Painel CRM, onde dá para restaurar."
  );
}
