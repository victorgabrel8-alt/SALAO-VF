"use client";

import { useState } from "react";
import { Folha } from "@/components/Folha";
import { MarcarVolta, type ServicoAtivo } from "@/components/MarcarVolta";
import type { Atendimento } from "@/lib/atendimentos";
import { formatarHora, formatarTelefone, primeiroNome } from "@/lib/formato";

// O ✓ de um horário a atender, como uma pergunta direta: "Maria fez o que estava marcado?".
// Quase sempre é "Sim" (1 toque). Se a cliente fez outra coisa ou mais coisas (marcou hidratação
// e fez mega hair), a dona marca o que ela fez de verdade.
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

  const nome = a.clientes?.nome ? primeiroNome(a.clientes.nome) : a.clientes ? formatarTelefone(a.clientes.telefone) : "A cliente";
  const servico = a.servicos?.nome ?? "Serviço não informado";

  return (
    <Folha rotulo="Concluir atendimento" aoFechar={aoFechar} className="bg-[var(--background)] px-5">
      <div className="flex flex-col gap-4 pt-1 pb-5">
        {volta ? (
          <MarcarVolta atendimento={a} feitos={volta} servicos={servicos} aoFechar={aoFechar} />
        ) : !mudou ? (
          <>
            {/* A pergunta, com o que estava marcado logo abaixo */}
            <div className="flex flex-col gap-1">
              <span className="rotulo text-texto-2">Atendimento das {formatarHora(a.inicio)}</span>
              <h2 className="font-serif text-[26px] leading-tight font-semibold">{nome} fez o que estava marcado?</h2>
            </div>
            <div className="flex items-center gap-3 rounded-[18px] bg-card px-4 py-3.5 borda-suave">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-areia">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6E5539" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] text-texto-2">Estava marcado</span>
                <span className="text-[16px] font-semibold">{servico}</span>
              </span>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => salvar([])}
                disabled={salvando}
                className="flex h-14 items-center justify-center gap-2 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98] disabled:opacity-60"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m5 12 5 5L20 7" />
                </svg>
                {salvando ? "Salvando…" : "Sim, concluir atendimento"}
              </button>
              <button
                onClick={() => setMudou(true)}
                disabled={salvando}
                className="h-13 min-h-[52px] rounded-full bg-card text-[16px] font-semibold borda-suave active:bg-campo"
              >
                Não, fez outro serviço
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <button onClick={() => setMudou(false)} className="-ml-1 flex w-fit items-center gap-0.5 py-1 text-[15px] font-semibold text-bronze-escuro">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="m15 18-6-6 6-6" />
                </svg>
                Voltar
              </button>
              <h2 className="font-serif text-[26px] leading-tight font-semibold">O que {nome} fez?</h2>
              <p className="text-[15px] text-texto-2">Toque em tudo que foi feito. Pode ser mais de um.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {servicos.map((s) => {
                const ativo = escolhidos.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => alternar(s.id)}
                    aria-pressed={ativo}
                    className={`flex h-11 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold transition-colors ${
                      ativo ? "chip-ativo" : "bg-card text-texto borda-suave"
                    }`}
                  >
                    {ativo && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m5 12 5 5L20 7" />
                      </svg>
                    )}
                    {s.nome}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => salvar(escolhidos)}
              disabled={salvando || escolhidos.length === 0}
              className="h-14 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98] disabled:opacity-50"
            >
              {salvando
                ? "Salvando…"
                : escolhidos.length === 0
                  ? "Escolha pelo menos um serviço"
                  : `Concluir com ${escolhidos.length === 1 ? "1 serviço" : `${escolhidos.length} serviços`}`}
            </button>
          </>
        )}

        {erro && <p className="rounded-2xl bg-rose p-3 text-rose-texto">Não deu para salvar: {erro}</p>}
        {!volta && (
          <button onClick={aoFechar} className="h-11 text-[16px] font-semibold text-texto-2">
            Cancelar
          </button>
        )}
      </div>
    </Folha>
  );
}
