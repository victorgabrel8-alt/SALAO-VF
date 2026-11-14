import { ErroLoja } from "@/lib/servidor/lojas";

// Erro de regra (ErroLoja) vai para a tela como está; qualquer outro vira uma mensagem genérica,
// para não mandar detalhe do servidor para o navegador.
export function comErro(e: unknown) {
  if (e instanceof ErroLoja) return Response.json({ erro: e.message }, { status: 400 });
  console.error("[lojas]", e);
  return Response.json({ erro: "Não deu certo agora. Tente de novo em instantes." }, { status: 500 });
}
