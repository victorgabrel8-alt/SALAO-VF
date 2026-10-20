"use client";

import Link from "next/link";
import { useState } from "react";
import { Etiquetas } from "@/components/Etiquetas";
import { useDialogo } from "@/components/Dialogo";
import { excluirCliente, textoExclusao } from "@/lib/excluidas";
import {
  excluirAtendimento,
  mudarStatus,
  reagendar,
  ultimoReagendamento,
  type Atendimento,
  type StatusAtendimento,
} from "@/lib/atendimentos";
import { dataNoSalao, formatarHora, formatarTelefone, instanteNoSalao, somarDias } from "@/lib/formato";

const ROTULO: Record<StatusAtendimento, string> = {
  agendado: "Agendado",
  realizado: "Realizado",
  cancelado: "Cancelado",
  faltou: "Faltou",
};

// Selo neutro com um pontinho de cor (a cor só sinaliza)
const PONTO: Record<StatusAtendimento, string> = {
  agendado: "bg-neutral-300",
  realizado: "bg-green-500",
  cancelado: "bg-neutral-400",
  faltou: "bg-red-500",
};

const BOTOES: { status: StatusAtendimento; rotulo: string }[] = [
  { status: "realizado", rotulo: "Realizado" },
  { status: "faltou", rotulo: "Faltou" },
  { status: "cancelado", rotulo: "Cancelado" },
];

// Valor cobrado (realizado) ou, se ainda não tem, o preço do serviço
function valorDoAtendimento(a: Atendimento): number | null {
  return a.valor ?? a.servicos?.preco ?? null;
}

