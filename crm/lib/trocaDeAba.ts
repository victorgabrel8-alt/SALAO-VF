// Troca entre as abas (Início, Conversas, Agenda): as telas se cruzam suavemente, sem deslizar.
//
// O navegador tira uma foto da tela inteira (do tamanho do celular), troca a tela por baixo e cruza
// a foto antiga com a tela nova. A barra de abas fica de fora da foto (view-transition-name no
// <nav>, em components/BarraAbas.tsx), então ela não pisca nem é coberta.
// Antes, a foto era só do conteúdo da aba: uma lista longa virava uma imagem de milhares de pixels,
// desenhada por cima da barra e escorregando até a posição da tela nova ("a tela enchia e voltava").
//
// O CSS está em app/globals.css (html[data-troca="aba"]::view-transition-*).

let liberar: (() => void) | null = null;
let emCurso = 0;

// A tela nova já está montada: o navegador pode fotografar e começar a cruzar
export function telaTrocou() {
  liberar?.();
  liberar = null;
}

// Celular sem suporte, app em segundo plano ou "reduzir movimento" ligado: troca direto
export function podeAnimarTroca(): boolean {
  return (
    typeof document.startViewTransition === "function" &&
    document.visibilityState === "visible" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

// `navegar` faz a troca de tela (router.push). Se a tela nova demorar (rota ainda não baixada),
// a espera é cortada para o toque não parecer travado: ela entra sem animação quando chegar.
export function trocarDeAba(navegar: () => void) {
  telaTrocou();
  const html = document.documentElement;
  html.dataset.troca = "aba";
  emCurso++;
  // O navegador só chama a troca quando desenha o próximo quadro. Se ele demorar (aparelho
  // ocupado, tela sem desenhar), a navegação não fica esperando: vai direto, sem animação.
  let navegou = false;
  const ir = () => {
    if (navegou) return;
    navegou = true;
    navegar();
  };
  const reserva = setTimeout(ir, 120);
  const troca = document.startViewTransition(
    () =>
      new Promise<void>((pronto) => {
        clearTimeout(reserva);
        if (navegou) return pronto();
        liberar = pronto;
        ir();
        setTimeout(pronto, 350);
      }),
  );
  // Troca cancelada (outro toque em seguida, app foi para segundo plano): a tela muda igual
  troca.ready.catch(() => {});
  troca.updateCallbackDone.catch(() => {});
  troca.finished
    .catch(() => {})
    .finally(() => {
      if (--emCurso === 0) delete html.dataset.troca;
    });
}
