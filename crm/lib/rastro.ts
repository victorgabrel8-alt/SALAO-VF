// Caminho que a pessoa fez dentro do app (enquanto ele está aberto), para o botão "Voltar" das
// telas internas voltar de verdade (como o gesto de voltar do celular) em vez de abrir a tela de
// trás como uma tela nova. Quem alimenta é a barra de abas (components/BarraAbas.tsx), que está em
// todas as telas; quem usa é components/Voltar.tsx.

const rastro: string[] = [];
let voltando = false;
let ouvindo = false;

export function registrarTela(caminho: string) {
  if (!ouvindo && typeof window !== "undefined") {
    ouvindo = true;
    // Gesto/botão de voltar do celular (ou o nosso router.back)
    window.addEventListener("popstate", () => {
      voltando = true;
    });
  }
  if (!caminho || rastro[rastro.length - 1] === caminho) return;
  if (voltando && rastro[rastro.length - 2] === caminho) rastro.pop();
  else rastro.push(caminho);
  voltando = false;
}

// A tela de onde a pessoa veio (ou null: abriu o app direto nesta tela)
export function telaAnterior(): string | null {
  return rastro[rastro.length - 2] ?? null;
}
