"use client";

import Link from "next/link";
import { useState } from "react";
import { Etiquetas } from "@/components/Etiquetas";
import { Aviso, Folha, Rotulo, botao, botaoForte, opcao, type Tom, TONS } from "@/components/Pecas";
import { montarMensagem, tipoDoAlo } from "@/lib/alo";
import { useEmpresa } from "@/lib/empresa";
import { formatarData, formatarHora, formatarTelefone, haQuantoTempo, hojeNoSalao, prazo } from "@/lib/formato";
import {
  ETAPAS,
  adicionarEtiqueta,
  etapaDe,
  faltaEnviar,
  moverCard,
  previa,
  proximaEtapa,
  type CardCliente,
  type Etapa,
} from "@/lib/quadro";
import { mudarStatus, type StatusManual } from "@/lib/statusManual";
import { abrirWhatsApp } from "@/lib/whatsapp";

type Filtro = "todas" | "atrasadas" | "chegando" | "inativas" | "vip" | Etapa;

// O que acontece ao soltar um card no filtro: muda o status à mão (null = volta ao automático),
// põe uma etiqueta ou muda a etapa (o mesmo que soltar na coluna)
type AoSoltar =
  | { tipo: "status"; status: StatusManual | null; texto: string }
  | { tipo: "etiqueta"; etiqueta: string; texto: string }
  | { tipo: "etapa"; etapa: Etapa };

const temVip = (c: CardCliente) => c.etiquetas.some((e) => e.toLowerCase() === "vip");

type OpcaoFiltro = { chave: Filtro; rotulo: string; ponto?: string; passa: (c: CardCliente) => boolean; aoSoltar: AoSoltar };

// Dois grupos de filtro, que são coisas diferentes: o status da cliente (o que o retorno dela diz)
// e a etapa do quadro (em que coluna ela está)
const POR_STATUS: OpcaoFiltro[] = [
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
];
const POR_ETAPA: OpcaoFiltro[] = ETAPAS.map((e) => ({
  chave: e.chave,
  rotulo: e.titulo,
  ponto: e.ponto,
  passa: (c: CardCliente) => etapaDe(c) === e.chave,
  aoSoltar: { tipo: "etapa", etapa: e.chave } as const,
}));
const GRUPOS = [
  { titulo: "Status da cliente", filtros: POR_STATUS },
  { titulo: "Etapa do quadro", filtros: POR_ETAPA },
];
const FILTROS = [...POR_STATUS, ...POR_ETAPA];

