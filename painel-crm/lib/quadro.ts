"use client";

import { useEffect, useState } from "react";
import { buscarServicoDoAlo, tipoDoAlo } from "@/lib/alo";
import { hojeNoSalao, inicioDoDia, somarDias } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import type { ClienteStatus } from "@/lib/tipos";

// Quadro de retorno do CRM: cada cliente que precisa ser chamada anda por 4 colunas.
// A coluna sai do último registro em `contatos` (o banco já marca sozinho "respondeu" e
// "agendou", ver CONTRATO.md); arrastar um card só muda esse registro.
export type Etapa = "para_chamar" | "enviada" | "respondeu" | "agendado";

export const ETAPAS: { chave: Etapa; titulo: string; ponto: string }[] = [
  { chave: "para_chamar", titulo: "Para chamar", ponto: "bg-orange-500" },
  { chave: "enviada", titulo: "Mensagem enviada", ponto: "bg-indigo-500" },
  { chave: "respondeu", titulo: "Respondeu", ponto: "bg-teal-500" },
  { chave: "agendado", titulo: "Agendado", ponto: "bg-green-500" },
];

// O que cada coluna grava em contatos.resultado
export const RESULTADO: Record<Etapa, Contato["resultado"]> = {
  para_chamar: "sem_resposta",
  enviada: "pendente",
  respondeu: "respondeu",
  agendado: "agendou",
};

// Contato mais velho que isso não conta mais: a cliente volta para "Para chamar"
const DIAS_CONTATO = 30;

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

export function etapaDe(c: CardCliente): Etapa {
  if (c.contato?.resultado === "agendou" || (c.contato && c.proximo_agendamento)) return "agendado";
  if (c.contato?.resultado === "respondeu") return "respondeu";
  if (c.contato?.resultado === "pendente") return "enviada";
  return "para_chamar";
}

export function proximaEtapa(etapa: Etapa): Etapa | null {
  const i = ETAPAS.findIndex((e) => e.chave === etapa);
  return ETAPAS[i + 1]?.chave ?? null;
}

// Quem entra no quadro: retorno chegando, atrasadas e inativas, mais quem foi chamada há pouco
// (para continuar aparecendo em "Respondeu" e "Agendado" depois que marcou)
async function buscarQuadro(empresaId: string): Promise<{ cards: CardCliente[]; erro?: string }> {
  const desde = inicioDoDia(somarDias(hojeNoSalao(), -DIAS_CONTATO));
  const db = supabase();
  const { data, error } = await db
    .from("clientes_status")
    .select(CAMPOS)
    .eq("empresa_id", empresaId)
    .not("etiquetas", "cs", '{"sistema:excluida"}')
    .or(`status.in.(retorno_chegando,retorno_atrasado,inativa),ultimo_contato.gte.${desde}`)
    .order("retorno_previsto", { ascending: true, nullsFirst: false })
    .limit(300);
  if (error) return { cards: [], erro: error.message };
  const clientes = (data ?? []) as Omit<CardCliente, "contato" | "servico">[];
  const ids = clientes.map((c) => c.id);
  if (ids.length === 0) return { cards: [] };

  const [contatos, servicos] = await Promise.all([
    db
      .from("contatos")
      .select("id, cliente_id, resultado, criado_em")
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

  const atual = estado?.chave === chave ? estado : null;
  // Troca um card na tela antes do banco responder (o arrastar fica instantâneo)
  function trocarCard(card: CardCliente) {
    setEstado((e) => e && { ...e, cards: e.cards.map((c) => (c.id === card.id ? card : c)) });
  }
  return { quadro: atual, trocarCard };
}

// Move o card: atualiza o contato atual ou, se ela ainda não foi chamada, cria um.
// Devolve o card como ficou (ou o erro do banco).
export async function moverCard(
  empresaId: string,
  card: CardCliente,
  destino: Etapa,
  mensagem?: string,
): Promise<{ card?: CardCliente; erro?: string }> {
  const db = supabase();
  const resultado = RESULTADO[destino];
  if (card.contato) {
    const mudanca = mensagem ? { resultado, mensagem } : { resultado };
    const { error } = await db.from("contatos").update(mudanca).eq("id", card.contato.id);
    if (error) return { erro: error.message };
    return { card: { ...card, contato: { ...card.contato, resultado } } };
  }
  if (destino === "para_chamar") return { card };
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
