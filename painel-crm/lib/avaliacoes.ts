import { supabase } from "@/lib/supabase/client";

// O que a IA sabe da cliente: a pré-avaliação anotada na conversa, o resultado da avaliação e a
// etapa do funil (view funil_clientes), tudo do supabase/004. Sem o 004 no banco, volta null e a
// ficha segue sem essa parte. Ver docs/PLANO-IA-ALIMENTA-CRM.md.

export type EtapaFunil = "novo" | "interessada" | "avaliacao_marcada" | "aguardando_gleide" | "pensando" | "fechou" | "nao_fechou";

export const ETAPAS_FUNIL: Record<EtapaFunil, string> = {
  novo: "Só conversou",
  interessada: "Interessada",
  avaliacao_marcada: "Avaliação marcada",
  aguardando_gleide: "Aguardando o resultado da Gleide",
  pensando: "Ficou de pensar",
  fechou: "Fechou",
  nao_fechou: "Não fechou",
};

export type SaberIa = {
  etapa: EtapaFunil;
  avaliacao: Record<string, string | number | boolean | null> | null;
  resumoConversas: string | null;
};

// Campos da pré-avaliação, na ordem em que aparecem
export const CAMPOS_PRE: [string, string][] = [
  ["pre_comprimento_atual", "Cabelo hoje"],
  ["pre_comprimento_desejado", "Quer chegar em"],
  ["pre_cor", "Cor"],
  ["pre_usa_mega", "Já usa mega hair"],
  ["pre_tecnica_atual", "Técnica atual"],
  ["pre_quimica_recente", "Química recente"],
  ["pre_tecnica_interesse", "Técnica de interesse"],
  ["pre_orcamento", "Orçamento"],
  ["pre_ocasiao", "Ocasião"],
  ["pre_data_ocasiao", "Data da ocasião"],
  ["pre_fotos", "Fotos que mandou"],
  ["tecnica_indicada", "Técnica indicada (Gleide)"],
  ["valor_orcado", "Valor orçado"],
  ["proximo_passo", "Próximo passo"],
  ["motivo_nao_fechou", "Por que não fechou"],
];

export async function buscarSaberIa(clienteId: string): Promise<SaberIa | null> {
  const db = supabase();
  const [funil, avaliacao, cliente] = await Promise.all([
    db.from("funil_clientes").select("etapa").eq("cliente_id", clienteId).maybeSingle(),
    db.from("avaliacoes").select("*").eq("cliente_id", clienteId).order("criado_em", { ascending: false }).limit(1).maybeSingle(),
    db.from("clientes").select("resumo_ia").eq("id", clienteId).maybeSingle(),
  ]);
  if (funil.error || avaliacao.error) return null;
  return {
    etapa: (funil.data?.etapa ?? "novo") as EtapaFunil,
    avaliacao: (avaliacao.data as SaberIa["avaliacao"]) ?? null,
    resumoConversas: cliente.error ? null : ((cliente.data?.resumo_ia as string | null) ?? null),
  };
}
