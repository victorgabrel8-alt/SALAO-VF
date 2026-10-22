import type { Atendimento } from "@/lib/atendimentos";
import { dataNoSalao, formatarData, formatarDiaLongo, formatarHora, primeiroNome } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

// Pedido de remarcação (supabase/005_pedido_remarcacao.sql): num imprevisto, a Gleide toca em
// "Pedir para remarcar". O app grava um contato tipo 'remarcacao' ligado ao horário e abre o
// WhatsApp do salão com a mensagem pronta; ela envia. Quando a cliente responde, a IA lê o
// "ALÔ DE REMARCAÇÃO" na ficha, oferece horários e remarca o mesmo agendamento.
// O n8n reconhece a mensagem enviada como alô (e não pausa a IA) se o começo dela for igual ao
// gravado: por isso a Gleide deve enviar o texto como está.

export type Pedido = {
  id: string;
  agendamento_id: string;
  resultado: "pendente" | "sem_resposta" | "respondeu" | "agendou";
  criado_em: string;
  horario_original: string | null;
};

export type Situacao = "aguardando" | "sem_resposta" | "respondeu" | "remarcado";

const HORAS_SEM_RESPOSTA = 24;

// Andamento do pedido, olhando também o horário: se ele mudou, a IA (ou a Gleide) já remarcou
export function situacaoDoPedido(p: Pedido, a: Pick<Atendimento, "inicio">): Situacao {
  const mudou = p.horario_original && Date.parse(p.horario_original) !== Date.parse(a.inicio);
  if (p.resultado === "agendou" || mudou) return "remarcado";
  if (p.resultado === "respondeu") return "respondeu";
  if (Date.now() - Date.parse(p.criado_em) > HORAS_SEM_RESPOSTA * 3_600_000) return "sem_resposta";
  return "aguardando";
}

export const SITUACAO: Record<Situacao, { rotulo: (p: Pedido) => string; classe: string }> = {
  aguardando: { rotulo: () => "Pedido enviado · aguardando", classe: "bg-ouro text-ouro-texto" },
  sem_resposta: { rotulo: () => "Sem resposta há 1 dia", classe: "bg-rose text-rose-texto" },
  respondeu: { rotulo: () => "Respondeu · a IA está remarcando", classe: "bg-areia text-taupe-texto" },
  remarcado: {
    rotulo: (p) => (p.horario_original ? `Remarcado · era ${formatarData(p.horario_original).slice(0, 5)} às ${formatarHora(p.horario_original)}` : "Remarcado"),
    classe: "bg-salvia text-salvia-texto",
  },
};

// O pedido mais recente de cada horário
export async function buscarPedidos(empresaId: string, agendamentoIds: string[]): Promise<Map<string, Pedido>> {
  const mapa = new Map<string, Pedido>();
  if (agendamentoIds.length === 0) return mapa;
  const { data } = await supabase()
    .from("contatos")
    .select("id, agendamento_id, resultado, criado_em, horario_original")
    .eq("empresa_id", empresaId)
    .eq("tipo", "remarcacao")
    .in("agendamento_id", agendamentoIds)
    .order("criado_em", { ascending: false });
  for (const p of (data ?? []) as Pedido[]) if (!mapa.has(p.agendamento_id)) mapa.set(p.agendamento_id, p);
  return mapa;
}

// A mensagem que a Gleide envia: fala do horário certo e deixa a cliente responder (quem
// oferece os horários novos é a IA, quando ela responder)
export function mensagemDeRemarcacao(a: Atendimento): string {
  const nome = a.clientes?.nome ? `, ${primeiroNome(a.clientes.nome)}` : "";
  const dia = formatarDiaLongo(dataNoSalao(a.inicio)).toLowerCase();
  return `Oi${nome}! Tudo bem? Tive um imprevisto e não vou conseguir te atender ${dia} às ${formatarHora(a.inicio)}. Vamos remarcar? Me diz qual dia fica melhor pra você 💛`;
}

// Grava o pedido. Quem abre o WhatsApp é a tela, logo depois (com a mesma mensagem).
export async function registrarPedido(empresaId: string, a: Atendimento, mensagem: string) {
  if (!a.clientes) return "Horário sem cliente.";
  const db = supabase();
  const { data: usuario } = await db.auth.getUser();
  const { error } = await db.from("contatos").insert({
    empresa_id: empresaId,
    cliente_id: a.clientes.id,
    tipo: "remarcacao",
    canal: "manual",
    mensagem,
    agendamento_id: a.id,
    horario_original: a.inicio,
    criado_por: usuario.user?.id ?? null,
  });
  return error?.message;
}
