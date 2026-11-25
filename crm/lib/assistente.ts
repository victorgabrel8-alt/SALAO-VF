// Conversa da assistente com a dona (e a equipe) no WhatsApp do studio (supabase/080).
// Essa conversa não fica no banco: o servidor do app lê o histórico da Evolution (app/api/assistente/route.ts) e entrega
// já no formato abaixo. Este arquivo é usado pelo servidor e pelas telas: não tem chave nenhuma.

// Uma linha de assistente_conversas(): uma conversa que o login pode abrir
export type ConversaAssistente = { empresa_id: string; loja: string; instancia: string; numero: string; nome: string | null };

export type TipoMensagem = "texto" | "audio" | "foto" | "video" | "documento" | "figurinha" | "contato" | "localizacao" | "reacao" | "outro";

export type MensagemAssistente = {
  id: string;
  // true: saiu do WhatsApp do studio (a assistente); false: a dona ou a profissional
  daAssistente: boolean;
  // segundos desde 1970 (messageTimestamp da Evolution)
  em: number;
  tipo: TipoMensagem;
  // texto da mensagem, legenda da foto, nome do contato, emoji da reação... (pode ser vazio, ex.: áudio)
  texto: string;
};

export type PaginaAssistente = {
  mensagens: MensagemAssistente[];
  // tem mais antigas: pedir de novo com ate = antes
  mais: boolean;
  antes: number | null;
  // nome da pessoa no WhatsApp (para quando a loja não tem o nome no cadastro)
  nomeWhatsApp: string | null;
};

// Rótulo do que não é texto, como a dona vê no WhatsApp: "[áudio]", "[foto]"...
export const ROTULO: Record<TipoMensagem, string> = {
  texto: "",
  audio: "[áudio]",
  foto: "[foto]",
  video: "[vídeo]",
  documento: "[documento]",
  figurinha: "[figurinha]",
  contato: "[contato]",
  localizacao: "[localização]",
  reacao: "[reação]",
  outro: "[mensagem]",
};

// "Assistente · Caroline"; sem nome, o telefone
export function tituloDaConversa(c: Pick<ConversaAssistente, "nome" | "numero">, nomeWhatsApp?: string | null): string {
  const nome = c.nome ?? nomeWhatsApp?.trim().split(/\s+/)[0] ?? formatarNumero(c.numero);
  return `Assistente · ${nome}`;
}

// 5593991144926 -> (93) 99114-4926
function formatarNumero(n: string): string {
  const local = n.startsWith("55") ? n.slice(2) : n;
  const numero = local.slice(2);
  if (numero.length === 9) return `(${local.slice(0, 2)}) ${numero.slice(0, 5)}-${numero.slice(5)}`;
  if (numero.length === 8) return `(${local.slice(0, 2)}) ${numero.slice(0, 4)}-${numero.slice(4)}`;
  return n;
}

// O WhatsApp guarda o número do celular com ou sem o 9 depois do DDD (a Caroline e a Duda vêm sem). Devolve as duas formas.
export function formasDoNumero(numero: string): string[] {
  const n = numero.replace(/\D/g, "");
  if (/^55\d{2}9\d{8}$/.test(n)) return [n, n.slice(0, 4) + n.slice(5)];
  if (/^55\d{2}\d{8}$/.test(n)) return [n, n.slice(0, 4) + "9" + n.slice(4)];
  return [n];
}

// ---------------------------------------------------------------------------------------------------------------------
// Registro do findMessages da Evolution -> mensagem da tela

