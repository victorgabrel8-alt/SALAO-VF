"use client";

import { useEffect, useState } from "react";

// Hora atual que muda sozinha a cada minuto: as telas que dependem do relógio ("Agora",
// "Não atendidas") se atualizam mesmo sem a Gleide mexer no celular
export function useAgora(intervaloMs = 60_000): number {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);
  return agora;
}
