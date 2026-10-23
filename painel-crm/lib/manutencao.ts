"use client";

import { useEffect, useState } from "react";
import { estaExcluida } from "@/lib/excluidas";
import { dataNoSalao, diasEntre, hojeNoSalao } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

// Controle da manutenção: para cada cliente, o retorno mais próximo entre as linhas de serviço
// que ainda estão pendentes (view retornos_pendentes, supabase/007; a mesma regra do status).
// Mega hair (75 dias) + pintura (45): chama pela pintura; depois da pintura, a manutenção do mega
// continua valendo. Sem o 007 no banco: o retorno da visita mais recente (regra do 006).

export type Faixa = "passou" | "semana" | "quinzena" | "mes" | "depois";

export const FAIXAS: { chave: Faixa; titulo: string; detalhe: string }[] = [
  { chave: "passou", titulo: "Passou da data", detalhe: "venceu há até 30 dias" },
  { chave: "semana", titulo: "Esta semana", detalhe: "vence em até 7 dias" },
  { chave: "quinzena", titulo: "Próximos 15 dias", detalhe: "vence em 8 a 15 dias" },
  { chave: "mes", titulo: "Este mês", detalhe: "vence em 16 a 30 dias" },
  { chave: "depois", titulo: "Mais adiante", detalhe: "vence em mais de 30 dias" },
];

export type Manutencao = {
  clienteId: string;
  nome: string | null;
  telefone: string;
  etiquetas: string[];
  servico: string;
  ultimaVez: string; // timestamptz da visita que gerou o retorno
  retorno: string; // "AAAA-MM-DD"
  faltam: number; // dias até o retorno (negativo = passou)
  ciclo: number; // 0 a 1: quanto do intervalo de retorno já passou
  marcado: string | null; // próximo horário já marcado (timestamptz)
  faixa: Faixa;
};

// Atrasada há mais que isso sai daqui (vira caso de reativação, no Quadro e na Lista)
const LIMITE_PASSOU = 30;

function faixaDe(faltam: number): Faixa | null {
  if (faltam < -LIMITE_PASSOU) return null;
  if (faltam < 0) return "passou";
  if (faltam <= 7) return "semana";
  if (faltam <= 15) return "quinzena";
  if (faltam <= 30) return "mes";
  return "depois";
}

// Um serviço realizado com retorno
type Feito = { cliente_id: string; inicio: string; retorno_previsto: string; servico: string };
type Cliente = { id: string; nome: string | null; telefone: string; etiquetas: string[] };

// O Supabase devolve no máximo 1000 linhas por vez: lê em páginas
async function lerTudo<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const linhas: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) return { linhas, erro: error.message };
    const pagina = (data ?? []) as T[];
    linhas.push(...pagina);
    if (pagina.length < 1000) return { linhas };
  }
}

// Os retornos que contam: os pendentes de cada linha (007) ou, sem o 007, todos os realizados
// com retorno, do mais recente para o mais antigo
async function lerFeitos(empresaId: string): Promise<{ linhas: Feito[]; pendentes?: boolean; erro?: string }> {
  const db = supabase();
  const daView = await lerTudo<{ cliente_id: string; ultima_vez: string; retorno_previsto: string; servico_nome: string | null }>((de, ate) =>
    db
      .from("retornos_pendentes")
      .select("cliente_id, ultima_vez, retorno_previsto, servico_nome")
      .eq("empresa_id", empresaId)
      .order("retorno_previsto")
      .range(de, ate),
  );
  if (!daView.erro) {
    const linhas = daView.linhas.map((f) => ({ cliente_id: f.cliente_id, inicio: f.ultima_vez, retorno_previsto: f.retorno_previsto, servico: f.servico_nome ?? "Serviço" }));
    return { linhas, pendentes: true };
  }
  // Sem o 007: só o serviço principal de cada horário (o app já põe ali o de retorno mais curto)
  const atend = await lerTudo<{ cliente_id: string; inicio: string; retorno_previsto: string; servicos: { nome: string } | null }>((de, ate) =>
    db
      .from("agendamentos")
      .select("cliente_id, inicio, retorno_previsto, servicos (nome)")
      .eq("empresa_id", empresaId)
      .eq("status", "realizado")
      .not("retorno_previsto", "is", null)
      .order("inicio", { ascending: false })
      .range(de, ate),
  );
  return { linhas: atend.linhas.map((a) => ({ ...a, servico: a.servicos?.nome ?? "Serviço" })) as Feito[], erro: atend.erro };
}

