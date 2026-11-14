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
  | "agendadas"
  | "excluidas"
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
// agendado: true = só quem tem horário marcado daqui para frente; false = só quem não tem.
// No banco, quem tem horário marcado fica "em_dia"; na tela ela aparece como "Agendada".
type Regra = { status: StatusCliente[] | null; retorno?: "recente" | "antigo"; agendado?: boolean };

const REGRAS: Record<FiltroClientes, Regra> = {
  retornos: { status: ["retorno_chegando", "retorno_atrasado"], retorno: "recente" },
  para_chamar: { status: ["retorno_chegando", "retorno_atrasado"] },
  retorno_chegando: { status: ["retorno_chegando"] },
  retorno_atrasado: { status: ["retorno_atrasado"] },
  atrasadas_recentes: { status: ["retorno_atrasado"], retorno: "recente" },
  atrasadas_antigas: { status: ["retorno_atrasado"], retorno: "antigo" },
  inativa: { status: ["inativa"] },
  agendadas: { status: null, agendado: true },
  em_dia: { status: ["em_dia"], agendado: false },
  sem_visita: { status: ["sem_visita"] },
  excluidas: { status: null },
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
    .eq("empresa_id", empresaId);
  // As excluídas só aparecem no filtro delas
  q = c.filtro === "excluidas" ? q.filter("etiquetas", "cs", SEM_EXCLUIDAS) : q.not("etiquetas", "cs", SEM_EXCLUIDAS);

  const regra = REGRAS[c.filtro];
  const status = regra.status;
  if (status) q = q.in("status", status);
  if (regra.retorno === "recente") q = q.gte("retorno_previsto", dataLimite(c.diasLimite));
  if (regra.retorno === "antigo") q = q.lt("retorno_previsto", dataLimite(c.diasLimite));
  if (regra.agendado === true) q = q.not("proximo_agendamento", "is", null);
  if (regra.agendado === false) q = q.is("proximo_agendamento", null);
  if (c.origem) q = q.contains("etiquetas", [`origem:${c.origem}`]);

  const termo = c.busca.replace(/[,()%*"\\]/g, " ").trim();
  if (termo) {
    const digitos = c.busca.replace(/\D/g, "");
    q = q.or([`nome.ilike.%${termo}%`, ...(digitos.length >= 3 ? [`telefone.like.%${digitos}%`] : [])].join(","));
  }

  // Quem tem retorno mais urgente primeiro; nas outras listas, por nome
  // Agendadas: o horário mais próximo primeiro
  q = c.filtro === "agendadas"
    ? q.order("proximo_agendamento", { ascending: true }).order("nome")
    : status && c.filtro !== "em_dia" && c.filtro !== "sem_visita"
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

// O banco devolve no máximo 1000 linhas por leitura (padrão do Supabase)
const PAGINA_CONTAGEM = 1000;

type LinhaContagem = Pick<ClienteStatus, "status" | "proximo_agendamento" | "retorno_previsto">;

// Contadores dos filtros. Uma leitura só de `clientes_status` (três colunas por cliente) e a conta é
// feita aqui: antes eram oito contagens ao mesmo tempo, cada uma recalculando a view inteira, e o
// banco chegou a travar. Devolve null se alguma leitura falhar: número errado nunca vai para a tela.
export async function contarClientes(empresaId: string, diasLimite: number): Promise<Record<string, number> | null> {
  const db = supabase();
  // O .then() já dispara a leitura: ela corre junto com a das linhas
  const excluidas = db
    .from("clientes")
    .select("id", { count: "exact", head: true })
    .eq("empresa_id", empresaId)
    .filter("etiquetas", "cs", SEM_EXCLUIDAS)
    .then((r) => r);

  const linhas: LinhaContagem[] = [];
  for (let de = 0; ; de += PAGINA_CONTAGEM) {
    const { data, error } = await db
      .from("clientes_status")
      .select("status, proximo_agendamento, retorno_previsto")
      .eq("empresa_id", empresaId)
      .not("etiquetas", "cs", SEM_EXCLUIDAS)
      .order("id")
      .range(de, de + PAGINA_CONTAGEM - 1);
    if (error || !data) return null;
    linhas.push(...(data as LinhaContagem[]));
    if (data.length < PAGINA_CONTAGEM) break;
  }
  const { count: totalExcluidas, error: erroExcluidas } = await excluidas;
  if (erroExcluidas || totalExcluidas === null) return null;

  const limite = dataLimite(diasLimite);
  const total: Record<string, number> = {
    retorno_chegando: 0,
    retorno_atrasado: 0,
    inativa: 0,
    em_dia: 0,
    sem_visita: 0,
    atrasadas_recentes: 0,
    agendadas: 0,
  };
  for (const l of linhas) {
    // Quem tem horário marcado vem "em_dia" do banco, mas na tela é "Agendada"
    if (l.proximo_agendamento) {
      total.agendadas += 1;
      continue;
    }
    total[l.status] = (total[l.status] ?? 0) + 1;
    if (l.status === "retorno_atrasado" && l.retorno_previsto && l.retorno_previsto >= limite) total.atrasadas_recentes += 1;
  }
  total.atrasadas_antigas = total.retorno_atrasado - total.atrasadas_recentes;
  total.retornos = total.retorno_chegando + total.atrasadas_recentes;
  total.para_chamar = total.retorno_chegando + total.retorno_atrasado;
  total.todas = linhas.length;
  total.excluidas = totalExcluidas;
  return total;
}

// Se a leitura falhar, tenta mais uma vez depois deste tempo
const NOVA_TENTATIVA_MS = 4000;

// null = ainda não tem contagem boa (a tela mostra "…"). Se uma releitura falhar, fica a última boa.
export function useContagemClientes(empresaId: string, diasLimite: number, versao: number) {
  const [estado, setEstado] = useState<{ empresaId: string; total: Record<string, number> } | null>(null);

  useEffect(() => {
    let ativo = true;
    let espera: ReturnType<typeof setTimeout> | undefined;
    const ler = (tentativa: number) =>
      contarClientes(empresaId, diasLimite).then((total) => {
        if (!ativo) return;
        if (total) setEstado({ empresaId, total });
        else if (tentativa === 0) espera = setTimeout(() => ler(1), NOVA_TENTATIVA_MS);
      });
    ler(0);
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [empresaId, diasLimite, versao]);

  return estado?.empresaId === empresaId ? estado.total : null;
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
