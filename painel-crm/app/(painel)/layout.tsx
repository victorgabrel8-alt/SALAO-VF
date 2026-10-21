import Link from "next/link";
import type { ReactNode } from "react";
import { BotaoSair, EmpresaProvider, SeletorSalao } from "@/lib/empresa";

// Painel da agência: barra no topo (nome, salão escolhido, sair) e o conteúdo largo
export default function PainelLayout({ children }: { children: ReactNode }) {
  return (
    <EmpresaProvider>
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex h-16 max-w-screen-2xl items-center justify-between gap-4 px-6">
          <Link href="/" className="flex items-center gap-2 text-xl font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--cor-principal)] text-white">S</span>
            Painel CRM
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-500">Salão:</span>
            <SeletorSalao />
            <BotaoSair />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-screen-2xl px-6 pb-12">{children}</main>
    </EmpresaProvider>
  );
}
