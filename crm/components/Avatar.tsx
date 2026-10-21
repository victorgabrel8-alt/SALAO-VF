// Bolinha com as iniciais da cliente (como a foto de perfil do WhatsApp).
// A cor sai do id, então cada cliente tem sempre a mesma.
const CORES = [
  "bg-taupe text-taupe-texto",
  "bg-rose text-rose-texto",
  "bg-salvia text-salvia-texto",
  "bg-ouro text-ouro-texto",
  "bg-[#E2E6EA] text-[#36485A]",
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
      className={`flex shrink-0 items-center justify-center rounded-full font-serif font-semibold ${tamanho} ${CORES[soma % CORES.length]}`}
    >
      {iniciais(nome)}
    </span>
  );
}
