// Tela de abertura (identidade Oi Studio): fundo Ônix, o "oi" se monta e embaixo "STUDIO".
// O "o" cresce numa mola, a haste do "i" se desenha de baixo para cima, o pingo dourado cai e
// quica de leve, e a tela se abre com a logo aproximando, como ao abrir um app no iPhone.
// Tudo em CSS (app/globals.css, "abertura-*"): vem pronto no HTML do servidor, então aparece
// antes de qualquer coisa e não depende do app carregar. Dura 1,6 s e não segura o toque depois.
// Só aparece ao abrir o app: o script PULAR_SE_JA_VIU (no <head>, via app/layout.tsx) marca a sessão e, numa recarga da mesma aba, esconde
// a abertura antes de ela ser pintada.
export const PULAR_SE_JA_VIU = `try{if(sessionStorage.getItem("oi-abertura"))document.documentElement.dataset.abertura="vista";else sessionStorage.setItem("oi-abertura","1")}catch(e){}`;

export function Abertura() {
  return (
    <>
      <div aria-hidden className="abertura">
        <div className="abertura-logo">
          <svg viewBox="0 0 120 120" width="104" height="104">
            <g transform="translate(2 6)">
              <path
                className="abertura-o"
                fillRule="evenodd"
                d="M46 42a26 26 0 1 0 0 52a26 26 0 1 0 0-52zM46 53.4a13.2 14.6 0 1 1 0 29.2a13.2 14.6 0 1 1 0-29.2z"
                fill="#FAF6F3"
              />
              {/* Haste desenhada de baixo para cima */}
              <path className="abertura-i" d="M92 88V48" fill="none" stroke="#FAF6F3" strokeWidth={12} strokeLinecap="round" />
              <circle className="abertura-pingo" cx="92" cy="20.9" r="7.6" fill="#D8BD8A" />
            </g>
          </svg>
          <span className="abertura-nome">STUDIO</span>
        </div>
      </div>
    </>
  );
}
