"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Etiquetas } from "@/components/Etiquetas";
import { useEmpresa } from "@/lib/empresa";
import { dataNoSalao, formatarDiaLongo, formatarHora, formatarTelefone, hojeNoSalao } from "@/lib/formato";
import { MOTIVOS_PRECISA, SELO_IA, pausarOuReativarIa, situacaoIa } from "@/lib/ia";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

type Cliente = {
  id: string;
  nome: string | null;
  telefone: string;
  etiquetas: string[];
  ia_pausada: boolean;
  ia_pausada_ate: string | null;
  motivo_pausa: string | null;
};

type Mensagem = {
  id: string;
  autor: "cliente" | "ia" | "humano";
  tipo: "texto" | "audio" | "imagem" | "outro";
  conteudo: string | null;
  criado_em: string;
};

type Conversa = { cliente: Cliente; mensagens: Mensagem[] } | { erro: string };

async function buscarConversa(clienteId: string): Promise<Conversa> {
  const db = supabase();
  const [cliente, mensagens] = await Promise.all([
    db
      .from("clientes_status")
      .select("id, nome, telefone, etiquetas, ia_pausada, ia_pausada_ate, motivo_pausa")
      .eq("id", clienteId)
      .maybeSingle(),
    // As últimas 300 mensagens, em ordem de envio
    db
      .from("mensagens")
      .select("id, autor, tipo, conteudo, criado_em")
      .eq("cliente_id", clienteId)
      .order("criado_em", { ascending: false })
      .limit(300),
  ]);
  if (cliente.error) return { erro: cliente.error.message };
  if (mensagens.error) return { erro: mensagens.error.message };
  if (!cliente.data) return { erro: "Cliente não encontrada." };
  return { cliente: cliente.data as Cliente, mensagens: (mensagens.data as Mensagem[]).reverse() };
}

export default function ConversaPage() {
  return (
    <Suspense fallback={<p className="p-4 text-texto-2">Carregando…</p>}>
      <ConversaCliente />
    </Suspense>
  );
}