function formatarValor(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Um horário com os botões de um toque: Realizado · Faltou · Cancelado · Reagendar.
// Tocar de novo no status atual volta para "agendado" (para desfazer um toque errado).
export function CartaoAtendimento({
  atendimento: a,
  cor,
  aoMudar,
  permitirExcluir = false,
  detalhado = false,
}: {
  atendimento: Atendimento;
  cor: string;
  aoMudar: () => void;
  // Menu ⋯ com "Excluir cliente" / "Apagar só este horário"
  permitirExcluir?: boolean;
  // Agenda: mostra também horário de término, telefone e valor
  detalhado?: boolean;
}) {
  const [salvando, setSalvando] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const { dialogo, perguntar, avisar } = useDialogo();
  const [aviso, setAviso] = useState("");
  const [reagendando, setReagendando] = useState(false);
  // Reagendar já sugere o dia seguinte (a dona troca se quiser)
  const [novoDia, setNovoDia] = useState(somarDias(dataNoSalao(a.inicio), 1));
  const [novaHora, setNovaHora] = useState(formatarHora(a.inicio));

  const reagendado = ultimoReagendamento(a);
  // O app ainda não mexe no Google Agenda: se o horário está lá, a dona precisa mudar lá também
  const avisoGoogle = a.google_event_id || a.origem === "ia";

  async function escolher(status: StatusAtendimento) {
    const novo = a.status === status ? "agendado" : status;
    const nome = a.clientes?.nome ?? "esta cliente";
    if (novo === "cancelado" && !(await perguntar(`Cancelar o horário de ${nome}?`, { confirmar: "Cancelar horário" }))) return;

    setSalvando(true);
    const erro = await mudarStatus(a.id, novo);
    setSalvando(false);
    if (erro) {
      setAviso(`Não foi possível salvar: ${erro}`);
      return;
    }
    setAviso("");
    // Alerta (e não aviso no cartão): no Início o cartão cancelado some da lista
    if (novo === "cancelado" && avisoGoogle) await avisar("Lembre de apagar também do Google Agenda.");
    aoMudar();
  }

  // Excluir a cliente: ela some do Início, da Agenda e de Clientes e vai para
  // Configurações → Clientes excluídas (dá para restaurar)
  async function excluirClienteDoCartao() {
    setMenuAberto(false);
    if (!a.clientes || !(await perguntar(textoExclusao(a.clientes.nome), { confirmar: "Excluir", perigo: true }))) return;
    setSalvando(true);
    const erro = await excluirCliente(a.clientes.id);
    setSalvando(false);
    if (erro) {
      setAviso(`Não foi possível excluir: ${erro}`);
      return;
    }
    aoMudar();
  }

  // Apagar só este horário (ex.: lançado por engano). Este não tem volta.
  async function apagarHorario() {
    setMenuAberto(false);
    const nome = a.clientes?.nome ?? "esta cliente";
    const texto = `Apagar de vez o horário das ${formatarHora(a.inicio)} de ${nome}?\n\nIsso não pode ser desfeito.`;
    if (!(await perguntar(texto, { confirmar: "Apagar", perigo: true }))) return;
    setSalvando(true);
    const erro = await excluirAtendimento(a.id);
    setSalvando(false);
    if (erro) {
      setAviso(`Não foi possível excluir: ${erro}`);
      return;
    }
    if (avisoGoogle) await avisar("Apagado. Lembre de apagar também do Google Agenda.");
    aoMudar();
  }

  async function confirmarReagendamento() {
    setSalvando(true);
    const erro = await reagendar(a, instanteNoSalao(novoDia, novaHora));
    setSalvando(false);
    if (erro) {
      setAviso(`Não foi possível reagendar: ${erro}`);
      return;
    }
    setReagendando(false);
    setAviso("");
    // Alerta: se mudou de dia, o cartão sai da lista deste dia
    if (avisoGoogle) await avisar("Reagendado. Lembre de mudar também no Google Agenda.");
    aoMudar();
  }

  const botao = (ativo: boolean) =>
    `h-12 rounded-xl font-semibold disabled:opacity-50 ${
      ativo ? "chip-ativo" : "border border-neutral-300 text-neutral-800 active:bg-neutral-100"
    }`;

  return (
    // relative + z-20 com o menu aberto: o menu ⋯ fica por cima do cartão de baixo
    <article className={`relative rounded-xl border border-l-4 border-neutral-200 bg-white p-3 ${cor} ${menuAberto ? "z-20" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xl font-bold">
            {formatarHora(a.inicio)}
            {detalhado && a.fim && <span className="text-base font-medium text-neutral-500"> até {formatarHora(a.fim)}</span>}
          </p>
          {a.clientes ? (
            // Etiquetas da cliente (vip, alergia...) ao lado do nome
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link href={`/clientes/${a.clientes.id}`} className="text-lg font-semibold underline-offset-2 active:underline">
                {a.clientes.nome ?? formatarTelefone(a.clientes.telefone)}
              </Link>
              <Etiquetas etiquetas={a.clientes.etiquetas} className="" />
            </div>
          ) : (
            <p className="text-lg font-semibold">Cliente removida</p>
          )}
          <p className="text-neutral-600">
            {[a.servicos?.nome ?? "Serviço não informado", a.profissionais?.nome].filter(Boolean).join(" · ")}
          </p>
          {/* Na Agenda, mais informação: telefone e valor */}
          {detalhado && (
            <p className="text-sm text-neutral-600">
              {[
                a.clientes && formatarTelefone(a.clientes.telefone),
                valorDoAtendimento(a) !== null && formatarValor(valorDoAtendimento(a)!),
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
          {a.origem === "ia" && <p className="text-sm text-neutral-500">Marcado pela IA</p>}
          {reagendado && <p className="text-sm text-neutral-500">{reagendado}</p>}
        </div>
        <div className="flex shrink-0 items-start gap-1">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-0.5 text-sm font-medium text-neutral-700">
            <span className={`h-2 w-2 rounded-full ${PONTO[a.status]}`} />
            {ROTULO[a.status]}
          </span>
          {permitirExcluir && (
            <div className="relative">
              <button
                onClick={() => setMenuAberto(!menuAberto)}
                aria-label="Mais opções"
                aria-expanded={menuAberto}
                className="-mt-2 -mr-2 flex h-11 w-11 items-center justify-center rounded-full text-2xl leading-none text-neutral-500 active:bg-neutral-100"
              >
                ⋯
              </button>
              {menuAberto && (
                <div className="absolute top-9 right-0 z-10 w-56 rounded-xl border border-neutral-200 bg-white p-1 shadow-lg">
                  {a.clientes && (
                    <button
                      onClick={excluirClienteDoCartao}
                      disabled={salvando}
                      className="h-11 w-full rounded-lg px-3 text-left font-semibold text-red-700 active:bg-red-50 disabled:opacity-50"
                    >
                      Excluir cliente
                    </button>
                  )}
                  <button
                    onClick={apagarHorario}
                    disabled={salvando}
                    className="h-11 w-full rounded-lg px-3 text-left text-neutral-700 active:bg-neutral-100 disabled:opacity-50"
                  >
                    Apagar só este horário
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {BOTOES.map((b) => (
          <button
            key={b.status}
            onClick={() => escolher(b.status)}
            disabled={salvando}
            aria-pressed={a.status === b.status}
            className={botao(a.status === b.status)}
          >
            {b.rotulo}
          </button>
        ))}
        <button onClick={() => setReagendando(!reagendando)} disabled={salvando} aria-expanded={reagendando} className={botao(reagendando)}>
          Reagendar
        </button>
      </div>

      {reagendando && (
        <div className="mt-3 space-y-2 rounded-xl bg-neutral-50 p-3">
          <p className="font-semibold">Novo dia e horário</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="Novo dia"
              value={novoDia}
              onChange={(e) => setNovoDia(e.target.value)}
              className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-lg"
            />
            <input
              type="time"
              aria-label="Novo horário"
              value={novaHora}
              onChange={(e) => setNovaHora(e.target.value)}
              className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-lg"
            />
          </div>
          <button
            onClick={confirmarReagendamento}
            disabled={salvando}
            className="h-12 w-full rounded-xl bg-[var(--cor-principal)] font-bold text-white disabled:opacity-50"
          >
            {salvando ? "Salvando…" : "Confirmar novo horário"}
          </button>
        </div>
      )}

      {aviso && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-amber-900">{aviso}</p>}
      {dialogo}
    </article>
  );
}
