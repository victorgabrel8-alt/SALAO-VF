"use client";

import { useState } from "react";
import { useEmpresa } from "@/lib/empresa";
import {
  agruparPorCategoria,
  formatarDuracao,
  formatarPreco,
  QUANTIDADE_MAXIMA,
  semAcento,
  servicosDeAtalho,
  somarEscolhidos,
  textoUnidade,
  type Escolhido,
  type ServicoEscolha,
} from "@/lib/servicos";

// Escolha de serviços sem poluir a tela:
//   - em cima, os 5 que a loja mais faz (1 toque no dia a dia);
//   - "Ver todos os serviços" abre a lista por categoria, com preço e tempo (e busca, se a loja
//     tiver muitos serviços);
//   - o que foi escolhido fica no quadro "Escolhidos", com [–][+] nos itens por unidade
//     (cada unha, cada pé) e o total de preço e de tempo.
// Tocar de novo num serviço escolhido tira ele.

const BUSCA_A_PARTIR_DE = 8;

export function EscolherServicos({
  servicos,
  maisUsados,
  escolhidos,
  aoMudar,
}: {
  servicos: ServicoEscolha[];
  maisUsados: string[];
  escolhidos: Escolhido[];
  aoMudar: (escolhidos: Escolhido[]) => void;
}) {
  const empresa = useEmpresa();
  const [verTodos, setVerTodos] = useState(false);
  const [busca, setBusca] = useState("");

  const atalhos = servicosDeAtalho(servicos, maisUsados);
  const temMais = servicos.length > atalhos.length;
  const marcado = (id: string) => escolhidos.some((e) => e.id === id);

  function alternar(id: string) {
    aoMudar(marcado(id) ? escolhidos.filter((e) => e.id !== id) : [...escolhidos, { id, quantidade: 1 }]);
  }

  function mudarQuantidade(id: string, delta: number) {
    aoMudar(
      escolhidos.map((e) =>
        e.id === id ? { ...e, quantidade: Math.min(QUANTIDADE_MAXIMA, Math.max(1, e.quantidade + delta)) } : e,
      ),
    );
  }

  const termo = semAcento(busca.trim());
  const filtrados = termo ? servicos.filter((s) => semAcento(s.nome).includes(termo)) : servicos;
  const grupos = agruparPorCategoria(filtrados, empresa);
  const total = somarEscolhidos(escolhidos, servicos);

  const chip = (ativo: boolean) =>
    `flex h-11 items-center gap-1.5 rounded-full px-4 font-semibold ${ativo ? "chip-ativo" : "bg-neutral-100 text-neutral-800"}`;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-lg font-semibold">Serviços</h3>
        <span className="text-sm text-neutral-500">pode escolher mais de um</span>
      </div>

      {/* Os mais usados */}
      <div className="flex flex-wrap gap-2">
        {atalhos.map((s) => (
          <button key={s.id} onClick={() => alternar(s.id)} aria-pressed={marcado(s.id)} className={chip(marcado(s.id))}>
            {marcado(s.id) && <Visto />}
            {s.nome}
          </button>
        ))}
      </div>

      {/* Todos, por categoria */}
      {temMais && (
        <button
          onClick={() => setVerTodos(!verTodos)}
          aria-expanded={verTodos}
          className="flex h-11 items-center gap-1 font-semibold text-[var(--cor-principal)]"
        >
          {verTodos ? "Esconder a lista" : `Ver todos os serviços (${servicos.length})`}
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={verTodos ? "rotate-180" : ""}
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      )}
      {temMais && verTodos && (
        <div className="space-y-3 rounded-xl border border-neutral-200 p-3">
          {servicos.length > BUSCA_A_PARTIR_DE && (
            <input
              type="search"
              placeholder="Buscar serviço"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
            />
          )}
          {grupos.map((g) => (
            <div key={g.id}>
              <p className="px-1 pb-1 text-xs font-bold tracking-wide text-neutral-500 uppercase">{g.nome}</p>
              <ul className="divide-y divide-neutral-100">
                {g.servicos.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => alternar(s.id)}
                      aria-pressed={marcado(s.id)}
                      className="flex min-h-12 w-full items-center gap-3 px-1 py-2 text-left active:bg-neutral-50"
                    >
                      <span
                        aria-hidden
                        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 ${
                          marcado(s.id) ? "border-[var(--cor-principal)] bg-[var(--cor-principal)] text-white" : "border-neutral-300"
                        }`}
                      >
                        {marcado(s.id) && <Visto />}
                      </span>
                      <span className="min-w-0 flex-1 font-semibold">{s.nome}</span>
                      <span className="shrink-0 text-right text-sm text-neutral-600">
                        {precoDoServico(s)} · {formatarDuracao(s.duracao_min)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {grupos.length === 0 && <p className="px-1 text-neutral-500">Nenhum serviço com esse nome.</p>}
        </div>
      )}

      {/* O que foi escolhido, com os totais */}
      {escolhidos.length > 0 && (
        <div className="rounded-xl bg-neutral-100 p-3">
          <p className="pb-1 text-sm font-semibold text-neutral-600">Escolhidos</p>
          <ul className="divide-y divide-neutral-200">
            {escolhidos.map((e) => {
              const s = servicos.find((x) => x.id === e.id);
              if (!s) return null;
              return (
                <li key={e.id} className="space-y-1 py-2">
                  <div className="flex items-start gap-2">
                    <span className="min-w-0 flex-1 font-semibold">{s.nome}</span>
                    <span className="shrink-0 text-right text-sm text-neutral-700">
                      {s.preco === null ? "sem preço" : formatarPreco(s.preco * e.quantidade)} · {formatarDuracao(s.duracao_min * e.quantidade)}
                    </span>
                    <button
                      onClick={() => alternar(s.id)}
                      aria-label={`Tirar ${s.nome}`}
                      className="-my-2 -mr-2 flex h-10 w-10 shrink-0 items-center justify-center text-neutral-500"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
                        <path d="M6 6l12 12M18 6 6 18" />
                      </svg>
                    </button>
                  </div>
                  {s.unidade && (
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => mudarQuantidade(s.id, -1)}
                        disabled={e.quantidade <= 1}
                        aria-label="Uma a menos"
                        className="h-11 w-11 rounded-full bg-white text-xl font-bold disabled:opacity-40"
                      >
                        –
                      </button>
                      <span className="min-w-16 text-center font-semibold" aria-live="polite">
                        {textoUnidade(s.unidade, e.quantidade)}
                      </span>
                      <button
                        onClick={() => mudarQuantidade(s.id, 1)}
                        disabled={e.quantidade >= QUANTIDADE_MAXIMA}
                        aria-label="Uma a mais"
                        className="h-11 w-11 rounded-full bg-white text-xl font-bold disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {(escolhidos.length > 1 || escolhidos.some((e) => e.quantidade > 1)) && (
            <div className="flex items-baseline justify-between gap-2 border-t border-neutral-300 pt-2">
              <span className="font-bold">Total</span>
              <span className="text-right font-bold">
                {total.aPartirDe ? "a partir de " : ""}
                {formatarPreco(total.preco)}
                {total.semPreco ? " + sem preço" : ""} · {formatarDuracao(total.minutos)}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function precoDoServico(s: ServicoEscolha): string {
  if (s.preco === null) return "sem preço";
  const valor = s.preco === 0 ? "grátis" : formatarPreco(s.preco);
  return s.unidade ? `${valor}/${s.unidade}` : valor;
}

function Visto() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12 5 5L20 7" />
    </svg>
  );
}
