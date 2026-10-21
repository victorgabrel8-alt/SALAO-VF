"use client";

import Link from "next/link";
import { useState } from "react";
import { Etiquetas } from "@/components/Etiquetas";
import { montarMensagem, tipoDoAlo } from "@/lib/alo";
import { useEmpresa } from "@/lib/empresa";
import { formatarData, formatarHora, formatarTelefone, haQuantoTempo, hojeNoSalao, prazo } from "@/lib/formato";
import {
  ETAPAS,
  adicionarEtiqueta,
  etapaDe,
  moverCard,
  previa,
  proximaEtapa,
  useQuadro,
  type CardCliente,
  type Etapa,
} from "@/lib/quadro";
import { mudarStatus, type StatusManual } from "@/lib/statusManual";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

type Filtro = "todas" | "atrasadas" | "chegando" | "inativas" | "vip" | Etapa;

// O que acontece ao soltar um card no filtro: muda o status à mão (null = volta ao automático),
// põe uma etiqueta ou muda a etapa (o mesmo que soltar na coluna)
type AoSoltar =
  | { tipo: "status"; status: StatusManual | null; texto: string }
  | { tipo: "etiqueta"; etiqueta: string; texto: string }
  | { tipo: "etapa"; etapa: Etapa };

const temVip = (c: CardCliente) => c.etiquetas.some((e) => e.toLowerCase() === "vip");

const FILTROS: { chave: Filtro; rotulo: string; passa: (c: CardCliente) => boolean; aoSoltar: AoSoltar }[] = [
  {
    chave: "todas",
    rotulo: "Todas",
    passa: () => true,
    aoSoltar: { tipo: "status", status: null, texto: "voltar ao status automático" },
  },
  {
    chave: "atrasadas",
    rotulo: "Atrasadas",
    passa: (c) => c.status === "retorno_atrasado",
    aoSoltar: { tipo: "status", status: "retorno_atrasado", texto: "marcar como atrasada" },
  },
  {
    chave: "chegando",
    rotulo: "Retorno chegando",
    passa: (c) => c.status === "retorno_chegando",
    aoSoltar: { tipo: "status", status: "retorno_chegando", texto: "marcar como retorno chegando" },
  },
  {
    chave: "inativas",
    rotulo: "Inativas",
    passa: (c) => c.status === "inativa",
    aoSoltar: { tipo: "status", status: "inativa", texto: "marcar como inativa" },
  },
  { chave: "vip", rotulo: "VIP", passa: temVip, aoSoltar: { tipo: "etiqueta", etiqueta: "vip", texto: "marcar como VIP" } },
  ...ETAPAS.map((e) => ({
    chave: e.chave,
    rotulo: e.titulo,
    passa: (c: CardCliente) => etapaDe(c) === e.chave,
    aoSoltar: { tipo: "etapa", etapa: e.chave } as const,
  })),
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
  // Com status escolhido à mão a data pode não bater: aí o selo só diz o status
  if (c.status === "retorno_atrasado") {
    const vencido = c.retorno_previsto && c.retorno_previsto < hojeNoSalao();
    return {
      texto: vencido ? prazo(c.retorno_previsto!) : "atrasada",
      cor: "bg-orange-50 text-orange-700",
      ponto: "bg-orange-500",
    };
  }
  if (c.status === "retorno_chegando") {
    const futuro = c.retorno_previsto && c.retorno_previsto >= hojeNoSalao();
    return {
      texto: futuro ? `retorno ${prazo(c.retorno_previsto!)}` : "retorno chegando",
      cor: "bg-amber-50 text-amber-700",
      ponto: "bg-amber-400",
    };
  }
  if (c.status === "sem_visita") return { texto: "sem visita", cor: "bg-neutral-100 text-neutral-600", ponto: "bg-neutral-300" };
  return { texto: "em dia", cor: "bg-green-50 text-green-700", ponto: "bg-green-500" };
}

