// Origem da cliente: de onde ela veio (mostra para o salão o resultado do marketing).
// Enquanto o banco não tem uma coluna própria, fica guardada nas etiquetas como "origem:instagram".
// Se um dia virar coluna, só este arquivo precisa mudar.
export const ORIGENS = [
  { chave: "instagram", rotulo: "Instagram" },
  { chave: "facebook", rotulo: "Facebook" },
  { chave: "google", rotulo: "Google" },
  { chave: "anuncio", rotulo: "Anúncio" },
  { chave: "indicacao", rotulo: "Indicação" },
  { chave: "passou_na_frente", rotulo: "Passou na frente" },
  { chave: "outro", rotulo: "Outro" },
] as const;

export type Origem = (typeof ORIGENS)[number]["chave"];

const PREFIXO = "origem:";

export function lerOrigem(etiquetas: string[]): Origem | null {
  const etiqueta = etiquetas.find((e) => e.startsWith(PREFIXO));
  const chave = etiqueta?.slice(PREFIXO.length);
  return ORIGENS.some((o) => o.chave === chave) ? (chave as Origem) : null;
}

export function rotuloOrigem(origem: Origem | null): string {
  return ORIGENS.find((o) => o.chave === origem)?.rotulo ?? "Não informada";
}

export function trocarOrigem(etiquetas: string[], origem: Origem | null): string[] {
  const outras = etiquetas.filter((e) => !e.startsWith(PREFIXO));
  return origem ? [...outras, PREFIXO + origem] : outras;
}

// Etiquetas internas do app (ex.: "sistema:excluida"): nunca aparecem para a dona
export const PREFIXO_SISTEMA = "sistema:";

// Etiquetas que a dona vê (sem a origem, que tem campo próprio na tela, e sem as internas)
export function etiquetasVisiveis(etiquetas: string[]): string[] {
  return etiquetas.filter((e) => !e.startsWith(PREFIXO) && !e.startsWith(PREFIXO_SISTEMA));
}

// Etiquetas internas, para preservar ao salvar a ficha
export function etiquetasDoSistema(etiquetas: string[]): string[] {
  return etiquetas.filter((e) => e.startsWith(PREFIXO_SISTEMA));
}
