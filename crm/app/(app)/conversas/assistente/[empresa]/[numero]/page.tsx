"use client";

import { useParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Voltar } from "@/components/Voltar";
import { ROTULO, tituloDaConversa, type ConversaAssistente, type MensagemAssistente, type PaginaAssistente } from "@/lib/assistente";
import { dataNoSalao, formatarDiaLongo, formatarHora, hojeNoSalao } from "@/lib/formato";
import { lembrar } from "@/lib/memoriaTela";
import { supabase } from "@/lib/supabase/client";

// Conversa da assistente com a dona (ou a profissional) no WhatsApp do studio (supabase/080).
// Só leitura: a tela não manda mensagem. A conversa vem da Evolution pelo servidor do app (app/api/assistente/route.ts).
// A dona fica à esquerda (balão claro) e a assistente à direita (balão escuro), com a hora de Cuiabá.

type Estado = { mensagens: MensagemAssistente[]; mais: boolean; antes: number | null; nomeWhatsApp: string | null };

async function lerPagina(empresa: string, numero: string, ate: number | null): Promise<PaginaAssistente> {
  const q = new URLSearchParams({ empresa, numero });
  if (ate) q.set("ate", String(ate));
  const r = await fetch(`/api/assistente?${q}`, { cache: "no-store" });
  // sessão vencida: o servidor manda para a tela de login (HTML), não para a resposta
  if (!r.headers.get("content-type")?.includes("application/json")) throw new Error("Sua sessão acabou. Entre de novo no app.");
  const j = (await r.json()) as PaginaAssistente | { erro: string };
  if ("erro" in j) throw new Error(j.erro);
  if (!r.ok) throw new Error("Não deu para ler a conversa.");
  return j;
}

// Junta sem repetir, na ordem da conversa (mesma hora: fica a ordem em que chegaram)
function juntar(a: MensagemAssistente[], b: MensagemAssistente[]): MensagemAssistente[] {
  const porId = new Map<string, MensagemAssistente>();
  for (const m of [...a, ...b]) porId.set(m.id, m);
  return [...porId.values()].map((m, i) => ({ m, i })).sort((x, y) => x.m.em - y.m.em || x.i - y.i).map(({ m }) => m);
}

const iso = (em: number) => new Date(em * 1000).toISOString();

function pertoDoFim() {
  return document.documentElement.scrollHeight - (window.scrollY + window.innerHeight) < 300;
}
function rolarAteOFim() {
  window.scrollTo({ top: document.documentElement.scrollHeight });
}

export default function ConversaAssistentePage() {
  return (
    <Suspense fallback={<p className="carregando-calmo p-4 text-texto-2">Carregando…</p>}>
      <ConversaAssistente />
    </Suspense>
  );
}

