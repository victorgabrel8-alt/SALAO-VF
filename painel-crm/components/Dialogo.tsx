"use client";

import { useEffect, useId, useState, type ReactNode } from "react";

type Estado = {
  texto: ReactNode;
  confirmar: string;
  cancelar?: string;
  perigo?: boolean;
  resolver: (sim: boolean) => void;
};

// Confirmação e aviso desenhados no próprio app. Não usamos window.confirm/alert: alguns
// navegadores (e o modo app do iPhone em certos casos) bloqueiam e respondem "não" sozinhos.
//   const { dialogo, perguntar, avisar } = useDialogo();
//   if (await perguntar("Excluir?", { confirmar: "Excluir", perigo: true })) ...
//   ... e renderizar {dialogo} no componente.
export function useDialogo() {
  const [estado, setEstado] = useState<Estado | null>(null);
  const idTexto = useId();

  function perguntar(texto: ReactNode, opcoes: { confirmar?: string; perigo?: boolean } = {}) {
    return new Promise<boolean>((resolver) =>
      setEstado({ texto, confirmar: opcoes.confirmar ?? "Confirmar", cancelar: "Voltar", perigo: opcoes.perigo, resolver }),
    );
  }

  function avisar(texto: ReactNode) {
    return new Promise<void>((resolver) => setEstado({ texto, confirmar: "Entendi", resolver: () => resolver() }));
  }

  function responder(sim: boolean) {
    estado?.resolver(sim);
    setEstado(null);
  }

  // Esc fecha como "Voltar"
  useEffect(() => {
    if (!estado) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      estado.resolver(false);
      setEstado(null);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [estado]);

  const dialogo = estado && (
    <div className="fixed inset-0 z-40 flex items-end bg-onix/45 sm:items-center" onClick={() => responder(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-describedby={idTexto}
        onClick={(e) => e.stopPropagation()}
        className="mx-auto w-full max-w-md space-y-5 rounded-t-[20px] border border-borda bg-card px-6 pt-6 pb-safe sm:rounded-[20px] sm:pb-6"
      >
        <div id={idTexto} className="text-[17px] leading-relaxed whitespace-pre-line text-grafite">
          {estado.texto}
        </div>
        <div className={`mb-4 grid gap-2.5 sm:mb-0 ${estado.cancelar ? "grid-cols-2" : "grid-cols-1"}`}>
          {estado.cancelar && (
            <button
              onClick={() => responder(false)}
              className="h-12 rounded-[14px] border border-borda-forte bg-card font-bold hover:bg-campo/50 active:bg-campo"
            >
              {estado.cancelar}
            </button>
          )}
          <button
            onClick={() => responder(true)}
            autoFocus
            className={`h-12 rounded-[14px] font-bold ${estado.perigo ? "bg-atencao text-white hover:bg-rose-texto" : "bg-onix text-porcelana hover:bg-carvao"}`}
          >
            {estado.confirmar}
          </button>
        </div>
      </div>
    </div>
  );

  return { dialogo, perguntar, avisar };
}
