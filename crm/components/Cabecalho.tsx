import type { ReactNode } from "react";

export function Cabecalho({ titulo, acao }: { titulo: string; acao?: ReactNode }) {
  return (
    <header className="flex items-center justify-between px-4 pt-4 pb-2">
      <h1 className="text-3xl font-bold">{titulo}</h1>
      {acao}
    </header>
  );
}

// Lista do que ainda vai entrar no app (sem falar em "fase": quem lê é a dona do salão)
export function EmBreve({ titulo, itens }: { titulo: string; itens: string[] }) {
  return (
    <section className="mx-4 rounded-2xl border border-dashed border-neutral-300 bg-white/60 p-4">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      <p className="text-neutral-600">Estamos preparando:</p>
      <ul className="mt-2 space-y-2">
        {itens.map((item) => (
          <li key={item} className="flex gap-2 text-neutral-700">
            <span aria-hidden className="mt-2 h-2 w-2 shrink-0 rounded-full bg-neutral-400" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
