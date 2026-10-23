import { diasEntre, dataNoSalao, hojeNoSalao, primeiroNome } from "@/lib/formato";
import type { StatusCliente } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";

// "Mandar alô": a dona chama a cliente que está para voltar (retorno) ou sumida (reativação).
// O texto vem de empresas.config.mensagens.retorno / .reativacao, com {nome} e {servico}.

export type TipoAlo = "retorno" | "reativacao";

const PADRAO: Record<TipoAlo, string> = {
  retorno: "Oi {nome}! Tudo bem? Já está chegando a hora do seu {servico}. Quer que eu veja um horário pra você?",
  reativacao: "Oi {nome}! Que saudade de você aqui no salão 💛 Bora marcar um horário pra se cuidar?",
};

// Quem pode receber alô: retorno chegando, atrasadas e inativas
export function podeMandarAlo(status: StatusCliente): boolean {
  return status === "retorno_chegando" || status === "retorno_atrasado" || status === "inativa";
}

export function tipoDoAlo(status: StatusCliente): TipoAlo {
  return status === "inativa" ? "reativacao" : "retorno";
}

export function montarMensagem(
  config: Record<string, unknown>,
  tipo: TipoAlo,
  nome: string | null,
  servico: string | null,
): string {
  const mensagens = (config.mensagens ?? {}) as Partial<Record<TipoAlo, string>>;
  const modelo = mensagens[tipo] || PADRAO[tipo];
  return modelo
    .replaceAll("{nome}", primeiroNome(nome))
    .replaceAll("{servico}", servico ?? "atendimento")
    .replace(/^Oi\s+!/, "Oi!");
}

// Dias desde o último alô (null se nunca foi chamada)
export function diasDesdeContato(ultimoContato: string | null): number | null {
  return ultimoContato ? diasEntre(dataNoSalao(ultimoContato), hojeNoSalao()) : null;
}

// Para cada cliente, o serviço a citar no alô: o que vence primeiro entre as linhas de serviço
// pendentes (view retornos_pendentes, supabase/007; a mesma regra do status).
// Sem o 007: o da visita mais recente que tem retorno e, se ela fez vários, o de retorno mais
// curto. Se nenhum tiver retorno, o mais recente.
// Só para as clientes que estão na tela (não baixa o histórico da base inteira).
export async function buscarServicoDoAlo(empresaId: string, clienteIds: string[]): Promise<Record<string, string>> {
  if (clienteIds.length === 0) return {};
  const pendentes = await supabase()
    .from("retornos_pendentes")
    .select("cliente_id, servico_nome, retorno_previsto")
    .eq("empresa_id", empresaId)
    .in("cliente_id", clienteIds)
    .order("retorno_previsto");
  if (!pendentes.error) {
    const primeiro: Record<string, string> = {};
    for (const r of (pendentes.data ?? []) as { cliente_id: string; servico_nome: string }[]) primeiro[r.cliente_id] ??= r.servico_nome;
    // Quem não tem retorno pendente cai na regra de baixo (o serviço mais recente)
    if (clienteIds.every((id) => primeiro[id])) return primeiro;
    const resto = await buscarServicoDoAloSem007(empresaId, clienteIds.filter((id) => !primeiro[id]));
    return { ...resto, ...primeiro };
  }
  return buscarServicoDoAloSem007(empresaId, clienteIds);
}

async function buscarServicoDoAloSem007(empresaId: string, clienteIds: string[]): Promise<Record<string, string>> {
  if (clienteIds.length === 0) return {};
  const { data } = await supabase()
    .from("retornos_por_servico")
    .select("cliente_id, servico_nome, ultima_vez, retorno_previsto")
    .eq("empresa_id", empresaId)
    .in("cliente_id", clienteIds);
  const escolhido: Record<string, { nome: string; retorno: string | null; ultima: string }> = {};
  for (const r of (data ?? []) as {
    cliente_id: string;
    servico_nome: string;
    ultima_vez: string;
    retorno_previsto: string | null;
  }[]) {
    const atual = escolhido[r.cliente_id];
    const melhor =
      !atual ||
      (r.retorno_previsto &&
        (!atual.retorno ||
          r.ultima_vez > atual.ultima ||
          (r.ultima_vez === atual.ultima && r.retorno_previsto < atual.retorno))) ||
      (!r.retorno_previsto && !atual.retorno && r.ultima_vez > atual.ultima);
    if (melhor) escolhido[r.cliente_id] = { nome: r.servico_nome, retorno: r.retorno_previsto, ultima: r.ultima_vez };
  }
  return Object.fromEntries(Object.entries(escolhido).map(([id, s]) => [id, s.nome]));
}

// Grava o alô em contatos. O banco marca sozinho "respondeu" / "agendou" depois.
export async function registrarAlo(empresaId: string, clienteId: string, tipo: TipoAlo, mensagem: string) {
  const db = supabase();
  const { data: usuario } = await db.auth.getUser();
  const { error } = await db.from("contatos").insert({
    empresa_id: empresaId,
    cliente_id: clienteId,
    tipo,
    canal: "manual",
    mensagem,
    criado_por: usuario.user?.id ?? null,
  });
  return error?.message;
}
