// Botão grande fixo acima da barra de abas (alcança com o polegar)
export function BotaoFlutuante({ rotulo, aoTocar }: { rotulo: string; aoTocar: () => void }) {
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom)+0.75rem)] z-10 mx-auto flex max-w-xl justify-end px-4">
      <button
        onClick={aoTocar}
        className="pointer-events-auto h-14 rounded-full bg-[var(--cor-principal)] px-6 text-lg font-bold text-white shadow-lg active:opacity-90"
      >
        {rotulo}
      </button>
    </div>
  );
}
