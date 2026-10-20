"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const ABAS = [
  { href: "/", rotulo: "Início", icone: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" },
  { href: "/conversas", rotulo: "Conversas", icone: "M4 5h16v11H8l-4 4z" },
  { href: "/agenda", rotulo: "Agenda", icone: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/clientes", rotulo: "Clientes", icone: "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M17 11a3 3 0 1 0 0-6M22 21a6 6 0 0 0-4-5.6" },
];

// Barra fixa embaixo, acima da área segura do iPhone. Fica atrás de um <Suspense> porque
// usePathname() lê a URL; enquanto isso, a mesma barra aparece sem aba marcada.
export function BarraAbas() {
  return (
    <Suspense fallback={<Abas caminho="" />}>
      <AbasComRota />
    </Suspense>
  );
}

function AbasComRota() {
  return <Abas caminho={usePathname()} />;
}

function Abas({ caminho }: { caminho: string }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-neutral-200 bg-white pb-safe">
      <ul className="mx-auto flex max-w-xl">
        {ABAS.map((aba) => {
          const ativa = aba.href === "/" ? caminho === "/" : caminho.startsWith(aba.href);
          return (
            <li key={aba.href} className="flex-1">
              <Link
                href={aba.href}
                aria-current={ativa ? "page" : undefined}
                className={`flex h-16 flex-col items-center justify-center gap-1 text-sm font-semibold ${
                  ativa ? "text-[var(--cor-principal)]" : "text-neutral-500"
                }`}
              >
                <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={aba.icone} />
                </svg>
                {aba.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
