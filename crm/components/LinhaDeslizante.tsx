"use client";

import { useRef, useState, type ReactNode } from "react";

export type AcaoDeslizante = { rotulo: string; icone: ReactNode; cor: string; aoTocar: () => void };

const LARGURA_ACAO = 78;

// Linha que desliza para a esquerda (como no Mail do iPhone) e mostra atalhos atrás dela.
// Toque simples faz a ação da linha; com a linha aberta, um toque só fecha.
export function LinhaDeslizante({
  acoes,
  aberta,
  aoAbrir,
  aoTocar,
  className = "",
  children,
}: {
  acoes: AcaoDeslizante[];
  aberta: boolean;
  aoAbrir: (aberta: boolean) => void;
  aoTocar: () => void;
  className?: string;
  children: ReactNode;
}) {
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const [arrasto, setArrasto] = useState<number | null>(null);
  const largura = LARGURA_ACAO * acoes.length;
  const deslocamento = arrasto ?? (aberta ? -largura : 0);

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-y-0 right-0 flex" aria-hidden={!aberta}>
        {acoes.map((a) => (
          <button
            key={a.rotulo}
            onClick={() => {
              aoAbrir(false);
              a.aoTocar();
            }}
            tabIndex={aberta ? 0 : -1}
            className={`flex flex-col items-center justify-center gap-1 text-xs font-semibold text-white ${a.cor}`}
            style={{ width: LARGURA_ACAO }}
          >
            {a.icone}
            {a.rotulo}
          </button>
        ))}
      </div>

      <button
        onClick={() => (aberta ? aoAbrir(false) : aoTocar())}
        onTouchStart={(e) => {
          inicio.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (!inicio.current) return;
          const dx = e.touches[0].clientX - inicio.current.x;
          const dy = e.touches[0].clientY - inicio.current.y;
          // Só arrasta quando o gesto é mais para o lado do que para baixo (senão é rolagem)
          if (arrasto === null && Math.abs(dx) < 8) return;
          if (arrasto === null && Math.abs(dy) > Math.abs(dx)) {
            inicio.current = null;
            return;
          }
          const base = aberta ? -largura : 0;
          setArrasto(Math.max(-largura - 20, Math.min(0, base + dx)));
        }}
        onTouchEnd={() => {
          if (arrasto !== null) aoAbrir(arrasto < -largura / 2);
          setArrasto(null);
          inicio.current = null;
        }}
        style={{ transform: `translateX(${deslocamento}px)` }}
        className={`relative flex w-full items-center text-left ${arrasto === null ? "transition-transform duration-200" : ""} ${className}`}
      >
        {children}
      </button>
    </div>
  );
}
