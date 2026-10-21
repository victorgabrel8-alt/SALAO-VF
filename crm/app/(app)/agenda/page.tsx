"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDialogo } from "@/components/Dialogo";
import { Etiquetas } from "@/components/Etiquetas";
import { MarcarVolta, type ServicoAtivo } from "@/components/MarcarVolta";
import { Observacao } from "@/components/Observacao";
import {
  buscarAtendimentosDoDia,
  buscarDiasComHorario,
  buscarReagendadosDoDia,
  confirmarAtendimento,
  corDaProfissional,
  desfazerConfirmacao,
  ehFeitoJunto,
  excluirAtendimento,
  feitosJunto,
  ultimoReagendamento,
  type Atendimento,
  type StatusAtendimento,
} from "@/lib/atendimentos";
import { lerAlmoco, textoAlmoco } from "@/lib/almoco";
import { useEmpresa } from "@/lib/empresa";
import {
  dataNoSalao,
  formatarData,
  formatarHora,
  formatarTelefone,
  hojeNoSalao,
  instanteNoSalao,
  somarDias,
} from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import type { Profissional } from "@/lib/tipos";

// Agenda no estilo do app Structured: faixa da semana em cima e o dia como uma linha do
// tempo, cada horário numa "cápsula" (altura = duração, cor = profissional), com os
// intervalos livres entre eles. O círculo à direita confirma o atendimento ("Foi isso" ou
// "Fez outra coisa", e em seguida "Já combinou a volta?"); tocar no horário abre todos os detalhes.

// Cancelados não aparecem na agenda: a dona não precisa ver quem desmarcou.
// "Reagendados" só aparece no dia em que alguém reagendou.
type Camada = "todos" | Exclude<StatusAtendimento, "cancelado"> | "reagendado";

const CAMADAS: { chave: Camada; rotulo: string }[] = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "agendado", rotulo: "A atender" },
  { chave: "realizado", rotulo: "Realizados" },
  { chave: "faltou", rotulo: "Faltaram" },
  { chave: "reagendado", rotulo: "Reagendados" },
];

