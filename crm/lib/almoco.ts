// Horário de almoço do salão: nesse intervalo não dá para marcar horário.
// Fica em empresas.config.almoco = { "inicio": "11:00", "fim": "13:00" } (o n8n também lê,
// para a IA não oferecer esses horários). Sem nada salvo, vale 11:00 às 13:00.
// almoco = null no config desliga o bloqueio.

export type Almoco = { inicio: string; fim: string } | null;

const PADRAO = { inicio: "11:00", fim: "13:00" };

export function lerAlmoco(config: Record<string, unknown>): Almoco {
  if (config.almoco === null) return null;
  const a = config.almoco as Partial<{ inicio: string; fim: string }> | undefined;
  return a?.inicio && a?.fim ? { inicio: a.inicio, fim: a.fim } : PADRAO;
}

function emMinutos(hora: string): number {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

// O horário (com a duração do serviço) encosta no almoço?
export function conflitaComAlmoco(almoco: Almoco, hora: string, duracaoMin: number): boolean {
  if (!almoco) return false;
  const inicio = emMinutos(hora);
  const fim = inicio + Math.max(duracaoMin, 1);
  return inicio < emMinutos(almoco.fim) && fim > emMinutos(almoco.inicio);
}

export function textoAlmoco(almoco: NonNullable<Almoco>): string {
  return `${almoco.inicio} às ${almoco.fim}`;
}

export function avisoAlmoco(almoco: NonNullable<Almoco>): string {
  return `Esse horário cai no almoço (${textoAlmoco(almoco)}). Escolha outro horário.`;
}
