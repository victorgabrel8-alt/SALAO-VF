"use client";

import { useEffect, useState } from "react";
import { buscarServicoDoAlo, tipoDoAlo } from "@/lib/alo";
import { hojeNoSalao, inicioDoDia, somarDias } from "@/lib/formato";
import { PREFIXO_SISTEMA } from "@/lib/origem";
import type { StatusCliente } from "@/lib/status";
import { mudarStatus, statusEfetivo, type StatusManual } from "@/lib/statusManual";
import { supabase } from "@/lib/supabase/client";
import type { ClienteStatus } from "@/lib/tipos";

// Quadro do CRM: todas as clientes do salão (menos as excluídas), em 5 colunas. Quem precisa ser
// chamada anda de "Para chamar" até "Agendado"; as outras ficam em "Em dia".
// A etapa sai do último registro em `contatos` (o banco já marca sozinho "respondeu" e
// "agendou", ver CONTRATO.md) e do status da cliente.
export type Etapa = "para_chamar" | "enviada" | "respondeu" | "agendado" | "em_dia";

export const ETAPAS: { chave: Etapa; titulo: string; ponto: string }[] = [
  { chave: "para_chamar", titulo: "Para chamar", ponto: "bg-terracota" },
  { chave: "enviada", titulo: "Mensagem enviada", ponto: "bg-cobre" },
  { chave: "respondeu", titulo: "Respondeu", ponto: "bg-nevoa-viva" },
  { chave: "agendado", titulo: "Agendado", ponto: "bg-salvia-viva" },
  { chave: "em_dia", titulo: "Em dia", ponto: "bg-status-sem-visita" },
];

// O que cada coluna grava em contatos.resultado
export const RESULTADO: Record<Etapa, Contato["resultado"]> = {
  para_chamar: "sem_resposta",
  enviada: "pendente",
  respondeu: "respondeu",
  agendado: "agendou",
  em_dia: "sem_resposta",
};

// Contato mais velho que isso não conta mais: a cliente volta para "Para chamar"
const DIAS_CONTATO = 30;

// Status de quem precisa ser chamada
const NO_QUADRO: StatusCliente[] = ["retorno_chegando", "retorno_atrasado", "inativa"];

// enviado: a mensagem saiu de verdade. Abrir o WhatsApp pelo card grava o contato com o texto
// (o n8n precisa dele para reconhecer o alô), mas só conta como enviado quando sai mensagem do
// salão para a cliente depois disso (o n8n grava em `mensagens` como 'humano'), ou quando a
// agência arrasta o card para "Mensagem enviada" (confirmação guardada na etiqueta interna).
export type Contato = {
  id: string;
  resultado: "pendente" | "sem_resposta" | "respondeu" | "agendou";
  criado_em: string;
  mensagem: string | null;
  enviado: boolean;
};

const CONFIRMADO = `${PREFIXO_SISTEMA}alo_enviado:`;

// Abriu o WhatsApp pelo card e a mensagem ainda não saiu: fica em "Para chamar", com aviso
export function faltaEnviar(c: CardCliente): boolean {
  return conversaEmAndamento(c) && c.contato?.resultado === "pendente" && !!c.contato.mensagem && !c.contato.enviado;
}

export type CardCliente = Pick<
  ClienteStatus,
  | "id"
  | "nome"
  | "telefone"
  | "etiquetas"
  | "status"
  | "ultima_visita"
  | "dias_sem_visita"
  | "proximo_agendamento"
  | "retorno_previsto"
  | "ultimo_contato"
> & { contato: Contato | null; servico: string | null };

const CAMPOS =
  "id, nome, telefone, etiquetas, status, ultima_visita, dias_sem_visita, proximo_agendamento, retorno_previsto, ultimo_contato";

// A conversa do quadro acabou quando a cliente veio ao salão depois de ser chamada
// (a dona confirmou o atendimento na Agenda): aí ela sai de "Agendado"
function conversaEmAndamento(c: CardCliente): boolean {
  if (!c.contato || c.contato.resultado === "sem_resposta") return false;
  if (!c.contato.criado_em || !c.ultima_visita) return true;
  return Date.parse(c.ultima_visita) < Date.parse(c.contato.criado_em);
}

