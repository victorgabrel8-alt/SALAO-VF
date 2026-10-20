"use client";

import { useEffect, useState } from "react";
import { BotaoFlutuante } from "@/components/BotaoFlutuante";
import { Cabecalho } from "@/components/Cabecalho";
import { CartaoAtendimento } from "@/components/CartaoAtendimento";
import { Etiquetas } from "@/components/Etiquetas";
import { FormAtendimento } from "@/components/FormAtendimento";
import {
  buscarAtendimentosDoDia,
  buscarReagendadosDoDia,
  corDaProfissional,
  ultimoReagendamento,
  type Atendimento,
} from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { dataNoSalao, formatarData, formatarDiaLongo, formatarHora, formatarTelefone, hojeNoSalao, somarDias } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import type { Profissional } from "@/lib/tipos";

type Camada = "agendado" | "realizado" | "faltou" | "cancelado" | "reagendado";

// Cada horário do dia fica numa "camada" conforme o status. Ao tocar em Realizado,
// Faltou, Cancelado ou reagendar para outro dia, ele sai de "A atender" e vai para a
// camada certa, onde a dona confere quem já foi atendida, quem faltou etc.
const CAMADAS: { chave: Camada; rotulo: string; ponto: string; vazio: string }[] = [
  { chave: "agendado", rotulo: "A atender", ponto: "bg-neutral-300", vazio: "Nenhum horário esperando atendimento neste dia." },
  { chave: "realizado", rotulo: "Realizados", ponto: "bg-green-500", vazio: "Nenhum atendimento realizado neste dia." },
  { chave: "faltou", rotulo: "Faltaram", ponto: "bg-red-500", vazio: "Ninguém faltou neste dia." },
  { chave: "cancelado", rotulo: "Cancelados", ponto: "bg-neutral-400", vazio: "Nenhum horário cancelado neste dia." },
  { chave: "reagendado", rotulo: "Reagendados", ponto: "bg-sky-400", vazio: "Nenhum horário deste dia foi reagendado." },
];

type Dia =
  | { camadas: Record<Camada, Atendimento[]>; profissionais: Profissional[] }
  | { erro: string };

async function buscarDia(empresaId: string, dia: string): Promise<Dia> {
  const [atendimentos, reagendados, profissionais] = await Promise.all([
    buscarAtendimentosDoDia(empresaId, dia),
    buscarReagendadosDoDia(empresaId, dia),
    supabase().from("profissionais").select("id, nome").eq("empresa_id", empresaId).order("nome"),
  ]);
  if (atendimentos.erro) return { erro: atendimentos.erro };
  if (reagendados.erro) return { erro: reagendados.erro };
  if (profissionais.error) return { erro: profissionais.error.message };
  const doDia = atendimentos.atendimentos;
  return {
    camadas: {
      agendado: doDia.filter((a) => a.status === "agendado"),
      realizado: doDia.filter((a) => a.status === "realizado"),
      faltou: doDia.filter((a) => a.status === "faltou"),
      cancelado: doDia.filter((a) => a.status === "cancelado"),
      reagendado: reagendados.atendimentos,
    },
    profissionais: profissionais.data as Profissional[],
  };
}

export default function AgendaPage() {
  const empresa = useEmpresa();
  const [dia, setDia] = useState(hojeNoSalao());
  const [camada, setCamada] = useState<Camada>("agendado");
  const [resultado, setResultado] = useState<{ dia: string; dados: Dia } | null>(null);
  const [versao, setVersao] = useState(0);
  const [marcando, setMarcando] = useState(false);
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
  const atual = CAMADAS.find((c) => c.chave === camada)!;
  const lista = ok ? ok.camadas[camada] : [];

  return (
    <>
      <Cabecalho titulo="Agenda" />

      <div className="flex items-center gap-2 px-4">
        <button
          onClick={() => setDia(somarDias(dia, -1))}
          aria-label="Dia anterior"
          className="h-12 w-12 shrink-0 rounded-full border border-neutral-300 bg-white text-2xl font-bold active:bg-neutral-100"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="text-lg leading-tight font-bold">{formatarDiaLongo(dia)}</p>
          {dia === hoje ? (
            <p className="text-sm font-semibold text-[var(--cor-principal)]">Hoje</p>
          ) : (
            <button onClick={() => setDia(hoje)} className="text-sm font-semibold text-[var(--cor-principal)] underline">
              Voltar para hoje
            </button>
          )}
        </div>
        <button
          onClick={() => setDia(somarDias(dia, 1))}
          aria-label="Próximo dia"
          className="h-12 w-12 shrink-0 rounded-full border border-neutral-300 bg-white text-2xl font-bold active:bg-neutral-100"
        >
          ›
        </button>
      </div>

      {/* Camadas do dia: cada botão abre a lista daquele status, com o total */}
      <nav aria-label="Status dos horários" className="mx-4 mt-4 rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm">
        {/* "A atender" em cima, ocupando a linha; as outras quatro em 2 × 2 */}
        <div className="grid grid-cols-2 gap-2">
          {CAMADAS.map((c) => (
            <button
              key={c.chave}
              onClick={() => setCamada(c.chave)}
              aria-pressed={camada === c.chave}
              className={`flex h-14 items-center justify-between rounded-xl px-3 ${
                camada === c.chave ? "chip-ativo" : "bg-neutral-50 active:bg-neutral-100"
              } ${c.chave === "agendado" ? "col-span-2" : ""}`}
            >
              <span className="flex items-center gap-1.5 font-semibold">
                <span className={`h-2.5 w-2.5 rounded-full ${c.ponto}`} />
                {c.rotulo}
              </span>
              <span className="text-xl font-bold">{ok ? ok.camadas[c.chave].length : "–"}</span>
            </button>
          ))}
        </div>
      </nav>

      {ok && ok.profissionais.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 px-4">
          {ok.profissionais.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5 text-sm font-medium text-neutral-600">
              <span className={`h-3 w-3 rounded-full ${corDaProfissional(p.id, ordem).ponto}`} />
              {p.nome}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-4 space-y-3 px-4">
        <h2 className="text-lg font-semibold">
          {atual.rotulo} <span className="font-normal text-neutral-500">({lista.length})</span>
        </h2>
        {!dados && <p className="text-neutral-500">Carregando…</p>}
        {dados && "erro" in dados && <p className="rounded-xl bg-red-100 p-4 text-red-900">Erro: {dados.erro}</p>}
        {ok && lista.length === 0 && (
          <p className="rounded-2xl border border-neutral-200 bg-white p-4 text-center text-neutral-500">{atual.vazio}</p>
        )}
        {ok &&
          (camada === "reagendado"
            ? lista.map((a) => <CartaoReagendado key={a.id} atendimento={a} aoVerDia={setDia} />)
            : lista.map((a) => (
                <CartaoAtendimento
                  key={a.id}
                  atendimento={a}
                  cor={corDaProfissional(a.profissional_id, ordem).borda}
                  aoMudar={recarregar}
                  permitirExcluir
                  detalhado
                />
              )))}
      </section>

      <div className="h-20" />
      <BotaoFlutuante rotulo="+ Novo horário" aoTocar={() => setMarcando(true)} />
      {marcando && (
        <FormAtendimento
          modo="agendar"
          dia={dia}
          aoFechar={() => setMarcando(false)}
          aoSalvar={() => {
            setMarcando(false);
            recarregar();
          }}
        />
      )}
    </>
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
      {a.clientes && <p className="text-sm text-neutral-600">{formatarTelefone(a.clientes.telefone)}</p>}
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
