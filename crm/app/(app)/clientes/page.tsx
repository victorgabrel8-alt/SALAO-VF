"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { Etiquetas } from "@/components/Etiquetas";
import { useEmpresa } from "@/lib/empresa";
import { estaExcluida } from "@/lib/excluidas";
import { formatarData, formatarHora, formatarTelefone, haQuantoTempo, prazo } from "@/lib/formato";
import { lerOrigem, rotuloOrigem } from "@/lib/origem";
import { SeloStatus, type StatusCliente } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";
import type { ClienteStatus } from "@/lib/tipos";

// "para_chamar" junta retorno chegando + atrasadas (o "Para chamar hoje" do Início)
type Filtro = StatusCliente | "para_chamar" | "todas";

const PARA_CHAMAR: StatusCliente[] = ["retorno_chegando", "retorno_atrasado"];

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: "para_chamar", rotulo: "Para chamar" },
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
        // Excluídas ficam em Configurações → Clientes excluídas
        else setClientes((data as ClienteStatus[]).filter((c) => !estaExcluida(c.etiquetas)));
      });
  }, [empresa.id]);

  const contagem = useMemo(() => {
    const total: Record<string, number> = { todas: clientes?.length ?? 0, para_chamar: 0 };
    for (const c of clientes ?? []) {
      total[c.status] = (total[c.status] ?? 0) + 1;
      if (PARA_CHAMAR.includes(c.status)) total.para_chamar++;
    }
    return total;
  }, [clientes]);

  const lista = useMemo(() => {
    const termo = semAcento(busca.trim());
    const digitos = busca.replace(/\D/g, "");
    return (clientes ?? [])
      .filter((c) =>
        filtro === "todas" ? true : filtro === "para_chamar" ? PARA_CHAMAR.includes(c.status) : c.status === filtro,
      )
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

  const linhaFiltros = useRef<HTMLDivElement>(null);
  function rolarFiltros(direcao: 1 | -1) {
    const linha = linhaFiltros.current;
    if (linha) linha.scrollBy({ left: direcao * linha.clientWidth * 0.7, behavior: "smooth" });
  }

  return (
    <div className="space-y-3">
      <div className="px-4">
        <input
          type="search"
          placeholder="Buscar por nome ou telefone"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
        />
      </div>

      {/* Filtros em linha que rola para o lado; as setas ‹ › passam para as próximas opções */}
      <div className="flex items-center gap-1 px-2">
        <button
          onClick={() => rolarFiltros(-1)}
          aria-label="Filtros anteriores"
          className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-2xl text-neutral-500 active:bg-neutral-100"
        >
          ‹
        </button>
        <div ref={linhaFiltros} className="flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth [scrollbar-width:none]">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              onClick={(e) => {
                escolherFiltro(f.chave);
                e.currentTarget.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
              }}
              aria-pressed={filtro === f.chave}
              className={`h-11 shrink-0 rounded-full px-4 font-semibold ${
                filtro === f.chave ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-800"
              }`}
            >
              {f.rotulo} ({contagem[f.chave] ?? 0})
            </button>
          ))}
        </div>
        <button
          onClick={() => rolarFiltros(1)}
          aria-label="Próximos filtros"
          className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-2xl text-neutral-500 active:bg-neutral-100"
        >
          ›
        </button>
      </div>

      {erro && <p className="mx-4 rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler as clientes: {erro}</p>}
      {!clientes && !erro && <p className="px-4 text-neutral-500">Carregando…</p>}
      {clientes && lista.length === 0 && (
        <p className="px-4 py-8 text-center text-lg text-neutral-500">Nenhuma cliente aqui.</p>
      )}

      <ul className="space-y-3 px-4">
        {lista.map((c) => (
          <li key={c.id}>
            <CartaoCliente cliente={c} />
          </li>
        ))}
      </ul>
    </div>
  );
}

// Uma cliente por caixinha: nome e status em cima, etiquetas, e as datas separadas em
// duas colunas com rótulo, para a dona achar a informação sem ler tudo corrido.
function CartaoCliente({ cliente: c }: { cliente: ClienteStatus }) {
  const origem = lerOrigem(c.etiquetas);

  // Com horário marcado, o retorno já está resolvido: mostra o horário
  const proximo = c.proximo_agendamento
    ? {
        rotulo: "Horário marcado",
        valor: formatarData(c.proximo_agendamento).slice(0, 5),
        detalhe: `às ${formatarHora(c.proximo_agendamento)}`,
        atrasado: false,
      }
    : c.retorno_previsto
      ? {
          rotulo: "Retorno",
          valor: formatarData(c.retorno_previsto).slice(0, 5),
          detalhe: prazo(c.retorno_previsto),
          atrasado: c.status === "retorno_atrasado" || c.status === "inativa",
        }
      : null;

  return (
    <Link
      href={`/clientes/${c.id}`}
      className="block rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm active:bg-neutral-50"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-lg font-semibold">{c.nome ?? formatarTelefone(c.telefone)}</p>
        <SeloStatus status={c.status} />
      </div>
      <Etiquetas etiquetas={c.etiquetas} />

      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-neutral-100 pt-3">
        <div>
          <dt className="text-sm text-neutral-500">Última visita</dt>
          <dd className="font-semibold">{c.ultima_visita ? haQuantoTempo(c.ultima_visita) : "Nunca veio"}</dd>
        </div>
        <div>
          <dt className="text-sm text-neutral-500">{proximo?.rotulo ?? "Retorno"}</dt>
          {proximo ? (
            <dd>
              <span className="block font-semibold">{proximo.valor}</span>
              <span className={`block text-sm ${proximo.atrasado ? "text-orange-700" : "text-neutral-600"}`}>
                {proximo.detalhe}
              </span>
            </dd>
          ) : (
            <dd className="text-neutral-500">—</dd>
          )}
        </div>
      </dl>

      {origem && <p className="mt-2 text-sm text-neutral-500">Veio por: {rotuloOrigem(origem)}</p>}
    </Link>
  );
}
