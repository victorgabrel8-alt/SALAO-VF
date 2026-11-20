import { primeiroNome } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

// "Chamar de volta": quem já passou do tempo de voltar e não tem horário marcado (view
// chamar_de_volta, supabase/063). A dona chama pelo WhatsApp do celular dela: o app só abre o
// WhatsApp com a mensagem pronta, não envia nem grava nada.
// Fica de fora (o banco já tira): cliente com horário marcado, excluída, inativa (passou de
// config.dias_inativa sem vir), com alô combinado esperando a data, ou que o salão (IA ou dona)
// chamou ou com quem falou nos últimos 7 dias (config.chamar_de_volta_dias).

export type ParaChamar = {
  id: string;
  nome: string | null;
  telefone: string;
  servico_nome: string | null;
  feito_em: string; // dia do atendimento, "AAAA-MM-DD"
  retorno_previsto: string;
  dias_passados: number;
  profissional_nome: string | null;
};

// Quem passou mais do tempo vem primeiro
export async function buscarParaChamar(empresaId: string) {
  const { data, error } = await supabase()
    .from("chamar_de_volta")
    .select("id, nome, telefone, servico_nome, feito_em, retorno_previsto, dias_passados, profissional_nome")
    .eq("empresa_id", empresaId)
    .order("dias_passados", { ascending: false })
    .order("nome");
  return { clientes: (data ?? []) as ParaChamar[], erro: error?.message };
}

// Só o número, para a linha do Início. Sem a view no banco (063 ainda não rodado), dá 0.
export async function contarParaChamar(empresaId: string): Promise<number> {
  const { count, error } = await supabase()
    .from("chamar_de_volta")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId);
  return error ? 0 : (count ?? 0);
}

// Quantas profissionais ativas o salão tem: só com mais de uma vale mostrar "com quem foi"
export async function contarProfissionais(empresaId: string): Promise<number> {
  const { count } = await supabase()
    .from("profissionais")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .eq("ativo", true);
  return count ?? 0;
}

const PADRAO = "Oi {nome}, tudo bem? Já faz um tempinho que você fez {servico}, quer que eu veja um horário pra você?";

// "Manicure" -> "manicure" (sigla como "UV" fica como está)
function servicoNoTexto(nome: string | null): string {
  if (!nome) return "o seu último atendimento";
  const n = nome.trim();
  return /^\p{Lu}\p{Ll}/u.test(n) ? n.charAt(0).toLowerCase() + n.slice(1) : n;
}

// Mensagem curta, do jeito da dona. A loja pode trocar em empresas.config.mensagens.chamar_de_volta,
// com {nome} e {servico}.
export function mensagemChamarDeVolta(config: Record<string, unknown>, c: Pick<ParaChamar, "nome" | "servico_nome">): string {
  const mensagens = (config.mensagens ?? {}) as { chamar_de_volta?: unknown };
  const modelo = typeof mensagens.chamar_de_volta === "string" && mensagens.chamar_de_volta.trim() ? mensagens.chamar_de_volta : PADRAO;
  return modelo
    .replaceAll("{nome}", primeiroNome(c.nome))
    .replaceAll("{servico}", servicoNoTexto(c.servico_nome))
    .replace(/^Oi\s+([,!])/, "Oi$1");
}

// "passou 1 dia", "passou 12 dias"
export function textoPassou(dias: number): string {
  return dias === 1 ? "passou 1 dia" : `passou ${dias} dias`;
}
