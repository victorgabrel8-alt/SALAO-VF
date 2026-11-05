import { hojeNoSalao } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

// Dias em que o salão não atende (viagem, folga, curso, imprevisto). Ficam em
// empresas.config.bloqueios = [{ "de": "2026-11-10", "ate": "2026-11-15", "motivo": "Viagem" }]
// (de e ate inclusivos). O app não oferece horário nesses dias, e a IA também não: o cálculo da
// agenda no n8n (agenda-calculo.js) lê o mesmo config. Ver CONTRATO.md.

export type Bloqueio = { de: string; ate: string; motivo: string | null };

export function lerBloqueios(config: Record<string, unknown>): Bloqueio[] {
  const lista = Array.isArray(config.bloqueios) ? config.bloqueios : [];
  return lista
    .filter((b): b is Bloqueio => typeof b?.de === "string" && typeof b?.ate === "string")
    .map((b) => ({ de: b.de, ate: b.ate < b.de ? b.de : b.ate, motivo: b.motivo ?? null }))
    .sort((a, b) => a.de.localeCompare(b.de));
}

// O bloqueio que cobre este dia, se houver
export function bloqueioDoDia(config: Record<string, unknown>, dia: string): Bloqueio | null {
  return lerBloqueios(config).find((b) => dia >= b.de && dia <= b.ate) ?? null;
}

// Horas sem atender num dia: empresas.config.bloqueios_horario = [{ "dia": "2026-11-10", "inicio": "14:00", "fim": "16:00", "motivo": "Médico" }].
// A Gleide cria pela assistente; a IA e o app não oferecem esse período. Ver supabase/030_bloqueio_por_horario.sql.
export type BloqueioHorario = { dia: string; inicio: string; fim: string; motivo: string | null };

export function bloqueiosHorarioDoDia(config: Record<string, unknown>, dia: string): BloqueioHorario[] {
  const lista = Array.isArray(config.bloqueios_horario) ? config.bloqueios_horario : [];
  return lista
    .filter((b): b is BloqueioHorario => b?.dia === dia && typeof b?.inicio === "string" && typeof b?.fim === "string")
    .sort((a, b) => a.inicio.localeCompare(b.inicio));
}

// Só os que ainda não passaram (os antigos ficam no config, mas não aparecem)
export function bloqueiosFuturos(config: Record<string, unknown>): Bloqueio[] {
  const hoje = hojeNoSalao();
  return lerBloqueios(config).filter((b) => b.ate >= hoje);
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
