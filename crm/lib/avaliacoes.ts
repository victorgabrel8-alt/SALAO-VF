"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// O que a IA anotou na conversa (pré-avaliação) e o resultado da avaliação, da tabela
// `avaliacoes` (supabase/004_avaliacoes_ia). Enquanto o 004 não roda no banco, a tabela não
// existe: aí as buscas voltam vazias e a tela segue como antes, sem erro.
// Ver docs/PLANO-IA-ALIMENTA-CRM.md.

export type ResultadoAvaliacao = "fechou" | "pensando" | "nao_fechou";

export type Avaliacao = {
  id: string;
  cliente_id: string;
  resultado: "pendente" | ResultadoAvaliacao;
  pre_resumo: string | null;
  pre_comprimento_atual: string | null;
  pre_comprimento_desejado: string | null;
  pre_cor: string | null;
  pre_usa_mega: boolean | null;
  pre_tecnica_atual: string | null;
  pre_quimica_recente: string | null;
  pre_tecnica_interesse: string | null;
  pre_orcamento: string | null;
  pre_ocasiao: string | null;
  pre_data_ocasiao: string | null;
  proximo_passo: string | null;
  criado_em: string;
};

const CAMPOS =
  "id, cliente_id, resultado, pre_resumo, pre_comprimento_atual, pre_comprimento_desejado, pre_cor, pre_usa_mega, " +
  "pre_tecnica_atual, pre_quimica_recente, pre_tecnica_interesse, pre_orcamento, pre_ocasiao, pre_data_ocasiao, proximo_passo, criado_em";

// "Aberta" = a IA ainda está acompanhando (pendente) ou a cliente ficou de pensar
const ABERTAS = ["pendente", "pensando"];

// Avaliação aberta de cada cliente (no máximo uma por cliente, garantido pelo banco)
export async function buscarIntencoes(clienteIds: string[]): Promise<Record<string, Avaliacao>> {
  if (clienteIds.length === 0) return {};
  const { data, error } = await supabase()
    .from("avaliacoes")
    .select(CAMPOS)
    .in("cliente_id", clienteIds)
    .in("resultado", ABERTAS);
  if (error) return {};
  return Object.fromEntries(((data ?? []) as unknown as Avaliacao[]).map((a) => [a.cliente_id, a]));
}

export function useIntencoes(clienteIds: string[], versao: number) {
  const chave = [...new Set(clienteIds)].sort().join(",");
  const [intencoes, setIntencoes] = useState<{ chave: string; mapa: Record<string, Avaliacao> }>({ chave: "", mapa: {} });

  useEffect(() => {
    let ativo = true;
    buscarIntencoes(chave ? chave.split(",") : []).then((mapa) => {
      if (ativo) setIntencoes({ chave, mapa });
    });
    return () => {
      ativo = false;
    };
  }, [chave, versao]);

  return intencoes.mapa;
}

// A última avaliação da cliente (aberta ou não), para a ficha
export async function buscarUltimaAvaliacao(clienteId: string): Promise<Avaliacao | null> {
  const { data, error } = await supabase()
    .from("avaliacoes")
    .select(CAMPOS)
    .eq("cliente_id", clienteId)
    .order("criado_em", { ascending: false })
    .limit(1)
    .maybeSingle();
  return error ? null : ((data as unknown as Avaliacao) ?? null);
}

// O serviço marcado é uma avaliação? Pelo nome ("Avaliação", "Avaliação de mega hair"),
// que vale com ou sem a coluna servicos.categoria do 004.
export function ehAvaliacao(nomeServico: string | null | undefined): boolean {
  return (nomeServico ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim().startsWith("avaliacao");
}

export const RESULTADOS: { chave: ResultadoAvaliacao; rotulo: string }[] = [
  { chave: "fechou", rotulo: "Fechou" },
  { chave: "pensando", rotulo: "Ficou de pensar" },
  { chave: "nao_fechou", rotulo: "Não fechou" },
];

// O ✓ de uma avaliação com o resultado. Usa crm_confirmar_atendimento (004): marca realizado e
// grava o resultado na avaliação (o funil e a IA leem dali). Sem o 004 no banco, marca realizado e
// guarda o resultado nas observações do horário, para não se perder.
export async function confirmarAvaliacao(agendamentoId: string, observacoes: string | null, resultado: ResultadoAvaliacao) {
  const db = supabase();
  const { error } = await db.rpc("crm_confirmar_atendimento", { p_agendamento_id: agendamentoId, p_resultado: resultado });
  if (!error) return undefined;
  if (!funcaoNaoExiste(error)) return error.message;
  const rotulo = RESULTADOS.find((r) => r.chave === resultado)!.rotulo;
  const { error: erro2 } = await db
    .from("agendamentos")
    .update({ status: "realizado", observacoes: [observacoes, `Avaliação: ${rotulo}`].filter(Boolean).join("\n") })
    .eq("id", agendamentoId);
  return erro2?.message;
}

// PostgREST: função que não existe no banco (o 004 ainda não rodou)
function funcaoNaoExiste(error: { code?: string; message: string }) {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message);
}
