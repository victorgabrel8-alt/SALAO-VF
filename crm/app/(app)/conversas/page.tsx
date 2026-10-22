"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useEmpresa } from "@/lib/empresa";
import { buscarExcluidas } from "@/lib/excluidas";
import { dataNoSalao, formatarData, formatarHora, formatarTelefone, hojeNoSalao, primeiroNome } from "@/lib/formato";
import { situacaoIa, type SituacaoIa } from "@/lib/ia";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

// Lista no estilo do WhatsApp no iPhone: título grande no fundo claro, busca, quem precisa de
// você em bolinhas no topo (como os stories), seletor Tudo/Atenção/IA pausada e linhas que
// deslizam para o lado mostrando Ficha e WhatsApp.

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
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#6E8CA0" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Enviada" className="mr-1 inline-block shrink-0 align-[-3px]">
      <path d="m2 13 4 4 8-9" />
      <path d="m10 16 1 1 8-9" />
    </svg>
  );
}

// Prévia da última mensagem: "[áudio] Oi..." vira 🎤 Oi..., e "[imagem]" vira 📷 Foto, como no WhatsApp
function Previa({ texto }: { texto: string | null }) {
  if (!texto) return <>(mensagem sem texto)</>;
  const audio = texto.match(/^\[(?:á|a)udio\]\s*/i);
  if (audio) return <>🎤 {texto.slice(audio[0].length) || "Áudio"}</>;
  const imagem = texto.match(/^\[imagem\]\s*/i);
  if (imagem) return <>📷 {texto.slice(imagem[0].length) || "Foto"}</>;
  return <>{texto}</>;
}

const LARGURA_ACOES = 156;

// Linha que desliza para a esquerda (como no iPhone) e mostra Ficha e WhatsApp.
// Toque simples abre a conversa; com a linha aberta, um toque só fecha.
function LinhaDeslizante({ conversa: c, aberta, aoAbrir }: { conversa: Conversa; aberta: boolean; aoAbrir: (aberta: boolean) => void }) {
  const router = useRouter();
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const [arrasto, setArrasto] = useState<number | null>(null);
  const situacao = situacaoIa(c.ia_pausada, c.motivo_pausa);
  const nossa = c.ultimo_autor !== "cliente";
  const deslocamento = arrasto ?? (aberta ? -LARGURA_ACOES : 0);

  function tocar() {
    if (aberta) aoAbrir(false);
    else router.push(`/conversas/${c.cliente_id}`);
  }

  return (
    <li className="group relative overflow-hidden">
      {/* Atalhos atrás da linha; invisíveis com ela parada, para a cor não vazar pelos cantos do cartão */}
      <div className={`absolute inset-y-0 right-0 flex ${deslocamento === 0 ? "invisible" : ""}`} aria-hidden={!aberta}>
        <Link
          href={`/clientes/${c.cliente_id}`}
          tabIndex={aberta ? 0 : -1}
          className="flex w-[78px] flex-col items-center justify-center gap-1 bg-bronze-escuro text-xs font-semibold text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
          Ficha
        </Link>
        <button
          onClick={() => abrirWhatsApp(c.telefone)}
          tabIndex={aberta ? 0 : -1}
          className="flex w-[78px] flex-col items-center justify-center gap-1 bg-salvia-texto text-xs font-semibold text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
          WhatsApp
        </button>
      </div>

      <button
        onClick={tocar}
        onTouchStart={(e) => {
          inicio.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (!inicio.current) return;
          const dx = e.touches[0].clientX - inicio.current.x;
          const dy = e.touches[0].clientY - inicio.current.y;
          // Só arrasta quando o gesto é mais para o lado do que para baixo (senão é rolagem)
          if (arrasto === null && Math.abs(dx) < 8) return;
          if (arrasto === null && Math.abs(dy) > Math.abs(dx)) {
            inicio.current = null;
            return;
          }
          const base = aberta ? -LARGURA_ACOES : 0;
          setArrasto(Math.max(-LARGURA_ACOES - 20, Math.min(0, base + dx)));
        }}
        onTouchEnd={() => {
          if (arrasto !== null) aoAbrir(arrasto < -LARGURA_ACOES / 2);
          setArrasto(null);
          inicio.current = null;
        }}
        style={{ transform: `translateX(${deslocamento}px)` }}
        className={`relative flex w-full items-center gap-3 bg-card px-3.5 text-left active:bg-campo ${arrasto === null ? "transition-transform duration-200" : ""}`}
      >
        <AvatarComStatus id={c.cliente_id} nome={c.nome} situacao={situacao} tamanho="h-12 w-12 text-lg" />
        {/* O nome manda; a prévia fica numa linha só, em cinza, como no WhatsApp */}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 border-b-[0.5px] border-borda py-3 group-last:border-b-0">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[16px] font-semibold text-texto">{c.nome ?? formatarTelefone(c.telefone)}</span>
            <span className={`shrink-0 text-[12px] ${situacao === "precisa" ? "font-bold text-rose-texto" : "text-texto-2"}`}>
              {quando(c.ultima_mensagem_em)}
            </span>
          </span>
          <span className="flex min-w-0 items-center text-[14px] text-texto-2">
            {nossa && <Enviada />}
            <span className="truncate">
              {c.ultimo_autor === "ia" && <span className="text-bronze-escuro">IA: </span>}
              {c.ultimo_autor === "humano" && "Você: "}
              <Previa texto={c.ultima_mensagem} />
            </span>
          </span>
        </span>
      </button>
    </li>
  );
}

