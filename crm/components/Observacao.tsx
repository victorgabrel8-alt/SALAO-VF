// Observação da cliente (alergia, fórmula da cor...) logo abaixo do nome, com asterisco e
// sublinhada, para a dona bater o olho antes de atender. Textos longos ficam em 2 linhas.
export function Observacao({ texto }: { texto: string | null | undefined }) {
  const limpo = texto?.trim();
  if (!limpo) return null;
  return (
    <p className="mt-0.5 line-clamp-2 text-sm text-neutral-700">
      <span className="font-bold text-[var(--cor-principal)]">* </span>
      <span className="underline decoration-neutral-400 underline-offset-2">{limpo}</span>
    </p>
  );
}
