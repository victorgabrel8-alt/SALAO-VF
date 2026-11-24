import { hojeNoSalao } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

// Dias em que o salão não atende (viagem, folga, curso, imprevisto). Ficam em
// empresas.config.bloqueios = [{ "de": "2026-11-10", "ate": "2026-11-15", "motivo": "Viagem" }]
// (de e ate inclusivos). O app não oferece horário nesses dias, e a IA também não: o cálculo da
// agenda no n8n (agenda-calculo.js) lê o mesmo config. Ver CONTRATO.md.
//
// Bloqueio de uma profissional só (24/11/2026, supabase/076): o bloqueio pode ter "profissional_id" (e "profissional", o
// nome). Sem ele, o studio todo fecha, como sempre. Com ele, só a agenda dessa profissional fecha: a outra continua
// atendendo (a Caroline foi para a prova, a Duda atende). A assistente da dona e a IA já gravam e respeitam isso.

export type Bloqueio = { de: string; ate: string; motivo: string | null; profissional_id?: string | null; profissional?: string | null };

export function lerBloqueios(config: Record<string, unknown>): Bloqueio[] {
  const lista = Array.isArray(config.bloqueios) ? config.bloqueios : [];
  return lista
    .filter((b): b is Bloqueio => typeof b?.de === "string" && typeof b?.ate === "string")
    .map((b) => ({
      de: b.de,
      ate: b.ate < b.de ? b.de : b.ate,
      motivo: b.motivo ?? null,
      // de quem é o bloqueio: guardado de volta ao salvar (antes a tela apagava e o bloqueio virava do studio todo)
      ...(b.profissional_id ? { profissional_id: b.profissional_id, profissional: b.profissional ?? null } : {}),
    }))
    .sort((a, b) => a.de.localeCompare(b.de));
}

// O bloqueio do STUDIO que cobre este dia, se houver (o dia todo fechado, para todas)
export function bloqueioDoDia(config: Record<string, unknown>, dia: string): Bloqueio | null {
  return lerBloqueios(config).find((b) => !b.profissional_id && dia >= b.de && dia <= b.ate) ?? null;
}

// Os bloqueios de UMA profissional que cobrem este dia (o studio abre, ela não)
export function bloqueiosDeProfissionalNoDia(config: Record<string, unknown>, dia: string): Bloqueio[] {
  return lerBloqueios(config).filter((b) => b.profissional_id && dia >= b.de && dia <= b.ate);
}

// O dia está fechado para esta profissional? (bloqueio do studio ou dela). profissionalId undefined = não se sabe de
// quem é o horário: qualquer bloqueio do dia vale, para não marcar em dia fechado.
export function bloqueioParaProfissional(config: Record<string, unknown>, dia: string, profissionalId?: string): Bloqueio | null {
  return (
    lerBloqueios(config).find(
      (b) => dia >= b.de && dia <= b.ate && (!b.profissional_id || profissionalId === undefined || b.profissional_id === profissionalId),
    ) ?? null
  );
}

// Horas sem atender num dia: empresas.config.bloqueios_horario = [{ "dia": "2026-11-10", "inicio": "14:00", "fim": "16:00", "motivo": "Médico" }].
// A Gleide cria pela assistente; a IA e o app não oferecem esse período. Ver supabase/030_bloqueio_por_horario.sql.
// Com "profissional_id", só a agenda dela fica fechada nessas horas (supabase/076).
export type BloqueioHorario = { dia: string; inicio: string; fim: string; motivo: string | null; profissional_id?: string | null; profissional?: string | null };

// profissionalId undefined = todos os bloqueios do dia (para mostrar, ou quando não se sabe de quem é o horário);
// com a profissional = os do studio e os dela.
export function bloqueiosHorarioDoDia(config: Record<string, unknown>, dia: string, profissionalId?: string): BloqueioHorario[] {
  const lista = Array.isArray(config.bloqueios_horario) ? config.bloqueios_horario : [];
  return lista
    .filter((b): b is BloqueioHorario => b?.dia === dia && typeof b?.inicio === "string" && typeof b?.fim === "string")
    .filter((b) => profissionalId === undefined || !b.profissional_id || b.profissional_id === profissionalId)
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}

// Só os que ainda não passaram (os antigos ficam no config, mas não aparecem)
export function bloqueiosFuturos(config: Record<string, unknown>): Bloqueio[] {
  const hoje = hojeNoSalao();
  return lerBloqueios(config).filter((b) => b.ate >= hoje);
}

// O mesmo bloqueio (para remover só ele): mesmas datas e da mesma profissional (ou dos dois do studio)
export function mesmoBloqueio(a: Bloqueio, b: Bloqueio): boolean {
  return a.de === b.de && a.ate === b.ate && (a.profissional_id ?? null) === (b.profissional_id ?? null);
}

// Salva a lista de bloqueios lendo o config atual do banco, para não apagar outras configurações.
// Devolve o config novo, para a tela já usar sem recarregar.
export async function salvarBloqueios(
  empresaId: string,
  mudar: (atuais: Bloqueio[]) => Bloqueio[],
): Promise<{ erro: string } | { config: Record<string, unknown> }> {
  const db = supabase();
  const atual = await db.from("empresas").select("config").eq("id", empresaId).single();
  if (atual.error) return { erro: atual.error.message };
  const configAtual = (atual.data.config ?? {}) as Record<string, unknown>;
  const config = { ...configAtual, bloqueios: mudar(lerBloqueios(configAtual)) };
  const { error } = await db.from("empresas").update({ config }).eq("id", empresaId);
  return error ? { erro: error.message } : { config };
}
