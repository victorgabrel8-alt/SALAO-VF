// Bolinha com as iniciais da cliente (como a foto de perfil do WhatsApp).
// Uma cor só para todas (Pérola com a inicial em Ônix), como pede a identidade Oi Studio.

function iniciais(nome: string | null): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

// O id continua no tipo para as telas que já o passam.
// cor: só para destacar quem precisa da dona (fundo de atenção)
export function Avatar({ nome, tamanho = "h-12 w-12 text-lg", cor = "bg-campo text-grafite" }: { id: string; nome: string | null; tamanho?: string; cor?: string }) {
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-extrabold ${tamanho} ${cor}`}
    >
      {iniciais(nome)}
    </span>
  );
}