async function lerClientes(ids: string[]) {
  const db = supabase();
  const clientes = new Map<string, Cliente>();
  // Em lotes, para a URL não ficar grande demais
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await db.from("clientes").select("id, nome, telefone, etiquetas").in("id", ids.slice(i, i + 150));
    if (error) return { clientes, erro: error.message };
    for (const c of (data ?? []) as Cliente[]) clientes.set(c.id, c);
  }
  return { clientes };
}

export async function buscarManutencoes(empresaId: string): Promise<{ itens: Manutencao[]; erro?: string }> {
  const db = supabase();
  const [feitos, marcados] = await Promise.all([
    lerFeitos(empresaId),
    lerTudo<{ cliente_id: string; inicio: string }>((de, ate) =>
      db
        .from("agendamentos")
        .select("cliente_id, inicio")
        .eq("empresa_id", empresaId)
        .eq("status", "agendado")
        .gt("inicio", new Date().toISOString())
        .order("inicio", { ascending: true })
        .range(de, ate),
    ),
  ]);
  const erro = feitos.erro ?? marcados.erro;
  if (erro) return { itens: [], erro };

  // Próximo horário de cada cliente (a lista vem do mais cedo para o mais tarde)
  const proximo = new Map<string, string>();
  for (const m of marcados.linhas) if (!proximo.has(m.cliente_id)) proximo.set(m.cliente_id, m.inicio);

  // O retorno que vale de cada cliente: com o 007, o mais próximo entre os pendentes; sem ele,
  // o da visita mais recente (e, nela, o serviço de retorno mais curto)
  const daVisita = new Map<string, Feito>();
  for (const f of feitos.linhas) {
    const atual = daVisita.get(f.cliente_id);
    if (!atual) daVisita.set(f.cliente_id, f);
    else if ((feitos.pendentes || f.inicio === atual.inicio) && f.retorno_previsto < atual.retorno_previsto) daVisita.set(f.cliente_id, f);
  }
  const { clientes, erro: erroClientes } = await lerClientes([...daVisita.keys()]);
  if (erroClientes) return { itens: [], erro: erroClientes };

  const hoje = hojeNoSalao();
  const itens: Manutencao[] = [];
  for (const a of daVisita.values()) {
    const c = clientes.get(a.cliente_id);
    if (!c || estaExcluida(c.etiquetas)) continue;
    const faltam = diasEntre(hoje, a.retorno_previsto);
    const faixa = faixaDe(faltam);
    if (!faixa) continue;
    const intervalo = diasEntre(dataNoSalao(a.inicio), a.retorno_previsto);
    const passados = diasEntre(dataNoSalao(a.inicio), hoje);
    itens.push({
      clienteId: a.cliente_id,
      nome: c.nome,
      telefone: c.telefone,
      etiquetas: c.etiquetas,
      servico: a.servico,
      ultimaVez: a.inicio,
      retorno: a.retorno_previsto,
      faltam,
      ciclo: intervalo > 0 ? Math.min(1, Math.max(0, passados / intervalo)) : 1,
      marcado: proximo.get(a.cliente_id) ?? null,
      faixa,
    });
  }
  itens.sort((x, y) => x.retorno.localeCompare(y.retorno) || (x.nome ?? "").localeCompare(y.nome ?? ""));
  return { itens };
}

export function useManutencoes(empresaId: string, versao: number) {
  const [estado, setEstado] = useState<{ chave: string; itens: Manutencao[]; erro?: string } | null>(null);
  const chave = `${empresaId}:${versao}`;

  useEffect(() => {
    let ativo = true;
    buscarManutencoes(empresaId).then((r) => {
      if (ativo) setEstado({ chave, ...r });
    });
    return () => {
      ativo = false;
    };
  }, [chave, empresaId]);

  return estado?.chave === chave ? estado : null;
}
