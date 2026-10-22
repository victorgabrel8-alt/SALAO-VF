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
  // da marca (cliente em branco, IA em grafite, você em bronze) e as ações numa bolha de vidro.
  return (
    // Fundo pérola com pontinhos bronze bem leves, como o papel de parede do WhatsApp
    <div className="-mt-[env(safe-area-inset-top)] min-h-dvh bg-[radial-gradient(rgb(168_138_104/0.16)_1px,transparent_1px)] [background-size:18px_18px]">
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
      <div className="px-4 py-4">
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
            <div key={m.id} className={mesmoAutor ? "pt-0.5" : "pt-2.5"}>
              {/* Separador de dia como no iMessage: o dia numa cápsula no meio */}
              {novoDia && (
                <p className="mx-auto my-3 w-fit rounded-full bg-card px-3 py-1 text-xs font-semibold text-texto-2 shadow-[0_1px_1.5px_rgba(30,23,20,0.1)]">
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

// Cada autor tem um balão com cor e lado próprios, inspirados no WhatsApp: a cliente num balão
// claro à esquerda e o salão (IA ou você) num balão forte à direita, que se destaca do fundo
const AUTOR: Record<
  Mensagem["autor"],
  { rotulo: string; lado: string; balao: string; rabo: string; canto: string; etiqueta: string; hora: string; enviada: boolean }
> = {
  cliente: {
    rotulo: "",
    lado: "justify-start",
    balao: "bg-white text-texto shadow-[0_1px_1.5px_rgba(30,23,20,0.13)]",
    rabo: "text-white -left-[7px]",
    canto: "rounded-tl-[4px]",
    etiqueta: "",
    hora: "text-texto-2",
    enviada: false,
  },
  ia: {
    rotulo: "IA",
    lado: "justify-end",
    balao: "bg-grafite text-perola shadow-[0_1px_1.5px_rgba(30,23,20,0.25)]",
    rabo: "text-grafite -right-[7px] -scale-x-100",
    canto: "rounded-tr-[4px]",
    etiqueta: "text-bronze",
    hora: "text-claro/80",
    enviada: true,
  },
  humano: {
    rotulo: "Você",
    lado: "justify-end",
    balao: "bg-bronze-escuro text-white shadow-[0_1px_1.5px_rgba(30,23,20,0.25)]",
    rabo: "text-bronze-escuro -right-[7px] -scale-x-100",
    canto: "rounded-tr-[4px]",
    etiqueta: "text-areia",
    hora: "text-white/75",
    enviada: true,
  },
};

function Balao({ mensagem: m, primeiro }: { mensagem: Mensagem; primeiro: boolean }) {
  const a = AUTOR[m.autor];
  const midia = m.tipo === "audio" ? "🎤 Áudio" : m.tipo === "imagem" ? "📷 Foto" : null;
  const texto = m.conteudo ?? (midia ? "" : "(mensagem sem texto)");
  return (
    <div className={`flex ${a.lado}`}>
      {/* O primeiro balão de cada sequência tem o "rabinho" no canto de cima, como no WhatsApp */}
      <div className={`relative max-w-[80%] rounded-[18px] px-3 pt-1.5 pb-2 ${a.balao} ${primeiro ? a.canto : ""}`}>
        {primeiro && (
          <svg viewBox="0 0 8 13" aria-hidden className={`absolute top-0 h-[13px] w-2 fill-current ${a.rabo}`}>
            <path d="M8 0H1.3C.3 0-.3 1.1.3 1.9L8 12Z" />
          </svg>
        )}
        {/* Quem respondeu: a IA ou a dona */}
        {a.rotulo && primeiro && <p className={`text-xs font-bold ${a.etiqueta}`}>{a.rotulo}</p>}
        {midia && <p className="text-xs font-semibold opacity-75">{midia}{m.conteudo && m.tipo === "audio" ? " · transcrição" : ""}</p>}
        <p className="text-[15px] leading-snug whitespace-pre-wrap">
          {texto}
          {/* Espaço reservado para a hora caber na última linha, como no WhatsApp */}
          <span aria-hidden className={`inline-block ${a.enviada ? "w-[62px]" : "w-[42px]"}`} />
        </p>
        <span className={`absolute right-2.5 bottom-1.5 flex items-center gap-0.5 text-[11px] leading-none ${a.hora}`}>
          {formatarHora(m.criado_em)}
          {a.enviada && (
            <svg width="16" height="11" viewBox="0 0 16 11" fill="none" stroke="#8DB4CF" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Enviada">
              <path d="m1 6 3 3 6-7.5" />
              <path d="m7.5 8 1 1 6-7.5" />
            </svg>
          )}
        </span>
      </div>
    </div>
  );
}
