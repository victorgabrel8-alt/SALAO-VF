"use client";

import { useEffect, useState } from "react";
import { buscarServicoDoAlo } from "@/lib/alo";
import { hojeNoSalao, somarDias } from "@/lib/formato";
import type { StatusCliente } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";
import type { ClienteStatus } from "@/lib/tipos";

// A lista de Clientes carrega aos poucos (uma página por vez, com "Ver mais") e pede ao
// banco só as colunas que aparecem na tela. A busca e os filtros também rodam no banco,
// então o celular nunca baixa a base inteira do salão.

export type FiltroClientes =
  | StatusCliente
  | "para_chamar"
  | "retornos"
  | "atrasadas_recentes"
  | "atrasadas_antigas"
  | "todas";

export type ClienteLista = Pick<
  ClienteStatus,
  | "id"
  | "nome"
  | "telefone"
  | "etiquetas"
  | "status"
  | "ultima_visita"
  | "proximo_agendamento"
  | "retorno_previsto"
  | "ultimo_contato"
  | "total_visitas"
>;

const CAMPOS =
  "id, nome, telefone, etiquetas, status, ultima_visita, proximo_agendamento, retorno_previsto, ultimo_contato, total_visitas";

// Etiqueta interna das clientes excluídas (ver lib/excluidas.ts)
const SEM_EXCLUIDAS = '{"sistema:excluida"}';

// Atrasada "recente" = o retorno venceu há até X dias (config.dias_limite_celular, padrão 30).
// No celular a dona só vê as recentes; as "antigas" (sumiram faz tempo) ficam no CRM do
// computador, para a agência trabalhar a reativação. Conta a partir da DATA DE RETORNO, não
// da última visita: quem fez progressiva (volta em 90 dias) não some antes da hora.
type Regra = { status: StatusCliente[] | null; retorno?: "recente" | "antigo" };

const REGRAS: Record<FiltroClientes, Regra> = {
  retornos: { status: ["retorno_chegando", "retorno_atrasado"], retorno: "recente" },
  para_chamar: { status: ["retorno_chegando", "retorno_atrasado"] },
  retorno_chegando: { status: ["retorno_chegando"] },
  retorno_atrasado: { status: ["retorno_atrasado"] },
  atrasadas_recentes: { status: ["retorno_atrasado"], retorno: "recente" },
  atrasadas_antigas: { status: ["retorno_atrasado"], retorno: "antigo" },
  inativa: { status: ["inativa"] },
  em_dia: { status: ["em_dia"] },
  sem_visita: { status: ["sem_visita"] },
  todas: { status: null },
};

export function diasLimiteCelular(config: Record<string, unknown>): number {
  const dias = Number(config.dias_limite_celular);
  return Number.isFinite(dias) && dias > 0 ? dias : 30;
}

// Data a partir da qual o atraso ainda é "recente"
function dataLimite(diasLimite: number): string {
  return somarDias(hojeNoSalao(), -diasLimite);
}

type Consulta = { filtro: FiltroClientes; busca: string; origem: string | null; diasLimite: number };

async function buscarPagina(empresaId: string, c: Consulta, de: number, quantidade: number) {
  let q = supabase()
    .from("clientes_status")
    .select(CAMPOS)
    .eq("empresa_id", empresaId)
    .not("etiquetas", "cs", SEM_EXCLUIDAS);

  const regra = REGRAS[c.filtro];
  const status = regra.status;
  if (status) q = q.in("status", status);
  if (regra.retorno === "recente") q = q.gte("retorno_previsto", dataLimite(c.diasLimite));
  if (regra.retorno === "antigo") q = q.lt("retorno_previsto", dataLimite(c.diasLimite));
  if (c.origem) q = q.contains("etiquetas", [`origem:${c.origem}`]);

  const termo = c.busca.replace(/[,()%*]/g, " ").trim();
  if (termo) {
    const digitos = c.busca.replace(/\D/g, "");
    q = q.or([`nome.ilike.%${termo}%`, ...(digitos.length >= 3 ? [`telefone.like.%${digitos}%`] : [])].join(","));
  }

  // Quem tem retorno mais urgente primeiro; nas outras listas, por nome
  q = status && c.filtro !== "em_dia" && c.filtro !== "sem_visita"
    ? q.order("retorno_previsto", { ascending: true, nullsFirst: false }).order("nome")
    : q.order("nome", { nullsFirst: false });

  // Pede uma a mais só para saber se existe próxima página
  const { data, error } = await q.range(de, de + quantidade);
  if (error) return { erro: error.message };
  const linhas = (data ?? []) as ClienteLista[];
  const itens = linhas.slice(0, quantidade);
  const servicos = await buscarServicoDoAlo(empresaId, itens.map((i) => i.id));
  return { itens, temMais: linhas.length > quantidade, servicos };
}

