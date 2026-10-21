"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

const ABAS = [
  { href: "/", rotulo: "Início", icone: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M10 21v-6h4v6" },
  { href: "/conversas", rotulo: "Conversas", icone: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z" },
  { href: "/agenda", rotulo: "Agenda", icone: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18" },
];
// A lista de clientes (CRM) saiu deste app: fica no site separado painel-crm, da agência.

// Barra grafite flutuante embaixo, acima da área segura do iPhone. Fica atrás de um <Suspense>
// porque usePathname() lê a URL; enquanto isso, a mesma barra aparece sem aba marcada.
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
    <nav className="fixed inset-x-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-10 mx-auto max-w-[calc(36rem-2rem)] rounded-3xl bg-grafite px-2 shadow-[0_12px_30px_rgba(30,23,20,0.25)]">
      <ul className="grid h-[68px] grid-cols-3 items-center">
        {ABAS.map((aba) => {
          const ativa = aba.href === "/" ? caminho === "/" : caminho.startsWith(aba.href);
          return (
            <li key={aba.href}>
              <Link
                href={aba.href}
                aria-current={ativa ? "page" : undefined}
                className={`flex h-14 flex-col items-center justify-center gap-1 text-xs ${
                  ativa ? "font-bold text-white" : "font-semibold text-inativo"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`h-[22px] w-[22px] ${ativa ? "text-bronze" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
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
