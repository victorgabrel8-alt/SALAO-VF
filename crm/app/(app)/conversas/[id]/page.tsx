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
    <Suspense fallback={<p className="p-4 text-neutral-500">Carregando…</p>}>
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

  if (!conversa) return <p className="p-4 text-neutral-500">Carregando…</p>;
  if ("erro" in conversa) return <p className="m-4 rounded-xl bg-red-100 p-4 text-red-900">{conversa.erro}</p>;

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

  // Visual próprio do app: topo branco com a cliente e a situação da IA, fundo claro com
  // textura leve, balões por autor (cliente / IA / você) e as ações num cartão flutuante.
  return (
    <div className="-mt-[env(safe-area-inset-top)] min-h-dvh bg-[#f5f3f1] bg-[radial-gradient(#e6e1dc_1px,transparent_1px)] [background-size:18px_18px] pt-[env(safe-area-inset-top)]">
      <header className="sticky top-0 z-10 flex items-center gap-2 bg-white/95 px-2 py-2 shadow-sm backdrop-blur">
        <Link
          href="/conversas"
          aria-label="Voltar para Conversas"
          className="flex h-11 w-9 shrink-0 items-center justify-center text-3xl text-[var(--cor-principal)]"
        >
          ‹
        </Link>
        <Link href={`/clientes/${cliente.id}`} className="flex min-w-0 flex-1 items-center gap-3">
          <span className="relative shrink-0">
            <Avatar id={cliente.id} nome={cliente.nome} tamanho="h-11 w-11 text-base" />
            <span className={`absolute -right-0.5 -bottom-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${selo.ponto}`} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[17px] leading-tight font-semibold">
              {cliente.nome ?? formatarTelefone(cliente.telefone)}
            </p>
            <p className="truncate text-xs text-neutral-500">
              {selo.rotulo}
              {pausaAte && ` · ${pausaAte}`}
            </p>
          </div>
        </Link>
        <Link
          href={`/clientes/${cliente.id}`}
          className="flex h-9 shrink-0 items-center rounded-full border border-neutral-200 px-3 text-sm font-semibold text-neutral-700 active:bg-neutral-100"
        >
          Ficha
        </Link>
      </header>

      {/* Só leitura: o app não envia mensagem; a dona responde pelo WhatsApp Business */}
      <div className="space-y-1 px-3 py-4">
        {/* Etiquetas e aviso no começo, como um "cartão" da cliente */}
        {cliente.etiquetas.length > 0 && <Etiquetas etiquetas={cliente.etiquetas} className="mb-3 justify-center" />}
        {situacao === "precisa" && cliente.motivo_pausa && (
          <div className="mx-auto mb-3 flex max-w-[92%] items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <span aria-hidden>⚠️</span>
            <p>
              <strong>{MOTIVOS_PRECISA[cliente.motivo_pausa]}.</strong> A IA parou de responder — responda pelo WhatsApp.
            </p>
          </div>
        )}
        {mensagens.length === 0 && (
          <p className="mx-auto w-fit rounded-full bg-white px-4 py-1.5 text-sm text-neutral-500 shadow-sm">
            Nenhuma mensagem ainda.
          </p>
        )}
        {mensagens.map((m, i) => {
          const dia = dataNoSalao(m.criado_em);
          const novoDia = i === 0 || dataNoSalao(mensagens[i - 1].criado_em) !== dia;
          const mesmoAutor = i > 0 && !novoDia && mensagens[i - 1].autor === m.autor;
          return (
            <div key={m.id} className={mesmoAutor ? "" : "pt-2"}>
              {novoDia && (
                <div className="my-3 flex items-center gap-3 px-6">
                  <span className="h-px flex-1 bg-neutral-300/70" />
                  <span className="text-xs font-semibold text-neutral-500">
                    {dia === hojeNoSalao() ? "Hoje" : formatarDiaLongo(dia)}
                  </span>
                  <span className="h-px flex-1 bg-neutral-300/70" />
                </div>
              )}
              <Balao mensagem={m} primeiro={!mesmoAutor} />
            </div>
          );
        })}
        <div ref={fim} className="h-28" />
      </div>

      {/* Ações num cartão flutuante acima da barra de abas */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.5rem)] z-10 mx-auto max-w-xl px-3">
        <div className="flex gap-2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-lg">
          <button
            onClick={alternarIa}
            disabled={salvando}
            className={`h-12 shrink-0 rounded-xl px-4 font-semibold disabled:opacity-50 ${
              cliente.ia_pausada ? "bg-violet-50 text-violet-700 active:bg-violet-100" : "bg-neutral-100 text-neutral-700 active:bg-neutral-200"
            }`}
          >
            {cliente.ia_pausada ? "▶ Reativar IA" : "⏸ Pausar IA"}
          </button>
          <button
            onClick={() => abrirWhatsApp(cliente.telefone)}
            className="h-12 flex-1 rounded-xl bg-emerald-600 font-semibold text-white active:bg-emerald-700"
          >
            Responder no WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}

// Cada autor tem um balão com cor e lado próprios
const AUTOR: Record<Mensagem["autor"], { rotulo: string; lado: string; balao: string; canto: string; etiqueta: string }> = {
  cliente: {
    rotulo: "",
    lado: "justify-start",
    balao: "bg-white text-neutral-900",
    canto: "rounded-bl-md",
    etiqueta: "",
  },
  ia: {
    rotulo: "✨ IA",
    lado: "justify-end",
    balao: "border border-violet-100 bg-violet-50 text-neutral-900",
    canto: "rounded-br-md",
    etiqueta: "text-violet-600",
  },
  humano: {
    rotulo: "Você",
    lado: "justify-end",
    balao: "chip-ativo text-neutral-900",
    canto: "rounded-br-md",
    etiqueta: "text-[var(--cor-principal)]",
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
      <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 shadow-sm ${a.balao} ${primeiro ? a.canto : ""}`}>
        {/* Quem respondeu: a IA ou a dona */}
        {a.rotulo && primeiro && <p className={`mb-0.5 text-xs font-bold ${a.etiqueta}`}>{a.rotulo}</p>}
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{texto}</p>
        <p className="mt-0.5 text-right text-[11px] text-neutral-400">{formatarHora(m.criado_em)}</p>
      </div>
    </div>
  );
}
