import type { Empresa } from "@/lib/empresa";
import { categoriasDo, nichoDa } from "@/lib/nicho";
import { supabase } from "@/lib/supabase/client";

// Escolha de serviços nos formulários (Registrar atendimento / Novo horário): vários serviços,
// itens cobrados por unidade (cada unha, cada pé) e os totais de preço e de tempo.
// Um horário só por visita: o principal fica em agendamentos.servico_id (+ quantidade) e os
// outros em atendimento_servicos (+ quantidade), supabase/010 e 034.

export type ServicoEscolha = {
  id: string;
  nome: string;
  categoria: string | null;
  preco: number | null;
  a_partir_de: boolean;
  duracao_min: number;
  dias_retorno: number | null;
  // Vazio = cobrado por serviço; "unha", "pé"... = cobrado por unidade (supabase/034)
  unidade: string | null;
};

export type Escolhido = { id: string; quantidade: number };

export const QUANTIDADE_MAXIMA = 20;

export async function buscarServicosAtivos(empresaId: string): Promise<ServicoEscolha[]> {
  const { data } = await supabase()
    .from("servicos")
    .select("id, nome, categoria, preco, a_partir_de, duracao_min, dias_retorno, unidade")
    .eq("empresa_id", empresaId)
    .eq("ativo", true)
    .order("nome");
  return ((data ?? []) as ServicoEscolha[]).map((s) => ({ ...s, preco: s.preco === null ? null : Number(s.preco) }));
}

// Os serviços que a loja mais fez nos últimos 90 dias (o principal e os a mais de cada horário)
export async function buscarMaisUsados(empresaId: string, limite = 5): Promise<string[]> {
  const desde = new Date(Date.now() - 90 * 86_400_000).toISOString();
  const { data, error } = await supabase()
    .from("servicos_feitos")
    .select("servico_id")
    .eq("empresa_id", empresaId)
    .gte("inicio", desde)
    .limit(3000);
  if (error) return [];
  const contagem = new Map<string, number>();
  for (const x of (data ?? []) as { servico_id: string | null }[]) {
    if (x.servico_id) contagem.set(x.servico_id, (contagem.get(x.servico_id) ?? 0) + 1);
  }
  return [...contagem.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limite)
    .map(([id]) => id);
}

// Os botões de cima: os mais usados que ainda estão ativos; completa com os primeiros da lista
// (loja nova, sem histórico), deixando por último os avulsos por unidade (cada unha, cada pé)
export function servicosDeAtalho(servicos: ServicoEscolha[], maisUsados: string[], limite = 5): ServicoEscolha[] {
  const usados = maisUsados.map((id) => servicos.find((s) => s.id === id)).filter((s): s is ServicoEscolha => !!s);
  const resto = servicos.filter((s) => !usados.includes(s)).sort((a, b) => Number(!!a.unidade) - Number(!!b.unidade));
  return [...usados, ...resto].slice(0, limite);
}

// "1 unha", "3 unhas", "2 pés"
export function textoUnidade(unidade: string, quantidade: number): string {
  if (quantidade === 1) return `1 ${unidade}`;
  const plural = unidade === "pé" ? "pés" : /[aeiou]$/i.test(unidade) ? `${unidade}s` : unidade;
  return `${quantidade} ${plural}`;
}

export function formatarPreco(valor: number): string {
  return `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: valor % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

export function formatarDuracao(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

// Total de preço e de tempo do que foi escolhido. aPartirDe: algum preço é "a partir de";
// semPreco: algum serviço não tem preço (o total fica incompleto)
export function somarEscolhidos(escolhidos: Escolhido[], servicos: ServicoEscolha[]) {
  let preco = 0;
  let minutos = 0;
  let aPartirDe = false;
  let semPreco = false;
  for (const e of escolhidos) {
    const s = servicos.find((x) => x.id === e.id);
    if (!s) continue;
    minutos += s.duracao_min * e.quantidade;
    if (s.preco === null) semPreco = true;
    else preco += s.preco * e.quantidade;
    if (s.a_partir_de && s.preco) aPartirDe = true;
  }
  return { preco, minutos, aPartirDe, semPreco };
}

// Ordem para gravar: o 1º vira o principal do horário. Mesma regra do "O que ela fez?"
// (FolhaConfirmar): o de retorno mais curto, para a IA chamar a cliente na data certa. Serviço
// por unidade (reposição de unha) só é o principal quando é o único.
export function ordenarParaGravar(escolhidos: Escolhido[], servicos: ServicoEscolha[]): Escolhido[] {
  const dados = (e: Escolhido) => servicos.find((s) => s.id === e.id);
  const peso = (e: Escolhido) => {
    const s = dados(e);
    return [s?.unidade ? 1 : 0, s?.dias_retorno ?? Infinity] as const;
  };
  return escolhidos
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const [ua, ra] = peso(a.e);
      const [ub, rb] = peso(b.e);
      return ua - ub || ra - rb || a.i - b.i;
    })
    .map((x) => x.e);
}

// Lista agrupada pelas categorias do nicho da loja, na ordem do nicho; o que não tem categoria
// conhecida vai para "Outros"
export function agruparPorCategoria(servicos: ServicoEscolha[], empresa: Empresa) {
  const categorias = categoriasDo(nichoDa(empresa));
  const conhecida = (c: string | null) => categorias.some((x) => x.id === c);
  return categorias
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      servicos: servicos.filter((s) => (conhecida(s.categoria) ? s.categoria : "outro") === c.id),
    }))
    .filter((g) => g.servicos.length > 0);
}

// Busca sem acento e sem diferença de maiúscula: "esmaltacao" acha "Esmaltação em gel"
export function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
