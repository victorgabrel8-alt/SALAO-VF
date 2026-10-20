// Bolinha com as iniciais da cliente (como a foto de perfil do WhatsApp).
// A cor sai do id, então cada cliente tem sempre a mesma.
const CORES = [
  "bg-rose-100 text-rose-800",
  "bg-sky-100 text-sky-800",
  "bg-violet-100 text-violet-800",
  "bg-emerald-100 text-emerald-800",
  "bg-amber-100 text-amber-800",
  "bg-teal-100 text-teal-800",
];

function iniciais(nome: string | null): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

export function Avatar({ id, nome, tamanho = "h-12 w-12 text-lg" }: { id: string; nome: string | null; tamanho?: string }) {
  let soma = 0;
  for (const c of id) soma = (soma + c.charCodeAt(0)) % 997;
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${tamanho} ${CORES[soma % CORES.length]}`}
    >
      {iniciais(nome)}
    </span>
  );
}
