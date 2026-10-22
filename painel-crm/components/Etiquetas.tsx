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
        <li key={e} className="inline-flex bg-cobre-claro text-cobre-escuro items-center rounded-full text-sm font-medium">
          <span className={aoRemover ? "py-0.5 pl-2.5" : "px-2.5 py-0.5"}>{e}</span>
          {aoRemover && (
            <button
              onClick={() => aoRemover(e)}
              aria-label={`Tirar a etiqueta ${e}`}
              className="flex h-8 w-8 items-center justify-center rounded-full text-base active:opacity-60"
            >
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
