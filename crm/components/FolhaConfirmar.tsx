"use client";

import { useState } from "react";
import { MarcarVolta, type ServicoAtivo } from "@/components/MarcarVolta";
import type { Atendimento } from "@/lib/atendimentos";
import { formatarHora, formatarTelefone } from "@/lib/formato";

// O ✓ de um horário a atender: quase sempre "Foi isso" (1 toque). Se a cliente fez outra coisa
// ou mais coisas (marcou hidratação e fez mega hair), a dona marca o que fez de verdade.
// Salvo, se algum serviço feito tem retorno, já pergunta "Já combinou a volta?" (MarcarVolta).
export function FolhaConfirmar({
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
    `h-11 rounded-full px-4 font-semibold ${ativo ? "chip-ativo" : "bg-campo text-texto"}`;

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={aoFechar}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Confirmar atendimento"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[85dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-[var(--background)] px-4 pt-3 pb-safe"
      >
        <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-borda" />
        <p className="text-xl font-bold">
          {a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")} · {formatarHora(a.inicio)}
        </p>

        {volta ? (
          <MarcarVolta atendimento={a} feitos={volta} servicos={servicos} aoFechar={aoFechar} />
        ) : (
          <>
            <p className="text-texto-2">Marcado: {a.servicos?.nome ?? "serviço não informado"}</p>

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
                  className="h-12 w-full rounded-2xl border border-borda bg-card font-semibold active:bg-campo"
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

            {erro && <p className="mb-3 rounded-2xl bg-rose p-3 text-rose-texto">Não salvou: {erro}</p>}
            <button
              onClick={aoFechar}
              className="mb-4 h-12 w-full rounded-2xl border border-borda bg-card font-semibold active:bg-campo"
            >
              Voltar
            </button>
          </>
        )}
      </div>
    </div>
  );
}
