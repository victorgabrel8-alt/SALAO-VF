import type { ReactNode } from "react";
import { Menu } from "@/components/Menu";
import { EmpresaProvider } from "@/lib/empresa";

// Painel da agência: menu lateral fixo (agência em cima, salão escolhido embaixo) e o conteúdo largo ao lado
export default function PainelLayout({ children }: { children: ReactNode }) {
  return (
    <EmpresaProvider>
      <div className="flex min-h-dvh">
        <Menu />
        <main className="min-w-0 flex-1 px-8 pb-16">
          <div className="mx-auto max-w-[1400px]">{children}</div>
        </main>
      </div>
    </EmpresaProvider>
  );
}
