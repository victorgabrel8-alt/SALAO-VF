"use client";

import { ViewTransition, useEffect, type ReactNode } from "react";

// Troca entre as abas (Início, Conversas, Agenda): as telas se cruzam suavemente, como no iPhone.
// Só anima quando o toque vem da barra (transitionTypes em components/BarraAbas.tsx); voltar pelo
// gesto do celular troca direto.
// O CSS está em app/globals.css (::view-transition-*). Celular sem suporte troca na hora.
export function TelaDaAba({ children }: { children: ReactNode }) {
  useEffect(protegerTroca, []);
  const tipos = { "aba-direita": "aba-direita", "aba-esquerda": "aba-esquerda", default: "none" };
  return (
    <ViewTransition enter={tipos} exit={tipos} default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}

// O navegador só anima a troca com a página visível. Se ela começa com o app em segundo plano (ou a
// página escondida), ele cancela no meio e o React mostrava isso como erro na tela
// ("Transition was aborted because of invalid state. Document hidden").
// 1) Com a página escondida, recusamos a animação logo de saída: o React então troca a tela sem
//    animar e sem erro (é o caminho que ele já tem para navegador sem suporte).
// 2) Se a página some no meio da animação, o cancelamento é só da animação; a tela troca igual,
//    então o aviso é descartado.
let protegido = false;
function protegerTroca() {
  if (protegido) return;
  protegido = true;
  const original = document.startViewTransition?.bind(document);
  if (original) {
    document.startViewTransition = ((arg: Parameters<typeof original>[0]) => {
      if (document.visibilityState !== "visible") throw new DOMException("Página escondida: troca sem animação", "InvalidStateError");
      return original(arg);
    }) as typeof document.startViewTransition;
  }
  const ehDaTroca = (r: unknown) => {
    const e = r as { name?: string; message?: string } | null | undefined;
    return (e?.name === "AbortError" || e?.name === "InvalidStateError") && /transition/i.test(e?.message ?? "");
  };
  window.addEventListener("error", (e) => {
    if (ehDaTroca(e.error)) e.preventDefault();
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (ehDaTroca(e.reason)) e.preventDefault();
  });
}
