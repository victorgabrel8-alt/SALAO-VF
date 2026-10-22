"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, useState } from "react";

const ABAS = [
  { href: "/", rotulo: "Início", icone: "M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5M10 21v-6h4v6" },
  { href: "/conversas", rotulo: "Conversas", icone: "M7.9 20A9 9 0 1 0 4 16.1L2 22Z" },
  { href: "/agenda", rotulo: "Agenda", icone: "M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM16 2v4M8 2v4M3 10h18" },
];
// A lista de clientes (CRM) saiu deste app: fica no site separado painel-crm, da agência.

function indiceDa(caminho: string): number {
  return ABAS.findIndex((aba) => (aba.href === "/" ? caminho === "/" : caminho.startsWith(aba.href)));
}

// Barra de vidro escuro flutuante embaixo, acima da área segura do iPhone, com a bolha da aba
// ativa que desliza e "estica" até a aba tocada (como no iOS 26). Fica atrás de um <Suspense>
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
  // A bolha já vai para a aba no toque, sem esperar a tela nova carregar; quando a URL muda,
  // volta a seguir a URL
  const [toque, setToque] = useState<{ indice: number; caminho: string } | null>(null);
  if (toque && toque.caminho !== caminho) setToque(null);
  const daUrl = indiceDa(caminho);
  const ativa = toque && toque.caminho === caminho ? toque.indice : daUrl;
  // Dedo em cima da aba já marcada: a bolha cresce de leve enquanto pressiona
  const [pressionada, setPressionada] = useState(false);

  return (
    <nav className="vidro-escuro fixed inset-x-4 bottom-[calc(20px+env(safe-area-inset-bottom))] z-10 mx-auto max-w-[calc(36rem-2rem)] rounded-full p-1.5">
      <ul className="relative grid h-[56px] grid-cols-3 items-center">
        {ativa >= 0 && (
          <li
            aria-hidden
            className="bolha-aba pointer-events-none absolute inset-y-0 left-0 w-1/3"
            style={{ transform: `translateX(${ativa * 100}%)` }}
          >
            {/* key: a cada troca a bolha refaz a "lente" do caminho */}
            <span key={ativa} className={`bolha-aba-forma block h-full rounded-full ${pressionada ? "bolha-aba-pressionada" : ""}`} />
          </li>
        )}
        {ABAS.map((aba, i) => {
          const marcada = i === ativa;
          return (
            <li key={aba.href} className="relative">
              <Link
                href={aba.href}
                onClick={() => i !== ativa && setToque({ indice: i, caminho })}
                onPointerDown={() => marcada && setPressionada(true)}
                onPointerUp={() => setPressionada(false)}
                onPointerLeave={() => setPressionada(false)}
                onPointerCancel={() => setPressionada(false)}
                aria-current={i === daUrl ? "page" : undefined}
                className={`flex h-[56px] flex-col items-center justify-center gap-1 text-xs transition-colors duration-300 ${
                  marcada ? "font-bold text-white" : "font-semibold text-inativo"
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className={`h-[22px] w-[22px] transition-colors duration-300 ${marcada ? "text-bronze" : ""}`}
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