function ConversaCliente() {
  const { id } = useParams<{ id: string }>();
  const empresa = useEmpresa();
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [versao, setVersao] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const fim = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ativo = true;
    buscarConversa(id).then((r) => {
      if (ativo) setConversa(r);
    });
    return () => {
      ativo = false;
    };
  }, [id, versao]);

  // Mensagem nova chega na hora, sem recarregar
  useTempoReal(["mensagens", "clientes"], empresa.id, () => setVersao((v) => v + 1));

  // Sempre mostra a mensagem mais recente
  const total = conversa && "mensagens" in conversa ? conversa.mensagens.length : 0;
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [total]);

  if (!conversa) return <p className="p-4 text-texto-2">Carregando…</p>;
  if ("erro" in conversa) return <p className="m-4 rounded-2xl bg-rose p-4 text-rose-texto">{conversa.erro}</p>;

  const { cliente, mensagens } = conversa;
  const situacao = situacaoIa(cliente.ia_pausada, cliente.motivo_pausa);
  const selo = SELO_IA[situacao];

  async function alternarIa() {
    setSalvando(true);
    await pausarOuReativarIa(cliente.id, !cliente.ia_pausada);
    setSalvando(false);
    setVersao((v) => v + 1);
  }

  const pausaAte =
    cliente.ia_pausada && cliente.ia_pausada_ate
      ? `até ${dataNoSalao(cliente.ia_pausada_ate) === hojeNoSalao() ? "hoje" : "amanhã"} às ${formatarHora(cliente.ia_pausada_ate)}`
      : "";

  // Visual do app: fundo pérola, topo de vidro com a cliente e a situação da IA, balões nas cores
  // da marca (cliente em creme, IA em areia, você em grafite) e as ações numa bolha de vidro.
  return (
    <div className="-mt-[env(safe-area-inset-top)] min-h-dvh">
      <header className="vidro-barra sticky top-0 z-10 pt-[env(safe-area-inset-top)]">
        <div className="flex items-center gap-2 px-3 py-2">
          <Link href="/conversas" aria-label="Voltar para Conversas" className="vidro flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:scale-95">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
          <Link href={`/clientes/${cliente.id}`} className="flex min-w-0 flex-1 items-center gap-2.5">
            <span className="relative shrink-0">
              <Avatar id={cliente.id} nome={cliente.nome} tamanho="h-10 w-10 text-base" />
              <span className={`absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-perola ${selo.ponto}`} />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[17px] leading-tight font-semibold">{cliente.nome ?? formatarTelefone(cliente.telefone)}</p>
              <p className="truncate text-xs text-texto-2">
                {selo.rotulo}
                {pausaAte && ` · ${pausaAte}`}
              </p>
            </div>
          </Link>
          <Link href={`/clientes/${cliente.id}`} className="vidro flex h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold active:scale-95">
            Ficha
          </Link>
        </div>
      </header>

      {/* Só leitura: o app não envia mensagem; a dona responde pelo WhatsApp Business */}
      <div className="space-y-1 px-3 py-4">
        {/* Etiquetas e aviso no começo, como um "cartão" da cliente */}
        {cliente.etiquetas.length > 0 && <Etiquetas etiquetas={cliente.etiquetas} className="mb-3 justify-center" />}
        {situacao === "precisa" && cliente.motivo_pausa && (
          <div className="mx-auto mb-3 max-w-[92%] rounded-[18px] bg-rose px-3.5 py-2.5 text-sm text-rose-texto">
            <strong>{MOTIVOS_PRECISA[cliente.motivo_pausa]}.</strong> A IA parou de responder — responda pelo WhatsApp.
          </div>
        )}
        {mensagens.length === 0 && <p className="mx-auto w-fit rounded-full bg-card px-4 py-1.5 text-sm text-texto-2">Nenhuma mensagem ainda.</p>}
        {mensagens.map((m, i) => {
          const dia = dataNoSalao(m.criado_em);
          const novoDia = i === 0 || dataNoSalao(mensagens[i - 1].criado_em) !== dia;
          const mesmoAutor = i > 0 && !novoDia && mensagens[i - 1].autor === m.autor;
          return (
            <div key={m.id} className={mesmoAutor ? "" : "pt-2"}>
              {/* Separador de dia como no iMessage: o dia numa cápsula no meio */}
              {novoDia && (
                <p className="mx-auto my-3 w-fit rounded-full bg-campo px-3 py-1 text-xs font-semibold text-texto-2">
                  {dia === hojeNoSalao() ? "Hoje" : formatarDiaLongo(dia)}
                </p>
              )}
              <Balao mensagem={m} primeiro={!mesmoAutor} />
            </div>
          );
        })}
        <div ref={fim} className="h-36" />
      </div>

      {/* Ações numa bolha de vidro, acima da barra de abas (70px + 20px de folga) */}
      <div className="fixed inset-x-0 bottom-[calc(100px+env(safe-area-inset-bottom))] z-10 mx-auto max-w-xl px-4">
        <div className="vidro flex gap-2 rounded-full p-1.5">
          <button
            onClick={alternarIa}
            disabled={salvando}
            className={`h-11 shrink-0 rounded-full px-4 text-[15px] font-semibold disabled:opacity-50 ${
              cliente.ia_pausada ? "bg-ouro text-ouro-texto" : "bg-campo text-texto"
            }`}
          >
            {cliente.ia_pausada ? "▶ Reativar IA" : "⏸ Pausar IA"}
          </button>
          <button
            onClick={() => abrirWhatsApp(cliente.telefone)}
            className="h-11 flex-1 rounded-full bg-salvia-texto text-[15px] font-semibold text-white active:opacity-90"
          >
            Responder no WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

// Cada autor tem um balão com cor e lado próprios, na paleta do app
const AUTOR: Record<Mensagem["autor"], { rotulo: string; lado: string; balao: string; canto: string; etiqueta: string; hora: string }> = {
  cliente: {
    rotulo: "",
    lado: "justify-start",
    balao: "bg-card text-texto shadow-[0_1px_2px_rgba(30,23,20,0.06)]",
    canto: "rounded-bl-md",
    etiqueta: "",
    hora: "text-texto-2/70",
  },
  ia: {
    rotulo: "IA",
    lado: "justify-end",
    balao: "bg-areia text-texto",
    canto: "rounded-br-md",
    etiqueta: "text-bronze-escuro",
    hora: "text-texto-2/70",
  },
  humano: {
    rotulo: "Você",
    lado: "justify-end",
    balao: "bg-grafite text-perola",
    canto: "rounded-br-md",
    etiqueta: "text-bronze",
    hora: "text-claro/70",
  },
};

function Balao({ mensagem: m, primeiro }: { mensagem: Mensagem; primeiro: boolean }) {
  const a = AUTOR[m.autor];
  const texto =
    m.tipo === "audio"
      ? `🎤 Áudio${m.conteudo ? `: ${m.conteudo}` : ""}`
      : m.tipo === "imagem"
        ? `📷 Imagem${m.conteudo ? `: ${m.conteudo}` : ""}`
        : (m.conteudo ?? "(mensagem sem texto)");
  return (
    <div className={`flex ${a.lado}`}>
      <div className={`max-w-[80%] rounded-[20px] px-3.5 py-2 ${a.balao} ${primeiro ? a.canto : ""}`}>
        {/* Quem respondeu: a IA ou a dona */}
        {a.rotulo && primeiro && <p className={`mb-0.5 text-xs font-bold ${a.etiqueta}`}>{a.rotulo}</p>}
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{texto}</p>
        <p className={`mt-0.5 text-right text-[11px] ${a.hora}`}>{formatarHora(m.criado_em)}</p>
      </div>
    </div>
  );
}
