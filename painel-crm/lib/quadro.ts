"use client";

import { useEffect, useState } from "react";
import { buscarServicoDoAlo, tipoDoAlo } from "@/lib/alo";
import { hojeNoSalao, inicioDoDia, somarDias } from "@/lib/formato";
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

export type Contato = { id: string; resultado: "pendente" | "sem_resposta" | "respondeu" | "agendou"; criado_em: string };

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
  if (conversaEmAndamento(c)) {
    if (c.proximo_agendamento || c.contato?.resultado === "agendou") return "agendado";
    if (c.contato?.resultado === "respondeu") return "respondeu";
    return "enviada";
  }
  // Fora de conversa: quem tem horário marcado (ou já foi atendida) está em dia
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

// Como o card fica depois de ir para a coluna (para a tela mudar antes do banco responder)
export function previa(card: CardCliente, destino: Etapa): CardCliente {
  const status = statusAoMover(card, destino) ?? card.status;
  const fora = destino === "para_chamar" || destino === "em_dia";
  if (!card.contato && fora) return { ...card, status };
  return {
    ...card,
    status,
    contato: { id: card.contato?.id ?? "novo", criado_em: card.contato?.criado_em ?? "", resultado: RESULTADO[destino] },
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
      .select("id, cliente_id, resultado, criado_em")
      // Pedido de remarcação (app da dona) não é chamar para voltar: não mexe na coluna do quadro
      .neq("tipo", "remarcacao")
      .in("cliente_id", ids)
      .gte("criado_em", desde)
      .order("criado_em", { ascending: false }),
    buscarServicoDoAlo(empresaId, ids),
  ]);
  if (contatos.error) return { cards: [], erro: contatos.error.message };
  const ultimo: Record<string, Contato> = {};
  for (const ct of contatos.data as (Contato & { cliente_id: string })[])
    ultimo[ct.cliente_id] ??= { id: ct.id, resultado: ct.resultado, criado_em: ct.criado_em };

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
  if (card.contato) {
    const mudanca = mensagem ? { resultado, mensagem } : { resultado };
    const { error } = await db.from("contatos").update(mudanca).eq("id", card.contato.id);
    if (error) return { erro: error.message };
    return { card: { ...card, contato: { ...card.contato, resultado } } };
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
    .select("id, resultado, criado_em")
    .single();
  if (error) return { erro: error.message };
  return { card: { ...card, contato: data as Contato, ultimo_contato: (data as Contato).criado_em } };
}
