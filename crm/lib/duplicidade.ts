import { estaExcluida } from "@/lib/excluidas";
import { inicioDoDia } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

// Conferências antes de gravar pelo app, para não nascer cliente nem horário em dobro:
//   - telefone que já é de outra cliente (o mesmo número, com ou sem o 9): não deixa criar outra
//     ficha, só usar a que existe
//   - cliente nova parecida com uma que já existe (mesmo nome ou telefone quase igual, como
//     "99683-4918" e "99885-4918"): pergunta antes
//   - a cliente já tem horário marcado (o certo costuma ser substituir esse horário, não criar outro)

export type ClienteParecida = {
  id: string;
  nome: string | null;
  telefone: string;
  etiquetas: string[];
  motivo: string;
  // O mesmo número (com ou sem o 9): aí não pode haver outra ficha
  mesmoTelefone: boolean;
};

const semAcento = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

// Mesmo número com ou sem o 9 / DDD, ou até 2 dígitos diferentes (erro de digitação)
function telefoneParecido(a: string, b: string): boolean {
  if (a.slice(-8) === b.slice(-8)) return true;
  if (a.length !== b.length) return false;
  let diferentes = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diferentes++;
  return diferentes <= 2;
}

export async function buscarParecidas(empresaId: string, nome: string, telefone: string): Promise<ClienteParecida[]> {
  const nomeLimpo = semAcento(nome);
  const primeiro = nomeLimpo.split(" ")[0] ?? "";
  const filtros = [
    ...(primeiro.length >= 2 ? [`nome.ilike.%${primeiro.replace(/[,()%*]/g, "")}%`] : []),
    `telefone.like.%${telefone.slice(-4)}`,
  ];
  const { data } = await supabase()
    .from("clientes")
    .select("id, nome, telefone, etiquetas")
    .eq("empresa_id", empresaId)
    .or(filtros.join(","))
    .limit(50);
  const parecidas: ClienteParecida[] = [];
  for (const c of (data ?? []) as Omit<ClienteParecida, "motivo" | "mesmoTelefone">[]) {
    // Mesmo telefone conta até de cliente excluída: o número não pode ter outra ficha
    const mesmoTelefone = c.telefone.slice(-8) === telefone.slice(-8);
    if (estaExcluida(c.etiquetas) && !mesmoTelefone) continue;
    const mesmoNome = !!c.nome && semAcento(c.nome) === nomeLimpo;
    const fone = telefoneParecido(c.telefone, telefone);
    if (mesmoNome || fone) {
      const motivo = mesmoTelefone ? "mesmo telefone" : mesmoNome && fone ? "mesmo nome e telefone parecido" : mesmoNome ? "mesmo nome" : "telefone parecido";
      parecidas.push({ ...c, motivo, mesmoTelefone });
    }
  }
  // Quem tem o mesmo telefone vem primeiro
  return parecidas.sort((a, b) => Number(b.mesmoTelefone) - Number(a.mesmoTelefone)).slice(0, 3);
}

export type HorarioMarcado = { id: string; inicio: string; observacoes: string | null; servicos: { nome: string } | null };

// Horários a atender da cliente, de hoje em diante
export async function horariosMarcadosDaCliente(clienteId: string, desdeDia: string): Promise<HorarioMarcado[]> {
  const { data } = await supabase()
    .from("agendamentos")
    .select("id, inicio, observacoes, servicos (nome)")
    .eq("cliente_id", clienteId)
    .eq("status", "agendado")
    .gte("inicio", inicioDoDia(desdeDia))
    .order("inicio")
    .limit(5);
  return (data ?? []) as unknown as HorarioMarcado[];
}
