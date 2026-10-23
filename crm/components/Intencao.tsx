import type { Avaliacao } from "@/lib/avaliacoes";

// O que a cliente quer, anotado pela IA na conversa (pré-avaliação), logo abaixo do serviço.
// Ex.: "Quer chegar na cintura, castanho escuro, até 3 mil, casamento em dezembro."
export function Intencao({ avaliacao, claro = false }: { avaliacao: Avaliacao | undefined; claro?: boolean }) {
  const texto = avaliacao?.pre_resumo?.trim();
  if (!texto) return null;
  return (
    <p className={`mt-0.5 line-clamp-2 text-sm ${claro ? "text-[#CFC3B4]" : "text-texto-2"}`}>
      <span className={`mr-1 rounded-full px-1.5 py-px text-[10px] font-bold tracking-wide ${claro ? "bg-bronze text-grafite" : "bg-areia text-bronze-escuro"}`}>
        IA
      </span>
      {avaliacao?.resultado === "pensando" && <span className="font-semibold">Ficou de pensar · </span>}
      {texto}
    </p>
  );
}
