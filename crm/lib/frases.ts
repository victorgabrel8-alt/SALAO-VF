// Frase do dia no Início: um versículo bíblico curto, de ânimo, que troca uma vez por dia (o mesmo
// para todo mundo naquele dia). Texto na tradução de João Ferreira de Almeida, em domínio público.
// A dona desliga em Configurações (empresas.config.frase_do_dia = false); sem a chave, aparece.

export type Frase = { texto: string; referencia: string };

export const FRASES: Frase[] = [
  { texto: "O coração alegre aformoseia o rosto.", referencia: "Provérbios 15:13" },
  { texto: "Este é o dia que fez o Senhor; regozijemo-nos e alegremo-nos nele.", referencia: "Salmos 118:24" },
  { texto: "Tudo posso naquele que me fortalece.", referencia: "Filipenses 4:13" },
  { texto: "O Senhor é o meu pastor; nada me faltará.", referencia: "Salmos 23:1" },
  { texto: "Entrega o teu caminho ao Senhor; confia nele, e ele tudo fará.", referencia: "Salmos 37:5" },
  { texto: "Não temas, porque eu sou contigo.", referencia: "Isaías 41:10" },
  { texto: "O choro pode durar uma noite, mas a alegria vem pela manhã.", referencia: "Salmos 30:5" },
  { texto: "Lança o teu cuidado sobre o Senhor, e ele te susterá.", referencia: "Salmos 55:22" },
  { texto: "Deleita-te também no Senhor, e te concederá os desejos do teu coração.", referencia: "Salmos 37:4" },
  { texto: "Confia no Senhor de todo o teu coração.", referencia: "Provérbios 3:5" },
  { texto: "Esforça-te, e tem bom ânimo; não temas, nem te espantes.", referencia: "Josué 1:9" },
  { texto: "Bem-aventurados os pacificadores.", referencia: "Mateus 5:9" },
  { texto: "Tudo tem o seu tempo determinado.", referencia: "Eclesiastes 3:1" },
  { texto: "A resposta branda desvia o furor.", referencia: "Provérbios 15:1" },
  { texto: "Confia ao Senhor as tuas obras, e teus pensamentos serão estabelecidos.", referencia: "Provérbios 16:3" },
  { texto: "Regozijai-vos sempre no Senhor.", referencia: "Filipenses 4:4" },
  { texto: "Em tudo dai graças.", referencia: "1 Tessalonicenses 5:18" },
  { texto: "O Senhor te guardará de todo o mal.", referencia: "Salmos 121:7" },
  { texto: "Vinde a mim, todos os que estais cansados e oprimidos, e eu vos aliviarei.", referencia: "Mateus 11:28" },
  { texto: "Deus é o nosso refúgio e fortaleza.", referencia: "Salmos 46:1" },
  { texto: "As suas misericórdias não têm fim; novas são cada manhã.", referencia: "Lamentações 3:22-23" },
  { texto: "Pedi, e dar-se-vos-á; buscai, e encontrareis.", referencia: "Mateus 7:7" },
  { texto: "Deixo-vos a paz, a minha paz vos dou.", referencia: "João 14:27" },
  { texto: "Tudo quanto fizerdes, fazei-o de todo o coração, como ao Senhor.", referencia: "Colossenses 3:23" },
  { texto: "O Senhor é a minha luz e a minha salvação; a quem temerei?", referencia: "Salmos 27:1" },
  { texto: "Bendize, ó minha alma, ao Senhor.", referencia: "Salmos 103:1" },
  { texto: "Deus é amor.", referencia: "1 João 4:8" },
  { texto: "O Senhor te abençoe e te guarde.", referencia: "Números 6:24" },
  { texto: "Esforçai-vos, e ele fortalecerá o vosso coração, vós todos que esperais no Senhor.", referencia: "Salmos 31:24" },
  { texto: "Sobre tudo o que se deve guardar, guarda o teu coração.", referencia: "Provérbios 4:23" },
  { texto: "Grandes coisas fez o Senhor por nós, pelas quais estamos alegres.", referencia: "Salmos 126:3" },
  { texto: "O amor é sofredor, é benigno.", referencia: "1 Coríntios 13:4" },
];

// A frase do dia: troca à meia-noite (no fuso do salão) e anda pela lista sem repetir seguido
export function fraseDoDia(dia: string): Frase {
  const n = Math.floor(Date.parse(`${dia}T12:00:00Z`) / 86_400_000);
  return FRASES[((n % FRASES.length) + FRASES.length) % FRASES.length];
}

// Sem a chave no config, a frase aparece; só some quando a dona desliga
export function mostrarFrase(config: Record<string, unknown>): boolean {
  return config.frase_do_dia !== false;
}