// Dentro da coluna: atrasadas (a mais atrasada primeiro), depois retorno chegando, depois inativas
const ORDEM_STATUS: Record<string, number> = { retorno_atrasado: 0, retorno_chegando: 1, inativa: 2 };
function porUrgencia(a: CardCliente, b: CardCliente): number {
  const s = (ORDEM_STATUS[a.status] ?? 3) - (ORDEM_STATUS[b.status] ?? 3);
  if (s !== 0) return s;
  // Em dia: por nome, para achar fácil
  if (ORDEM_STATUS[a.status] === undefined) return (a.nome ?? "￿").localeCompare(b.nome ?? "￿");
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
  // Atendimento marcado/desmarcado na Agenda do salão, horário novo da IA etc.: o quadro se atualiza sozinho
  useTempoReal(["agendamentos", "clientes"], empresa.id, () => setVersao((v) => v + 1));
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
    // Com horário marcado ela não precisa ser chamada: só pode ficar em "Agendado" ou "Em dia"
    if (card.proximo_agendamento && destino !== "agendado" && destino !== "em_dia") {
      setErro(
        `${card.nome ?? "A cliente"} tem horário marcado em ${formatarData(card.proximo_agendamento).slice(0, 5)}, ` +
          "então não precisa ser chamada. Para mudar, cancele ou remarque o horário na Agenda do salão.",
      );
      return;
    }
    const antes = card;
    // Mostra já na coluna nova; se o banco recusar, volta
    trocarCard(previa(card, destino));
    const r = await moverCard(empresa.id, card, destino, mensagem);
    if (r.erro || !r.card) {
      trocarCard(antes);
      setErro(`Não foi possível mover ${card.nome ?? "a cliente"}: ${r.erro}`);
      return;
    }
    setErro("");
    trocarCard(r.card);
  }

  // Card solto num filtro lá em cima (ver FILTROS)
  async function soltarNoFiltro(card: CardCliente, acao: AoSoltar) {
    if (acao.tipo === "etapa") return mover(card, acao.etapa);
    if (acao.tipo === "etiqueta" && temVip(card)) return;
    // Status à mão não vale para quem tem horário marcado (ver statusEfetivo)
    if (acao.tipo === "status" && acao.status && card.proximo_agendamento) {
      setErro(
        `${card.nome ?? "A cliente"} tem horário marcado em ${formatarData(card.proximo_agendamento).slice(0, 5)}, ` +
          "então fica em dia até o horário acontecer ou ser cancelado na Agenda do salão.",
      );
      return;
    }
    // Mostra a mudança já; depois recarrega com o que o banco gravou
    if (acao.tipo === "status" && acao.status) trocarCard({ ...card, status: acao.status });
    if (acao.tipo === "etiqueta") trocarCard({ ...card, etiquetas: [...card.etiquetas, acao.etiqueta] });
    const e =
      acao.tipo === "status" ? await mudarStatus(card.id, acao.status) : await adicionarEtiqueta(card.id, acao.etiqueta);
    if (e) trocarCard(card);
    setErro(e ? `Não foi possível ${acao.texto} (${card.nome ?? "cliente"}): ${e}` : "");
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
        {FILTROS.map((f, i) => {
          const alvo = `filtro-${f.chave}`;
          return (
            <span key={f.chave} className="contents">
              {/* Separa os filtros de status das etapas do quadro */}
              {i > 0 && FILTROS[i - 1].aoSoltar.tipo !== "etapa" && f.aoSoltar.tipo === "etapa" && (
                <span className="mx-1 self-center text-neutral-300" aria-hidden>
                  |
                </span>
              )}
              <button
                onClick={() => setFiltro(f.chave)}
                aria-pressed={filtro === f.chave}
                {...soltarEm(alvo, (c) => soltarNoFiltro(c, f.aoSoltar))}
                className={`h-10 rounded-full px-4 font-semibold transition ${
                  filtro === f.chave ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50"
                } ${arrastando ? "ring-2 ring-[var(--cor-principal)]/40 ring-offset-1" : ""} ${
                  sobre === alvo ? "scale-110 bg-[var(--cor-principal)] text-white" : ""
                }`}
              >
                {f.rotulo}{" "}
                <span className={sobre === alvo ? "font-normal" : "font-normal text-neutral-500"}>
                  {buscados.filter(f.passa).length}
                </span>
              </button>
            </span>
          );
        })}
      </div>
      <p className="mb-4 text-sm text-neutral-500">
        {arrastando
          ? `Solte ${arrastando.nome ?? "a cliente"} numa coluna ou em qualquer opção acima. Em “Todas”, ela volta ao status automático.`
          : "Arraste os cards entre as colunas ou para as opções acima, ou use a seta do card. Clique no card para escrever a mensagem."}
      </p>

      {erro && <p className="mb-4 rounded-xl bg-red-100 p-4 text-red-900">{erro}</p>}
      {quadro?.erro && <p className="mb-4 rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler o quadro: {quadro.erro}</p>}

      {/* "Para chamar" é a coluna mais cheia: ocupa duas larguras, com os cards lado a lado */}
      <div className="grid grid-cols-6 gap-4">
        {ETAPAS.map((etapa) => {
          const cards = visiveis.filter((c) => etapaDe(c) === etapa.chave);
          const larga = etapa.chave === "para_chamar";
          return (
            <section
              key={etapa.chave}
              {...soltarEm(etapa.chave, (c) => mover(c, etapa.chave))}
              className={`min-h-[60vh] rounded-2xl bg-neutral-200/60 p-3 transition ${larga ? "col-span-2" : ""} ${
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
              <div className={larga ? "grid grid-cols-2 items-start gap-3" : "space-y-3"}>
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
      <p className="font-bold leading-snug">{card.nome ?? "Sem nome"}</p>
      <p className="text-sm whitespace-nowrap text-neutral-500">{formatarTelefone(card.telefone)}</p>
      <span className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-medium ${s.cor}`}>
        <span className={`h-2 w-2 rounded-full ${s.ponto}`} />
        {s.texto}
      </span>
      <Etiquetas etiquetas={card.etiquetas} className="mt-2" />
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-neutral-100 pt-3">
        <span className="text-sm leading-tight text-neutral-600">{textoVisita(card)}</span>
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
