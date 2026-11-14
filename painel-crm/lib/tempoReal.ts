"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

// Mudanças que chegam juntas (a resposta da IA em 3 balões, o registro da mensagem + a ficha)
// viram uma recarga só: espera esse tempo sem mudança nova antes de chamar `aoMudar`. Em conversa
// corrida não espera para sempre: no máximo ESPERA_MAXIMA_MS depois da primeira mudança ele chama.
// Sem isso, cada mensagem relia o quadro inteiro e o banco (pequeno) chegou a travar.
const JUNTAR_MS = 1500;
const ESPERA_MAXIMA_MS = 6000;

// Chama `aoMudar` quando algo muda nas tabelas do salão (ex.: a IA marcou um horário).
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
    let primeira = 0;
    const avisar = () => {
      espera = undefined;
      primeira = 0;
      callback.current();
    };
    const mudou = () => {
      const agora = Date.now();
      if (!primeira) primeira = agora;
      clearTimeout(espera);
      espera = setTimeout(avisar, Math.max(0, Math.min(JUNTAR_MS, primeira + ESPERA_MAXIMA_MS - agora)));
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
