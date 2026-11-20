"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

// O outro jeito do mesmo número: com o 9 depois do DDD vira sem, e sem vira com
// (5566996834918 <-> 556696834918). Fixo e outros formatos: null.
export function telefoneGemeo(telefone: string): string | null {
  if (/^55\d{2}9\d{8}$/.test(telefone)) return telefone.slice(0, 4) + telefone.slice(5);
  if (/^55\d{2}[6-9]\d{7}$/.test(telefone)) return telefone.slice(0, 4) + "9" + telefone.slice(4);
  return null;
}

// Na ficha: avisa quando a mesma cliente tem outro cadastro com o número com/sem o 9 e leva para
// Configurações > Cadastros repetidos, onde a dona confere e junta.
export function AvisoCadastroRepetido({ empresaId, telefone }: { empresaId: string; telefone: string }) {
  const [tem, setTem] = useState(false);

  useEffect(() => {
    const gemeo = telefoneGemeo(telefone);
    if (!gemeo) return;
    let ativo = true;
    supabase()
      .from("clientes")
      .select("id")
      .eq("empresa_id", empresaId)
      .eq("telefone", gemeo)
      .limit(1)
      .then(({ data }) => {
        if (ativo) setTem((data ?? []).length > 0);
      });
    return () => {
      ativo = false;
    };
  }, [empresaId, telefone]);

  if (!tem) return null;
  return (
    <Link
      href="/configuracoes/cadastros-repetidos"
      className="flex items-center justify-between gap-3 rounded-[22px] bg-areia p-[18px] text-bronze-escuro active:opacity-80"
    >
      <span>
        <span className="block font-bold">Ela tem outro cadastro</span>
        <span className="block text-[14px]">O mesmo número com e sem o 9. Toque para conferir e juntar.</span>
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden>
        <path d="m9 18 6-6-6-6" />
      </svg>
    </Link>
  );
}
