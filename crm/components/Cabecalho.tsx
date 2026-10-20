import type { ReactNode } from "react";

export function Cabecalho({ titulo, acao }: { titulo: string; acao?: ReactNode }) {
  return (
    <header className="flex items-center justify-between px-4 pt-4 pb-2">
      <h1 className="text-3xl font-bold">{titulo}</h1>
      {acao}
    </header>
  );
}

// Aviso usado nas abas que ainda serão feitas nas próximas fases.
export function EmBreve({ fase, oQue }: { fase: number; oQue: string }) {
  return (
    <div className="m-4 rounded-2xl border-2 border-dashed border-neutral-300 p-6 text-center">
      <p className="text-lg font-semibold">Em construção</p>
      <p className="mt-1 text-neutral-600">
        {oQue} chega na fase {fase}.
      </p>
    </div>
  );
}
