"use client";

import { ViewTransition, type ReactNode } from "react";

// Troca entre as abas (Início, Conversas, Agenda): as telas se cruzam suavemente, como no iPhone.
// Só anima quando o toque vem da barra (transitionTypes em components/BarraAbas.tsx); voltar pelo
// gesto do celular troca direto.
// O CSS está em app/globals.css (::view-transition-*). Celular sem suporte troca na hora.
export function TelaDaAba({ children }: { children: ReactNode }) {
  const tipos = { "aba-direita": "aba-direita", "aba-esquerda": "aba-esquerda", default: "none" };
  return (
    <ViewTransition enter={tipos} exit={tipos} default="none">
      <div>{children}</div>
    </ViewTransition>
  );
}
