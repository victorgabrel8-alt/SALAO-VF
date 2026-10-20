"use client";

import { useState, type ReactNode } from "react";

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

  const dialogo = estado && (
    <div className="fixed inset-0 z-30 flex items-end bg-black/40 sm:items-center" onClick={() => responder(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto w-full max-w-md space-y-4 rounded-t-3xl bg-white px-4 pt-5 pb-safe sm:rounded-3xl sm:pb-5"
      >
        <div className="text-lg whitespace-pre-line text-neutral-800">{estado.texto}</div>
        <div className={`mb-4 grid gap-2 sm:mb-0 ${estado.cancelar ? "grid-cols-2" : "grid-cols-1"}`}>
          {estado.cancelar && (
            <button
              onClick={() => responder(false)}
              className="h-12 rounded-xl border border-neutral-300 bg-white font-semibold active:bg-neutral-100"
            >
              {estado.cancelar}
            </button>
          )}
          <button
            onClick={() => responder(true)}
            autoFocus
            className={`h-12 rounded-xl font-bold text-white ${estado.perigo ? "bg-red-600 active:bg-red-700" : "bg-[var(--cor-principal)]"}`}
          >
            {estado.confirmar}
          </button>
        </div>
      </div>
    </div>
  );

  return { dialogo, perguntar, avisar };
}
