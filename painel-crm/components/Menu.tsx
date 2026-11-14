"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { LogoOi } from "@/components/Logo";
import { usePainel } from "@/lib/empresa";
import { supabase } from "@/lib/supabase/client";

// Menu lateral do painel. Dois níveis, separados de propósito:
//   AGÊNCIA  -> o que vale para todas as lojas (criar loja, conectar WhatsApp, liberar a IA)
//   SALÃO    -> o salão escolhido na caixa (clientes e serviços dele)
// Fundo Ônix, como os fundos escuros da identidade Oi Studio; o item da tela aberta fica numa pílula Carvão.

const traco = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const IconeLojas = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...traco}>
    <path d="M3 9.5 5 4h14l2 5.5" />
    <path d="M4 9.5V20h16V9.5" />
    <path d="M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0" />
    <path d="M10 20v-6h4v6" />
  </svg>
);
const IconeClientes = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...traco}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8" />
    <path d="M18.5 14.2A6.5 6.5 0 0 1 21.5 20" />
  </svg>
);
const IconeServicos = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...traco}>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h10" />
  </svg>
);
const IconeSair = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" {...traco}>
    <path d="M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
    <path d="M16 8l4 4-4 4" />
    <path d="M20 12H9" />
  </svg>
);

function Item({ href, ativo, icone, children }: { href: string; ativo: boolean; icone: ReactNode; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={ativo ? "page" : undefined}
      className={`flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] transition-colors ${
        ativo ? "bg-carvao font-bold text-porcelana" : "font-medium text-campo/80 hover:bg-carvao/60 hover:text-porcelana"
      }`}
    >
      {icone}
      {children}
    </Link>
  );
}

const Secao = ({ children }: { children: ReactNode }) => (
  <p className="mt-6 mb-1.5 px-3 text-[11px] font-bold tracking-[0.14em] text-campo/55 uppercase">{children}</p>
);

export function Menu() {
  const caminho = usePathname();
  const router = useRouter();
  const { empresa, empresas, trocar } = usePainel();

  async function sair() {
    await supabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <aside className="sticky top-0 flex h-dvh w-60 shrink-0 flex-col bg-onix px-3 py-5 text-porcelana">
      <Link href="/lojas" className="px-3" aria-label="Oi Studio, painel da agência">
        <LogoOi escuro />
      </Link>

      <nav aria-label="Menu do painel" className="mt-2 flex flex-1 flex-col">
        <Secao>Agência</Secao>
        <Item href="/lojas" ativo={caminho.startsWith("/lojas")} icone={<IconeLojas />}>
          Lojas
        </Item>

        <Secao>Salão</Secao>
        {empresas.length === 1 ? (
          <p className="mb-1.5 truncate px-3 text-[15px] font-bold">{empresa.nome}</p>
        ) : (
          <select
            value={empresa.id}
            onChange={(e) => trocar(e.target.value)}
            aria-label="Salão escolhido"
            className="mb-1.5 h-11 w-full rounded-xl border border-carvao bg-carvao px-3 text-[15px] font-bold text-porcelana outline-none focus-visible:ring-2 focus-visible:ring-dourado"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </select>
        )}
        <Item href="/" ativo={caminho === "/" || caminho.startsWith("/clientes")} icone={<IconeClientes />}>
          Clientes
        </Item>
        <Item href="/servicos" ativo={caminho.startsWith("/servicos")} icone={<IconeServicos />}>
          Serviços
        </Item>

        <button
          onClick={sair}
          className="mt-auto flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium text-campo/80 hover:bg-carvao/60 hover:text-porcelana"
        >
          <IconeSair />
          Sair
        </button>
      </nav>
    </aside>
  );
}