export default function ConversasPage() {
  const empresa = useEmpresa();
  const [resultado, setResultado] = useState<{ conversas: Conversa[] } | { erro: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  // Só uma linha aberta (deslizada) por vez, como no iPhone
  const [aberta, setAberta] = useState<string | null>(null);

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

  return (
    <>
      {/* Título grande no fundo claro, como no iPhone */}
      <header className="flex flex-col gap-2.5 px-4 pt-6">
        <div>
          <h1 className="font-serif text-[34px] leading-tight font-semibold">Conversas</h1>
          <p className="text-sm text-texto-2">
            {total.todas} {total.todas === 1 ? "conversa" : "conversas"}
            {total.precisa > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-rose-texto">
                  {total.precisa} {total.precisa === 1 ? "precisa" : "precisam"} de você
                </span>
              </>
            )}
          </p>
        </div>
        <label className="flex h-10 items-center gap-2 rounded-full bg-campo px-3.5">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8F8377" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">Pesquisar conversa</span>
          <input
            type="search"
            placeholder="Pesquisar"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#8F8377]"
          />
        </label>
      </header>

      {!resultado && <p className="px-4 pt-5 text-texto-2">Carregando…</p>}
      {resultado && "erro" in resultado && <p className="m-4 rounded-2xl bg-rose p-4 text-rose-texto">Erro ao ler as conversas: {resultado.erro}</p>}

      {/* Quem precisa de você, em bolinhas (como os stories do Instagram/Messenger) */}
      {precisam.length > 0 && !busca.trim() && (
        <section aria-label="Precisam de você" className="flex gap-3.5 overflow-x-auto px-4 pt-3.5 pb-1 [scrollbar-width:none]">
          {precisam.map((c) => (
            <Link key={c.cliente_id} href={`/conversas/${c.cliente_id}`} className="flex w-16 shrink-0 flex-col items-center gap-1.5 text-center text-xs text-rotulo">
              <span className="rounded-full bg-[conic-gradient(#8A3B2B,#A88A68,#8A3B2B)] p-[3px]">
                <span className="block rounded-full border-2 border-perola">
                  <Avatar id={c.cliente_id} nome={c.nome} tamanho="h-[54px] w-[54px] text-xl" />
                </span>
              </span>
              <span className="w-full truncate">{c.nome ? primeiroNome(c.nome) : formatarTelefone(c.telefone)}</span>
            </Link>
          ))}
        </section>
      )}

      {/* Seletor em cápsula, como no iOS 26: a bolha da opção escolhida desliza até a tocada,
          na mesma mola da barra de abas (bolha-aba) */}
      <div role="group" aria-label="Filtrar conversas" className="relative mx-4 mt-3 mb-1.5 grid grid-cols-3 rounded-full bg-campo p-1">
        <span
          aria-hidden
          className="bolha-aba pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full bg-card shadow-[0_1px_4px_rgba(30,23,20,0.15)]"
          style={{ transform: `translateX(${FILTROS.findIndex((f) => f.chave === filtro) * 100}%)` }}
        />
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            onClick={() => setFiltro(f.chave)}
            aria-pressed={filtro === f.chave}
            className={`relative h-10 rounded-full text-[13px] font-semibold transition-colors duration-300 active:scale-95 ${
              filtro === f.chave ? "text-grafite" : "text-rotulo"
            }`}
          >
            {f.rotulo}
            {total[f.chave] > 0 && f.chave !== "todas" && ` · ${total[f.chave]}`}
          </button>
        ))}
      </div>

      {resultado && "conversas" in resultado && (
        <section>
          {lista.length === 0 ? (
            <p className="mx-4 mt-6 text-center text-[15px] text-texto-2">
              {busca.trim() ? "Nenhuma conversa encontrada." : "Nenhuma conversa aqui."}
            </p>
          ) : (
            // As conversas num cartão, para os nomes não se perderem no fundo pérola
            <ul className="mx-4 mt-1.5 overflow-hidden rounded-[22px] bg-card borda-suave">
              {lista.map((c) => (
                <LinhaDeslizante
                  key={c.cliente_id}
                  conversa={c}
                  aberta={aberta === c.cliente_id}
                  aoAbrir={(abrir) => setAberta(abrir ? c.cliente_id : null)}
                />
              ))}
            </ul>
          )}
          {lista.length > 0 && <p className="px-4 pt-3 text-center text-xs text-texto-2">Deslize uma conversa para o lado para ver Ficha e WhatsApp.</p>}
        </section>
      )}
    </>
  );
}
