import { estaExcluida } from "@/lib/excluidas";
import { dataNoSalao, formatarData, formatarHora, inicioDoDia, somarDias } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

export type StatusAtendimento = "agendado" | "realizado" | "cancelado" | "faltou";

export type Atendimento = {
  id: string;
  inicio: string;
  fim: string | null;
  status: StatusAtendimento;
  origem: "ia" | "manual";
  google_event_id: string | null;
  profissional_id: string | null;
  observacoes: string | null;
  valor: number | null;
  clientes: { id: string; nome: string | null; telefone: string; etiquetas: string[] } | null;
  servicos: { nome: string; preco: number | null } | null;
  profissionais: { nome: string } | null;
};

const CAMPOS =
  "id, inicio, fim, status, origem, google_event_id, profissional_id, observacoes, valor, clientes (id, nome, telefone, etiquetas), servicos (nome, preco), profissionais (nome)";

// Atendimentos de um dia (no fuso do salão), em ordem de horário
export async function buscarAtendimentosDoDia(empresaId: string, dia: string) {
  const { data, error } = await supabase()
    .from("agendamentos")
    .select(CAMPOS)
    .eq("empresa_id", empresaId)
    .gte("inicio", inicioDoDia(dia))
    .lt("inicio", inicioDoDia(somarDias(dia, 1)))
    .order("inicio");
  // Horários de clientes excluídas não aparecem (nem no Início nem na Agenda)
  const atendimentos = ((data ?? []) as unknown as Atendimento[]).filter((a) => !estaExcluida(a.clientes?.etiquetas));
  return { atendimentos, erro: error?.message };
}

// Horários que estavam marcados para este dia e foram reagendados para outro
// (o reagendar anota "Reagendado de 20/10 às 09:00" nas observações)
export async function buscarReagendadosDoDia(empresaId: string, dia: string) {
  const { data, error } = await supabase()
    .from("agendamentos")
    .select(CAMPOS)
    .eq("empresa_id", empresaId)
    .like("observacoes", `%Reagendado de ${formatarData(dia).slice(0, 5)} às%`)
    .order("inicio");
  const atendimentos = ((data ?? []) as unknown as Atendimento[]).filter(
    (a) => !estaExcluida(a.clientes?.etiquetas) && dataNoSalao(a.inicio) !== dia,
  );
  return { atendimentos, erro: error?.message };
}

export async function mudarStatus(id: string, status: StatusAtendimento) {
  const { error } = await supabase().from("agendamentos").update({ status }).eq("id", id);
  return error?.message;
}

// Excluir apaga o horário de vez (ex.: lançado por engano). Para a cliente que desmarcou,
// o certo é "Cancelado", que fica no histórico.
export async function excluirAtendimento(id: string) {
  const { error } = await supabase().from("agendamentos").delete().eq("id", id);
  return error?.message;
}

// Reagendar: muda o horário do mesmo atendimento e volta para "agendado" (ex.: ela faltou e
// remarcou). O horário antigo fica anotado nas observações ("Reagendado de 20/10 às 13:00").
// fim = null faz o banco recalcular o fim pela duração do serviço.
export async function reagendar(a: Atendimento, novoInicio: string) {
  const anotacao = `Reagendado de ${formatarData(a.inicio).slice(0, 5)} às ${formatarHora(a.inicio)}`;
  const { error } = await supabase()
    .from("agendamentos")
    .update({
      inicio: novoInicio,
      fim: null,
      status: "agendado",
      observacoes: [a.observacoes, anotacao].filter(Boolean).join("\n"),
    })
    .eq("id", a.id);
  return error?.message;
}

// Última anotação de reagendamento do atendimento, para mostrar no cartão
export function ultimoReagendamento(a: Atendimento): string | null {
  const linhas = (a.observacoes ?? "").split("\n").filter((l) => l.startsWith("Reagendado de "));
  return linhas.at(-1) ?? null;
}

// Cor fixa por profissional (pela ordem do nome), para a dona reconhecer de longe na agenda
// Tons suaves: a cor só identifica, não chama atenção.
const CORES_PROFISSIONAL = [
  { borda: "border-l-rose-300", ponto: "bg-rose-300" },
  { borda: "border-l-sky-300", ponto: "bg-sky-300" },
  { borda: "border-l-violet-300", ponto: "bg-violet-300" },
  { borda: "border-l-emerald-300", ponto: "bg-emerald-300" },
  { borda: "border-l-amber-300", ponto: "bg-amber-300" },
  { borda: "border-l-stone-400", ponto: "bg-stone-400" },
];
const SEM_PROFISSIONAL = { borda: "border-l-neutral-200", ponto: "bg-neutral-200" };

export function corDaProfissional(profissionalId: string | null, ordem: string[]) {
  const i = profissionalId ? ordem.indexOf(profissionalId) : -1;
  return i < 0 ? SEM_PROFISSIONAL : CORES_PROFISSIONAL[i % CORES_PROFISSIONAL.length];
}