export function etapaDe(c: CardCliente): Etapa {
  // Tem horário marcado daqui para frente (marcou ou remarcou, pela IA ou pela Gleide): Agendado
  if (c.proximo_agendamento) return "agendado";
  if (conversaEmAndamento(c)) {
    if (c.proximo_agendamento || c.contato?.resultado === "agendou") return "agendado";
    if (c.contato?.resultado === "respondeu") return "respondeu";
    if (faltaEnviar(c)) return "para_chamar";
    return "enviada";
  }
  // Fora de conversa e sem horário marcado: precisa ser chamada ou está em dia
  return NO_QUADRO.includes(c.status) ? "para_chamar" : "em_dia";
}

// A seta do card anda de "Para chamar" até "Agendado" ("Em dia" fica fora da sequência)
export function proximaEtapa(etapa: Etapa): Etapa | null {
  if (etapa === "agendado" || etapa === "em_dia") return null;
  const i = ETAPAS.findIndex((e) => e.chave === etapa);
  return ETAPAS[i + 1]?.chave ?? null;
}

// Status que a cliente passa a ter ao ir para a coluna (null = não muda):
// tirar de "Em dia" para "Para chamar" marca retorno chegando; o contrário marca em dia
function statusAoMover(card: CardCliente, destino: Etapa): StatusManual | null {
  if (destino === "para_chamar" && !NO_QUADRO.includes(card.status)) return "retorno_chegando";
  if (destino === "em_dia" && NO_QUADRO.includes(card.status)) return "em_dia";
  return null;
}

// Como o card fica depois de ir para a coluna (para a tela mudar antes do banco responder).
// Com mensagem = abriu o WhatsApp pelo card: ainda não enviada.
export function previa(card: CardCliente, destino: Etapa, mensagem?: string): CardCliente {
  const status = statusAoMover(card, destino) ?? card.status;
  const fora = destino === "para_chamar" || destino === "em_dia";
  if (!card.contato && fora) return { ...card, status };
  return {
    ...card,
    status,
    contato: {
      id: card.contato?.id ?? "novo",
      criado_em: card.contato?.criado_em ?? "",
      resultado: RESULTADO[destino],
      mensagem: mensagem ?? card.contato?.mensagem ?? null,
      enviado: !mensagem,
    },
  };
}

// Todas as clientes do salão, menos as excluídas (as mesmas do app do salão)
async function buscarQuadro(empresaId: string): Promise<{ cards: CardCliente[]; erro?: string }> {
  const desde = inicioDoDia(somarDias(hojeNoSalao(), -DIAS_CONTATO));
  const db = supabase();
  const { data, error } = await db
    .from("clientes_status")
    .select(CAMPOS)
    .eq("empresa_id", empresaId)
    .not("etiquetas", "cs", '{"sistema:excluida"}')
    .order("retorno_previsto", { ascending: true, nullsFirst: false })
    .limit(1000);
  if (error) return { cards: [], erro: error.message };
  // Com o status escolhido à mão aplicado
  const clientes = ((data ?? []) as Omit<CardCliente, "contato" | "servico">[]).map((c) => ({
    ...c,
    status: statusEfetivo(c),
  }));
  const ids = clientes.map((c) => c.id);
  if (ids.length === 0) return { cards: [] };

  const [contatos, servicos] = await Promise.all([
    db
      .from("contatos")
      .select("id, cliente_id, resultado, criado_em, mensagem")
      // Pedido de remarcação (app da dona) não é chamar para voltar: não mexe na coluna do quadro
      .neq("tipo", "remarcacao")
      .in("cliente_id", ids)
      .gte("criado_em", desde)
      .order("criado_em", { ascending: false }),
    buscarServicoDoAlo(empresaId, ids),
  ]);
  if (contatos.error) return { cards: [], erro: contatos.error.message };
  const ultimo: Record<string, Contato> = {};
  for (const ct of contatos.data as (Omit<Contato, "enviado"> & { cliente_id: string })[])
    ultimo[ct.cliente_id] ??= { id: ct.id, resultado: ct.resultado, criado_em: ct.criado_em, mensagem: ct.mensagem, enviado: true };

  // Alô aberto pelo card ainda pendente: confere se saiu mensagem do salão depois dele
  const abertos = Object.entries(ultimo).filter(([, ct]) => ct.resultado === "pendente" && ct.mensagem);
  if (abertos.length) {
    const desde = abertos.reduce((m, [, ct]) => (ct.criado_em < m ? ct.criado_em : m), abertos[0][1].criado_em);
    const { data: saidas } = await db
      .from("mensagens")
      .select("cliente_id, criado_em")
      .eq("empresa_id", empresaId)
      .eq("autor", "humano")
      .in("cliente_id", abertos.map(([id]) => id))
      .gte("criado_em", desde);
    const etiquetasDe = new Map(clientes.map((c) => [c.id, c.etiquetas]));
    for (const [clienteId, ct] of abertos) {
      ct.enviado =
        (etiquetasDe.get(clienteId) ?? []).includes(CONFIRMADO + ct.id) ||
        ((saidas ?? []) as { cliente_id: string; criado_em: string }[]).some(
          (m) => m.cliente_id === clienteId && Date.parse(m.criado_em) >= Date.parse(ct.criado_em),
        );
    }
  }

  return { cards: clientes.map((c) => ({ ...c, contato: ultimo[c.id] ?? null, servico: servicos[c.id] ?? null })) };
}

