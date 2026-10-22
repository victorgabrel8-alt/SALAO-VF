"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useDialogo } from "@/components/Dialogo";
import { Etiquetas } from "@/components/Etiquetas";
import { FolhaConfirmar } from "@/components/FolhaConfirmar";
import { Intencao } from "@/components/Intencao";
import { Observacao } from "@/components/Observacao";
import {
  buscarAtendimentosDoDia,
  buscarDiasComHorario,
  confirmarAtendimento,
  corDaProfissional,
  desfazerConfirmacao,
  ehFeitoJunto,
  naoAtendida,
  excluirAtendimento,
  feitosJunto,
  mudarStatus,
  nomeDosServicos,
  reagendar,
  resumoDosServicos,
  ultimoReagendamento,
  type Atendimento,
  type StatusAtendimento,
} from "@/lib/atendimentos";
import { lerAlmoco, textoAlmoco } from "@/lib/almoco";
import { confirmarAvaliacao, useIntencoes, type Avaliacao, type ResultadoAvaliacao } from "@/lib/avaliacoes";
import { bloqueioDoDia } from "@/lib/bloqueios";
import { useEmpresa } from "@/lib/empresa";
import {
  formatarData,
  formatarHora,
  formatarTelefone,
  hojeNoSalao,
  instanteNoSalao,
  somarDias,
} from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import { useAgora } from "@/lib/relogio";
import { useTempoReal } from "@/lib/tempoReal";
import type { Profissional, ServicoAtivo } from "@/lib/tipos";

// Agenda (design/salao-redesign): topo grafite com os dias da semana e o dia como uma lista de
// cartões (Concluído / Agora / A atender), com os intervalos livres e o almoço entre eles.
// O círculo à direita confirma o atendimento ("Foi isso" ou "Fez outra coisa", e em seguida
// "Já combinou a volta?"); tocar no cartão abre todos os detalhes.

// "Clientes do dia": só quem ainda vai ser atendida fica na linha do tempo. Concluídas e faltas
// saem dela e vão para o grupo recolhido ("N concluídos"). Cancelados não aparecem.
const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

type Dia = { atendimentos: Atendimento[]; profissionais: Profissional[]; comHorario: Set<string> } | { erro: string };

// Segunda-feira da semana do dia
function inicioDaSemana(dia: string): string {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return somarDias(dia, -((semana + 6) % 7));
}

async function buscarDia(empresaId: string, dia: string): Promise<Dia> {
  const segunda = inicioDaSemana(dia);
  const [atendimentos, profissionais, comHorario] = await Promise.all([
    buscarAtendimentosDoDia(empresaId, dia),
    supabase().from("profissionais").select("id, nome").eq("empresa_id", empresaId).order("nome"),
    buscarDiasComHorario(empresaId, segunda, somarDias(segunda, 6)),
  ]);
  if (atendimentos.erro) return { erro: atendimentos.erro };
  if (profissionais.error) return { erro: profissionais.error.message };
  return {
    atendimentos: atendimentos.atendimentos,
    profissionais: profissionais.data as Profissional[],
    comHorario,
  };
}

type Entrada =
  | { tipo: "atendimento"; atendimento: Atendimento; inicio: number; fim: number }
  | { tipo: "almoco"; inicio: number; fim: number };

function minutos(a: Atendimento): number {
  if (!a.fim) return 60;
  return Math.max(15, Math.round((Date.parse(a.fim) - Date.parse(a.inicio)) / 60_000));
}

