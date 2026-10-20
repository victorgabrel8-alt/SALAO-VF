"use client";

import { useEffect, useState } from "react";
import { BotaoFlutuante } from "@/components/BotaoFlutuante";
import { CartaoAtendimento } from "@/components/CartaoAtendimento";
import { Etiquetas } from "@/components/Etiquetas";
import { FormAtendimento } from "@/components/FormAtendimento";
import {
  buscarAtendimentosDoDia,
  buscarDiasComHorario,
  buscarReagendadosDoDia,
  corDaProfissional,
  mudarStatus,
  ultimoReagendamento,
  type Atendimento,
  type StatusAtendimento,
} from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { dataNoSalao, formatarData, formatarHora, formatarTelefone, hojeNoSalao, somarDias } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import type { Profissional } from "@/lib/tipos";

// Agenda no estilo do app Structured: faixa da semana em cima e o dia como uma linha do
// tempo, cada horário numa "cápsula" (altura = duração, cor = profissional), com os
// intervalos livres entre eles. O círculo à direita marca como realizado com um toque;
// tocar no horário abre todos os detalhes e ações.

type Camada = "todos" | StatusAtendimento | "reagendado";

const CAMADAS: { chave: Camada; rotulo: string }[] = [
  { chave: "todos", rotulo: "Todos" },
  { chave: "agendado", rotulo: "A atender" },
  { chave: "realizado", rotulo: "Realizados" },
  { chave: "faltou", rotulo: "Faltaram" },
  { chave: "cancelado", rotulo: "Cancelados" },
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
  const [novo, setNovo] = useState<{ hora?: string } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const recarregar = () => setVersao((v) => v + 1);

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

  const contagem: Record<Camada, number> = {
    todos: ok?.atendimentos.length ?? 0,
    agendado: ok?.atendimentos.filter((a) => a.status === "agendado").length ?? 0,
    realizado: ok?.atendimentos.filter((a) => a.status === "realizado").length ?? 0,
    faltou: ok?.atendimentos.filter((a) => a.status === "faltou").length ?? 0,
    cancelado: ok?.atendimentos.filter((a) => a.status === "cancelado").length ?? 0,
    reagendado: ok?.reagendados.length ?? 0,
  };
  const lista = !ok ? [] : camada === "todos" ? ok.atendimentos : ok.atendimentos.filter((a) => a.status === camada);
  const selecionado = ok?.atendimentos.find((a) => a.id === aberto) ?? null;

  async function alternarRealizado(a: Atendimento) {
    await mudarStatus(a.id, a.status === "realizado" ? "agendado" : "realizado");
    recarregar();
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
        {CAMADAS.map((c) => (
          <button
            key={c.chave}
            onClick={() => setCamada(c.chave)}
            aria-pressed={camada === c.chave}
            className={`h-9 shrink-0 rounded-full px-3 text-sm font-semibold ${
              camada === c.chave ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-700"
            }`}
          >
            {c.rotulo} {ok ? contagem[c.chave] : ""}
          </button>
        ))}
      </div>

      <section className="mt-3 px-4">
        {!dados && <p className="text-neutral-500">Carregando…</p>}
        {dados && "erro" in dados && <p className="rounded-xl bg-red-100 p-4 text-red-900">Erro: {dados.erro}</p>}

        {ok && camada === "reagendado" && (
          <div className="space-y-3">
            {ok.reagendados.length === 0 && <Vazio texto="Nenhum horário deste dia foi reagendado." />}
            {ok.reagendados.map((a) => (
              <CartaoReagendado key={a.id} atendimento={a} aoVerDia={setDia} />
            ))}
          </div>
        )}

        {ok && camada !== "reagendado" && (
          <>
            {lista.length === 0 && (
              <Vazio texto={camada === "todos" ? "Dia livre. Nenhum horário marcado." : "Nenhum horário aqui neste dia."} />
            )}
            <ol>
              {lista.map((a, i) => {
                const anterior = lista[i - 1];
                const fimAnterior = anterior ? Date.parse(anterior.fim ?? anterior.inicio) + (anterior.fim ? 0 : 3_600_000) : null;
                const livre = fimAnterior ? Math.round((Date.parse(a.inicio) - fimAnterior) / 60_000) : 0;
                return (
                  <li key={a.id}>
                    {camada === "todos" && livre >= 30 && anterior && (
                      <IntervaloLivre
                        minutos={livre}
                        aoMarcar={() => setNovo({ hora: formatarHora(new Date(fimAnterior!).toISOString()) })}
                      />
                    )}
                    <ItemLinhaDoTempo
                      atendimento={a}
                      capsula={corDaProfissional(a.profissional_id, ordem).capsula}
                      ultimo={i === lista.length - 1}
                      aoAbrir={() => setAberto(a.id)}
                      aoMarcar={() => alternarRealizado(a)}
                    />
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {ok && ok.profissionais.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
            {ok.profissionais.map((p) => (
              <li key={p.id} className="flex items-center gap-1.5 text-sm text-neutral-500">
                <span className={`h-3 w-3 rounded-full ${corDaProfissional(p.id, ordem).ponto}`} />
                {p.nome}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="h-20" />
      <BotaoFlutuante rotulo="+ Novo horário" aoTocar={() => setNovo({})} />

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
            <CartaoAtendimento
              atendimento={selecionado}
              cor={corDaProfissional(selecionado.profissional_id, ordem).borda}
              aoMudar={recarregar}
              permitirExcluir
              detalhado
            />
            <button
              onClick={() => setAberto(null)}
              className="my-4 h-12 w-full rounded-xl border border-neutral-300 bg-white font-semibold active:bg-neutral-100"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {novo && (
        <FormAtendimento
          modo="agendar"
          dia={dia}
          horaInicial={novo.hora}
          aoFechar={() => setNovo(null)}
          aoSalvar={() => {
            setNovo(null);
            recarregar();
          }}
        />
      )}
    </>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-2xl border border-neutral-200 bg-white p-6 text-center text-neutral-500">{texto}</p>;
}

const ICONE_STATUS: Record<StatusAtendimento, { simbolo: string; classe: string; rotulo: string }> = {
  agendado: { simbolo: "", classe: "border-2 border-neutral-300 bg-white", rotulo: "Marcar como realizado" },
  realizado: { simbolo: "✓", classe: "bg-green-500 text-white", rotulo: "Realizado (tocar desfaz)" },
  faltou: { simbolo: "✕", classe: "bg-red-500 text-white", rotulo: "Faltou" },
  cancelado: { simbolo: "–", classe: "bg-neutral-400 text-white", rotulo: "Cancelado" },
};

function ItemLinhaDoTempo({
  atendimento: a,
  capsula,
  ultimo,
  aoAbrir,
  aoMarcar,
}: {
  atendimento: Atendimento;
  capsula: string;
  ultimo: boolean;
  aoAbrir: () => void;
  aoMarcar: () => void;
}) {
  const min = minutos(a);
  // Altura da cápsula acompanha a duração (com limites para caber na tela)
  const altura = Math.min(140, Math.max(56, Math.round(min * 0.9)));
  const icone = ICONE_STATUS[a.status];
  const apagado = a.status === "cancelado" || a.status === "faltou";
  const reagendado = ultimoReagendamento(a);

  return (
    <div className="flex gap-3">
      {/* Coluna da hora */}
      <p className="w-11 shrink-0 pt-2 text-right text-sm font-medium text-neutral-500">{formatarHora(a.inicio)}</p>

      {/* Cápsula + linha que liga um horário ao próximo */}
      <div className="relative flex w-12 shrink-0 justify-center">
        {!ultimo && <span className="absolute top-2 bottom-0 left-1/2 w-px -translate-x-1/2 border-l-2 border-dotted border-neutral-300" />}
        <button
          onClick={aoAbrir}
          aria-label={`Abrir horário de ${a.clientes?.nome ?? "cliente"}`}
          style={{ height: altura }}
          className={`relative flex w-11 items-start justify-center rounded-full pt-3 text-lg ${capsula} ${apagado ? "opacity-40" : ""}`}
        >
          {a.origem === "ia" ? "✨" : "✂️"}
        </button>
      </div>

      {/* Informações */}
      <button onClick={aoAbrir} className="min-w-0 flex-1 pt-1 pb-5 text-left">
        <p className="text-sm text-neutral-500">
          {formatarHora(a.inicio)}
          {a.fim && ` – ${formatarHora(a.fim)}`} ({duracao(min)})
        </p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className={`text-lg leading-tight font-semibold ${a.status === "cancelado" ? "text-neutral-400 line-through" : ""}`}>
            {a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")}
          </p>
          {a.clientes && <Etiquetas etiquetas={a.clientes.etiquetas} className="" />}
        </div>
        <p className="text-neutral-600">
          {[a.servicos?.nome ?? "Serviço não informado", a.profissionais?.nome].filter(Boolean).join(" · ")}
        </p>
        {a.status === "faltou" && <p className="text-sm font-medium text-red-600">Faltou</p>}
        {a.status === "cancelado" && <p className="text-sm font-medium text-neutral-500">Cancelado</p>}
        {reagendado && <p className="text-sm text-neutral-500">{reagendado}</p>}
      </button>

      {/* Círculo de concluído (como no Structured): um toque marca realizado */}
      <div className="shrink-0 pt-3">
        <button
          onClick={aoMarcar}
          disabled={a.status === "faltou" || a.status === "cancelado"}
          aria-label={icone.rotulo}
          className={`flex h-8 w-8 items-center justify-center rounded-full text-base font-bold ${icone.classe}`}
        >
          {icone.simbolo}
        </button>
      </div>
    </div>
  );
}

function IntervaloLivre({ minutos: min, aoMarcar }: { minutos: number; aoMarcar: () => void }) {
  return (
    <div className="flex gap-3">
      <span className="w-11 shrink-0" />
      <div className="relative flex w-12 shrink-0 justify-center">
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 border-l-2 border-dotted border-neutral-300" />
      </div>
      <button onClick={aoMarcar} className="flex-1 py-2 text-left text-sm text-neutral-500 active:text-neutral-700">
        {duracao(min)} livre · <span className="font-semibold text-[var(--cor-principal)]">+ marcar</span>
      </button>
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
        {[a.servicos?.nome ?? "Serviço não informado", a.profissionais?.nome].filter(Boolean).join(" · ")}
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
