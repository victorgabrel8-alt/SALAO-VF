import type { Empresa } from "@/lib/empresa";

// Nicho da loja (empresas.nicho, supabase/024): muda as categorias de serviço e os exemplos das telas.
// Loja de mega hair continua exatamente como era antes.

export type Nicho = "mega_hair" | "manicure" | "estudio_beleza";

export type Categoria = { id: string; nome: string };

// Os ids precisam estar no check de servicos.categoria (supabase/024)
const CATEGORIAS: Record<Nicho, Categoria[]> = {
  mega_hair: [
    { id: "aplicacao", nome: "Aplicação de mega hair" },
    { id: "manutencao", nome: "Manutenção" },
    { id: "quimica", nome: "Químicas" },
    { id: "tratamento", nome: "Tratamentos" },
    { id: "avaliacao", nome: "Avaliação" },
    { id: "venda", nome: "Venda de cabelo" },
    { id: "outro", nome: "Outros" },
  ],
  manicure: [
    { id: "unhas", nome: "Unhas" },
    { id: "alongamento", nome: "Alongamento" },
    { id: "tratamento", nome: "Tratamentos e spa" },
    { id: "sobrancelha_cilios", nome: "Sobrancelha e cílios" },
    { id: "avaliacao", nome: "Avaliação" },
    { id: "outro", nome: "Outros" },
  ],
  estudio_beleza: [
    { id: "unhas", nome: "Unhas" },
    { id: "sobrancelha_cilios", nome: "Sobrancelha e cílios" },
    { id: "estetica", nome: "Estética" },
    { id: "depilacao", nome: "Depilação" },
    { id: "maquiagem", nome: "Maquiagem" },
    { id: "quimica", nome: "Cabelo – químicas" },
    { id: "tratamento", nome: "Tratamentos" },
    { id: "avaliacao", nome: "Avaliação" },
    { id: "outro", nome: "Outros" },
  ],
};

const EXEMPLO_SERVICO: Record<Nicho, string> = {
  mega_hair: "Ex.: Selagem",
  manicure: "Ex.: Pé e mão",
  estudio_beleza: "Ex.: Design de sobrancelha",
};

export function nichoDa(empresa: Empresa): Nicho {
  return empresa.nicho === "manicure" || empresa.nicho === "estudio_beleza" ? empresa.nicho : "mega_hair";
}

export function categoriasDo(nicho: Nicho): Categoria[] {
  return CATEGORIAS[nicho];
}

export function exemploServico(nicho: Nicho): string {
  return EXEMPLO_SERVICO[nicho];
}
