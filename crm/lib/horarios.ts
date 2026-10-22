import { conflitaComAlmoco, lerAlmoco } from "@/lib/almoco";
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

// [abre, fecha] em minutos, ou null se o salão não abre nesse dia
function expediente(config: Record<string, unknown>, dia: string): [number, number] | null {
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

// O próprio dia, se o salão abre, ou o próximo dia aberto (até uma semana depois)
export function proximoDiaAberto(config: Record<string, unknown>, dia: string): string {
  for (let i = 0; i < 7; i++) {
    const d = somarDias(dia, i);
    if (expediente(config, d)) return d;
  }
  return dia;
}

// Horários de início livres no dia, de 30 em 30 minutos, para um serviço com essa duração
export async function horariosLivres(
  empresaId: string,
  config: Record<string, unknown>,
  dia: string,
  duracaoMin: number,
): Promise<string[]> {
  const faixa = expediente(config, dia);
  if (!faixa) return [];
  const { data } = await supabase()
    .from("agendamentos")
    .select("inicio, fim")
    .eq("empresa_id", empresaId)
    .in("status", ["agendado", "realizado"])
    .gte("inicio", inicioDoDia(dia))
    .lt("inicio", inicioDoDia(somarDias(dia, 1)));
  // Sem fim gravado, conta 1 h; atendimento que passa da meia-noite ocupa até o fim do dia
  const ocupados = ((data ?? []) as { inicio: string; fim: string | null }[]).map((a) => {
    const ini = emMinutos(formatarHora(a.inicio));
    const fim = !a.fim ? ini + 60 : dataNoSalao(a.fim) === dia ? emMinutos(formatarHora(a.fim)) : 24 * 60;
    return [ini, fim] as const;
  });
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
