"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { useEmpresa } from "@/lib/empresa";
import { buscarExcluidas, restaurarCliente, type ClienteExcluida } from "@/lib/excluidas";
import { formatarTelefone, haQuantoTempo } from "@/lib/formato";

// Configurações → Clientes excluídas: quem a dona tirou das listas, com opção de restaurar
export default function ClientesExcluidasPage() {
  const empresa = useEmpresa();
  const [resultado, setResultado] = useState<{ excluidas: ClienteExcluida[]; erro?: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [erroRestaurar, setErroRestaurar] = useState("");

  useEffect(() => {
    let ativo = true;
    buscarExcluidas(empresa.id).then((r) => {
      if (ativo) setResultado(r);
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, versao]);

  async function restaurar(c: ClienteExcluida) {
    setRestaurando(c.id);
    const erro = await restaurarCliente(c.id);
    setRestaurando(null);
    if (erro) {
      setErroRestaurar(`Não foi possível restaurar: ${erro}`);
      return;
    }
    setErroRestaurar("");
    setVersao((v) => v + 1);
  }

  return (
    <>
      <Cabecalho
        titulo="Clientes excluídas"
        acao={
          <Link href="/configuracoes" className="flex h-11 items-center px-2 text-lg font-semibold text-[var(--cor-principal)]">
            Voltar
          </Link>
        }
      />
      <p className="px-4 text-neutral-600">
        Elas não aparecem no Início, na Agenda nem em Clientes. O histórico continua guardado.
      </p>

      <div className="mt-4 space-y-3 px-4">
        {!resultado && <p className="text-neutral-500">Carregando…</p>}
        {resultado?.erro && <p className="rounded-xl bg-red-100 p-4 text-red-900">Erro: {resultado.erro}</p>}
        {erroRestaurar && <p className="rounded-xl bg-red-100 p-4 text-red-900">{erroRestaurar}</p>}
        {resultado && !resultado.erro && resultado.excluidas.length === 0 && (
          <p className="rounded-2xl border border-neutral-200 bg-white p-4 text-center text-neutral-500">
            Nenhuma cliente excluída.
          </p>
        )}
        {resultado?.excluidas.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <Link href={`/clientes/${c.id}`} className="min-w-0 flex-1">
              <p className="truncate text-lg font-semibold">{c.nome ?? "Sem nome"}</p>
              <p className="text-neutral-600">{formatarTelefone(c.telefone)}</p>
              <p className="text-sm text-neutral-500">Excluída {haQuantoTempo(c.atualizado_em)}</p>
            </Link>
            <button
              onClick={() => restaurar(c)}
              disabled={restaurando === c.id}
              className="h-11 shrink-0 rounded-xl border border-neutral-300 bg-white px-3 font-semibold active:bg-neutral-100 disabled:opacity-50"
            >
              {restaurando === c.id ? "…" : "Restaurar"}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
