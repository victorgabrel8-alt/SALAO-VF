"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

// Chama `aoMudar` sempre que algo muda nas tabelas do salão (ex.: a IA marcou um horário).
// O Realtime já está ligado no banco para mensagens, clientes e agendamentos.
export function useTempoReal(tabelas: string[], empresaId: string, aoMudar: () => void) {
  const callback = useRef(aoMudar);
  useEffect(() => {
    callback.current = aoMudar;
  });

  const chave = tabelas.join(",");
  useEffect(() => {
    const db = supabase();
    const canal = db.channel(`tempo-real:${chave}:${empresaId}:${Math.random()}`);
    for (const tabela of chave.split(",")) {
      canal.on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabela, filter: `empresa_id=eq.${empresaId}` },
        () => callback.current(),
      );
    }
    canal.subscribe();
    return () => {
      db.removeChannel(canal);
    };
  }, [chave, empresaId]);
}
