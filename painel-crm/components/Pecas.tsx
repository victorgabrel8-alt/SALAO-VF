"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

// Peças de desenho do painel (identidade Oi Studio: cartão branco com borda, sem sombra; botão Ônix).
// Usadas pela tela Lojas, por Clientes, pela ficha da cliente e pela manutenção, para tudo ter a mesma cara.

// campoBase não fixa a largura (para seleções e busca em linha); campo ocupa a linha toda
export const campoBase =
  "h-11 rounded-xl border border-borda bg-card px-3 text-[15px] outline-none placeholder:text-apoio/70 focus:border-onix focus-visible:ring-2 focus-visible:ring-onix/15";
export const campo = campoBase + " w-full";
export const botao =
  "inline-flex h-10 items-center justify-center rounded-xl border border-borda-forte bg-card px-4 text-[14px] font-bold text-grafite hover:bg-campo/50 disabled:opacity-50";
export const botaoForte =
  "inline-flex h-10 items-center justify-center rounded-xl bg-onix px-5 text-[14px] font-bold text-porcelana hover:bg-carvao disabled:opacity-50";
export const cartao = "rounded-[18px] border border-borda bg-card";
// Opção de filtro em pílula (40px de altura): a escolhida fica Ônix
export const opcao = (ativa: boolean) =>
  `inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-bold whitespace-nowrap ${
    ativa ? "chip-ativo" : "border border-borda bg-card text-grafite hover:bg-campo/50"
  }`;

export type Tom = "ok" | "atencao" | "aviso" | "neutro";
export const TONS: Record<Tom, string> = {
  ok: "bg-salvia text-salvia-texto",
  atencao: "bg-rose text-rose-texto",
  aviso: "bg-mel text-mel-texto",
  neutro: "bg-campo text-grafite",
};

export const Chip = ({ tom, children }: { tom: Tom; children: ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold whitespace-nowrap ${TONS[tom]}`}>{children}</span>
);

export const Aviso = ({ tom, children }: { tom: Tom; children: ReactNode }) => (
  <p role={tom === "atencao" ? "alert" : undefined} className={`rounded-xl px-3.5 py-3 text-[14px] leading-relaxed ${TONS[tom]}`}>
    {children}
  </p>
);

export const Rotulo = ({ children }: { children: ReactNode }) => <span className="mb-1.5 block text-[13px] font-bold text-texto-2">{children}</span>;

// Folha por cima da tela (formulários). Fecha no ×, no Esc e no clique fora.
export function Folha({ titulo, aoFechar, largura = "max-w-2xl", children }: { titulo: string; aoFechar: () => void; largura?: string; children: ReactNode }) {
  const idTitulo = useId();
  // ao abrir, o foco entra na folha (o Tab passa a andar por ela, não pela página de trás)
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    caixa.current?.focus();
  }, []);
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-onix/45 px-4 py-10" onClick={aoFechar}>
      <div
        ref={caixa}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${largura} rounded-[20px] border border-borda bg-card p-6 outline-none`}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id={idTitulo} className="text-[22px] leading-tight font-bold tracking-[-0.02em]">
            {titulo}
          </h2>
          <button onClick={aoFechar} aria-label="Fechar" className="-mt-1 -mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-apoio hover:bg-campo/60 hover:text-grafite">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Um número do resumo: rótulo pequeno, número grande, uma linha de apoio (null = ainda carregando)
export function Numero({ rotulo, valor, apoio, tom }: { rotulo: string; valor: number | null; apoio: string; tom?: "atencao" | "aviso" }) {
  return (
    <div className={`${cartao} px-5 py-4`}>
      <p className="rotulo">{rotulo}</p>
      <p className="mt-1.5 text-[34px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{valor === null ? "…" : valor.toLocaleString("pt-BR")}</p>
      <p className={`mt-2 text-[13px] font-semibold ${tom === "atencao" ? "text-rose-texto" : tom === "aviso" ? "text-mel-texto" : "text-apoio"}`}>{apoio}</p>
    </div>
  );
}

export function Secao({ titulo, apoio, acao, children }: { titulo: string; apoio?: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold tracking-[-0.02em]">{titulo}</h2>
          {apoio && <p className="text-[14px] text-apoio">{apoio}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}