function ConversaAssistente() {
  const { empresa, numero } = useParams<{ empresa: string; numero: string }>();
  // Nome e loja da linha que abriu esta tela (a lista de Conversas já leu); sem ela, pergunta ao banco
  const [conversa, setConversa] = useState<ConversaAssistente | null>(
    () => (lembrar<ConversaAssistente[]>("conversas:assistente") ?? []).find((c) => c.empresa_id === empresa && c.numero === numero) ?? null,
  );
  const [estado, setEstado] = useState<Estado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [atualizando, setAtualizando] = useState(false);
  const [carregandoAntigas, setCarregandoAntigas] = useState(false);
  const ocupado = useRef(false);
  const topo = useRef<HTMLDivElement>(null);
  // Altura da página antes de pôr as mais antigas em cima (para a tela não pular)
  const alturaAntes = useRef<number | null>(null);
  const rolarNoFim = useRef(true);

  useEffect(() => {
    if (conversa) return;
    supabase()
      .rpc("assistente_conversas")
      .then(({ data }) => {
        const c = ((data ?? []) as ConversaAssistente[]).find((x) => x.empresa_id === empresa && x.numero === numero);
        if (c) setConversa(c);
      });
  }, [conversa, empresa, numero]);

  // As mais novas; junta com o que já está na tela (atualizar não perde as antigas que a pessoa já carregou)
  const atualizar = useCallback(async () => {
    setAtualizando(true);
    try {
      const p = await lerPagina(empresa, numero, null);
      rolarNoFim.current = pertoDoFim();
      setEstado((e) => {
        // Primeira vez, ou chegou tanta mensagem que a página nova não encosta nas que já estavam: começa de novo
        const encosta = e && (!p.mais || !e.mensagens.length || (p.antes ?? 0) <= e.mensagens[e.mensagens.length - 1].em);
        if (!e || !encosta) return { mensagens: p.mensagens, mais: p.mais, antes: p.antes, nomeWhatsApp: p.nomeWhatsApp };
        return { ...e, mensagens: juntar(e.mensagens, p.mensagens), nomeWhatsApp: p.nomeWhatsApp ?? e.nomeWhatsApp };
      });
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para ler a conversa.");
    } finally {
      setAtualizando(false);
    }
  }, [empresa, numero]);

  const carregarAntigas = useCallback(async () => {
    if (ocupado.current || !estado?.mais || !estado.antes) return;
    ocupado.current = true;
    setCarregandoAntigas(true);
    try {
      const p = await lerPagina(empresa, numero, estado.antes);
      alturaAntes.current = document.documentElement.scrollHeight;
      rolarNoFim.current = false;
      setEstado((e) => {
        if (!e) return e;
        const mensagens = juntar(p.mensagens, e.mensagens);
        // nada novo: chegou ao começo
        const novas = mensagens.length - e.mensagens.length;
        return { ...e, mensagens, mais: p.mais && novas > 0, antes: novas > 0 ? Math.min(p.antes ?? e.antes ?? 0, e.antes ?? Infinity) : e.antes };
      });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não deu para ler as mensagens mais antigas.");
    } finally {
      ocupado.current = false;
      setCarregandoAntigas(false);
    }
  }, [empresa, numero, estado]);

  // Abre já com as mais novas e atualiza sozinha quando a pessoa volta para o app e a cada minuto com a tela aberta
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial da conversa
    atualizar();
    const aoVoltar = () => {
      if (document.visibilityState === "visible") atualizar();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") atualizar();
    }, 60_000);
    return () => {
      document.removeEventListener("visibilitychange", aoVoltar);
      clearInterval(t);
    };
  }, [atualizar]);

  // Depois de mostrar: as mais antigas entram em cima sem a tela pular; mensagem nova desce até o fim
  const total = estado?.mensagens.length ?? 0;
  useLayoutEffect(() => {
    if (alturaAntes.current !== null) {
      window.scrollBy({ top: document.documentElement.scrollHeight - alturaAntes.current });
      alturaAntes.current = null;
    } else if (rolarNoFim.current) rolarAteOFim();
  }, [total]);

  // Chegou no topo da conversa: carrega as mais antigas
  useEffect(() => {
    const alvo = topo.current;
    if (!alvo || !estado?.mais) return;
    const olho = new IntersectionObserver((v) => {
      if (v.some((x) => x.isIntersecting)) carregarAntigas();
    });
    olho.observe(alvo);
    return () => olho.disconnect();
  }, [estado?.mais, carregarAntigas]);

  const titulo = conversa ? tituloDaConversa(conversa, estado?.nomeWhatsApp) : "Assistente";
  const mensagens = estado?.mensagens ?? [];
  const hoje = hojeNoSalao();

  return (
    <div className="-mt-[env(safe-area-inset-top)] min-h-dvh bg-[radial-gradient(rgb(27_23_25/0.05)_1px,transparent_1px)] [background-size:18px_18px]">
      <header className="vidro-barra sticky top-0 z-10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-3 py-2">
          <Voltar para="/conversas" aria-label="Voltar para Conversas" className="vidro flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-95">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1B1719" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Voltar>
          <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-grafite text-ouro-antigo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3l1.9 4.8L19 9.7l-4 3.4 1.2 5.2L12 15.6l-4.2 2.7L9 13.1 5 9.7l5.1-1.9Z" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] leading-tight font-semibold">{titulo}</h1>
            <p className="truncate text-xs text-texto-2">{conversa ? `${conversa.loja} · só leitura` : "Só leitura"}</p>
          </div>
          <button
            onClick={() => atualizar()}
            disabled={atualizando}
            aria-label="Atualizar a conversa"
            className="vidro flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold active:scale-95 disabled:opacity-60"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={atualizando ? "animate-spin" : ""}>
              <path d="M21 12a9 9 0 1 1-2.6-6.4" />
              <path d="M21 3v6h-6" />
            </svg>
            Atualizar
          </button>
        </div>
      </header>

      <div className="px-4 py-4">
        {erro && (
          <div className="mx-auto mb-3 max-w-[92%] rounded-[18px] bg-rose px-3.5 py-2.5 text-sm text-rose-texto">
            {erro}{" "}
            <button onClick={() => atualizar()} className="font-semibold underline">
              Tentar de novo
            </button>
          </div>
        )}
        {!estado && !erro && <p className="carregando-calmo p-4 text-center text-texto-2">Carregando a conversa…</p>}

        {estado && (
          <div ref={topo} className="flex justify-center pb-1">
            {estado.mais ? (
              <button onClick={() => carregarAntigas()} disabled={carregandoAntigas} className="rounded-full bg-card px-4 py-1.5 text-sm font-semibold text-texto-2 shadow-[0_1px_1.5px_rgba(30,23,20,0.1)]">
                {carregandoAntigas ? "Carregando as mais antigas…" : "Ver mensagens mais antigas"}
              </button>
            ) : (
              mensagens.length > 0 && <p className="rounded-full bg-card px-4 py-1.5 text-xs text-texto-2">Começo da conversa</p>
            )}
          </div>
        )}
        {estado && mensagens.length === 0 && <p className="mx-auto mt-3 w-fit rounded-full bg-card px-4 py-1.5 text-sm text-texto-2">Nenhuma mensagem ainda.</p>}

        {mensagens.map((m, i) => {
          const dia = dataNoSalao(iso(m.em));
          const novoDia = i === 0 || dataNoSalao(iso(mensagens[i - 1].em)) !== dia;
          const mesmoAutor = i > 0 && !novoDia && mensagens[i - 1].daAssistente === m.daAssistente;
          return (
            <div key={m.id} className={mesmoAutor ? "pt-0.5" : "pt-2.5"}>
              {novoDia && (
                <p className="mx-auto my-3 w-fit rounded-full bg-card px-3 py-1 text-xs font-semibold text-texto-2 shadow-[0_1px_1.5px_rgba(30,23,20,0.1)]">
                  {dia === hoje ? "Hoje" : formatarDiaLongo(dia)}
                </p>
              )}
              <Balao mensagem={m} primeiro={!mesmoAutor} />
            </div>
          );
        })}
        <p className="mx-auto mt-4 w-fit max-w-[92%] text-center text-xs text-rotulo">Só leitura: a conversa acontece no WhatsApp do studio.</p>
        {/* folga da barra de abas */}
        <div className="h-28" />
      </div>
    </div>
  );
}

