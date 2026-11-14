import { etiquetasVisiveis } from "@/lib/origem";

// Etiquetas da cliente (vip, alergia, mega hair...) logo abaixo do nome.
// Com `aoRemover`, cada etiqueta ganha um × para tirar (usado na ficha).
export function Etiquetas({
  etiquetas,
  aoRemover,
  className = "mt-1",
}: {
  etiquetas: string[];
  aoRemover?: (etiqueta: string) => void;
  className?: string;
}) {
  const visiveis = etiquetasVisiveis(etiquetas);
  if (visiveis.length === 0) return null;
  return (
    <ul className={`flex flex-wrap gap-1.5 ${className}`}>
      {visiveis.map((e) => (
        <li key={e} className="inline-flex items-center rounded-full bg-campo text-[13px] font-bold text-grafite">
          <span className={aoRemover ? "py-1 pl-3" : "px-2.5 py-1"}>{e}</span>
          {aoRemover && (
            <button
              onClick={() => aoRemover(e)}
              aria-label={`Tirar a etiqueta ${e}`}
              className="flex h-10 w-10 items-center justify-center rounded-full text-apoio hover:bg-borda hover:text-grafite"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
