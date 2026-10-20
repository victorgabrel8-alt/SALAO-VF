"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { useEmpresa } from "@/lib/empresa";
import { supabase } from "@/lib/supabase/client";

const STATUS = [
  { chave: "em_dia", rotulo: "Em dia", cor: "bg-green-100 text-green-900" },
  { chave: "retorno_chegando", rotulo: "Retorno chegando", cor: "bg-yellow-100 text-yellow-900" },
  { chave: "retorno_atrasado", rotulo: "Atrasadas", cor: "bg-orange-100 text-orange-900" },
  { chave: "inativa", rotulo: "Inativas", cor: "bg-red-100 text-red-900" },
  { chave: "sem_visita", rotulo: "Sem visita", cor: "bg-neutral-100 text-neutral-800" },
];

export default function InicioPage() {
  const empresa = useEmpresa();
  const [contagem, setContagem] = useState<Record<string, number> | null>(null);
  const [erro, setErro] = useState("");

  // Fase 1: só confere que o app lê o banco, contando as clientes por status.
  useEffect(() => {
    supabase()
      .from("clientes_status")
      .select("status")
      .eq("empresa_id", empresa.id)
      .then(({ data, error }) => {
        if (error) {
          setErro(error.message);
          return;
        }
        const total: Record<string, number> = {};
        for (const { status } of data) total[status] = (total[status] ?? 0) + 1;
        setContagem(total);
      });
  }, [empresa.id]);

  return (
    <>
      <Cabecalho
        titulo={empresa.nome}
        acao={
          <Link
            href="/configuracoes"
            aria-label="Configurações"
            className="flex h-12 w-12 items-center justify-center rounded-full active:bg-neutral-100"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </Link>
        }
      />

      <section className="space-y-3 px-4">
        <h2 className="text-xl font-semibold">Suas clientes</h2>
        {erro && <p className="rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler o banco: {erro}</p>}
        {!contagem && !erro && <p className="text-neutral-500">Carregando…</p>}
        {contagem && (
          <ul className="grid grid-cols-2 gap-3">
            {STATUS.map((s) => (
              <li key={s.chave} className={`rounded-2xl p-4 ${s.cor}`}>
                <p className="text-3xl font-bold">{contagem[s.chave] ?? 0}</p>
                <p className="font-medium">{s.rotulo}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