// A dona num balão claro à esquerda e a assistente num balão escuro à direita, como nas conversas das clientes
function Balao({ mensagem: m, primeiro }: { mensagem: MensagemAssistente; primeiro: boolean }) {
  const dela = !m.daAssistente;
  const rotulo = ROTULO[m.tipo];
  const reacao = m.tipo === "reacao";
  return (
    <div className={`flex ${dela ? "justify-start" : "justify-end"}`}>
      <div
        className={`relative max-w-[80%] rounded-[18px] px-3 pt-1.5 pb-2 ${
          dela ? "bg-white text-texto shadow-[0_1px_1.5px_rgba(30,23,20,0.13)]" : "bg-grafite text-perola shadow-[0_1px_1.5px_rgba(27,23,25,0.2)]"
        } ${primeiro ? (dela ? "rounded-tl-[4px]" : "rounded-tr-[4px]") : ""}`}
      >
        {primeiro && (
          <svg viewBox="0 0 8 13" aria-hidden className={`absolute top-0 h-[13px] w-2 fill-current ${dela ? "-left-[7px] text-white" : "-right-[7px] -scale-x-100 text-grafite"}`}>
            <path d="M8 0H1.3C.3 0-.3 1.1.3 1.9L8 12Z" />
          </svg>
        )}
        {!dela && primeiro && <p className="text-xs font-bold text-bronze">Assistente</p>}
        {rotulo && !reacao && <p className="text-xs font-semibold opacity-75">{rotulo}</p>}
        <p className="text-[15px] leading-snug whitespace-pre-wrap [overflow-wrap:anywhere]">
          {reacao ? `reagiu com ${m.texto}` : m.texto}
          {/* espaço para a hora caber na última linha, como no WhatsApp */}
          <span aria-hidden className="inline-block w-[42px]" />
        </p>
        <span className={`absolute right-2.5 bottom-1.5 text-[11px] leading-none ${dela ? "text-texto-2" : "text-claro/80"}`}>{formatarHora(iso(m.em))}</span>
      </div>
    </div>
  );
}
