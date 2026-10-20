// Único lugar que monta o link do WhatsApp. A dona tem o WhatsApp pessoal e o Business
// no iPhone; o link comum (wa.me) pode abrir o pessoal. Na fase 4 vamos testar no
// iPhone dela e, se precisar, trocar o tipo de link só aqui.
export function linkWhatsApp(telefone: string, texto?: string): string {
  const mensagem = texto ? `?text=${encodeURIComponent(texto)}` : "";
  return `https://wa.me/${telefone}${mensagem}`;
}

export function abrirWhatsApp(telefone: string, texto?: string) {
  window.open(linkWhatsApp(telefone, texto), "_blank");
}
