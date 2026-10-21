"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useEmpresa } from "@/lib/empresa";
import { buscarExcluidas } from "@/lib/excluidas";
import { dataNoSalao, formatarData, formatarHora, formatarTelefone, hojeNoSalao } from "@/lib/formato";
import { MOTIVOS_PRECISA, situacaoIa, type SituacaoIa } from "@/lib/ia";
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

type Filtro = "todas" | "precisa" | "pausada";

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "precisa", rotulo: "Atenção" },
  { chave: "pausada", rotulo: "IA pausada" },
];

// Pontinho no canto do avatar: verde = IA atendendo, amarelo = pausada, vermelho = precisa de você
const PONTO: Record<SituacaoIa, string> = {
  atendendo: "bg-emerald-500",
  pausada: "bg-amber-400",
  precisa: "bg-red-500",
};

function AvatarComStatus({ id, nome, situacao, tamanho }: { id: string; nome: string | null; situacao: SituacaoIa; tamanho?: string }) {
  return (
    <span className="relative shrink-0">
      <Avatar id={id} nome={nome} tamanho={tamanho} />
      <span className={`absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${PONTO[situacao]}`} />
    </span>
  );
}

export default function ConversasPage() {
  const empresa = useEmpresa();
  const [resultado, setResultado] = useState<{ conversas: Conversa[] } | { erro: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>("todas");
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
  const precisam = conversas.filter((c) => situacaoIa(c.ia_pausada, c.motivo_pausa) === "precisa");
  const total: Record<Filtro, number> = {
    todas: conversas.length,
    precisa: precisam.length,
    pausada: conversas.filter((c) => situacaoIa(c.ia_pausada, c.motivo_pausa) === "pausada").length,
  };

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const digitos = busca.replace(/\D/g, "");
    return conversas
      .filter((c) => filtro === "todas" || situacaoIa(c.ia_pausada, c.motivo_pausa) === filtro)
      .filter(
        (c) =>
          !termo ||
          (c.nome ?? "").toLowerCase().includes(termo) ||
          (digitos.length >= 3 && c.telefone.includes(digitos)),
      );
  }, [conversas, filtro, busca]);

  // Em "Todas", quem precisa de você aparece em destaque no topo (e não repete embaixo)
  const destacar = filtro === "todas" && !busca.trim() && precisam.length > 0;
  const recentes = destacar ? lista.filter((c) => situacaoIa(c.ia_pausada, c.motivo_pausa) !== "precisa") : lista;

  return (
    <>
      <header className="px-4 pt-4 pb-3">
        <h1 className="text-3xl font-bold">Conversas</h1>
        <p className="text-neutral-500">
          {total.todas} {total.todas === 1 ? "conversa" : "conversas"}
          {total.precisa > 0 && (
            <>
              {" · "}
              <span className="font-semibold text-red-600">
                {total.precisa} {total.precisa === 1 ? "precisa" : "precisam"} de você
              </span>
            </>
          )}
        </p>
      </header>

      <div className="space-y-3 px-4">
        <label className="flex h-12 items-center gap-2 rounded-2xl border border-neutral-200 bg-white px-4 shadow-sm">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-neutral-400" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Buscar cliente"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-lg outline-none"
          />
        </label>

        {/* Seletor em pílula: um toque troca o filtro */}
        <div className="grid grid-cols-3 gap-1 rounded-2xl bg-neutral-200/70 p-1">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              onClick={() => setFiltro(f.chave)}
              aria-pressed={filtro === f.chave}
              className={`h-10 rounded-xl px-1 text-sm font-semibold leading-tight ${
                filtro === f.chave ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"
              }`}
            >
              {f.rotulo}
              {total[f.chave] > 0 && f.chave !== "todas" && <span className="ml-1 text-neutral-400">{total[f.chave]}</span>}
            </button>
          ))}
        </div>
      </div>

      {!resultado && <p className="px-4 pt-4 text-neutral-500">Carregando…</p>}
      {resultado && "erro" in resultado && (
        <p className="m-4 rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler as conversas: {resultado.erro}</p>
      )}

      {/* Destaque: quem pediu para falar com a dona */}
      {destacar && (
        <section className="mt-5">
          <h2 className="px-4 text-xs font-bold tracking-wide text-red-600 uppercase">Precisam de você</h2>
          <div className="mt-2 flex gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {precisam.map((c) => (
              <Link
                key={c.cliente_id}
                href={`/conversas/${c.cliente_id}`}
                className="w-60 shrink-0 rounded-2xl border border-red-100 bg-white p-3 shadow-sm active:bg-red-50"
              >
                <div className="flex items-center gap-2">
                  <AvatarComStatus id={c.cliente_id} nome={c.nome} situacao="precisa" tamanho="h-10 w-10 text-base" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.nome ?? formatarTelefone(c.telefone)}</p>
                    <p className="text-xs text-neutral-500">{quando(c.ultima_mensagem_em)}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm font-medium text-red-700">
                  {c.motivo_pausa ? MOTIVOS_PRECISA[c.motivo_pausa] : "Precisa de você"}
                </p>
                <p className="truncate text-sm text-neutral-600">“{c.ultima_mensagem ?? "…"}”</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {resultado && "conversas" in resultado && (
        <section className="mt-5 px-4">
          {destacar && <h2 className="mb-2 text-xs font-bold tracking-wide text-neutral-500 uppercase">Recentes</h2>}
          {recentes.length === 0 ? (
            <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-center text-neutral-500">
              {busca.trim() ? "Nenhuma conversa com esse nome." : "Nenhuma conversa aqui."}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
              {recentes.map((c, i) => {
                const situacao = situacaoIa(c.ia_pausada, c.motivo_pausa);
                return (
                  <li key={c.cliente_id}>
                    <Link
                      href={`/conversas/${c.cliente_id}`}
                      className={`flex items-center gap-3 px-3 py-3 active:bg-neutral-50 ${i > 0 ? "border-t border-neutral-100" : ""}`}
                    >
                      <AvatarComStatus id={c.cliente_id} nome={c.nome} situacao={situacao} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-[17px] font-semibold">{c.nome ?? formatarTelefone(c.telefone)}</p>
                          <span className="shrink-0 text-xs text-neutral-400">{quando(c.ultima_mensagem_em)}</span>
                        </div>
                        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[15px] text-neutral-500">
                          {c.ultimo_autor === "ia" && (
                            <span className="shrink-0 rounded-md bg-violet-50 px-1.5 text-xs font-bold text-violet-600">IA</span>
                          )}
                          {c.ultimo_autor === "humano" && (
                            <span className="chip-ativo shrink-0 rounded-md px-1.5 text-xs font-bold">Você</span>
                          )}
                          <span className={`truncate ${c.ultimo_autor === "cliente" ? "text-neutral-700" : ""}`}>
                            {c.ultima_mensagem ?? "(mensagem sem texto)"}
                          </span>
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