const DIAS_SEMANA = ["S", "T", "Q", "Q", "S", "S", "D"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

type Dia =
  | { atendimentos: Atendimento[]; reagendados: Atendimento[]; profissionais: Profissional[]; comHorario: Set<string> }
  | { erro: string };

// Segunda-feira da semana do dia
function inicioDaSemana(dia: string): string {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return somarDias(dia, -((semana + 6) % 7));
}

async function buscarDia(empresaId: string, dia: string): Promise<Dia> {
  const segunda = inicioDaSemana(dia);
  const [atendimentos, reagendados, profissionais, comHorario] = await Promise.all([
    buscarAtendimentosDoDia(empresaId, dia),
    buscarReagendadosDoDia(empresaId, dia),
    supabase().from("profissionais").select("id, nome").eq("empresa_id", empresaId).order("nome"),
    buscarDiasComHorario(empresaId, segunda, somarDias(segunda, 6)),
  ]);
  if (atendimentos.erro) return { erro: atendimentos.erro };
  if (reagendados.erro) return { erro: reagendados.erro };
  if (profissionais.error) return { erro: profissionais.error.message };
  return {
    atendimentos: atendimentos.atendimentos,
    reagendados: reagendados.atendimentos,
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
  const [camada, setCamada] = useState<Camada>("todos");
  const [resultado, setResultado] = useState<{ dia: string; dados: Dia } | null>(null);
  const [versao, setVersao] = useState(0);
  const [aberto, setAberto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Atendimento | null>(null);
  const [servicos, setServicos] = useState<ServicoAtivo[]>([]);
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
  const semana = Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
  const [, mes] = dia.split("-").map(Number);

  const visiveis = ok?.atendimentos.filter((a) => a.status !== "cancelado") ?? [];
  const contagem: Record<Camada, number> = {
    todos: visiveis.length,
    agendado: visiveis.filter((a) => a.status === "agendado").length,
    realizado: visiveis.filter((a) => a.status === "realizado").length,
    faltou: visiveis.filter((a) => a.status === "faltou").length,
    reagendado: ok?.reagendados.length ?? 0,
  };
  const camadas = CAMADAS.filter((c) => c.chave !== "reagendado" || contagem.reagendado > 0);
  // Ao trocar para um dia sem reagendados, volta para "Todos"
  const camadaAtual: Camada = camadas.some((c) => c.chave === camada) ? camada : "todos";
  const lista = camadaAtual === "todos" ? visiveis : visiveis.filter((a) => a.status === camadaAtual);
  const selecionado = visiveis.find((a) => a.id === aberto) ?? null;

  // Linha do tempo: os horários e, em "Todos", o bloco do almoço no lugar certo
  const almoco = lerAlmoco(empresa.config);
  const entradas: Entrada[] = [
    ...lista.map((a) => ({
      tipo: "atendimento" as const,
      atendimento: a,
      inicio: Date.parse(a.inicio),
      fim: Date.parse(a.inicio) + minutos(a) * 60_000,
    })),
    ...(almoco && camadaAtual === "todos"
      ? [
          {
            tipo: "almoco" as const,
            inicio: Date.parse(instanteNoSalao(dia, almoco.inicio)),
            fim: Date.parse(instanteNoSalao(dia, almoco.fim)),
          },
        ]
      : []),
  ].sort((x, y) => x.inicio - y.inicio);

  // A atender -> abre a folha "Foi isso / Fez outra coisa". Realizado -> desfaz (um toque; só
  // pergunta antes quando algo vai sumir da agenda: os serviços feitos junto).
  async function alternarRealizado(a: Atendimento) {
    if (a.status !== "realizado") {
      setConfirmando(a);
      return;
    }
    let erro: string | undefined;
    if (ehFeitoJunto(a)) {
      if (!(await perguntar(`Tirar ${a.servicos?.nome ?? "este serviço"} deste atendimento?`, { confirmar: "Tirar", perigo: true }))) return;
      erro = await excluirAtendimento(a.id);
    } else {
      const extras = feitosJunto(a, ok?.atendimentos ?? []);
      const nomes = extras.map((x) => x.servicos?.nome ?? "serviço").join(", ");
      if (extras.length && !(await perguntar(`Voltar para "a atender"? O que foi feito junto (${nomes}) sai da agenda.`, { confirmar: "Desfazer" }))) return;
      erro = await desfazerConfirmacao(empresa.id, a, extras);
    }
    if (erro) await avisar(`Não deu certo: ${erro}`);
    recarregar();
  }

  // A folha continua aberta depois de salvar: em seguida pergunta se já combinou a volta
  async function confirmar(a: Atendimento, servicoIds: string[]) {
    const erro = await confirmarAtendimento(empresa.id, a, servicoIds);
    if (!erro) recarregar();
    return erro;
  }

  return (
    <>
      {/* Mês e semana */}
      <header className="px-4 pt-4">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">
            {MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1)}
            <span className="ml-2 text-lg font-medium text-neutral-400">{dia.slice(0, 4)}</span>
          </h1>
          {dia !== hoje && (
            <button
              onClick={() => setDia(hoje)}
              className="h-9 rounded-full border border-neutral-300 bg-white px-4 text-sm font-semibold active:bg-neutral-100"
            >
              Hoje
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-1">
          <button
            onClick={() => setDia(somarDias(dia, -7))}
            aria-label="Semana anterior"
            className="flex h-12 w-7 shrink-0 items-center justify-center text-2xl text-neutral-400"
          >
            ‹
          </button>
          <div className="grid flex-1 grid-cols-7 gap-1">
            {semana.map((d, i) => {
              const escolhido = d === dia;
              return (
                <button
                  key={d}
                  onClick={() => setDia(d)}
                  aria-pressed={escolhido}
                  aria-label={formatarData(d)}
                  className="flex flex-col items-center gap-1 py-1"
                >
                  <span className="text-xs font-medium text-neutral-500">{DIAS_SEMANA[i]}</span>
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-base font-semibold ${
                      escolhido
                        ? "bg-[var(--cor-principal)] text-white"
                        : d === hoje
                          ? "text-[var(--cor-principal)] ring-1 ring-[var(--cor-principal)]"
                          : "text-neutral-800"
                    }`}
                  >
                    {Number(d.slice(8))}
                  </span>
                  <span className={`h-1 w-1 rounded-full ${ok?.comHorario.has(d) ? "bg-neutral-400" : "bg-transparent"}`} />
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setDia(somarDias(dia, 7))}
            aria-label="Próxima semana"
            className="flex h-12 w-7 shrink-0 items-center justify-center text-2xl text-neutral-400"
          >
            ›
          </button>
        </div>
      </header>

      {/* Camadas por status */}
      <div className="mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {camadas.map((c) => (
          <button
            key={c.chave}
            onClick={() => setCamada(c.chave)}
            aria-pressed={camadaAtual === c.chave}
            className={`h-9 shrink-0 rounded-full px-3 text-sm font-semibold ${
              camadaAtual === c.chave ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-700"
            }`}
          >
            {c.rotulo} {ok ? contagem[c.chave] : ""}
          </button>
        ))}
      </div>

      <section className="mt-3 px-4">
        {!dados && <p className="text-neutral-500">Carregando…</p>}
        {dados && "erro" in dados && <p className="rounded-xl bg-red-100 p-4 text-red-900">Erro: {dados.erro}</p>}

        {ok && camadaAtual === "reagendado" && (
          <div className="space-y-3">
            {ok.reagendados.length === 0 && <Vazio texto="Nenhum horário deste dia foi reagendado." />}
            {ok.reagendados.map((a) => (
              <CartaoReagendado key={a.id} atendimento={a} aoVerDia={setDia} />
            ))}
          </div>
        )}

        {ok && camadaAtual !== "reagendado" && (
          <>
            {lista.length === 0 && (
              <Vazio texto={camadaAtual === "todos" ? "Dia livre. Nenhum horário marcado." : "Nenhum horário aqui neste dia."} />
            )}
            <ol>
              {entradas.map((e, i) => {
                const fimAnterior = i > 0 ? Math.max(...entradas.slice(0, i).map((x) => x.fim)) : null;
                const livre = fimAnterior ? Math.round((e.inicio - fimAnterior) / 60_000) : 0;
                const ultimo = i === entradas.length - 1;
                return (
                  <li key={e.tipo === "almoco" ? "almoco" : e.atendimento.id}>
                    {camadaAtual === "todos" && livre >= 30 && <IntervaloLivre minutos={livre} />}
                    {e.tipo === "almoco" ? (
                      <BlocoAlmoco texto={textoAlmoco(almoco!)} ultimo={ultimo} />
                    ) : (
                      <ItemLinhaDoTempo
                        atendimento={e.atendimento}
                        barra={corDaProfissional(e.atendimento.profissional_id, ordem).ponto}
                        ultimo={ultimo}
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
          aoFechar={() => setConfirmando(null)}
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
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-300" />
            <DetalheHorario atendimento={selecionado} />
            <button
              onClick={() => setAberto(null)}
              className="my-4 h-12 w-full rounded-xl border border-neutral-300 bg-white font-semibold active:bg-neutral-100"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// O ✓ de um horário a atender: quase sempre "Foi isso" (1 toque). Se a cliente fez outra coisa
// ou mais coisas (marcou hidratação e fez mega hair), a dona marca o que fez de verdade.
// Salvo, se algum serviço feito tem retorno, já pergunta "Já combinou a volta?" (MarcarVolta).
function FolhaConfirmar({
  atendimento: a,
  servicos,
  aoConfirmar,
  aoFechar,
}: {
  atendimento: Atendimento;
  servicos: ServicoAtivo[];
  aoConfirmar: (servicoIds: string[]) => Promise<string | undefined>;
  aoFechar: () => void;
}) {
  const [mudou, setMudou] = useState(false);
  const [escolhidos, setEscolhidos] = useState<string[]>(a.servico_id ? [a.servico_id] : []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [volta, setVolta] = useState<ServicoAtivo[] | null>(null);

  function alternar(id: string) {
    setEscolhidos((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  async function salvar(ids: string[]) {
    setSalvando(true);
    setErro("");
    const falhou = await aoConfirmar(ids);
    setSalvando(false);
    if (falhou) {
      setErro(falhou);
      return;
    }
    const feitos = (ids.length ? ids : [a.servico_id])
      .map((id) => servicos.find((s) => s.id === id))
      .filter((s): s is ServicoAtivo => !!s?.dias_retorno);
    if (feitos.length) setVolta(feitos);
    else aoFechar();
  }

  const chip = (ativo: boolean) =>
    `h-11 rounded-full px-4 font-semibold ${ativo ? "chip-ativo" : "bg-neutral-100 text-neutral-800"}`;

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={aoFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar atendimento"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--background)] px-4 pt-3 pb-safe"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-neutral-300" />
        <p className="text-xl font-bold">
          {a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")} · {formatarHora(a.inicio)}
        </p>

        {volta ? (
          <MarcarVolta atendimento={a} feitos={volta} servicos={servicos} aoFechar={aoFechar} />
        ) : (
          <>
            <p className="text-neutral-500">Marcado: {a.servicos?.nome ?? "serviço não informado"}</p>

            {!mudou ? (
              <div className="my-4 space-y-2">
                <button
                  onClick={() => salvar([])}
                  disabled={salvando}
                  className="h-14 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-60"
                >
                  ✓ Foi isso
                </button>
                <button
                  onClick={() => setMudou(true)}
                  className="h-12 w-full rounded-xl border border-neutral-300 bg-white font-semibold active:bg-neutral-100"
                >
                  Fez outra coisa
                </button>
              </div>
            ) : (
              <div className="my-4">
                <p className="mb-2 font-semibold">O que ela fez? (pode marcar mais de um)</p>
                <div className="flex flex-wrap gap-2">
                  {servicos.map((s) => (
                    <button key={s.id} onClick={() => alternar(s.id)} aria-pressed={escolhidos.includes(s.id)} className={chip(escolhidos.includes(s.id))}>
                      {s.nome}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => salvar(escolhidos)}
                  disabled={salvando || escolhidos.length === 0}
                  className="mt-4 h-14 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-60"
                >
                  Salvar como realizado
                </button>
              </div>
            )}

            {erro && <p className="mb-3 rounded-xl bg-red-100 p-3 text-red-900">Não salvou: {erro}</p>}
            <button
              onClick={aoFechar}
              className="mb-4 h-12 w-full rounded-xl border border-neutral-300 bg-white font-semibold active:bg-neutral-100"
            >
              Voltar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-center text-neutral-500">{texto}</p>;
}

// Círculo de status, discreto: vazio = a atender, ✓ = realizado, ✕ = faltou, – = cancelado
const ICONE_STATUS: Record<StatusAtendimento, { simbolo: string; classe: string; rotulo: string }> = {
  agendado: { simbolo: "", classe: "border-[1.5px] border-neutral-300 bg-white", rotulo: "Marcar como realizado" },
  realizado: { simbolo: "✓", classe: "bg-emerald-500 text-white", rotulo: "Realizado (tocar desfaz)" },
  faltou: { simbolo: "✕", classe: "bg-red-400 text-white", rotulo: "Faltou" },
  cancelado: { simbolo: "–", classe: "bg-neutral-300 text-white", rotulo: "Cancelado" },
};

// Linha do tempo enxuta: hora, uma barrinha fina (altura = duração, cor = profissional),
// e o texto. Sem ícones nem efeitos.
function ItemLinhaDoTempo({
  atendimento: a,
  barra,
  ultimo,
  aoAbrir,
  aoMarcar,
}: {
  atendimento: Atendimento;
  barra: string;
  ultimo: boolean;
  aoAbrir: () => void;
  aoMarcar: () => void;
}) {
  const min = minutos(a);
  // Altura da barra acompanha a duração (com limites para caber na tela)
  const altura = Math.min(110, Math.max(40, Math.round(min * 0.7)));
  const icone = ICONE_STATUS[a.status];
  const apagado = a.status === "cancelado" || a.status === "faltou";
  const reagendado = ultimoReagendamento(a);

  return (
    <div className="flex gap-3">
      {/* Coluna da hora */}
      <p className="w-10 shrink-0 pt-0.5 text-right text-xs font-semibold text-neutral-400">{formatarHora(a.inicio)}</p>

      {/* Barrinha + linha fina até o próximo horário */}
      <div className="relative flex w-3 shrink-0 justify-center">
        {!ultimo && <span className="absolute top-1 bottom-0 left-1/2 w-px -translate-x-1/2 bg-neutral-200" />}
        <span style={{ height: altura }} className={`relative w-1.5 rounded-full ${barra} ${apagado ? "opacity-40" : ""}`} />
      </div>

      {/* Informações */}
      <button onClick={aoAbrir} className="min-w-0 flex-1 pb-5 text-left">
        <p className="text-xs text-neutral-400">
          {formatarHora(a.inicio)}
          {a.fim && ` – ${formatarHora(a.fim)}`} · {duracao(min)}
          {a.origem === "ia" && " · IA"}
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={`text-base leading-snug font-semibold ${a.status === "cancelado" ? "text-neutral-400 line-through" : ""}`}>
            {a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")}
          </p>
          {a.clientes && <Etiquetas etiquetas={a.clientes.etiquetas} className="" />}
        </div>
        <Observacao texto={a.clientes?.observacoes} />
        <p className="text-sm text-neutral-500">
          {a.servicos?.nome ?? "Serviço não informado"}
        </p>
        {a.status === "faltou" && <p className="text-xs font-semibold text-red-500">Faltou</p>}
        {a.status === "cancelado" && <p className="text-xs font-semibold text-neutral-400">Cancelado</p>}
        {reagendado && <p className="text-xs text-neutral-400">{reagendado}</p>}
      </button>

      {/* Círculo de concluído: um toque marca realizado */}
      <div className="shrink-0 pt-0.5">
        <button
          onClick={aoMarcar}
          disabled={a.status === "faltou" || a.status === "cancelado"}
          aria-label={icone.rotulo}
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${icone.classe}`}
        >
          {icone.simbolo}
        </button>
      </div>
    </div>
  );
}

// Almoço na linha do tempo: uma faixa cinza simples, sem ações
function BlocoAlmoco({ texto, ultimo }: { texto: string; ultimo: boolean }) {
  return (
    <div className="flex gap-3">
      <p className="w-10 shrink-0 pt-0.5 text-right text-xs font-semibold text-neutral-300">{texto.slice(0, 5)}</p>
      <div className="relative flex w-3 shrink-0 justify-center">
        {!ultimo && <span className="absolute top-1 bottom-0 left-1/2 w-px -translate-x-1/2 bg-neutral-200" />}
        <span className="relative h-10 w-1.5 rounded-full bg-neutral-200" />
      </div>
      <p className="flex-1 pb-5 text-sm text-neutral-400">
        <span className="font-semibold text-neutral-500">Almoço</span> · {texto}
      </p>
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
function DetalheHorario({ atendimento: a }: { atendimento: Atendimento }) {
  const reagendado = ultimoReagendamento(a);
  const linhas: [string, string][] = [
    ["Horário", `${formatarHora(a.inicio)}${a.fim ? ` até ${formatarHora(a.fim)}` : ""}`],
    ["Serviço", a.servicos?.nome ?? "Não informado"],
    ...(a.clientes ? ([["Telefone", formatarTelefone(a.clientes.telefone)]] as [string, string][]) : []),
    ["Situação", ROTULO_STATUS[a.status]],
    ...(reagendado ? ([["Reagendado", reagendado.replace("Reagendado de ", "era ")]] as [string, string][]) : []),
    ...(a.origem === "ia" ? ([["Marcado por", "IA"]] as [string, string][]) : []),
  ];
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xl font-bold">{a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")}</p>
        {a.clientes && <Etiquetas etiquetas={a.clientes.etiquetas} className="" />}
      </div>
      <Observacao texto={a.clientes?.observacoes} />
      <dl className="mt-3 divide-y divide-neutral-100">
        {linhas.map(([rotulo, valor]) => (
          <div key={rotulo} className="flex justify-between gap-4 py-2">
            <dt className="text-neutral-500">{rotulo}</dt>
            <dd className="text-right font-medium">{valor}</dd>
          </div>
        ))}
      </dl>
      {a.clientes && (
        <Link
          href={`/clientes/${a.clientes.id}`}
          className="mt-3 flex h-11 items-center justify-center rounded-xl border border-neutral-300 font-semibold active:bg-neutral-100"
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
    <div className="flex gap-3">
      <span className="w-10 shrink-0" />
      <div className="relative flex w-3 shrink-0 justify-center">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l border-dashed border-neutral-300" />
      </div>
      <p className="-mt-2 flex-1 pb-4 text-xs text-neutral-400">{duracao(min)} livre</p>
    </div>
  );
}

// Horário que era deste dia e foi para outro: mostra de quando para quando
function CartaoReagendado({ atendimento: a, aoVerDia }: { atendimento: Atendimento; aoVerDia: (dia: string) => void }) {
  const novoDia = dataNoSalao(a.inicio);
  return (
    <article className="rounded-xl border border-l-4 border-neutral-200 border-l-sky-300 bg-white p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-lg font-semibold">{a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")}</p>
        {a.clientes && <Etiquetas etiquetas={a.clientes.etiquetas} className="" />}
      </div>
      <p className="text-neutral-600">
        {a.servicos?.nome ?? "Serviço não informado"}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-neutral-50 p-2 text-sm">
        <div>
          <p className="text-neutral-500">Era</p>
          <p className="font-medium">{ultimoReagendamento(a)?.replace("Reagendado de ", "") ?? "—"}</p>
        </div>
        <div>
          <p className="text-neutral-500">Agora</p>
          <p className="font-semibold">
            {formatarData(a.inicio).slice(0, 5)} às {formatarHora(a.inicio)}
          </p>
        </div>
      </div>
      <button
        onClick={() => aoVerDia(novoDia)}
        className="mt-2 h-11 w-full rounded-xl border border-neutral-300 bg-white font-semibold active:bg-neutral-100"
      >
        Ver no dia {formatarData(novoDia).slice(0, 5)}
      </button>
    </article>
  );
}
