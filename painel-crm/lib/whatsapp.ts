// Único lugar que monta o link do WhatsApp. A dona tem o WhatsApp pessoal e o Business
// no iPhone, e nenhum link garante qual dos dois abre (ver "WhatsApp no iPhone" no README).
// Para testar no iPhone dela, troque TIPO_LINK e publique de novo:
//   "wa.me"    -> https://wa.me/55...?text=   (link universal, o oficial do WhatsApp)
//   "esquema"  -> whatsapp://send?phone=55...&text=   (abre direto o app, sem passar pelo Safari)
type TipoLink = "wa.me" | "esquema";
export const TIPO_LINK: TipoLink = "wa.me";

export function linkWhatsApp(telefone: string, texto?: string, tipo: TipoLink = TIPO_LINK): string {
  telefone = telefone.replace(/\D/g, "");
  const mensagem = texto ? encodeURIComponent(texto) : "";
  if (tipo === "esquema") return `whatsapp://send?phone=${telefone}${mensagem ? `&text=${mensagem}` : ""}`;
  return `https://wa.me/${telefone}${mensagem ? `?text=${mensagem}` : ""}`;
}

export function abrirWhatsApp(telefone: string, texto?: string) {
  window.open(linkWhatsApp(telefone, texto), "_blank", "noopener,noreferrer");
}
