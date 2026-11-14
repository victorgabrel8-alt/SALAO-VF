// Logo Oi Studio (oi-studio-design-handoff.md, seção 5): o ícone já diz "oi"; ao lado vai só "studio".
// O desenho é o do arquivo oi-icon.svg, sem alteração. Fica aqui dentro (e não em /public) porque a tela de
// login também usa e o proxy só deixa passar arquivo público de quem já entrou.

export function IconeOi({ tamanho = 32 }: { tamanho?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width={tamanho} height={tamanho} role="img" aria-label="Oi Studio" className="shrink-0">
      <path d="M60 0C115.2 0 120 4.8 120 60C120 115.2 115.2 120 60 120C4.8 120 0 115.2 0 60C0 4.8 4.8 0 60 0Z" fill="#1B1719" />
      <g transform="translate(2 6)">
        <path
          fillRule="evenodd"
          d="M46 42a26 26 0 1 0 0 52a26 26 0 1 0 0-52zM46 53.4a13.2 14.6 0 1 1 0 29.2a13.2 14.6 0 1 1 0-29.2z"
          fill="#FAF6F3"
        />
        <path d="M92 48V88" fill="none" stroke="#FAF6F3" strokeWidth="12" strokeLinecap="round" />
        <circle cx="92" cy="20.9" r="7.6" fill="#D8BD8A" />
      </g>
    </svg>
  );
}

// Só o símbolo "oi", sem o quadrado, para usar sobre o fundo Ônix do menu
export function SimboloOi({ tamanho = 34 }: { tamanho?: number }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="14 20 96 82" width={tamanho} height={(tamanho * 82) / 96} role="img" aria-label="Oi Studio" className="shrink-0">
      <g transform="translate(2 6)">
        <path
          fillRule="evenodd"
          d="M46 42a26 26 0 1 0 0 52a26 26 0 1 0 0-52zM46 53.4a13.2 14.6 0 1 1 0 29.2a13.2 14.6 0 1 1 0-29.2z"
          fill="#FAF6F3"
        />
        <path d="M92 48V88" fill="none" stroke="#FAF6F3" strokeWidth="12" strokeLinecap="round" />
        <circle cx="92" cy="20.9" r="7.6" fill="#D8BD8A" />
      </g>
    </svg>
  );
}

// Logo horizontal: símbolo + "studio"
export function LogoOi({ escuro = false, tamanho = 30 }: { escuro?: boolean; tamanho?: number }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {escuro ? <SimboloOi tamanho={tamanho + 4} /> : <IconeOi tamanho={tamanho} />}
      <span className={`text-[22px] leading-none font-bold tracking-[-0.045em] ${escuro ? "text-porcelana" : "text-grafite"}`}>studio</span>
    </span>
  );
}