type Registro = {
  key?: { id?: string; fromMe?: boolean; remoteJid?: string };
  messageType?: string;
  message?: Record<string, unknown> | null;
  messageTimestamp?: number | string;
  pushName?: string | null;
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" ? (v as Obj) : null);
const txt = (v: unknown): string => (typeof v === "string" ? v : "");

// Mensagens embrulhadas (temporária, ver uma vez, documento com legenda) trazem a de verdade dentro de "message"
function desembrulhar(m: Obj): Obj {
  for (let i = 0; i < 4; i++) {
    const dentro =
      obj(obj(m.ephemeralMessage)?.message) ??
      obj(obj(m.viewOnceMessage)?.message) ??
      obj(obj(m.viewOnceMessageV2)?.message) ??
      obj(obj(m.viewOnceMessageV2Extension)?.message) ??
      obj(obj(m.documentWithCaptionMessage)?.message);
    if (!dentro) break;
    m = dentro;
  }
  return m;
}

// Nome e telefone de um cartão de contato (vCard)
function doVcard(vcard: string, nome: string): string {
  const fn = vcard.match(/^FN:(.*)$/m)?.[1]?.trim();
  const tel = vcard.match(/waid=\d+:([^\r\n]+)/)?.[1]?.trim() ?? vcard.match(/^TEL[^:]*:([^\r\n]+)/m)?.[1]?.trim();
  return [nome || fn, tel].filter(Boolean).join(" · ");
}

// O que a tela mostra de cada mensagem; null = não é mensagem para mostrar (apagada, edição, aviso do sistema)
export function lerMensagem(r: Registro): MensagemAssistente | null {
  const id = r.key?.id;
  const em = Number(r.messageTimestamp);
  const bruta = obj(r.message);
  if (!id || !Number.isFinite(em) || !bruta) return null;
  const m = desembrulhar(bruta);
  const daAssistente = Boolean(r.key?.fromMe);
  const base = { id, daAssistente, em };

  // texto vazio (edição ou apagada) não aparece
  if (typeof m.conversation === "string") return m.conversation.trim() ? { ...base, tipo: "texto", texto: m.conversation } : null;
  const ext = obj(m.extendedTextMessage);
  if (ext) return txt(ext.text).trim() ? { ...base, tipo: "texto", texto: txt(ext.text) } : null;
  if (obj(m.audioMessage)) return { ...base, tipo: "audio", texto: "" };
  const foto = obj(m.imageMessage);
  if (foto) return { ...base, tipo: "foto", texto: txt(foto.caption) };
  const video = obj(m.videoMessage) ?? obj(m.ptvMessage);
  if (video) return { ...base, tipo: "video", texto: txt(video.caption) };
  const doc = obj(m.documentMessage);
  if (doc) return { ...base, tipo: "documento", texto: txt(doc.caption) || txt(doc.fileName) || txt(doc.title) };
  if (obj(m.stickerMessage)) return { ...base, tipo: "figurinha", texto: "" };
  const contato = obj(m.contactMessage);
  if (contato) return { ...base, tipo: "contato", texto: doVcard(txt(contato.vcard), txt(contato.displayName)) };
  const contatos = obj(m.contactsArrayMessage);
  if (contatos) {
    const lista = Array.isArray(contatos.contacts) ? contatos.contacts.map((c) => obj(c)).filter((c): c is Obj => c !== null) : [];
    const texto = lista.map((c) => doVcard(txt(c.vcard), txt(c.displayName))).filter(Boolean).join("\n");
    return { ...base, tipo: "contato", texto: texto || txt(contatos.displayName) };
  }
  const local = obj(m.locationMessage) ?? obj(m.liveLocationMessage);
  if (local) return { ...base, tipo: "localizacao", texto: txt(local.name) || txt(local.address) };
  const reacao = obj(m.reactionMessage);
  // reação tirada (texto vazio) não aparece
  if (reacao) return txt(reacao.text) ? { ...base, tipo: "reacao", texto: txt(reacao.text) } : null;
  const botao = obj(m.buttonsResponseMessage) ?? obj(m.templateButtonReplyMessage);
  if (botao) return { ...base, tipo: "texto", texto: txt(botao.selectedDisplayText) };
  const lista = obj(m.listResponseMessage);
  if (lista) return { ...base, tipo: "texto", texto: txt(lista.title) };

  // Apagar, editar, chaves de criptografia e avisos do WhatsApp não são mensagens da conversa
  const ignorar = ["protocolMessage", "editedMessage", "secretEncryptedMessage", "senderKeyDistributionMessage", "pollUpdateMessage", "keepInChatMessage", "encReactionMessage"];
  const chaves = Object.keys(m).filter((k) => k !== "messageContextInfo");
  if (!chaves.length || chaves.some((k) => ignorar.includes(k))) return null;
  return { ...base, tipo: "outro", texto: "" };
}
