import type { ReactNode } from "react";

export function Cabecalho({ titulo, acao }: { titulo: string; acao?: ReactNode }) {
  return (
    <header className="flex items-center justify-between px-4 pt-4 pb-2">
      <h1 className="text-3xl font-bold">{titulo}</h1>
      {acao}
    </header>
  );
}
