import { supabase } from "@/lib/supabase/client";

// Cadastros repetidos: a mesma cliente duas vezes na loja, uma com o número com o 9 e outra sem
// (ex.: 5566996834918 e 556696834918). O sistema não junta sozinho: a dona confere cada par e toca
// em "Juntar" (supabase/062: clientes_duplicadas e juntar_clientes).

export type LadoDoPar = {
  id: string;
  nome: string | null;
  telefone: string;
  horarios: number;
  mensagens: number;
  ultimaMensagem: string | null;
  ultimoHorario: string | null;
  excluida: boolean;
};

export type ParRepetido = { com9: LadoDoPar; sem9: LadoDoPar };

type Linha = Record<string, unknown>;

function lado(l: Linha, prefixo: "com9" | "sem9"): LadoDoPar {
  const v = (campo: string) => l[`${prefixo}_${campo}`];
  return {
    id: v("id") as string,
    nome: (v("nome") as string | null) ?? null,
    telefone: v("telefone") as string,
    horarios: Number(v("horarios") ?? 0),
    mensagens: Number(v("mensagens") ?? 0),
    ultimaMensagem: (v("ultima_mensagem") as string | null) ?? null,
    ultimoHorario: (v("ultimo_horario") as string | null) ?? null,
    excluida: v("excluida") === true,
  };
}

// Os pares da loja (o mais recente primeiro)
export async function buscarRepetidos(empresaId: string): Promise<{ pares: ParRepetido[]; erro?: string }> {
  const { data, error } = await supabase().rpc("clientes_duplicadas", { p_empresa_id: empresaId });
  if (error) return { pares: [], erro: error.message };
  return { pares: ((data ?? []) as Linha[]).map((l) => ({ com9: lado(l, "com9"), sem9: lado(l, "sem9") })) };
}

// Junta os dois cadastros: tudo da que sai passa para a que fica, que termina com o número com o 9.
// A que sai deixa de existir (não dá para desfazer). Devolve a mensagem de erro, se houver.
export async function juntarCadastros(empresaId: string, fica: string, sai: string): Promise<string | undefined> {
  const { error } = await supabase().rpc("juntar_clientes", { p_empresa_id: empresaId, p_fica: fica, p_sai: sai });
  return error?.message;
}
