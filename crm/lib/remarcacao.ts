import type { Atendimento } from "@/lib/atendimentos";
import { dataNoSalao, formatarData, formatarDiaLongo, formatarHora, primeiroNome } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

// Pedido de remarcação (supabase/005_pedido_remarcacao.sql): num imprevisto, a Gleide toca em
// "Pedir para remarcar". O app grava um contato tipo 'remarcacao' ligado ao horário e abre o
// WhatsApp do salão com a mensagem pronta; ela envia. Quando a cliente responde, a IA lê o
// "ALÔ DE REMARCAÇÃO" na ficha, oferece horários e remarca o mesmo agendamento.
// O n8n reconhece a mensagem enviada como alô (e não pausa a IA) se o começo dela for igual ao
// gravado: por isso a Gleide deve enviar o texto como está.
// Abrir o WhatsApp não é enviar: o pedido só conta como enviado quando a mensagem sai pelo
// WhatsApp do salão (o n8n grava em `mensagens` como autor 'humano').

export type Pedido = {
  id: string;
  agendamento_id: string;
  cliente_id: string;
  resultado: "pendente" | "sem_resposta" | "respondeu" | "agendou";
  criado_em: string;
  horario_original: string | null;
  mensagem: string | null;
  // Saiu mensagem do salão para a cliente depois do pedido
  enviado: boolean;
};

export type Situacao = "nao_enviado" | "aguardando" | "sem_resposta" | "respondeu" | "remarcado";

const HORAS_SEM_RESPOSTA = 24;
// O n8n só reconhece o alô enviado até 2 h depois de gravado: depois disso, pedido novo
export const HORAS_PARA_ENVIAR = 2;

// Andamento do pedido, olhando também o horário: se ele mudou, a IA (ou a Gleide) já remarcou
export function situacaoDoPedido(p: Pedido, a: Pick<Atendimento, "inicio">): Situacao {
  const mudou = p.horario_original && Date.parse(p.horario_original) !== Date.parse(a.inicio);
  if (p.resultado === "agendou" || mudou) return "remarcado";
  if (p.resultado === "respondeu") return "respondeu";
  if (!p.enviado) return "nao_enviado";
  if (Date.now() - Date.parse(p.criado_em) > HORAS_SEM_RESPOSTA * 3_600_000) return "sem_resposta";
  return "aguardando";
}

export const SITUACAO: Record<Situacao, { rotulo: (p: Pedido) => string; classe: string }> = {
  nao_enviado: { rotulo: () => "Falta enviar no WhatsApp", classe: "bg-rose text-rose-texto" },
  aguardando: { rotulo: () => "Pedido enviado · aguardando", classe: "bg-ouro text-ouro-texto" },
  sem_resposta: { rotulo: () => "Sem resposta há 1 dia", classe: "bg-rose text-rose-texto" },
  respondeu: { rotulo: () => "Respondeu · a IA está remarcando", classe: "bg-areia text-taupe-texto" },
  remarcado: {
    rotulo: (p) => (p.horario_original ? `Remarcado · era ${formatarData(p.horario_original).slice(0, 5)} às ${formatarHora(p.horario_original)}` : "Remarcado"),
    classe: "bg-salvia text-salvia-texto",
  },
};

// O pedido mais recente de cada horário, com "enviado" conferido nas mensagens do salão
export async function buscarPedidos(empresaId: string, agendamentoIds: string[]): Promise<Map<string, Pedido>> {
  const mapa = new Map<string, Pedido>();
  if (agendamentoIds.length === 0) return mapa;
  const db = supabase();
  const { data } = await db
    .from("contatos")
    .select("id, agendamento_id, cliente_id, resultado, criado_em, horario_original, mensagem")
    .eq("empresa_id", empresaId)
    .eq("tipo", "remarcacao")
    .in("agendamento_id", agendamentoIds)
    .order("criado_em", { ascending: false });
  for (const p of (data ?? []) as Omit<Pedido, "enviado">[]) if (!mapa.has(p.agendamento_id)) mapa.set(p.agendamento_id, { ...p, enviado: false });
  if (mapa.size === 0) return mapa;

  // Mensagens do salão (Gleide) para essas clientes desde o pedido mais antigo
  const pedidos = [...mapa.values()];
  const desde = pedidos.reduce((m, p) => (p.criado_em < m ? p.criado_em : m), pedidos[0].criado_em);
  const { data: saidas } = await db
    .from("mensagens")
    .select("cliente_id, criado_em")
    .eq("empresa_id", empresaId)
    .eq("autor", "humano")
    .in("cliente_id", [...new Set(pedidos.map((p) => p.cliente_id))])
    .gte("criado_em", desde);
  for (const p of pedidos) {
    p.enviado = ((saidas ?? []) as { cliente_id: string; criado_em: string }[]).some(
      (m) => m.cliente_id === p.cliente_id && Date.parse(m.criado_em) >= Date.parse(p.criado_em),
    );
  }
  return mapa;
}

// Ainda dá para reenviar este pedido sem gravar outro? (não enviado e dentro das 2 h do n8n)
export function podeReaproveitar(p: Pedido | undefined): p is Pedido {
  return !!p && !p.enviado && p.resultado === "pendente" && Date.now() - Date.parse(p.criado_em) < HORAS_PARA_ENVIAR * 3_600_000;
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
