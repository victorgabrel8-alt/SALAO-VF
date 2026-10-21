"use client";

import Link from "next/link";
import { useState } from "react";
import { Etiquetas } from "@/components/Etiquetas";
import { montarMensagem, tipoDoAlo } from "@/lib/alo";
import { useEmpresa } from "@/lib/empresa";
import { formatarData, formatarHora, formatarTelefone, haQuantoTempo, prazo } from "@/lib/formato";
import { ETAPAS, RESULTADO, etapaDe, moverCard, proximaEtapa, useQuadro, type CardCliente, type Etapa } from "@/lib/quadro";
import { mudarStatus } from "@/lib/statusManual";
import { abrirWhatsApp } from "@/lib/whatsapp";

type Filtro = "todas" | "atrasadas" | "chegando" | "inativas" | "vip";

const FILTROS: { chave: Filtro; rotulo: string; passa: (c: CardCliente) => boolean }[] = [
  { chave: "todas", rotulo: "Todas", passa: () => true },
  { chave: "atrasadas", rotulo: "Atrasadas", passa: (c) => c.status === "retorno_atrasado" },
  { chave: "chegando", rotulo: "Retorno chegando", passa: (c) => c.status === "retorno_chegando" },
  { chave: "inativas", rotulo: "Inativas", passa: (c) => c.status === "inativa" },
  { chave: "vip", rotulo: "VIP", passa: (c) => c.etiquetas.some((e) => e.toLowerCase() === "vip") },
];

// Selo do card: o que mais importa sobre o retorno dela
function selo(c: CardCliente): { texto: string; cor: string; ponto: string } {
  if (c.proximo_agendamento) {
    const hora = formatarHora(c.proximo_agendamento).replace(":00", "h");
    return {
      texto: `marcado ${formatarData(c.proximo_agendamento).slice(0, 5)} ${hora}`,
      cor: "bg-green-50 text-green-700",
      ponto: "bg-green-500",
    };
  }
  if (c.status === "inativa") {
    const dias = c.dias_sem_visita ?? 0;
    const meses = Math.floor(dias / 30);
    return {
      texto: `inativa ${meses >= 2 ? `${meses} meses` : `${dias} dias`}`,
      cor: "bg-neutral-100 text-neutral-600",
      ponto: "bg-neutral-400",
    };
  }
  if (c.status === "retorno_atrasado" && c.retorno_previsto)
    return { texto: prazo(c.retorno_previsto), cor: "bg-orange-50 text-orange-700", ponto: "bg-orange-500" };
  if (c.status === "retorno_chegando" && c.retorno_previsto)
    return { texto: `retorno ${prazo(c.retorno_previsto)}`, cor: "bg-amber-50 text-amber-700", ponto: "bg-amber-400" };
  return { texto: "em dia", cor: "bg-green-50 text-green-700", ponto: "bg-green-500" };
}

// Dentro da coluna: atrasadas (a mais atrasada primeiro), depois retorno chegando, depois inativas
const ORDEM_STATUS: Record<string, number> = { retorno_atrasado: 0, retorno_chegando: 1, inativa: 2 };
function porUrgencia(a: CardCliente, b: CardCliente): number {
  const s = (ORDEM_STATUS[a.status] ?? 3) - (ORDEM_STATUS[b.status] ?? 3);
  if (s !== 0) return s;
  return (a.retorno_previsto ?? "9999").localeCompare(b.retorno_previsto ?? "9999");
}

function textoVisita(c: CardCliente): string {
  if (!c.ultima_visita) return "Nunca veio ao salão";
  return `Última visita ${haQuantoTempo(c.ultima_visita)}`;
}

