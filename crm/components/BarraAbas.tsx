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

// Barra fixa no rodapé (identidade Oi Studio): branca, borda de cima fina, 76px + área segura do
// iPhone. O conteúdo termina acima dela (pb-abas no layout). A troca de tela anima em
// components/TelaDaAba.tsx. Fica atrás de um <Suspense> porque
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
  // A pílula já vai para a aba no toque, sem esperar a tela nova carregar; quando a URL muda,
  // volta a seguir a URL
  const [toque, setToque] = useState<{ indice: number; caminho: string } | null>(null);
  if (toque && toque.caminho !== caminho) setToque(null);
  const daUrl = indiceDa(caminho);
  const ativa = toque && toque.caminho === caminho ? toque.indice : daUrl;
  // A pílula só estica quando muda de aba (não ao abrir o app)
  const [anterior, setAnterior] = useState(ativa);
  const [mexeu, setMexeu] = useState(false);
  if (anterior !== ativa) {
    setAnterior(ativa);
    setMexeu(true);
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-borda bg-card pb-[env(safe-area-inset-bottom)]">
      <ul className="relative mx-auto grid h-[76px] max-w-xl grid-cols-3 items-center">
        {/* Uma pílula só, que desliza numa mola até a aba tocada (atrás dos ícones) */}
        {ativa >= 0 && (
          <li
            aria-hidden
            className="bolha-aba pointer-events-none absolute top-[12px] left-0 flex w-1/3 justify-center"
            style={{ transform: `translateX(${ativa * 100}%)`, transitionDuration: "0.55s" }}
          >
            <span key={ativa} className={`${mexeu ? "pilula-aba" : ""} block h-[30px] w-[56px] rounded-full bg-campo`} />
          </li>
        )}
        {ABAS.map((aba, i) => {
          const marcada = i === ativa;
          return (
            <li key={aba.href} className="relative">
              <Link
                href={aba.href}
                // Direção da animação da tela: aba à direita entra pela direita, e vice-versa
                transitionTypes={daUrl >= 0 && i !== daUrl ? [i > daUrl ? "aba-direita" : "aba-esquerda"] : undefined}
                onClick={(e) => {
                  // Tocar na aba em que já está (na tela principal dela): volta suave ao topo
                  if (caminho === aba.href) {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                    return;
                  }
                  if (i !== ativa) setToque({ indice: i, caminho });
                }}
                aria-current={i === daUrl ? "page" : undefined}
                className={`group flex h-[76px] flex-col items-center justify-center gap-1 text-[13px] transition-colors duration-300 ease-out ${
                  marcada ? "font-extrabold text-grafite" : "font-semibold text-texto-apoio"
                }`}
              >
                <span className="flex h-[30px] w-[56px] items-center justify-center transition-transform duration-300 [transition-timing-function:var(--mola)] group-active:scale-[0.88] group-active:duration-100">
                  <svg
                    viewBox="0 0 24 24"
                    className="h-[22px] w-[22px]"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d={aba.icone} />
                  </svg>
                </span>
                {aba.rotulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