type Estado = {
  chave: string;
  itens: ClienteLista[];
  servicos: Record<string, string>;
  temMais: boolean;
  carregandoMais: boolean;
  erro?: string;
};

export function useListaClientes(empresaId: string, consulta: Consulta, porPagina: number, versao: number) {
  const chave = JSON.stringify([empresaId, consulta, porPagina, versao]);
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    let ativo = true;
    const c = JSON.parse(chave)[1] as Consulta;
    buscarPagina(empresaId, c, 0, porPagina).then((r) => {
      if (!ativo) return;
      if ("erro" in r) setEstado({ chave, itens: [], servicos: {}, temMais: false, carregandoMais: false, erro: r.erro });
      else setEstado({ chave, itens: r.itens, servicos: r.servicos, temMais: r.temMais, carregandoMais: false });
    });
    return () => {
      ativo = false;
    };
  }, [chave, empresaId, porPagina]);

  const atual = estado?.chave === chave ? estado : null;

  async function verMais() {
    if (!atual || atual.carregandoMais) return;
    setEstado({ ...atual, carregandoMais: true });
    const r = await buscarPagina(empresaId, consulta, atual.itens.length, porPagina);
    setEstado((e) => {
      if (!e || e.chave !== chave) return e;
      if ("erro" in r) return { ...e, carregandoMais: false, erro: r.erro };
      return {
        ...e,
        itens: [...e.itens, ...r.itens],
        servicos: { ...e.servicos, ...r.servicos },
        temMais: r.temMais,
        carregandoMais: false,
      };
    });
  }

  return { lista: atual, verMais };
}

// Contadores dos filtros: o banco conta, sem mandar as linhas (também usado pelo Início)
export async function contarClientes(empresaId: string, diasLimite: number): Promise<Record<string, number>> {
  const statuses: StatusCliente[] = ["retorno_chegando", "retorno_atrasado", "inativa", "em_dia", "sem_visita"];
  const contar = () =>
    supabase()
      .from("clientes_status")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .not("etiquetas", "cs", SEM_EXCLUIDAS);
  const [recentes, ...respostas] = await Promise.all([
    contar().eq("status", "retorno_atrasado").gte("retorno_previsto", dataLimite(diasLimite)),
    ...statuses.map((s) => contar().eq("status", s)),
  ]);
  const total: Record<string, number> = {};
  statuses.forEach((s, i) => (total[s] = respostas[i].count ?? 0));
  total.atrasadas_recentes = recentes.count ?? 0;
  total.atrasadas_antigas = total.retorno_atrasado - total.atrasadas_recentes;
  total.retornos = total.retorno_chegando + total.atrasadas_recentes;
  total.para_chamar = total.retorno_chegando + total.retorno_atrasado;
  total.todas = statuses.reduce((soma, s) => soma + total[s], 0);
  return total;
}

export function useContagemClientes(empresaId: string, diasLimite: number, versao: number) {
  const [contagem, setContagem] = useState<Record<string, number> | null>(null);

  useEffect(() => {
    let ativo = true;
    contarClientes(empresaId, diasLimite).then((total) => {
      if (ativo) setContagem(total);
    });
    return () => {
      ativo = false;
    };
  }, [empresaId, diasLimite, versao]);

  return contagem;
}

// Espera a dona parar de digitar antes de buscar no banco
export function useAtraso<T>(valor: T, ms = 300): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

// Computador (tela larga) mostra o CRM completo; celular, a versão enxuta
export function useTelaGrande(): boolean | null {
  const [grande, setGrande] = useState<boolean | null>(null);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const atualizar = () => setGrande(mq.matches);
    atualizar();
    mq.addEventListener("change", atualizar);
    return () => mq.removeEventListener("change", atualizar);
  }, []);
  return grande;
}
