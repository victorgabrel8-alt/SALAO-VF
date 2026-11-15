"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { telaAnterior } from "@/lib/rastro";

// Botão "Voltar" das telas internas (conversa, configurações, próximas...).
// Se a pessoa veio da tela `para`, volta de verdade: a tela de trás reaparece no ponto em que
// estava (a lista não pula para o topo) e o gesto de voltar do celular não cai de novo na tela
// que ela acabou de fechar. Se abriu direto aqui (ou veio de outro lugar), vai para `para`
// no lugar desta tela.
export function Voltar({ para, className, children, ...resto }: { para: string; className?: string; children: ReactNode; "aria-label"?: string }) {
  const router = useRouter();
  return (
    <Link
      href={para}
      className={className}
      {...resto}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        if (telaAnterior() === para) router.back();
        else router.replace(para);
      }}
    >
      {children}
    </Link>
  );
}
