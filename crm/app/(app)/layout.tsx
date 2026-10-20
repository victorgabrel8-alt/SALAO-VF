import type { ReactNode } from "react";
import { BarraAbas } from "@/components/BarraAbas";
import { EmpresaProvider } from "@/lib/empresa";

// Telas de quem já entrou: conteúdo + barra de abas fixa embaixo.
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <main className="mx-auto w-full max-w-xl flex-1 pt-safe pb-abas">
        <EmpresaProvider>{children}</EmpresaProvider>
      </main>
      <BarraAbas />
    </>
  );
}
