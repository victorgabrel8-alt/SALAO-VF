import Link from "next/link";
import type { ReactNode } from "react";
import { BotaoSair, EmpresaProvider, SeletorSalao } from "@/lib/empresa";

// Painel da agência: barra no topo (nome, salão escolhido, sair) e o conteúdo largo
export default function PainelLayout({ children }: { children: ReactNode }) {
  return (
    <EmpresaProvider>
      <header className="sticky top-0 z-10 border-b border-borda bg-card">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-4 px-6">
          <Link href="/" className="flex items-center gap-2 text-xl font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-grafite font-serif text-[21px] text-[#e3b48c]">S</span>
            Painel CRM
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-texto-2">Salão:</span>
            <SeletorSalao />
            <BotaoSair />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-6 pb-12">{children}</main>
    </EmpresaProvider>
  );
}