function duracao(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h${String(m).padStart(2, "0")}` : h ? `${h}h` : `${m} min`;
}

export default function AgendaPage() {
  const empresa = useEmpresa();
  const [dia, setDia] = useState(hojeNoSalao());
  const [resultado, setResultado] = useState<{ dia: string; dados: Dia } | null>(null);
  const [versao, setVersao] = useState(0);
  const [aberto, setAberto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Atendimento | null>(null);
  const [servicos, setServicos] = useState<ServicoAtivo[]>([]);
  // Concluído agora há pouco: quando a folha fecha, o cartão dele acende em verde por um instante
  const confirmadoAgora = useRef<string | null>(null);
  const [celebrando, setCelebrando] = useState<string | null>(null);
  // Concluídos e faltas ficam recolhidos numa linha "✓ 4 concluídos" que abre ao tocar
  const [verConcluidos, setVerConcluidos] = useState(false);
  // Não atendidas (passou 1 h e ninguém confirmou) saem da Agenda: elas ficam no Início
  const agora = useAgora();
  const { dialogo, perguntar, avisar } = useDialogo();
  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    supabase()
      .from("servicos")
      .select("id, nome, dias_retorno, duracao_min")
      .eq("empresa_id", empresa.id)
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => setServicos((data ?? []) as ServicoAtivo[]));
  }, [empresa.id]);

  useEffect(() => {
    let ativo = true;
    buscarDia(empresa.id, dia).then((dados) => {
      if (ativo) setResultado({ dia, dados });
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, dia, versao]);

  useTempoReal(["agendamentos"], empresa.id, recarregar);

  const hoje = hojeNoSalao();
  const dados = resultado?.dia === dia ? resultado.dados : null;
  const ok = dados && !("erro" in dados) ? dados : null;
  const ordem = ok ? ok.profissionais.map((p) => p.id) : [];
  const segunda = inicioDaSemana(dia);
  // Seg a Sáb; o domingo só aparece se o salão abre nesse dia, se tem horário nele ou se é o dia escolhido
  const abreDomingo = Boolean((empresa.config.horario_funcionamento as Record<string, string | null> | undefined)?.dom);
  const semana = Array.from({ length: 7 }, (_, i) => somarDias(segunda, i)).filter(
    (d, i) => i < 6 || abreDomingo || d === dia || ok?.comHorario.has(d),
  );
  const [, mes] = dia.split("-").map(Number);

  // Onde está o dia escolhido, para a bolha bronze deslizar até ele (o domingo pode entrar ou
  // sair da semana, então mede de novo quando a lista de dias muda)
  const botoesDia = useRef(new Map<string, HTMLButtonElement>());
  const [bolhaDia, setBolhaDia] = useState<{ x: number; largura: number } | null>(null);
  useLayoutEffect(() => {
    const medir = () => {
      const el = botoesDia.current.get(dia);
      if (el) setBolhaDia({ x: el.offsetLeft, largura: el.offsetWidth });
    };
    medir();
    // Os dias têm largura fluida: girou o celular, mede de novo
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [dia, semana.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  const visiveis = ok?.atendimentos.filter((a) => a.status !== "cancelado") ?? [];
  const selecionado = visiveis.find((a) => a.id === aberto) ?? null;
  // O que a IA anotou de cada cliente do dia (pré-avaliação), para aparecer no cartão
  const intencoes = useIntencoes(
    visiveis.flatMap((a) => (a.clientes ? [a.clientes.id] : [])),
    versao,
  );
  const intencaoDe = (a: Atendimento) => (a.clientes ? intencoes[a.clientes.id] : undefined);
  // Concluídos e faltas saem da linha do tempo e vão para o grupo recolhido. O que acabou de ser
  // concluído fica à vista até terminar de acender.
  const concluidos = visiveis.filter((a) => (a.status === "realizado" || a.status === "faltou") && a.id !== celebrando);
  // Passou 1 h do horário e ninguém confirmou: some da Agenda (o Início mostra em "Não atendidas")
  const naoAtendidas = visiveis.filter((a) => naoAtendida(a, agora));
  const naLinha = visiveis.filter((a) => !concluidos.includes(a) && !naoAtendidas.includes(a));
  // Mesma cliente com mais de um horário no dia (ex.: mudou de horário e alguém criou outro em vez
  // de remarcar): o cartão avisa, para a Gleide conferir
  const horariosDaCliente = new Map<string, number>();
  for (const a of visiveis) if (a.clientes && a.status !== "faltou") horariosDaCliente.set(a.clientes.id, (horariosDaCliente.get(a.clientes.id) ?? 0) + 1);
  const repetidaNoDia = (a: Atendimento) => (a.clientes ? (horariosDaCliente.get(a.clientes.id) ?? 0) : 0);
  const faltas = concluidos.filter((a) => a.status === "faltou").length;

  // Linha do tempo: os horários a atender e o bloco do almoço no lugar certo
  const almoco = lerAlmoco(empresa.config);
  const entradas: Entrada[] = [
    ...naLinha.map((a) => ({
      tipo: "atendimento" as const,
      atendimento: a,
      inicio: Date.parse(a.inicio),
      fim: Date.parse(a.inicio) + minutos(a) * 60_000,
    })),
    ...(almoco
      ? [
          {
            tipo: "almoco" as const,
            inicio: Date.parse(instanteNoSalao(dia, almoco.inicio)),
            fim: Date.parse(instanteNoSalao(dia, almoco.fim)),
          },
        ]
      : []),
  ].sort((x, y) => x.inicio - y.inicio);

  // A atender -> abre a folha "Foi isso / Fez outra coisa / Faltou". Realizado ou faltou -> desfaz
  // (volta para a linha do tempo; pergunta antes quando algo vai sumir: os serviços feitos junto).
  async function alternarRealizado(a: Atendimento) {
    if (a.status === "agendado") {
      setConfirmando(a);
      return;
    }
    let erro: string | undefined;
    if (a.status === "faltou") {
      if (!(await perguntar(`Desfazer a falta de ${a.clientes?.nome ?? "a cliente"}? Ela volta para os clientes do dia.`, { confirmar: "Desfazer" }))) return;
      erro = await mudarStatus(a.id, "agendado");
    } else if (ehFeitoJunto(a)) {
      if (!(await perguntar(`Tirar ${a.servicos?.nome ?? "este serviço"} deste atendimento?`, { confirmar: "Tirar", perigo: true }))) return;
      erro = await excluirAtendimento(a.id);
    } else {
      const extras = feitosJunto(a);
      const nomes = (a.extras ?? []).join(", ");
      if (nomes && !(await perguntar(`Voltar para "a atender"? O que foi feito junto (${nomes}) sai deste horário.`, { confirmar: "Desfazer" }))) return;
      erro = await desfazerConfirmacao(empresa.id, a, extras);
    }
    if (erro) await avisar(`Não deu certo: ${erro}`);
    recarregar();
  }

  // A folha continua aberta depois de salvar: em seguida pergunta se já combinou a volta
  async function confirmar(a: Atendimento, servicoIds: string[]) {
    const erro = await confirmarAtendimento(empresa.id, a, servicoIds);
    if (!erro) {
      confirmadoAgora.current = a.id;
      recarregar();
    }
    return erro;
  }

  // Avaliação: o ✓ já leva o resultado (Fechou / Ficou de pensar / Não fechou)
  async function confirmarComResultado(a: Atendimento, resultado: ResultadoAvaliacao) {
    const erro = await confirmarAvaliacao(a.id, a.observacoes, resultado);
    if (!erro) {
      confirmadoAgora.current = a.id;
      recarregar();
    }
    return erro;
  }

  // Faltou: sai da linha do tempo e vai para o grupo recolhido; a IA vê a falta na ficha
  async function marcarFalta(a: Atendimento) {
    const erro = await mudarStatus(a.id, "faltou");
    if (!erro) recarregar();
    return erro;
  }

  // Remarcou: o mesmo horário vai para o novo dia (anota "Reagendado de ...")
  async function remarcar(a: Atendimento, novoInicio: string) {
    const erro = await reagendar(a, novoInicio);
    if (!erro) recarregar();
    return erro;
  }

  function fecharConfirmar() {
    setConfirmando(null);
    const id = confirmadoAgora.current;
    if (!id) return;
    confirmadoAgora.current = null;
    setCelebrando(id);
    setTimeout(() => setCelebrando((atual) => (atual === id ? null : atual)), 2000);
  }

  return (
    <>
      {/* Topo grafite: mês, resumo do dia e os dias da semana */}
      <header className="relative -mt-[env(safe-area-inset-top)] flex flex-col gap-[18px] overflow-hidden rounded-b-[32px] bg-grafite px-5 pt-[calc(56px+env(safe-area-inset-top))] pb-6">
        {/* Detalhe do canto: um brilho bronze suave e dois arcos finos, no lugar do círculo cinza chapado */}
        <span aria-hidden className="pointer-events-none absolute -top-28 -right-20 h-[240px] w-[240px] rounded-full bg-[radial-gradient(circle,rgb(168_138_104/0.26),transparent_68%)]" />
        <span aria-hidden className="pointer-events-none absolute -top-[78px] -right-[46px] h-[176px] w-[176px] rounded-full border border-bronze/35" />
        <span aria-hidden className="pointer-events-none absolute -top-[46px] -right-[14px] h-[112px] w-[112px] rounded-full border border-bronze/20" />
        <div className="relative flex items-end justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm text-claro">
              {MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1)} de {dia.slice(0, 4)}
              {ok && ` · ${visiveis.length === 1 ? "1 horário" : `${visiveis.length} horários`}`}
            </span>
            <h1 className="font-serif text-[30px] leading-tight font-semibold text-white">Agenda</h1>
          </div>
          <div className="flex items-center gap-2">
            {dia !== hoje && (
              <button onClick={() => setDia(hoje)} className="h-11 rounded-full border border-bronze/50 px-4 text-[13px] font-bold text-perola active:scale-95">
                Hoje
              </button>
            )}
            {/* Todas as clientes dos próximos dias e meses, numa lista só */}
            <Link
              href="/agenda/proximas"
              className="flex h-11 items-center gap-1.5 rounded-full bg-[#D8C6AE] pr-3.5 pl-3 text-[13px] font-bold text-grafite active:scale-95"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
              </svg>
              Próximas
            </Link>
          </div>
        </div>
        <div className="relative flex items-center gap-1">
          <button
            onClick={() => setDia(somarDias(dia, -7))}
            aria-label="Semana anterior"
            className="-ml-2 flex h-16 w-6 shrink-0 items-center justify-center text-2xl text-inativo"
          >
            ‹
          </button>
          <div className={`relative grid flex-1 gap-1.5 ${semana.length === 7 ? "grid-cols-7" : "grid-cols-6"}`}>
            {/* Bolha bronze do dia escolhido: desliza até o dia tocado na mesma mola da barra de
                abas. Fica atrás dos dias (que são translúcidos), então aparece passando por baixo */}
            {bolhaDia && (
              <span
                aria-hidden
                className="bolha-aba pointer-events-none absolute inset-y-0 left-0 rounded-[18px] bg-bronze shadow-[0_8px_20px_rgba(0,0,0,0.35)]"
                style={{ transform: `translateX(${bolhaDia.x}px)`, width: bolhaDia.largura, transitionProperty: "transform, width" }}
              />
            )}
            {semana.map((d) => {
              const escolhido = d === dia;
              const semanaIdx = (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
              return (
                <button
                  key={d}
                  ref={(el) => {
                    if (el) botoesDia.current.set(d, el);
                    else botoesDia.current.delete(d);
                  }}
                  onClick={() => setDia(d)}
                  aria-pressed={escolhido}
                  aria-label={`${formatarData(d)}${bloqueioDoDia(empresa.config, d) ? " (sem atender)" : ""}`}
                  className={`relative flex h-16 flex-col items-center justify-center gap-0.5 rounded-[18px] transition-colors duration-300 active:scale-95 ${
                    escolhido
                      ? "text-grafite"
                      : `bg-white/[0.07] text-perola ${d === hoje ? "ring-[1.5px] ring-bronze" : "ring-1 ring-bronze/25"}`
                  }`}
                >
                  <span className="text-xs font-semibold opacity-85">{DIAS_SEMANA[semanaIdx]}</span>
                  {/* Dia sem atender: número riscado */}
                  <span className={`font-serif text-[22px] leading-none font-semibold ${bloqueioDoDia(empresa.config, d) ? "line-through decoration-[#C9897A] decoration-2 opacity-60" : ""}`}>
                    {Number(d.slice(8))}
                  </span>
                  {/* Pontinho: dia com horário marcado */}
                  <span
                    aria-hidden
                    className={`absolute bottom-1.5 h-1 w-1 rounded-full ${
                      ok?.comHorario.has(d) ? (escolhido ? "bg-grafite" : "bg-bronze") : "bg-transparent"
                    }`}
                  />
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setDia(somarDias(dia, 7))}
            aria-label="Próxima semana"
            className="-mr-2 flex h-16 w-6 shrink-0 items-center justify-center text-2xl text-inativo"
          >
            ›
          </button>
        </div>
      </header>

      <h2 className="mt-5 text-center font-serif text-[24px] font-semibold">
        Clientes do dia
        {ok && naLinha.length > 0 && <span className="ml-2 align-middle text-base font-bold text-bronze-escuro">{naLinha.length}</span>}
      </h2>

      <section className="mt-3 px-5">
        {/* Dia bloqueado (viagem, folga...): a IA não marca ninguém; quem já estava marcado aparece abaixo */}
        {bloqueioDoDia(empresa.config, dia) && (
          <Link href="/agenda/bloqueios" className="mb-3 flex items-center gap-3 rounded-[18px] bg-rose px-4 py-3 text-rose-texto active:scale-[0.99]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18M9 14l6 6M15 14l-6 6" />
            </svg>
            <span className="min-w-0 flex-1 text-[15px]">
              <b>Dia sem atender</b>
              {bloqueioDoDia(empresa.config, dia)?.motivo && ` · ${bloqueioDoDia(empresa.config, dia)?.motivo}`}. A IA não marca ninguém nesse dia.
            </span>
            <span aria-hidden className="text-lg">›</span>
          </Link>
        )}
        {!dados && <p className="text-texto-2">Carregando…</p>}
        {dados && "erro" in dados && <p className="rounded-2xl bg-rose p-4 text-rose-texto">Erro: {dados.erro}</p>}

        {ok && (
          <>
            {visiveis.length === 0 && <Vazio texto="Dia livre. Nenhum horário marcado." />}
            <ol className="flex flex-col gap-3">
              {/* Concluídos e faltas: fora da linha do tempo, recolhidos; tocar mostra a lista deles */}
              {concluidos.length > 0 && (
                <li className="flex flex-col gap-3">
                  <LinhaConcluidos
                    quantidade={concluidos.length - faltas}
                    faltas={faltas}
                    aberto={verConcluidos}
                    tudoFeito={naLinha.length === 0 && naoAtendidas.length === 0}
                    aoAlternar={() => setVerConcluidos((v) => !v)}
                  />
                  {verConcluidos &&
                    concluidos.map((a) => (
                      <ItemLinhaDoTempo
                        key={a.id}
                        atendimento={a}
                        intencao={intencaoDe(a)}
                        vezesNoDia={repetidaNoDia(a)}
                        barra={corDaProfissional(a.profissional_id, ordem).ponto}
                        celebrar={false}
                        aoAbrir={() => setAberto(a.id)}
                        aoMarcar={() => alternarRealizado(a)}
                      />
                    ))}
                </li>
              )}
              {entradas.map((e, i) => {
                // Os concluídos também ocupavam a agenda: contam para o intervalo livre
                const antes = [
                  ...entradas.slice(0, i).map((x) => x.fim),
                  ...concluidos
                    .filter((a) => a.status === "realizado" && Date.parse(a.inicio) < e.inicio)
                    .map((a) => Date.parse(a.inicio) + minutos(a) * 60_000),
                ];
                const fimAnterior = antes.length ? Math.max(...antes) : null;
                const livre = fimAnterior ? Math.round((e.inicio - fimAnterior) / 60_000) : 0;
                return (
                  <li key={e.tipo === "almoco" ? "almoco" : e.atendimento.id} className="flex flex-col gap-3">
                    {livre >= 30 && <IntervaloLivre minutos={livre} />}
                    {e.tipo === "almoco" ? (
                      <BlocoAlmoco texto={textoAlmoco(almoco!)} />
                    ) : (
                      <ItemLinhaDoTempo
                        atendimento={e.atendimento}
                        intencao={intencaoDe(e.atendimento)}
                        vezesNoDia={repetidaNoDia(e.atendimento)}
                        barra={corDaProfissional(e.atendimento.profissional_id, ordem).ponto}
                        celebrar={celebrando === e.atendimento.id && e.atendimento.status === "realizado"}
                        aoAbrir={() => setAberto(e.atendimento.id)}
                        aoMarcar={() => alternarRealizado(e.atendimento)}
                      />
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </section>

      {/* Sem "+ Novo horário": quem marca os horários é a IA */}
      <div className="h-6" />

      {dialogo}

      {confirmando && (
        <FolhaConfirmar
          atendimento={confirmando}
          servicos={servicos}
          aoConfirmar={(ids) => confirmar(confirmando, ids)}
          aoResultado={(r) => confirmarComResultado(confirmando, r)}
          aoFaltou={() => marcarFalta(confirmando)}
          aoRemarcar={(inicio) => remarcar(confirmando, inicio)}
          intencao={intencaoDe(confirmando)}
          aoFechar={fecharConfirmar}
        />
      )}

      {/* Detalhes do horário: tudo do cartão completo, numa folha que sobe de baixo */}
      {selecionado && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={() => setAberto(null)}>
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            className="mx-auto max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--background)] px-4 pt-3 pb-safe"
          >
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-borda" />
            <DetalheHorario atendimento={selecionado} intencao={intencaoDe(selecionado)} />
            <button
              onClick={() => setAberto(null)}
              className="my-4 h-12 w-full rounded-2xl border border-borda bg-card font-semibold active:bg-campo"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-[22px] bg-card px-5 py-7 text-center">
      <span className="text-base font-bold">{texto}</span>
    </div>
  );
}

// Situação do cartão (como no desenho): Concluído, Agora (cartão grafite) ou A atender
type Situacao = "concluido" | "agora" | "atender" | "faltou";

const SITUACAO: Record<Situacao, { rotulo: string; cartao: string; selo: string; sub: string }> = {
  // Concluído e Faltou saem da frente: sem fundo cheio nem sombra, só um contorno e bem mais claros,
  // para os pendentes (cartão creme com sombra) saltarem aos olhos
  concluido: { rotulo: "Concluído", cartao: "border border-borda bg-transparent opacity-55", selo: "bg-salvia text-salvia-texto", sub: "text-texto-2" },
  agora: {
    rotulo: "Agora",
    cartao: "bg-grafite text-white shadow-[0_14px_30px_rgba(30,23,20,0.25)]",
    selo: "bg-bronze text-grafite",
    sub: "text-[#C7BBAC]",
  },
  atender: { rotulo: "A atender", cartao: "bg-card shadow-[0_2px_10px_rgba(30,23,20,0.05)]", selo: "bg-taupe text-taupe-texto", sub: "text-texto-2" },
  faltou: { rotulo: "Faltou", cartao: "border border-borda bg-transparent opacity-55", selo: "bg-rose text-rose-texto", sub: "text-texto-2" },
};

function situacaoDe(a: Atendimento): Situacao {
  if (a.status === "realizado") return "concluido";
  if (a.status === "faltou") return "faltou";
  const agora = Date.now();
  const inicio = Date.parse(a.inicio);
  return agora >= inicio && agora < inicio + minutos(a) * 60_000 ? "agora" : "atender";
}

// Círculo de concluído ao lado do cartão: vazio = a atender, ✓ = realizado, ✕ = faltou
const ICONE_STATUS: Record<StatusAtendimento, { simbolo: string; classe: string; rotulo: string }> = {
  agendado: { simbolo: "", classe: "border-[1.5px] border-bronze bg-card", rotulo: "Marcar como realizado" },
  realizado: { simbolo: "✓", classe: "bg-[#5E7A50] text-white", rotulo: "Realizado (tocar desfaz)" },
  faltou: { simbolo: "✕", classe: "bg-rose-texto text-white", rotulo: "Faltou (tocar desfaz)" },
  cancelado: { simbolo: "–", classe: "bg-borda text-white", rotulo: "Cancelado" },
};

// Um horário: hora à esquerda, cartão (toque abre os detalhes) e o círculo de concluído.
// A bolinha antes do nome tem a cor da profissional.
function ItemLinhaDoTempo({
  atendimento: a,
  intencao,
  vezesNoDia,
  barra,
  celebrar,
  aoAbrir,
  aoMarcar,
}: {
  atendimento: Atendimento;
  intencao: Avaliacao | undefined;
  vezesNoDia: number;
  barra: string;
  celebrar: boolean;
  aoAbrir: () => void;
  aoMarcar: () => void;
}) {
  const min = minutos(a);
  const icone = ICONE_STATUS[a.status];
  const situacao = situacaoDe(a);
  const s = SITUACAO[situacao];
  // Já resolvido (concluído ou faltou): cartão compacto, só nome e serviço
  const resolvido = situacao === "concluido" || situacao === "faltou";
  const reagendado = ultimoReagendamento(a);

  return (
    <div className="flex items-stretch gap-3">
      <span className={`w-12 shrink-0 text-sm font-bold ${resolvido ? "pt-3 text-inativo" : "pt-4 text-rotulo"}`}>{formatarHora(a.inicio)}</span>

      <button
        onClick={aoAbrir}
        className={`flex min-w-0 flex-1 flex-col gap-1 rounded-[20px] px-4 text-left ${resolvido ? "py-2.5" : "py-3.5"} ${s.cartao} ${celebrar ? "cartao-confirmado" : ""}`}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-2">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${barra}`} />
            <span className="truncate text-base font-bold">
              {a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")}
            </span>
          </span>
          <span className={`shrink-0 rounded-full px-[9px] py-[5px] text-[11px] font-bold whitespace-nowrap ${s.selo} ${celebrar ? "selo-pop" : ""}`}>
            {s.rotulo}
          </span>
        </span>
        <span className={`text-[13px] ${s.sub}`}>
          {resumoDosServicos(a)} · {duracao(min)}
          {a.origem === "ia" && " · IA"}
        </span>
        {/* Também nos concluídos: é lá que costuma ficar o horário em dobro */}
        {vezesNoDia > 1 && (
          <span className="w-fit rounded-full bg-rose px-2 py-0.5 text-[11px] font-bold text-rose-texto">
            {vezesNoDia} horários dela neste dia · conferir
          </span>
        )}
        {!resolvido && (
          <>
            {a.clientes && <Etiquetas etiquetas={a.clientes.etiquetas} className="" />}
            <Intencao avaliacao={intencao} claro={situacao === "agora"} />
            <Observacao texto={a.clientes?.observacoes} />
            {reagendado && <span className={`text-xs ${s.sub}`}>{reagendado}</span>}
          </>
        )}
      </button>

      {/* Círculo de concluído: um toque marca realizado */}
      <button
        onClick={aoMarcar}
        disabled={a.status === "cancelado"}
        aria-label={icone.rotulo}
        className={`flex w-8 shrink-0 items-start justify-center ${resolvido ? "pt-2.5" : "pt-3.5"}`}
      >
        <span className="relative flex h-[26px] w-[26px]">
          {celebrar && <span aria-hidden className="onda-confirmar absolute inset-0 rounded-full bg-[#5E7A50]" />}
          <span className={`relative flex h-full w-full items-center justify-center rounded-full text-xs font-bold ${icone.classe} ${celebrar ? "selo-pop" : ""}`}>
            {a.status === "realizado" ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path className={celebrar ? "check-desenhar" : ""} d="m5 12 5 5L20 7" />
              </svg>
            ) : (
              icone.simbolo
            )}
          </span>
        </span>
      </button>
    </div>
  );
}

