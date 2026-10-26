import { FUSO, FUSO_OFFSET } from "@/lib/config";

// O banco só aceita telefone como 55 + DDD + número, só dígitos (ex.: 5566999998888).
// Aceita o que a dona digitar: "(66) 99999-8888", "66999998888", "+55 66 99999-8888".
export function normalizarTelefone(texto: string): string {
  let digitos = texto.replace(/\D/g, "");
  if (digitos.startsWith("0")) digitos = digitos.replace(/^0+/, "");
  if (digitos.length === 10 || digitos.length === 11) digitos = "55" + digitos;
  return digitos;
}

export function telefoneValido(telefone: string): boolean {
  return /^55[0-9]{10,11}$/.test(telefone);
}

// 5566999998888 -> (66) 99999-8888
export function formatarTelefone(telefone: string): string {
  const local = telefone.startsWith("55") ? telefone.slice(2) : telefone;
  const ddd = local.slice(0, 2);
  const numero = local.slice(2);
  if (numero.length === 9) return `(${ddd}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
  if (numero.length === 8) return `(${ddd}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return telefone;
}

export function primeiroNome(nome: string | null): string {
  return nome?.trim().split(/\s+/)[0] ?? "";
}

// Data de hoje no fuso do salão, como "2026-10-20"
export function hojeNoSalao(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: FUSO });
}

// Converte um timestamptz para a data "AAAA-MM-DD" no fuso do salão
export function dataNoSalao(instante: string): string {
  return new Date(instante).toLocaleDateString("en-CA", { timeZone: FUSO });
}

// Diferença em dias entre duas datas "AAAA-MM-DD" (b - a)
export function diasEntre(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// "2026-10-20" ou timestamptz -> "20/10/2026"
export function formatarData(valor: string): string {
  const data = valor.length === 10 ? valor : dataNoSalao(valor);
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

// h23: meia-noite sai "00:00" (alguns navegadores escreviam "24:00", e as contas de horário
// livre em minutos erravam)
export function formatarHora(instante: string): string {
  return new Date(instante).toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

// Dia "AAAA-MM-DD" e hora "HH:MM" que dá para gravar (o campo de data ou hora pode vir vazio
// quando a dona apaga no celular)
export function dataValida(data: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(data) && !Number.isNaN(Date.parse(`${data}T12:00:00Z`));
}
export function horaValida(hora: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hora.slice(0, 5));
}

// "hoje", "ontem", "há 47 dias"
export function haQuantoTempo(instante: string): string {
  const dias = diasEntre(dataNoSalao(instante), hojeNoSalao());
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

// Data e hora de agora no fuso do salão: { data: "2026-10-20", hora: "14:35" }
export function agoraNoSalao(): { data: string; hora: string } {
  const agora = new Date();
  return {
    data: agora.toLocaleDateString("en-CA", { timeZone: FUSO }),
    hora: agora.toLocaleTimeString("pt-BR", { timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
  };
}

// "2026-10-20" + "14:30" (horário do salão) -> instante ISO para gravar no banco
export function instanteNoSalao(data: string, hora: string): string {
  return new Date(`${data}T${hora}:00${FUSO_OFFSET}`).toISOString();
}

// Começo do dia no fuso do salão, como instante ISO (para filtrar no banco)
export function inicioDoDia(data: string): string {
  return instanteNoSalao(data, "00:00");
}

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// "2026-10-20" -> "Terça-feira, 20 de outubro"
export function formatarDiaLongo(data: string): string {
  const texto = new Date(`${data}T12:00:00Z`).toLocaleDateString("pt-BR", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Para datas futuras ou passadas: "hoje", "amanhã", "em 5 dias", "atrasado 3 dias"
export function prazo(data: string): string {
  const dias = diasEntre(hojeNoSalao(), data);
  if (dias === 0) return "hoje";
  if (dias === 1) return "amanhã";
  if (dias > 1) return `em ${dias} dias`;
  if (dias === -1) return "atrasado 1 dia";
  return `atrasado ${-dias} dias`;
}
