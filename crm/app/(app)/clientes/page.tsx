"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { useEmpresa } from "@/lib/empresa";
import { formatarData, formatarHora, formatarTelefone, haQuantoTempo, prazo } from "@/lib/formato";
import { lerOrigem, rotuloOrigem } from "@/lib/origem";
import { SeloStatus, type StatusCliente } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";
import type { ClienteStatus } from "@/lib/tipos";

type Filtro = StatusCliente | "todas";

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: "retorno_chegando", rotulo: "Retorno chegando" },
  { chave: "retorno_atrasado", rotulo: "Atrasadas" },
  { chave: "inativa", rotulo: "Inativas" },
  { chave: "em_dia", rotulo: "Em dia" },
  { chave: "sem_visita", rotulo: "Sem visita" },
  { chave: "todas", rotulo: "Todas" },
];

// Busca sem diferenciar acento e maiúscula: "debora" encontra "Débora"
function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export default function ClientesPage() {
  return (
    <>
      <Cabecalho titulo="Clientes" />
      <Suspense fallback={<p className="px-4 text-neutral-500">Carregando…</p>}>
        <ListaClientes />
      </Suspense>
    </>
  );
}

function ListaClientes() {
  const empresa = useEmpresa();
  const router = useRouter();
  const params = useSearchParams();
  const filtro = (FILTROS.find((f) => f.chave === params.get("filtro"))?.chave ?? "todas") as Filtro;

  const [clientes, setClientes] = useState<ClienteStatus[] | null>(null);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");

  useEffect(() => {
    supabase()
      .from("clientes_status")
      .select("*")
      .eq("empresa_id", empresa.id)
      .then(({ data, error }) => {
        if (error) setErro(error.message);
        else setClientes(data as ClienteStatus[]);
      });
  }, [empresa.id]);

  const contagem = useMemo(() => {
    const total: Record<string, number> = { todas: clientes?.length ?? 0 };
    for (const c of clientes ?? []) total[c.status] = (total[c.status] ?? 0) + 1;
    return total;
  }, [clientes]);

  const lista = useMemo(() => {
    const termo = semAcento(busca.trim());
    const digitos = busca.replace(/\D/g, "");
    return (clientes ?? [])
      .filter((c) => filtro === "todas" || c.status === filtro)
      .filter((c) => {
        if (!termo) return true;
        if (semAcento(c.nome ?? "").includes(termo)) return true;
        return digitos.length >= 3 && c.telefone.includes(digitos);
      })
      .sort((a, b) => {
        // Quem tem retorno mais urgente aparece primeiro; depois, por nome
        if (filtro !== "todas" && a.retorno_previsto !== b.retorno_previsto) {
          if (!a.retorno_previsto) return 1;
          if (!b.retorno_previsto) return -1;
          return a.retorno_previsto.localeCompare(b.retorno_previsto);
        }
        return (a.nome ?? "~").localeCompare(b.nome ?? "~", "pt-BR");
      });
  }, [clientes, filtro, busca]);

  function escolherFiltro(chave: Filtro) {
    router.replace(chave === "todas" ? "/clientes" : `/clientes?filtro=${chave}`, { scroll: false });
  }

  return (
    <div className="space-y-3">
      <div className="px-4">
        <input
          type="search"
          placeholder="Buscar por nome ou telefone"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="h-12 w-full rounded-xl border-2 border-neutral-300 px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
        />
      </div>

      <div className="flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            onClick={() => escolherFiltro(f.chave)}
            aria-pressed={filtro === f.chave}
            className={`h-11 shrink-0 rounded-full px-4 font-semibold ${
              filtro === f.chave ? "bg-[var(--cor-principal)] text-white" : "bg-neutral-100 text-neutral-800"
            }`}
          >
            {f.rotulo} ({contagem[f.chave] ?? 0})
          </button>
        ))}
      </div>

      {erro && <p className="mx-4 rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler as clientes: {erro}</p>}
      {!clientes && !erro && <p className="px-4 text-neutral-500">Carregando…</p>}
      {clientes && lista.length === 0 && (
        <p className="px-4 py-8 text-center text-lg text-neutral-500">Nenhuma cliente aqui.</p>
      )}

      <ul className="divide-y divide-neutral-200 border-y border-neutral-200">
        {lista.map((c) => (
          <li key={c.id}>
            <Link href={`/clientes/${c.id}`} className="block px-4 py-3 active:bg-neutral-50">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-lg font-semibold">{c.nome ?? formatarTelefone(c.telefone)}</p>
                <SeloStatus status={c.status} />
              </div>
              <p className="mt-0.5 text-neutral-600">
                {c.ultima_visita ? `Última visita ${haQuantoTempo(c.ultima_visita)}` : "Nunca veio"}
                {/* Com horário marcado, o retorno já está resolvido: mostra o horário */}
                {c.proximo_agendamento
                  ? ` · Marcado ${formatarData(c.proximo_agendamento)} às ${formatarHora(c.proximo_agendamento)}`
                  : c.retorno_previsto && ` · Retorno ${formatarData(c.retorno_previsto)} (${prazo(c.retorno_previsto)})`}
              </p>
              {lerOrigem(c.etiquetas) && (
                <p className="text-sm text-neutral-500">Veio por: {rotuloOrigem(lerOrigem(c.etiquetas))}</p>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
