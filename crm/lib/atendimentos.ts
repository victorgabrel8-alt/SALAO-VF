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
  servico_id: string | null;
  observacoes: string | null;
  clientes: { id: string; nome: string | null; telefone: string; etiquetas: string[]; observacoes: string | null } | null;
  servicos: { nome: string } | null;
};

// Sem valores: o painel do salão controla atendimentos, não dinheiro (a tabela de preços
// fica com a profissional e a IA)
const CAMPOS =
  "id, inicio, fim, status, origem, google_event_id, profissional_id, servico_id, observacoes, clientes (id, nome, telefone, etiquetas, observacoes), servicos (nome)";

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

// Confirmar o atendimento (o ✓ da agenda).
//   "Foi isso" (sem serviços): só marca realizado, com o serviço que estava marcado.
//   "Fez outra coisa": o 1º serviço escolhido fica neste horário e cada um dos outros vira um
//   atendimento realizado no mesmo horário. Assim cada serviço ganha o próprio retorno (o banco
//   calcula pelo dias_retorno) e a IA enxerga o que foi feito de verdade.
// Trocou o serviço? O que estava marcado fica anotado ("Marcado era: Hidratação") para o desfazer
// conseguir voltar.
export async function confirmarAtendimento(empresaId: string, a: Atendimento, servicoIds: string[] = []) {
  const db = supabase();
  const [primeiro, ...extras] = servicoIds;
  const trocou = primeiro && primeiro !== a.servico_id;
  const { error } = await db
    .from("agendamentos")
    .update({
      status: "realizado",
      ...(trocou
        ? {
            servico_id: primeiro,
            observacoes: [a.observacoes, MARCADO_ERA + (a.servicos?.nome ?? SEM_SERVICO)].filter(Boolean).join("\n"),
          }
        : {}),
    })
    .eq("id", a.id);
  if (error || !extras.length || !a.clientes) return error?.message;

  const { error: erroExtras } = await db.from("agendamentos").insert(
    extras.map((servico_id) => ({
      empresa_id: empresaId,
      cliente_id: a.clientes!.id,
      servico_id,
      profissional_id: a.profissional_id,
      inicio: a.inicio,
      status: "realizado",
      origem: "manual",
      observacoes: FEITO_JUNTO + formatarHora(a.inicio),
    })),
  );
  return erroExtras?.message;
}

const FEITO_JUNTO = "Feito junto no atendimento das ";
const MARCADO_ERA = "Marcado era: ";
const SEM_SERVICO = "serviço não informado";

// Atendimento criado pelo "Fez outra coisa" (serviço a mais no mesmo horário)
export function ehFeitoJunto(a: Atendimento) {
  return (a.observacoes ?? "").startsWith(FEITO_JUNTO);
}

// Os serviços feitos junto com este atendimento (mesma cliente, mesmo horário)
export function feitosJunto(a: Atendimento, doDia: Atendimento[]) {
  return doDia.filter((x) => x.id !== a.id && ehFeitoJunto(x) && x.clientes?.id === a.clientes?.id && x.inicio === a.inicio);
}

// Desfaz o ✓: volta para "a atender", apaga os serviços feitos junto e, se o serviço foi trocado
// no "Fez outra coisa", volta o que estava marcado.
export async function desfazerConfirmacao(empresaId: string, a: Atendimento, extras: Atendimento[]) {
  const db = supabase();
  if (extras.length) {
    const { error } = await db.from("agendamentos").delete().in("id", extras.map((x) => x.id));
    if (error) return error.message;
  }
  const linhas = (a.observacoes ?? "").split("\n");
  const era = linhas.findLast((l) => l.startsWith(MARCADO_ERA))?.slice(MARCADO_ERA.length);
  let servicoAntigo: string | null | undefined;
  if (era !== undefined) {
    if (era === SEM_SERVICO) servicoAntigo = null;
    else {
      const { data } = await db.from("servicos").select("id").eq("empresa_id", empresaId).eq("nome", era).limit(1);
      servicoAntigo = data?.[0]?.id;
    }
  }
  const { error } = await db
    .from("agendamentos")
    .update({
      status: "agendado",
      ...(servicoAntigo !== undefined
        ? { servico_id: servicoAntigo, observacoes: linhas.filter((l) => !l.startsWith(MARCADO_ERA)).join("\n") || null }
        : {}),
    })
    .eq("id", a.id);
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
  { borda: "border-l-rose-300", ponto: "bg-rose-300", capsula: "bg-rose-200 text-rose-900" },
  { borda: "border-l-sky-300", ponto: "bg-sky-300", capsula: "bg-sky-200 text-sky-900" },
  { borda: "border-l-violet-300", ponto: "bg-violet-300", capsula: "bg-violet-200 text-violet-900" },
  { borda: "border-l-emerald-300", ponto: "bg-emerald-300", capsula: "bg-emerald-200 text-emerald-900" },
  { borda: "border-l-amber-300", ponto: "bg-amber-300", capsula: "bg-amber-200 text-amber-900" },
  { borda: "border-l-stone-400", ponto: "bg-stone-400", capsula: "bg-stone-200 text-stone-900" },
];
const SEM_PROFISSIONAL = { borda: "border-l-neutral-200", ponto: "bg-neutral-200", capsula: "bg-neutral-200 text-neutral-700" };

// Dias da semana que têm horário (para os pontinhos da faixa da semana)
export async function buscarDiasComHorario(empresaId: string, de: string, ate: string) {
  const { data } = await supabase()
    .from("agendamentos")
    .select("inicio, clientes (etiquetas)")
    .eq("empresa_id", empresaId)
    .neq("status", "cancelado")
    .gte("inicio", inicioDoDia(de))
    .lt("inicio", inicioDoDia(somarDias(ate, 1)));
  const dias = new Set<string>();
  for (const a of (data ?? []) as unknown as { inicio: string; clientes: { etiquetas: string[] } | null }[]) {
    if (!estaExcluida(a.clientes?.etiquetas)) dias.add(dataNoSalao(a.inicio));
  }
  return dias;
}

export function corDaProfissional(profissionalId: string | null, ordem: string[]) {
  const i = profissionalId ? ordem.indexOf(profissionalId) : -1;
  return i < 0 ? SEM_PROFISSIONAL : CORES_PROFISSIONAL[i % CORES_PROFISSIONAL.length];
}
