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

// "14:35" se foi hoje, "Ontem", ou "18/10"
function quando(instante: string): string {
  const dia = dataNoSalao(instante);
  const hoje = hojeNoSalao();
  if (dia === hoje) return formatarHora(instante);
  const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (dia === ontem) return "Ontem";
  return formatarData(instante).slice(0, 5);
}

// O app não guarda "lida" nem "favorita": os filtros são os que a dona usa de verdade
type Filtro = "todas" | "precisa" | "pausada";

const FILTROS: { chave: Filtro; rotulo: string }[] = [
  { chave: "todas", rotulo: "Tudo" },
  { chave: "precisa", rotulo: "Atenção" },
  { chave: "pausada", rotulo: "IA pausada" },
];

// Pontinho no canto do avatar: verde = IA atendendo, bronze = pausada, rosé = precisa de você
const PONTO: Record<SituacaoIa, { cor: string; rotulo: string }> = {
  atendendo: { cor: "bg-[#5E7A50]", rotulo: "IA atendendo" },
  pausada: { cor: "bg-bronze", rotulo: "IA pausada" },
  precisa: { cor: "bg-rose-texto", rotulo: "Precisa de você" },
};

function AvatarComStatus({ id, nome, situacao, tamanho }: { id: string; nome: string | null; situacao: SituacaoIa; tamanho?: string }) {
  return (
    <span className="relative shrink-0">
      <Avatar id={id} nome={nome} tamanho={tamanho} />
      <span
        role="img"
        aria-label={PONTO[situacao].rotulo}
        className={`absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-perola ${PONTO[situacao].cor}`}
      />
    </span>
  );
}

// ✓✓ nas mensagens que saíram do salão (da IA ou da dona)
function Enviada() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6E8CA0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Enviada" className="shrink-0">
      <path d="m2 13 4 4 8-9" />
      <path d="m10 16 1 1 8-9" />
    </svg>
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

  // Em "Tudo", quem precisa de você aparece em destaque no topo (e não repete embaixo)
  const destacar = filtro === "todas" && !busca.trim() && precisam.length > 0;
  const recentes = destacar ? lista.filter((c) => situacaoIa(c.ia_pausada, c.motivo_pausa) !== "precisa") : lista;

  return (
    <>
      {/* Topo grafite: título, resumo, busca e filtros */}
      <header className="relative -mt-[env(safe-area-inset-top)] flex flex-col gap-4 overflow-hidden rounded-b-[32px] bg-grafite px-5 pt-[calc(56px+env(safe-area-inset-top))] pb-5">
        <span aria-hidden="true" className="absolute -top-[90px] -right-[60px] h-[200px] w-[200px] rounded-full border-[1.5px] border-bronze/45" />
        <div className="relative flex flex-col gap-1">
          <h1 className="font-serif text-[32px] leading-tight font-semibold text-white">Conversas</h1>
          <p className="text-sm text-claro">
            {total.todas} {total.todas === 1 ? "conversa" : "conversas"}
            {total.precisa > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-bronze">
                  {total.precisa} {total.precisa === 1 ? "precisa" : "precisam"} de você
                </span>
              </>
            )}
          </p>
        </div>

        <label className="relative flex h-12 items-center gap-2.5 rounded-full border border-bronze/30 bg-white/[0.08] px-[18px]">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#A88A68" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">Pesquisar conversa</span>
          <input
            type="search"
            placeholder="Pesquisar"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-perola outline-none placeholder:text-[#9A8C80]"
          />
        </label>

        <div className="relative flex gap-2 overflow-x-auto [scrollbar-width:none]">
          {FILTROS.map((f) => (
            <button
              key={f.chave}
              onClick={() => setFiltro(f.chave)}
              aria-pressed={filtro === f.chave}
              className={`h-11 shrink-0 rounded-full px-4 text-sm font-semibold whitespace-nowrap ${
                filtro === f.chave ? "bg-bronze text-grafite" : "border border-bronze/40 text-perola"
              }`}
            >
              {f.rotulo}
              {total[f.chave] > 0 && f.chave !== "todas" && <span className="ml-1.5 opacity-70">{total[f.chave]}</span>}
            </button>
          ))}
        </div>
      </header>

      {!resultado && <p className="px-5 pt-5 text-texto-2">Carregando…</p>}
      {resultado && "erro" in resultado && <p className="m-5 rounded-2xl bg-rose p-4 text-rose-texto">Erro ao ler as conversas: {resultado.erro}</p>}

      {/* Destaque: quem pediu para falar com a dona */}
      {destacar && (
        <section className="mt-5">
          <h2 className="rotulo px-5 text-rose-texto">Precisam de você</h2>
          <div className="mt-3 flex gap-3 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
            {precisam.map((c) => (
              <Link key={c.cliente_id} href={`/conversas/${c.cliente_id}`} className="w-60 shrink-0 rounded-[20px] bg-card p-3.5 active:bg-campo">
                <div className="flex items-center gap-2.5">
                  <AvatarComStatus id={c.cliente_id} nome={c.nome} situacao="precisa" tamanho="h-10 w-10 text-base" />
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{c.nome ?? formatarTelefone(c.telefone)}</p>
                    <p className="text-xs text-texto-2">{quando(c.ultima_mensagem_em)}</p>
                  </div>
                </div>
                <p className="mt-2 text-sm font-semibold text-rose-texto">{c.motivo_pausa ? MOTIVOS_PRECISA[c.motivo_pausa] : "Precisa de você"}</p>
                <p className="truncate text-sm text-texto-2">“{c.ultima_mensagem ?? "…"}”</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {resultado && "conversas" in resultado && (
        <section className="mt-2">
          {destacar && <h2 className="rotulo mt-4 mb-1 px-5 text-texto-2">Recentes</h2>}
          {recentes.length === 0 ? (
            <p className="mx-5 mt-6 text-center text-[15px] text-texto-2">
              {busca.trim() ? "Nenhuma conversa encontrada." : "Nenhuma conversa aqui."}
            </p>
          ) : (
            <ul>
              {recentes.map((c) => {
                const situacao = situacaoIa(c.ia_pausada, c.motivo_pausa);
                const nossa = c.ultimo_autor !== "cliente";
                return (
                  <li key={c.cliente_id}>
                    <Link href={`/conversas/${c.cliente_id}`} className="flex items-center gap-3.5 px-5 py-2.5 active:bg-campo">
                      <AvatarComStatus id={c.cliente_id} nome={c.nome} situacao={situacao} tamanho="h-[52px] w-[52px] text-xl" />
                      <div className="flex min-w-0 flex-1 flex-col gap-[3px] border-b border-borda pt-1.5 pb-3">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-base font-semibold">{c.nome ?? formatarTelefone(c.telefone)}</span>
                          <span className={`shrink-0 text-xs ${situacao === "precisa" ? "font-bold text-bronze-escuro" : "text-texto-2"}`}>
                            {quando(c.ultima_mensagem_em)}
                          </span>
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          {nossa && <Enviada />}
                          <span className="min-w-0 flex-1 truncate text-sm text-texto-2">
                            {c.ultimo_autor === "ia" && <span className="font-semibold text-bronze-escuro">IA: </span>}
                            {c.ultimo_autor === "humano" && <span className="font-semibold text-bronze-escuro">Você: </span>}
                            {c.ultima_mensagem ?? "(mensagem sem texto)"}
                          </span>
                          {situacao === "precisa" && (
                            <span className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-bronze px-1.5 text-xs font-bold text-grafite" aria-label="Precisa de você">
                              !
                            </span>
                          )}
                        </div>
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
