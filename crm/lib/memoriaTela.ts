// Memória das telas enquanto o app está aberto: ao voltar para uma aba (Início, Conversas,
// Agenda), ela aparece na hora com o que já tinha, e os dados novos chegam por trás. Antes cada
// troca de aba começava vazia ("Carregando…") e o conteúdo pulava na tela depois.
// Fica só na memória da aba do navegador: recarregar a página ou sair da conta limpa tudo.

const memoria = new Map<string, unknown>();

export function lembrar<T>(chave: string): T | null {
  return (memoria.get(chave) as T | undefined) ?? null;
}

export function guardar<T>(chave: string, valor: T) {
  // Erro não fica guardado: na próxima vez tenta de novo do zero
  if (valor && typeof valor === "object" && "erro" in (valor as object)) memoria.delete(chave);
  else memoria.set(chave, valor);
}

export function esquecerTudo() {
  memoria.clear();
}
