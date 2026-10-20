"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Cabecalho } from "@/components/Cabecalho";
import { useEmpresa } from "@/lib/empresa";
import { buscarExcluidas } from "@/lib/excluidas";
import { dataNoSalao, formatarData, formatarHora, formatarTelefone, hojeNoSalao } from "@/lib/formato";
import { situacaoIa } from "@/lib/ia";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";

// Linha da view conversas: a última mensagem de cada cliente
type Conversa = {
  cliente_id: string;
  nome: string | null;
  telefone: string;
  ia_pausada: boolean;
  motivo_pausa: string | null;
  ultimo_autor: "cliente" | "ia" | "humano";
  ultima_mensagem: string | null;
  ultima_mensagem_em: string;
};

async function buscarConversas(empresaId: string) {
  const [conversas, excluidas] = await Promise.all([
    supabase()
      .from("conversas")
      .select("cliente_id, nome, telefone, ia_pausada, motivo_pausa, ultimo_autor, ultima_mensagem, ultima_mensagem_em")
      .eq("empresa_id", empresaId)
      .order("ultima_mensagem_em", { ascending: false }),
    buscarExcluidas(empresaId),
  ]);
  if (conversas.error) return { erro: conversas.error.message };
  const fora = new Set(excluidas.excluidas.map((c) => c.id));
  return { conversas: (conversas.data as Conversa[]).filter((c) => !fora.has(c.cliente_id)) };
}

// "14:35" se foi hoje, "ontem", ou "18/10"
function quando(instante: string): string {
  const dia = dataNoSalao(instante);
  const hoje = hojeNoSalao();
  if (dia === hoje) return formatarHora(instante);
  const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (dia === ontem) return "ontem";
  return formatarData(instante).slice(0, 5);
}

const PREFIXO_AUTOR: Record<Conversa["ultimo_autor"], string> = { cliente: "", ia: "IA: ", humano: "Você: " };

export default function ConversasPage() {
  const empresa = useEmpresa();
  const [resultado, setResultado] = useState<{ conversas: Conversa[] } | { erro: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const [soPrecisam, setSoPrecisam] = useState(false);
  const [busca, setBusca] = useState("");

  useEffect(() => {
    let ativo = true;
    buscarConversas(empresa.id).then((r) => {
      if (ativo) setResultado(r);
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, versao]);

  // Mensagem nova ou IA pausada/reativada: a lista se atualiza sozinha
  useTempoReal(["mensagens", "clientes"], empresa.id, () => setVersao((v) => v + 1));

  const conversas = useMemo(() => (resultado && "conversas" in resultado ? resultado.conversas : []), [resultado]);
  const precisam = conversas.filter((c) => situacaoIa(c.ia_pausada, c.motivo_pausa) === "precisa").length;
  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = busca.replace(/\D/g, "");
    return conversas
      .filter((c) => !soPrecisam || situacaoIa(c.ia_pausada, c.motivo_pausa) === "precisa")
      .filter(
        (c) =>
          !termo ||
          (c.nome ?? "").toLowerCase().includes(termo) ||
          (digitos.length >= 3 && c.telefone.includes(digitos)),
      );
  }, [conversas, soPrecisam, busca]);

  // Visual inspirado na lista de conversas do WhatsApp: fundo branco, foto (iniciais),
  // nome e hora na mesma linha, prévia da última mensagem e o aviso à direita.
  return (
    <div className="-mt-[env(safe-area-inset-top)] min-h-dvh bg-white pt-[env(safe-area-inset-top)]">
      <Cabecalho titulo="Conversas" />
      <div className="space-y-3 px-4 pb-2">
        <label className="flex h-11 items-center gap-2 rounded-full bg-neutral-100 px-4">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-500" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Pesquisar"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-lg outline-none"
          />
        </label>
        <div className="flex gap-2">
          <button
            onClick={() => setSoPrecisam(false)}
            aria-pressed={!soPrecisam}
            className={`h-9 rounded-full px-4 font-medium ${!soPrecisam ? "bg-[#d9fdd3] text-[#0a5c2f]" : "bg-neutral-100 text-neutral-600"}`}
          >
            Tudo
          </button>
          <button
            onClick={() => setSoPrecisam(true)}
            aria-pressed={soPrecisam}
            className={`h-9 rounded-full px-4 font-medium ${soPrecisam ? "bg-[#d9fdd3] text-[#0a5c2f]" : "bg-neutral-100 text-neutral-600"}`}
          >
            Precisam de você {precisam > 0 && `(${precisam})`}
          </button>
        </div>
      </div>

      {!resultado && <p className="px-4 text-neutral-500">Carregando…</p>}
      {resultado && "erro" in resultado && (
        <p className="mx-4 rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler as conversas: {resultado.erro}</p>
      )}
      {resultado && "conversas" in resultado && lista.length === 0 && (
        <p className="px-4 py-10 text-center text-neutral-500">Nenhuma conversa aqui.</p>
      )}

      <ul>
        {lista.map((c) => {
          const situacao = situacaoIa(c.ia_pausada, c.motivo_pausa);
          return (
            <li key={c.cliente_id}>
              <Link href={`/conversas/${c.cliente_id}`} className="flex items-center gap-3 pl-4 active:bg-neutral-100">
                <Avatar id={c.cliente_id} nome={c.nome} />
                <div className="min-w-0 flex-1 border-b border-neutral-100 py-3 pr-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[17px] font-semibold">{c.nome ?? formatarTelefone(c.telefone)}</p>
                    <span
                      className={`shrink-0 text-xs ${situacao === "precisa" ? "font-semibold text-[#1da851]" : "text-neutral-500"}`}
                    >
                      {quando(c.ultima_mensagem_em)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <p className="truncate text-[15px] text-neutral-500">
                      {c.ultimo_autor !== "cliente" && <span className="text-sky-500">✓✓ </span>}
                      {PREFIXO_AUTOR[c.ultimo_autor]}
                      {c.ultima_mensagem ?? "(mensagem sem texto)"}
                    </p>
                    {situacao === "precisa" && (
                      <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[#1da851] px-1.5 text-xs font-bold text-white">
                        !
                      </span>
                    )}
                    {situacao === "pausada" && (
                      <span className="shrink-0 text-xs font-medium text-amber-600">IA pausada</span>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
