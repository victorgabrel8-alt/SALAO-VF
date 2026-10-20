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

  // Visual inspirado no WhatsApp: barra de cima com foto e nome, fundo bege,
  // balões brancos (cliente) e verdes (IA / você), e uma barra de baixo com as ações.
  return (
    <div className="-mt-[env(safe-area-inset-top)] min-h-dvh bg-[#efeae2] pt-[env(safe-area-inset-top)]">
      <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-200 bg-[#f6f6f6] px-2 py-2">
        <Link
          href="/conversas"
          aria-label="Voltar para Conversas"
          className="flex h-11 w-9 shrink-0 items-center justify-center text-3xl text-[#1da851]"
        >
          ‹
        </Link>
        <Link href={`/clientes/${cliente.id}`} className="flex min-w-0 flex-1 items-center gap-2">
          <Avatar id={cliente.id} nome={cliente.nome} tamanho="h-10 w-10 text-base" />
          <div className="min-w-0">
            <p className="truncate text-[17px] leading-tight font-semibold">
              {cliente.nome ?? formatarTelefone(cliente.telefone)}
            </p>
            <p className="flex items-center gap-1 truncate text-xs text-neutral-500">
              <span className={`h-2 w-2 shrink-0 rounded-full ${selo.ponto}`} />
              {selo.rotulo}
              {pausaAte && ` · ${pausaAte}`}
            </p>
          </div>
        </Link>
        <Link
          href={`/clientes/${cliente.id}`}
          className="flex h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-[#1da851] active:bg-neutral-200"
        >
          Ficha
        </Link>
      </header>

      {/* Só leitura: o app não envia mensagem; a dona responde pelo WhatsApp Business */}
      <div className="space-y-1.5 px-3 py-3">
        <Etiquetas etiquetas={cliente.etiquetas} className="mb-2 justify-center" />
        {situacao === "precisa" && cliente.motivo_pausa && (
          <p className="mx-auto mb-2 w-fit max-w-[90%] rounded-lg bg-[#fff3c4] px-3 py-1.5 text-center text-sm text-neutral-800 shadow-sm">
            ⚠️ {MOTIVOS_PRECISA[cliente.motivo_pausa]}. A IA parou de responder.
          </p>
        )}
        {mensagens.length === 0 && (
          <p className="mx-auto w-fit rounded-lg bg-white px-3 py-1.5 text-sm text-neutral-500 shadow-sm">
            Nenhuma mensagem ainda.
          </p>
        )}
        {mensagens.map((m, i) => {
          const dia = dataNoSalao(m.criado_em);
          const novoDia = i === 0 || dataNoSalao(mensagens[i - 1].criado_em) !== dia;
          const mesmoAutor = i > 0 && !novoDia && mensagens[i - 1].autor === m.autor;
          return (
            <div key={m.id} className={mesmoAutor ? "" : "pt-1.5"}>
              {novoDia && (
                <p className="mx-auto my-3 w-fit rounded-lg bg-white px-3 py-1 text-xs font-medium text-neutral-600 shadow-sm">
                  {dia === hojeNoSalao() ? "Hoje" : formatarDiaLongo(dia)}
                </p>
              )}
              <Balao mensagem={m} comPonta={!mesmoAutor} />
            </div>
          );
        })}
        <div ref={fim} className="h-20" />
      </div>

      {/* Barra de baixo (no lugar do campo de digitar do WhatsApp) */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 mx-auto flex max-w-xl gap-2 bg-[#f6f6f6] px-3 py-2">
        <button
          onClick={alternarIa}
          disabled={salvando}
          className="h-11 shrink-0 rounded-full border border-neutral-300 bg-white px-4 font-semibold active:bg-neutral-100 disabled:opacity-50"
        >
          {cliente.ia_pausada ? "Reativar IA" : "Pausar IA"}
        </button>
        <button
          onClick={() => abrirWhatsApp(cliente.telefone)}
          className="h-11 flex-1 rounded-full bg-[#1da851] font-semibold text-white active:bg-[#178a43]"
        >
          Responder no WhatsApp
        </button>
      </div>
    </div>
  );
}

const AUTOR: Record<Mensagem["autor"], { rotulo: string; lado: string; balao: string; ponta: string }> = {
  cliente: { rotulo: "Cliente", lado: "justify-start", balao: "bg-white", ponta: "rounded-tl-none" },
  ia: { rotulo: "IA", lado: "justify-end", balao: "bg-[#d9fdd3]", ponta: "rounded-tr-none" },
  humano: { rotulo: "Você", lado: "justify-end", balao: "bg-[#d9fdd3]", ponta: "rounded-tr-none" },
};

function Balao({ mensagem: m, comPonta }: { mensagem: Mensagem; comPonta: boolean }) {
  const a = AUTOR[m.autor];
  const texto =
    m.tipo === "audio"
      ? `🎤 Áudio${m.conteudo ? `: ${m.conteudo}` : ""}`
      : m.tipo === "imagem"
        ? `📷 Imagem${m.conteudo ? `: ${m.conteudo}` : ""}`
        : (m.conteudo ?? "(mensagem sem texto)");
  return (
    <div className={`flex ${a.lado}`}>
      <div className={`max-w-[82%] rounded-lg px-2.5 pt-1.5 pb-1 shadow-sm ${a.balao} ${comPonta ? a.ponta : ""}`}>
        {/* Quem respondeu: a IA ou a dona */}
        {m.autor !== "cliente" && comPonta && (
          <p className={`text-xs font-semibold ${m.autor === "ia" ? "text-violet-600" : "text-[#1da851]"}`}>{a.rotulo}</p>
        )}
        <p className="text-[15px] leading-snug whitespace-pre-wrap text-neutral-900">
          {texto}
          {/* Espaço para a hora caber na última linha, como no WhatsApp */}
          <span className="inline-block w-14" />
        </p>
        <p className="-mt-4 text-right text-[11px] text-neutral-500">
          {formatarHora(m.criado_em)}
          {m.autor !== "cliente" && <span className="ml-1 text-sky-500">✓✓</span>}
        </p>
      </div>
    </div>
  );
}