// Selo do card: o que mais importa sobre o retorno dela, sempre escrito
function selo(c: CardCliente): { texto: string; tom: Tom } {
  if (c.proximo_agendamento) {
    const hora = formatarHora(c.proximo_agendamento).replace(":00", "h");
    return { texto: `marcado ${formatarData(c.proximo_agendamento).slice(0, 5)} ${hora}`, tom: "ok" };
  }
  if (c.status === "inativa") {
    const dias = c.dias_sem_visita ?? 0;
    const meses = Math.floor(dias / 30);
    return { texto: `inativa ${meses >= 2 ? `${meses} meses` : `${dias} dias`}`, tom: "neutro" };
  }
  // Com status escolhido à mão a data pode não bater: aí o selo só diz o status
  if (c.status === "retorno_atrasado") {
    const vencido = c.retorno_previsto && c.retorno_previsto < hojeNoSalao();
    return { texto: vencido ? prazo(c.retorno_previsto!) : "atrasada", tom: "atencao" };
  }
  if (c.status === "retorno_chegando") {
    const futuro = c.retorno_previsto && c.retorno_previsto >= hojeNoSalao();
    return { texto: futuro ? `retorno ${prazo(c.retorno_previsto!)}` : "retorno chegando", tom: "aviso" };
  }
  if (c.status === "sem_visita") return { texto: "sem visita", tom: "neutro" };
  return { texto: "em dia", tom: "ok" };
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
// Quem lê o quadro no banco é a tela de Clientes (o mesmo quadro alimenta o resumo do topo).
export function QuadroRetorno({
  busca,
  quadro,
  trocarCard,
  aoRecarregar,
}: {
  busca: string;
  quadro: { cards: CardCliente[]; erro?: string } | null;
  trocarCard: (card: CardCliente) => void;
  aoRecarregar: () => void;
}) {
  const empresa = useEmpresa();
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
    // Com horário marcado (ou remarcado) ela fica em "Agendado" até o horário acontecer
    if (card.proximo_agendamento && destino !== "agendado") {
      setErro(
        `${card.nome ?? "A cliente"} tem horário marcado em ${formatarData(card.proximo_agendamento).slice(0, 5)}, ` +
          "então fica em Agendado. Para mudar, cancele ou remarque o horário na Agenda do salão.",
      );
      return;
    }
    const antes = card;
    // Mostra já na coluna nova; se o banco recusar, volta
    trocarCard(previa(card, destino, mensagem));
    const r = await moverCard(empresa.id, card, destino, mensagem);
    if (r.erro || !r.card) {
      trocarCard(antes);
      setErro(`Não foi possível mover ${card.nome ?? "a cliente"}: ${r.erro}`);
      return;
    }
    setErro("");
    trocarCard(r.card);
  }

  // Card solto num filtro lá em cima (ver POR_STATUS e POR_ETAPA)
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
    if (!e) aoRecarregar();
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
      {/* Filtros: status e etapa são dois grupos, cada um com o seu nome. Também recebem cards arrastados. */}
      <div className="mb-4 rounded-[18px] border border-borda bg-card px-5 py-4">
        <div className="grid gap-x-5 gap-y-3 md:grid-cols-[9.5rem_1fr]">
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="contents">
              <p className="rotulo md:pt-3.5">{g.titulo}</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Filtros: ${g.titulo}`}>
                {g.filtros.map((f) => {
                  const alvo = `filtro-${f.chave}`;
                  const ativa = filtro === f.chave;
                  return (
                    <button
                      key={f.chave}
                      onClick={() => setFiltro(f.chave)}
                      aria-pressed={ativa}
                      {...soltarEm(alvo, (c) => soltarNoFiltro(c, f.aoSoltar))}
                      className={`${opcao(ativa)} ${
                        sobre === alvo ? "outline-2 outline-offset-2 outline-onix" : arrastando ? "border-dashed border-borda-forte" : ""
                      }`}
                    >
                      {f.ponto && <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${f.ponto}`} aria-hidden="true" />}
                      {f.rotulo}
                      <span className={`font-semibold tabular-nums ${ativa ? "" : "text-apoio"}`}>{buscados.filter(f.passa).length}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 border-t border-borda pt-3 text-[14px] text-apoio" aria-live="polite">
          {arrastando
            ? `Solte ${arrastando.nome ?? "a cliente"} numa coluna ou em qualquer opção acima. Em “Todas”, ela volta ao status automático.`
            : "Arraste os cards entre as colunas ou para as opções acima, ou use a seta do card. Clique no card para escrever a mensagem."}
        </p>
      </div>

      {erro && (
        <div className="mb-4">
          <Aviso tom="atencao">{erro}</Aviso>
        </div>
      )}
      {quadro?.erro && (
        <div className="mb-4">
          <Aviso tom="atencao">Erro ao ler o quadro: {quadro.erro}</Aviso>
        </div>
      )}

      {/* "Para chamar" é a coluna mais cheia: ocupa duas larguras, com os cards lado a lado.
          Em tela estreita o quadro rola para o lado, para nenhum texto ser cortado. */}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1040px] grid-cols-[1.7fr_repeat(4,minmax(0,1fr))] gap-3">
          {ETAPAS.map((etapa) => {
            const cards = visiveis.filter((c) => etapaDe(c) === etapa.chave);
            const larga = etapa.chave === "para_chamar";
            return (
              <section
                key={etapa.chave}
                aria-label={etapa.titulo}
                {...soltarEm(etapa.chave, (c) => mover(c, etapa.chave))}
                className={`min-h-[50vh] rounded-[18px] bg-campo p-2 ${
                  sobre === etapa.chave ? "outline-2 -outline-offset-2 outline-onix" : ""
                }`}
              >
                <header className="px-1 pt-2 pb-3">
                  <h2 className="flex items-center gap-1.5 text-[14px] font-bold tracking-[-0.01em]">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${etapa.ponto}`} aria-hidden="true" />
                    {etapa.titulo}
                  </h2>
                  <p className="mt-0.5 pl-4 text-[13px] font-semibold text-apoio tabular-nums">
                    {quadro ? `${cards.length} ${cards.length === 1 ? "cliente" : "clientes"}` : "…"}
                  </p>
                </header>
                <div className={larga ? "grid grid-cols-2 items-start gap-2" : "space-y-2"}>
                  {!quadro && <p className="px-2 text-[14px] text-texto-2">Carregando…</p>}
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
  // Selo em caixinha (não em pílula) e sem "nowrap": em coluna estreita o texto quebra de linha, não é cortado
  const caixinha = "inline-block rounded-lg px-2 py-1 text-[13px] leading-snug font-bold";
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
      className={`min-w-0 cursor-grab rounded-[14px] border border-borda bg-card p-3 hover:border-borda-forte active:cursor-grabbing ${arrastado ? "opacity-40" : ""}`}
    >
      {/* O nome abre a mensagem pelo teclado (Enter ou espaço); o clique em qualquer ponto do card faz o mesmo.
          Não é um <button> de verdade porque, em alguns navegadores, botão dentro do card atrapalha o arrastar. */}
      <p
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          aoAbrir();
        }}
        className="rounded text-[15px] leading-snug font-bold [overflow-wrap:anywhere]"
      >
        {card.nome?.trim() || "Sem nome"}
      </p>
      <p className="mt-0.5 text-[13px] text-apoio">{formatarTelefone(card.telefone)}</p>
      <p className="mt-2">
        <span className={`${caixinha} ${TONS[s.tom]}`}>{s.texto}</span>
      </p>
      {faltaEnviar(card) && (
        <p className="mt-1.5">
          <span className={`${caixinha} ${TONS.atencao}`}>Abriu o WhatsApp, falta enviar</span>
        </p>
      )}
      <Etiquetas etiquetas={card.etiquetas} className="mt-2" />
      <div className="mt-2.5 flex items-end justify-between gap-2 border-t border-borda pt-2.5">
        <span className="text-[13px] leading-snug text-apoio">{textoVisita(card)}</span>
        {temProxima && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              aoAvancar();
            }}
            aria-label={`Passar ${card.nome ?? "a cliente"} para a próxima coluna`}
            title="Passar para a próxima coluna"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-borda-forte bg-card text-grafite hover:bg-campo/50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
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
    <Folha titulo={card.nome ?? "Sem nome"} aoFechar={aoFechar} largura="max-w-lg">
      <div className="space-y-4">
        <p className="-mt-3 flex flex-wrap items-center justify-between gap-3 text-[15px] text-texto-2">
          {formatarTelefone(card.telefone)}
          <Link href={`/clientes/${card.id}`} className="flex h-10 items-center font-bold text-grafite underline underline-offset-4">
            Ver ficha
          </Link>
        </p>
        <label className="block">
          <Rotulo>Mensagem para mandar pelo WhatsApp</Rotulo>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-borda bg-card p-3 text-[15px] leading-relaxed outline-none focus:border-onix focus-visible:ring-2 focus-visible:ring-onix/15"
          />
        </label>
        <div className="flex flex-wrap gap-2.5">
          <button onClick={() => aoEnviar(texto.trim())} disabled={!texto.trim()} className={botaoForte + " h-11"}>
            Abrir no WhatsApp
          </button>
          <button onClick={aoFechar} className={botao + " h-11"}>
            Voltar
          </button>
        </div>
        <p className="text-[14px] leading-relaxed text-apoio">
          O card vai para “Mensagem enviada” quando a mensagem sair pelo WhatsApp do salão. Enviou de outro jeito? Arraste o card para
          “Mensagem enviada”.
        </p>
      </div>
    </Folha>
  );
}