export function useQuadro(empresaId: string, versao: number) {
  const [estado, setEstado] = useState<{ chave: string; cards: CardCliente[]; erro?: string } | null>(null);
  const chave = `${empresaId}:${versao}`;

  useEffect(() => {
    let ativo = true;
    buscarQuadro(empresaId).then((r) => {
      if (ativo) setEstado({ chave, ...r });
    });
    return () => {
      ativo = false;
    };
  }, [chave, empresaId]);

  // Ao recarregar (tempo real, depois de mover) mantém o quadro anterior na tela até chegar o novo
  const atual = estado?.chave.startsWith(`${empresaId}:`) ? estado : null;
  // Troca um card na tela antes do banco responder (o arrastar fica instantâneo)
  function trocarCard(card: CardCliente) {
    setEstado((e) => e && { ...e, cards: e.cards.map((c) => (c.id === card.id ? card : c)) });
  }
  return { quadro: atual, trocarCard };
}

// Põe uma etiqueta (ex.: "vip") sem perder as que ela já tem
export async function adicionarEtiqueta(clienteId: string, etiqueta: string) {
  const db = supabase();
  const atual = await db.from("clientes").select("etiquetas").eq("id", clienteId).single();
  if (atual.error) return atual.error.message;
  const etiquetas = atual.data.etiquetas as string[];
  if (etiquetas.includes(etiqueta)) return undefined;
  const { error } = await db.from("clientes").update({ etiquetas: [...etiquetas, etiqueta] }).eq("id", clienteId);
  return error?.message;
}

// Move o card: muda o status se precisar (ver statusAoMover) e atualiza o contato atual
// ou, se ela ainda não foi chamada, cria um.
// Devolve o card como ficou (ou o erro do banco).
export async function moverCard(
  empresaId: string,
  card: CardCliente,
  destino: Etapa,
  mensagem?: string,
): Promise<{ card?: CardCliente; erro?: string }> {
  const db = supabase();
  const resultado = RESULTADO[destino];
  const status = statusAoMover(card, destino);
  if (status) {
    const erro = await mudarStatus(card.id, status);
    if (erro) return { erro };
    card = { ...card, status };
  }
  const contato = card.contato;
  if (contato) {
    const mudanca = mensagem ? { resultado, mensagem } : { resultado };
    const { error } = await db.from("contatos").update(mudanca).eq("id", contato.id);
    if (error) return { erro: error.message };
    // Arrastou para "Mensagem enviada" um alô que ainda não tinha saído: a agência confirmou o envio
    if (!mensagem && destino === "enviada" && contato.mensagem && !contato.enviado) {
      const erro = await adicionarEtiqueta(card.id, CONFIRMADO + contato.id);
      if (erro) return { erro };
      card = { ...card, etiquetas: [...card.etiquetas, CONFIRMADO + contato.id] };
    }
    const enviado = mensagem ? false : contato.enviado || destino === "enviada";
    return { card: { ...card, contato: { ...contato, resultado, mensagem: mensagem ?? contato.mensagem, enviado } } };
  }
  if (destino === "para_chamar" || destino === "em_dia") return { card };
  const { data: usuario } = await db.auth.getUser();
  const { data, error } = await db
    .from("contatos")
    .insert({
      empresa_id: empresaId,
      cliente_id: card.id,
      tipo: tipoDoAlo(card.status),
      canal: "manual",
      resultado,
      mensagem: mensagem ?? null,
      criado_por: usuario.user?.id ?? null,
    })
    .select("id, resultado, criado_em, mensagem")
    .single();
  if (error) return { erro: error.message };
  const novo = { ...(data as Omit<Contato, "enviado">), enviado: !mensagem };
  return { card: { ...card, contato: novo, ultimo_contato: novo.criado_em } };
}
