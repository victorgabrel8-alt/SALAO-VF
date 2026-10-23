import { avisoAlmoco, conflitaComAlmoco, lerAlmoco } from "@/lib/almoco";
import { bloqueioDoDia } from "@/lib/bloqueios";
import { agoraNoSalao, dataNoSalao, formatarHora, inicioDoDia, somarDias } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

// Horários livres para marcar, com as mesmas regras da IA (n8n/demo-agente/agenda-calculo.js):
// dentro do horário de funcionamento, fora do almoço e sem encostar em outro horário marcado.
// Horário de funcionamento: empresas.config.horario_funcionamento = { "ter": "09:00-19:00", "seg": null, ... }

const CHAVES_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const PASSO_MIN = 30;

function emMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

function hora(minutos: number): string {
  return `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}`;
}

// [abre, fecha] em minutos, ou null se o salão não abre nesse dia (fechado ou dia bloqueado)
function expediente(config: Record<string, unknown>, dia: string): [number, number] | null {
  if (bloqueioDoDia(config, dia)) return null;
  const tabela = config.horario_funcionamento as Record<string, string | null> | undefined;
  if (!tabela) return [emMinutos("09:00"), emMinutos("18:00")];
  const faixa = tabela[CHAVES_SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()]];
  if (!faixa) return null;
  const [abre, fecha] = faixa.split("-");
  return [emMinutos(abre), emMinutos(fecha)];
}

export function abreNoDia(config: Record<string, unknown>, dia: string): boolean {
  return expediente(config, dia) !== null;
}

// O próprio dia, se o salão abre, ou o próximo dia aberto (até dois meses depois, para passar
// por cima de um bloqueio longo)
export function proximoDiaAberto(config: Record<string, unknown>, dia: string): string {
  for (let i = 0; i < 60; i++) {
    const d = somarDias(dia, i);
    if (expediente(config, d)) return d;
  }
  return dia;
}

type Ocupado = { ini: number; fim: number; nome: string };

// O que já ocupa o dia: horários a atender e concluídos (falta e cancelado liberam a vaga).
// Sem fim gravado, conta 1 h; atendimento que passa da meia-noite ocupa até o fim do dia.
async function ocupadosDoDia(empresaId: string, dia: string, ignorarId?: string): Promise<Ocupado[] | { erro: string }> {
  let consulta = supabase()
    .from("agendamentos")
    .select("inicio, fim, clientes (nome, telefone)")
    .eq("empresa_id", empresaId)
    .in("status", ["agendado", "realizado"])
    .gte("inicio", inicioDoDia(dia))
    .lt("inicio", inicioDoDia(somarDias(dia, 1)));
  if (ignorarId) consulta = consulta.neq("id", ignorarId);
  const { data, error } = await consulta;
  if (error) return { erro: error.message };
  return ((data ?? []) as unknown as { inicio: string; fim: string | null; clientes: { nome: string | null; telefone: string } | null }[]).map((a) => {
    const ini = emMinutos(formatarHora(a.inicio));
    const fim = !a.fim ? ini + 60 : dataNoSalao(a.fim) === dia ? emMinutos(formatarHora(a.fim)) : 24 * 60;
    return { ini, fim, nome: a.clientes?.nome ?? "outra cliente" };
  });
}

// Antes de gravar um horário a atender (marcar, remarcar, mudar): o salão abre nesse dia, está
// dentro do expediente, fora do almoço e sem encavalar com outra cliente? Devolve o motivo
// para a dona, ou null se pode marcar. ignorarId: o próprio horário que está mudando.
export async function conferirHorario(
  empresaId: string,
  config: Record<string, unknown>,
  dia: string,
  horaInicio: string,
  duracaoMin: number,
  ignorarId?: string,
): Promise<string | null> {
  const bloqueio = bloqueioDoDia(config, dia);
  if (bloqueio) return `Esse dia está marcado como sem atender${bloqueio.motivo ? ` (${bloqueio.motivo})` : ""}. Escolha outro dia.`;
  const faixa = expediente(config, dia);
  if (!faixa) return "O salão não abre nesse dia. Escolha outro dia.";
  const ini = emMinutos(horaInicio.slice(0, 5));
  const fim = ini + Math.max(duracaoMin, 1);
  if (ini < faixa[0] || fim > faixa[1]) {
    return `Fora do horário do salão nesse dia (${hora(faixa[0])} às ${hora(faixa[1])}), contando a duração do serviço.`;
  }
  const almoco = lerAlmoco(config);
  if (almoco && conflitaComAlmoco(almoco, horaInicio.slice(0, 5), duracaoMin)) return avisoAlmoco(almoco);
  const ocupados = await ocupadosDoDia(empresaId, dia, ignorarId);
  if ("erro" in ocupados) return `Não foi possível conferir a agenda: ${ocupados.erro}`;
  const choque = ocupados.find((o) => ini < o.fim && fim > o.ini);
  if (choque) {
    return `Encavala com ${choque.nome} (${hora(choque.ini)} às ${hora(choque.fim)}). Escolha outro horário.`;
  }
  return null;
}

// Horários de início livres no dia, de 30 em 30 minutos, para um serviço com essa duração.
// ignorarId: o horário que está sendo remarcado não ocupa a própria vaga.
export async function horariosLivres(
  empresaId: string,
  config: Record<string, unknown>,
  dia: string,
  duracaoMin: number,
  ignorarId?: string,
): Promise<string[]> {
  const faixa = expediente(config, dia);
  if (!faixa) return [];
  const resultado = await ocupadosDoDia(empresaId, dia, ignorarId);
  const ocupados = "erro" in resultado ? [] : resultado.map((o) => [o.ini, o.fim] as const);
  const almoco = lerAlmoco(config);
  const agora = agoraNoSalao();
  const livres: string[] = [];
  for (let ini = faixa[0]; ini + duracaoMin <= faixa[1]; ini += PASSO_MIN) {
    const fim = ini + duracaoMin;
    if (dia === agora.data && ini <= emMinutos(agora.hora)) continue;
    if (conflitaComAlmoco(almoco, hora(ini), duracaoMin)) continue;
    if (ocupados.some(([a, b]) => ini < b && fim > a)) continue;
    livres.push(hora(ini));
  }
  return livres;
}