// Quadro de retorno: arrastar o card entre as colunas (ou usar a seta) muda a etapa;
// clicar no card abre a mensagem para mandar pelo WhatsApp.
export function QuadroRetorno({ busca }: { busca: string }) {
  const empresa = useEmpresa();
  const [versao, setVersao] = useState(0);
  const { quadro, trocarCard } = useQuadro(empresa.id, versao);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [arrastando, setArrastando] = useState<CardCliente | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const [escrevendo, setEscrevendo] = useState<CardCliente | null>(null);
  const [erro, setErro] = useState("");

  const termo = busca.trim().toLowerCase();
  const digitos = busca.replace(/\D/g, "");
  const buscados = (quadro?.cards ?? []).filter(
    (c) =>
      !termo ||
      (c.nome ?? "").toLowerCase().includes(termo) ||
      (digitos.length >= 3 && c.telefone.includes(digitos)),
  );
  const passa = FILTROS.find((f) => f.chave === filtro)!.passa;
  const visiveis = buscados.filter(passa).sort(porUrgencia);

  async function mover(card: CardCliente, destino: Etapa, mensagem?: string) {
    if (etapaDe(card) === destino && !mensagem) return;
    const antes = card;
    // Mostra já na coluna nova; se o banco recusar, volta
    trocarCard({
      ...card,
      contato: { id: card.contato?.id ?? "novo", criado_em: card.contato?.criado_em ?? "", resultado: RESULTADO[destino] },
    });
    const r = await moverCard(empresa.id, card, destino, mensagem);
    if (r.erro || !r.card) {
      trocarCard(antes);
      setErro(`Não foi possível mover ${card.nome ?? "a cliente"}: ${r.erro}`);
      return;
    }
    setErro("");
    trocarCard(r.card);
  }

  // Soltar no filtro "Inativas" marca a cliente como inativa à mão (supabase/004_status_manual.sql)
  async function marcarInativa(card: CardCliente) {
    const e = await mudarStatus(card.id, "inativa");
    setErro(e ? `Não foi possível marcar ${card.nome ?? "a cliente"} como inativa: ${e}` : "");
    if (!e) setVersao((v) => v + 1);
  }

  function soltarEm(chave: string, acao: (c: CardCliente) => void) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!arrastando) return;
        e.preventDefault();
        setSobre(chave);
      },
      onDragLeave: () => setSobre((s) => (s === chave ? null : s)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const c = arrastando;
        setArrastando(null);
        setSobre(null);
        if (c) acao(c);
      },
    };
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap gap-2">
        {FILTROS.map((f) => {
          const aceita = f.chave === "inativas" && arrastando !== null;
          return (
            <button
              key={f.chave}
              onClick={() => setFiltro(f.chave)}
              aria-pressed={filtro === f.chave}
              {...(f.chave === "inativas" ? soltarEm("filtro-inativas", marcarInativa) : {})}
              className={`h-10 rounded-full px-4 font-semibold transition ${
                filtro === f.chave ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50"
              } ${aceita ? "ring-2 ring-[var(--cor-principal)] ring-offset-2" : ""} ${
                sobre === "filtro-inativas" && f.chave === "inativas" ? "scale-110" : ""
              }`}
            >
              {f.rotulo} <span className="font-normal text-neutral-500">{buscados.filter(f.passa).length}</span>
            </button>
          );
        })}
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        Arraste os cards entre as colunas, ou use a seta do card. Clique no card para escrever a mensagem.
        {arrastando && " Solte em Inativas para marcar a cliente como inativa."}
      </p>

      {erro && <p className="mb-4 rounded-xl bg-red-100 p-4 text-red-900">{erro}</p>}
      {quadro?.erro && <p className="mb-4 rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler o quadro: {quadro.erro}</p>}

      <div className="grid grid-cols-4 gap-4">
        {ETAPAS.map((etapa) => {
          const cards = visiveis.filter((c) => etapaDe(c) === etapa.chave);
          return (
            <section
              key={etapa.chave}
              {...soltarEm(etapa.chave, (c) => mover(c, etapa.chave))}
              className={`min-h-[60vh] rounded-2xl bg-neutral-200/60 p-3 transition ${
                sobre === etapa.chave ? "bg-[color-mix(in_srgb,var(--cor-principal)_14%,white)] ring-2 ring-[var(--cor-principal)]" : ""
              }`}
            >
              <header className="mb-3 flex items-center justify-between px-1 pt-1">
                <h2 className="flex items-center gap-2 font-bold">
                  <span className={`h-2.5 w-2.5 rounded-full ${etapa.ponto}`} />
                  {etapa.titulo}
                </h2>
                <span className="rounded-full bg-white px-2.5 py-0.5 text-sm font-semibold text-neutral-700">
                  {quadro ? cards.length : "…"}
                </span>
              </header>
              <div className="space-y-3">
                {!quadro && <p className="px-1 text-sm text-neutral-500">Carregando…</p>}
                {cards.map((c) => (
                  <Card
                    key={c.id}
                    card={c}
                    arrastado={arrastando?.id === c.id}
                    aoArrastar={() => setArrastando(c)}
                    aoSoltar={() => {
                      setArrastando(null);
                      setSobre(null);
                    }}
                    aoAbrir={() => setEscrevendo(c)}
                    aoAvancar={() => {
                      const prox = proximaEtapa(etapaDe(c));
                      if (prox) mover(c, prox);
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {escrevendo && (
        <Mensagem
          card={escrevendo}
          config={empresa.config}
          aoFechar={() => setEscrevendo(null)}
          aoEnviar={(texto) => {
            abrirWhatsApp(escrevendo.telefone, texto);
            mover(escrevendo, "enviada", texto);
            setEscrevendo(null);
          }}
        />
      )}
    </>
  );
}

function Card({
  card,
  arrastado,
  aoArrastar,
  aoSoltar,
  aoAbrir,
  aoAvancar,
}: {
  card: CardCliente;
  arrastado: boolean;
  aoArrastar: () => void;
  aoSoltar: () => void;
  aoAbrir: () => void;
  aoAvancar: () => void;
}) {
  const s = selo(card);
  const temProxima = proximaEtapa(etapaDe(card)) !== null;
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        aoArrastar();
      }}
      onDragEnd={aoSoltar}
      onClick={aoAbrir}
      className={`cursor-grab rounded-xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:shadow-md active:cursor-grabbing ${
        arrastado ? "opacity-40" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold leading-snug">{card.nome ?? "Sem nome"}</p>
          <p className="text-sm text-neutral-500">{formatarTelefone(card.telefone)}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium ${s.cor}`}>
          <span className={`h-2 w-2 rounded-full ${s.ponto}`} />
          {s.texto}
        </span>
      </div>
      <Etiquetas etiquetas={card.etiquetas} className="mt-2" />
      <div className="mt-3 flex items-center justify-between border-t border-neutral-100 pt-3">
        <span className="text-sm text-neutral-600">{textoVisita(card)}</span>
        {temProxima && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              aoAvancar();
            }}
            aria-label="Passar para a próxima coluna"
            title="Passar para a próxima coluna"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-neutral-200 text-[var(--cor-principal)] hover:bg-neutral-50"
          >
            →
          </button>
        )}
      </div>
    </article>
  );
}

// Mensagem do alô: já vem escrita com o modelo do salão e dá para mudar antes de mandar
function Mensagem({
  card,
  config,
  aoFechar,
  aoEnviar,
}: {
  card: CardCliente;
  config: Record<string, unknown>;
  aoFechar: () => void;
  aoEnviar: (texto: string) => void;
}) {
  const [texto, setTexto] = useState(() => montarMensagem(config, tipoDoAlo(card.status), card.nome, card.servico));
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={aoFechar}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg space-y-4 rounded-3xl bg-white p-6"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">{card.nome ?? "Sem nome"}</h2>
            <p className="text-neutral-500">{formatarTelefone(card.telefone)}</p>
          </div>
          <Link href={`/clientes/${card.id}`} className="text-sm font-semibold text-[var(--cor-principal)] hover:underline">
            Ver ficha
          </Link>
        </div>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={5}
          className="w-full rounded-xl border border-neutral-300 p-3 outline-none focus:border-[var(--cor-principal)]"
        />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={aoFechar} className="h-12 rounded-xl border border-neutral-300 font-semibold hover:bg-neutral-50">
            Voltar
          </button>
          <button
            onClick={() => aoEnviar(texto.trim())}
            disabled={!texto.trim()}
            className="h-12 rounded-xl bg-[var(--cor-principal)] font-bold text-white disabled:opacity-50"
          >
            Abrir no WhatsApp
          </button>
        </div>
        <p className="text-sm text-neutral-500">Ao abrir o WhatsApp, o card vai para “Mensagem enviada”.</p>
      </div>
    </div>
  );
}
