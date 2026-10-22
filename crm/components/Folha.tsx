"use client";

import { useRef, useState, type ReactNode } from "react";

const DISTANCIA_FECHAR = 110;

// Folha que sobe de baixo, como no iPhone: alcinha no topo e, puxando para baixo (com o
// conteúdo já no começo), ela desce e fecha. Tocar no fundo escuro também fecha.
export function Folha({ rotulo, aoFechar, className = "", children }: { rotulo: string; aoFechar: () => void; className?: string; children: ReactNode }) {
  const painel = useRef<HTMLDivElement>(null);
  const inicio = useRef<number | null>(null);
  const [arrasto, setArrasto] = useState<number | null>(null);

  return (
    <div className="folha-fundo fixed inset-0 z-20 flex items-end bg-black/40" onClick={aoFechar}>
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-label={rotulo}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => {
          // Só vira arrasto quando a folha está rolada até o topo; senão é rolagem do conteúdo
          inicio.current = (painel.current?.scrollTop ?? 0) <= 0 ? e.touches[0].clientY : null;
        }}
        onTouchMove={(e) => {
          if (inicio.current === null) return;
          const dy = e.touches[0].clientY - inicio.current;
          setArrasto(dy > 0 ? dy : null);
        }}
        onTouchEnd={() => {
          if ((arrasto ?? 0) > DISTANCIA_FECHAR) aoFechar();
          setArrasto(null);
          inicio.current = null;
        }}
        style={arrasto ? { transform: `translateY(${arrasto}px)` } : undefined}
        className={`folha-subir mx-auto max-h-[92dvh] w-full max-w-xl overflow-y-auto overscroll-contain rounded-t-3xl pb-safe ${
          arrasto ? "" : "transition-transform duration-200"
        } ${className}`}
      >
        <div aria-hidden className="sticky top-0 z-10 -mb-1 flex justify-center pt-2 pb-2">
          <span className="h-[5px] w-9 rounded-full bg-borda" />
        </div>
        {children}
      </div>
    </div>
  );
}