// Os concluídos do dia recolhidos numa linha só; tocar abre (ou esconde) os cartões deles.
// O número "pula" quando mais um entra, para a dona ver que contou.
function LinhaConcluidos({
  quantidade,
  faltas,
  aberto,
  tudoFeito,
  aoAlternar,
}: {
  quantidade: number;
  faltas: number;
  aberto: boolean;
  tudoFeito: boolean;
  aoAlternar: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0" />
      <button
        onClick={aoAlternar}
        aria-expanded={aberto}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[20px] border border-borda px-4 py-2.5 text-left active:scale-[0.99]"
      >
        <span key={quantidade} className="selo-pop flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-[#5E7A50] text-white">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m5 12 5 5L20 7" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-salvia-texto">
          {aberto
            ? "Esconder concluídos"
            : [
                // "Tudo atendido" só quando não houve falta, para o texto caber numa linha
                tudoFeito && !faltas ? "Tudo atendido" : null,
                quantidade ? (quantidade === 1 ? "1 concluído" : `${quantidade} concluídos`) : null,
                faltas ? (faltas === 1 ? "1 faltou" : `${faltas} faltaram`) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className={`shrink-0 text-texto-2 transition-transform duration-300 ${aberto ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <span className="w-8 shrink-0" />
    </div>
  );
}

// Almoço na agenda: uma faixa discreta, sem ações
function BlocoAlmoco({ texto }: { texto: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0 text-sm font-bold text-inativo">{texto.slice(0, 5)}</span>
      <p className="flex-1 rounded-[20px] border border-dashed border-borda px-4 py-3 text-sm text-texto-2">
        <span className="font-semibold text-rotulo">Almoço</span> · {texto}
      </p>
      <span className="w-8 shrink-0" />
    </div>
  );
}

const ROTULO_STATUS: Record<StatusAtendimento, string> = {
  agendado: "A atender",
  realizado: "Realizado",
  faltou: "Faltou",
  cancelado: "Cancelado",
};

// Folha ao tocar no horário: só informação (sem ações nem valores — quem cuida da agenda
// e dos valores é a IA). Dá para abrir a ficha da cliente.
function DetalheHorario({ atendimento: a, intencao }: { atendimento: Atendimento; intencao: Avaliacao | undefined }) {
  const reagendado = ultimoReagendamento(a);
  const linhas: [string, string][] = [
    ["Horário", `${formatarHora(a.inicio)}${a.fim ? ` até ${formatarHora(a.fim)}` : ""}`],
    [a.extras?.length ? "Serviços" : "Serviço", nomeDosServicos(a, "Não informado")],
    ...(a.clientes ? ([["Telefone", formatarTelefone(a.clientes.telefone)]] as [string, string][]) : []),
    ["Situação", ROTULO_STATUS[a.status]],
    ...(reagendado ? ([["Reagendado", reagendado.replace("Reagendado de ", "era ")]] as [string, string][]) : []),
    ...(a.origem === "ia" ? ([["Marcado por", "IA"]] as [string, string][]) : []),
  ];
  return (
    <div className="rounded-[22px] bg-card p-[18px]">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="font-serif text-2xl font-semibold">{a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")}</p>
        {a.clientes && <Etiquetas etiquetas={a.clientes.etiquetas} className="" />}
      </div>
      <Intencao avaliacao={intencao} />
      <Observacao texto={a.clientes?.observacoes} />
      <dl className="mt-3 divide-y divide-borda">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex justify-between gap-4 py-2">
            <dt className="text-texto-2">{rotulo}</dt>
            <dd className="text-right font-medium whitespace-pre-line">{valor}</dd>
          </div>
        ))}
      </dl>
      {a.clientes && (
        <Link
          href={`/clientes/${a.clientes.id}`}
          className="mt-3 flex h-12 items-center justify-center rounded-[18px] bg-grafite font-semibold text-white"
        >
          Ver ficha da cliente
        </Link>
      )}
    </div>
  );
}

// Só informa o tempo livre entre os horários (quem marca é a IA)
function IntervaloLivre({ minutos: min }: { minutos: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-12 shrink-0" />
      <p className="flex-1 text-xs font-medium text-texto-2">{duracao(min)} livre</p>
    </div>
  );
}

