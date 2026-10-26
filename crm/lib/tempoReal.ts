"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

// Mudanças que chegam juntas (a resposta da IA em 3 balões, o registro da mensagem + a ficha)
// viram uma recarga só: espera esse tempo sem mudança nova antes de chamar `aoMudar`.
const JUNTAR_MS = 800;

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
    let espera: ReturnType<typeof setTimeout> | undefined;
    const mudou = () => {
      clearTimeout(espera);
      espera = setTimeout(() => callback.current(), JUNTAR_MS);
    };
    for (const tabela of chave.split(",")) {
      canal.on(
        "postgres_changes",
        { event: "*", schema: "public", table: tabela, filter: `empresa_id=eq.${empresaId}` },
        mudou,
      );
    }
    canal.subscribe();
    return () => {
      clearTimeout(espera);
      db.removeChannel(canal);
    };
  }, [chave, empresaId]);
}
