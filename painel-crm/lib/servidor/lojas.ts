/* eslint-disable @typescript-eslint/no-explicit-any -- respostas da Evolution e o config da loja são JSON livre */
// Lojas do motor único (docs/PLANO-MOTOR-UNICO.md). Roda só no servidor do painel: usa a chave de serviço do
// Supabase e a chave da Evolution, que nunca vão para o navegador. É a mesma sequência do
// n8n/demo-agente/nova-loja.js (lá é o comando; aqui é o botão).

// ramo -> nicho no banco e nome do motor no n8n (o webhook é <motor>-whatsapp-salao)
export const RAMOS = {
  unhas: { nicho: "manicure", motor: "motor-unhas", rotulo: "Unhas" },
  megahair: { nicho: "mega_hair", motor: "motor-megahair", rotulo: "Mega hair" },
} as const;
export type Ramo = keyof typeof RAMOS;

const env = (nome: string) => (process.env[nome] ?? "").trim();

export function faltandoNoServidor(): string[] {
  return ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_KEY", "EVOLUTION_URL", "EVOLUTION_API_KEY", "AGENCIA_EMAILS", "AGENCIA_WHATSAPP"].filter(
    (n) => !env(n),
  );
}

const digitos = (s: unknown) => String(s ?? "").replace(/\D/g, "");
const sem9 = (n: string) => (/^55\d{2}9\d{8}$/.test(n) ? n.slice(0, 4) + n.slice(5) : n);

export class ErroLoja extends Error {}

async function banco<T>(rota: string, opcoes: RequestInit = {}): Promise<T> {
  const chave = env("SUPABASE_SERVICE_KEY");
  const r = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}${rota}`, {
    ...opcoes,
    cache: "no-store",
    headers: { apikey: chave, Authorization: `Bearer ${chave}`, "Content-Type": "application/json", ...(opcoes.headers ?? {}) },
  });
  const texto = await r.text();
  if (!r.ok) throw new ErroLoja(`banco ${r.status}: ${texto.slice(0, 300)}`);
  return (texto ? JSON.parse(texto) : null) as T;
}

async function evo(rota: string, opcoes: RequestInit = {}) {
  const r = await fetch(`${env("EVOLUTION_URL").replace(/\/$/, "")}${rota}`, {
    ...opcoes,
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    headers: { apikey: env("EVOLUTION_API_KEY"), "Content-Type": "application/json", ...(opcoes.headers ?? {}) },
  });
  const texto = await r.text();
  let corpo: unknown = texto;
  try {
    corpo = JSON.parse(texto);
  } catch {
    // resposta que não é JSON fica como texto
  }
  return { ok: r.ok, status: r.status, corpo: corpo as Record<string, any> };
}

type Config = Record<string, any>;
type LinhaEmpresa = { id: string; nome: string; nicho: string; ativo: boolean; instancia_whatsapp: string | null; config: Config; criado_em: string };

export type Loja = {
  id: string;
  nome: string;
  ramo: string;
  instancia: string | null;
  noMotor: boolean;
  whatsapp: "conectado" | "desconectado" | "sem instância";
  dona: string;
  liberada: boolean;
  permitidos: string[];
  usoMes: number;
  limiteMes: number | null;
  blocoMin: number | null;
  servicos: number;
  servicosSemPreco: number;
  temHorario: boolean;
  temRecado: boolean;
  sinal: { ativo: boolean; valor: number | null; chave: string; nome: string; soParaQuemFaltou: boolean };
};

const SELECAO = "id,nome,nicho,ativo,instancia_whatsapp,config,criado_em";

async function montar(e: LinhaEmpresa, estados: Map<string, string>): Promise<Loja> {
  const ia: Config = e.config?.ia ?? {};
  const sinal: Config = e.config?.loja?.sinal_pix ?? {};
  const [uso, servicos] = await Promise.all([
    banco<number>("/rest/v1/rpc/motor_uso_mes", { method: "POST", body: JSON.stringify({ p_empresa_id: e.id }) }),
    banco<{ preco: number | null }[]>(`/rest/v1/servicos?select=preco&ativo=eq.true&empresa_id=eq.${e.id}`),
  ]);
  const estado = e.instancia_whatsapp ? estados.get(e.instancia_whatsapp) : undefined;
  return {
    id: e.id,
    nome: e.nome,
    ramo: e.nicho,
    instancia: e.instancia_whatsapp,
    noMotor: ia.motor === true,
    whatsapp: estado === "open" ? "conectado" : estado ? "desconectado" : "sem instância",
    dona: String(ia.dona ?? ""),
    liberada: ia.liberada === true,
    permitidos: Array.isArray(ia.permitidos) ? ia.permitidos.map(String) : [],
    usoMes: Number(uso) || 0,
    limiteMes: Number.isInteger(ia.limite_mes) ? ia.limite_mes : null,
    blocoMin: Number.isInteger(ia.bloco_min) ? ia.bloco_min : null,
    servicos: servicos.length,
    servicosSemPreco: servicos.filter((s) => s.preco === null).length,
    temHorario: Boolean(e.config?.horario_funcionamento),
    temRecado: Boolean(String(e.config?.loja?.sobre ?? "").trim()),
    sinal: {
      ativo: sinal.ativo === true,
      valor: typeof sinal.valor === "number" ? sinal.valor : null,
      chave: String(sinal.chave ?? ""),
      nome: String(Array.isArray(sinal.nome_recebedor) ? (sinal.nome_recebedor[0] ?? "") : (sinal.nome_recebedor ?? "")),
      soParaQuemFaltou: sinal.so_para_quem_faltou === true,
    },
  };
}

// estado de conexão de todas as instâncias, numa chamada só
async function estadosDaEvolution(): Promise<Map<string, string>> {
  const r = await evo("/instance/fetchInstances").catch(() => null);
  const mapa = new Map<string, string>();
  if (r?.ok && Array.isArray(r.corpo)) for (const i of r.corpo as any[]) if (i?.name) mapa.set(String(i.name), String(i.connectionStatus ?? ""));
  return mapa;
}

export async function listarLojas(): Promise<Loja[]> {
  const [empresas, estados] = await Promise.all([banco<LinhaEmpresa[]>(`/rest/v1/empresas?select=${SELECAO}&order=criado_em.desc`), estadosDaEvolution()]);
  return Promise.all(empresas.map((e) => montar(e, estados)));
}

async function lerEmpresa(id: string): Promise<LinhaEmpresa> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ErroLoja("loja inválida");
  const l = await banco<LinhaEmpresa[]>(`/rest/v1/empresas?select=${SELECAO}&id=eq.${id}`);
  if (!l.length) throw new ErroLoja("loja não encontrada");
  return l[0];
}

// QR em "data:image/png;base64,…" e o código de pareamento, quando a Evolution mandar
function lerQr(corpo: Record<string, any> | undefined) {
  const q = corpo?.qrcode ?? corpo ?? {};
  return { imagem: typeof q.base64 === "string" ? q.base64 : "", codigo: typeof q.pairingCode === "string" ? q.pairingCode : "" };
}

export type NovaLoja = {
  ramo: string;
  nome: string;
  dona: string;
  whatsappDona: string;
  cidade?: string;
  limiteMes?: number | null;
  blocoMin?: number | null;
  email?: string;
};

export async function criarLoja(dados: NovaLoja, criadoPor: string) {
  const ramo = RAMOS[dados.ramo as Ramo];
  if (!ramo) throw new ErroLoja("Escolha o ramo.");
  const nome = String(dados.nome ?? "").trim();
  const dona = String(dados.dona ?? "").trim();
  const whats = digitos(dados.whatsappDona);
  const cidade = String(dados.cidade ?? "").trim();
  const email = String(dados.email ?? "").trim();
  if (nome.length < 3) throw new ErroLoja("Escreva o nome da loja.");
  if (!dona) throw new ErroLoja("Escreva o nome da dona.");
  if (!/^55\d{10,11}$/.test(whats)) throw new ErroLoja("WhatsApp da dona: 55 + DDD + número.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErroLoja("E-mail inválido.");
  const limite = dados.limiteMes ?? null;
  const bloco = dados.blocoMin ?? null;
  if (limite !== null && !(Number.isInteger(limite) && limite > 0 && limite < 1000000)) throw new ErroLoja("Teto de conversas: um número inteiro.");
  if (bloco !== null && !(Number.isInteger(bloco) && bloco >= 30 && bloco <= 480)) throw new ErroLoja("Tempo por cliente: de 30 a 480 minutos.");
  const agencia = digitos(env("AGENCIA_WHATSAPP"));
  if (!/^\d{12,13}$/.test(agencia)) throw new ErroLoja("AGENCIA_WHATSAPP não está configurado no servidor.");

  // nome da instância: o nome da loja sem acento + 4 letras, para não repetir
  const base = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "loja";
  const instancia = `${base}-${Math.random().toString(36).slice(2, 6)}`;

  // a senha do webhook é a mesma das outras instâncias (o webhook do motor confere esse cabeçalho)
  const modelo = await evo(`/webhook/find/${encodeURIComponent(env("EVOLUTION_INSTANCE_MODELO") || "karol-manicure")}`);
  const token = modelo.corpo?.headers?.["x-webhook-token"];
  if (!token) throw new ErroLoja("Não consegui ler a senha do webhook numa instância que já existe.");

  // 1. instância do WhatsApp, já apontada para o motor do ramo
  const n8n = (env("N8N_URL_INTERNA") || "http://n8n:5678").replace(/\/$/, "");
  const criada = await evo("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: instancia,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: { url: `${n8n}/webhook/${ramo.motor}-whatsapp-salao`, byEvents: false, base64: true, headers: { "x-webhook-token": token }, events: ["MESSAGES_UPSERT"] },
    }),
  });
  if (!criada.ok) throw new ErroLoja(`A Evolution não criou a instância (${criada.status}).`);

  // 2. loja no banco (profissional e serviços padrão do ramo, sem preço), no motor e com a trava de teste
  let id: string;
  try {
    const ia: Config = { motor: true, dona, permitidos: [agencia] };
    if (limite !== null) ia.limite_mes = limite;
    if (bloco !== null) ia.bloco_min = bloco;
    const config: Config = { ia, assistente_numeros: [whats], whatsapp_alerta: sem9(whats), loja: cidade ? { cidade } : {} };
    id = await banco<string>("/rest/v1/rpc/criar_loja", {
      method: "POST",
      body: JSON.stringify({ p_nome: nome, p_nicho: ramo.nicho, p_profissional: dona, p_instancia: instancia, p_config: config }),
    });
  } catch (e) {
    await evo(`/instance/delete/${encodeURIComponent(instancia)}`, { method: "DELETE" }).catch(() => null);
    throw new ErroLoja(`Não criei a loja no banco: ${e instanceof Error ? e.message : e}`);
  }

  // 3. quem criou passa a ver a loja no painel (o painel mostra as lojas ligadas ao login)
  const avisos: string[] = [];
  await banco("/rest/v1/usuarios_empresa", { method: "POST", body: JSON.stringify({ user_id: criadoPor, empresa_id: id, papel: "recepcao" }) }).catch(() =>
    avisos.push("A loja foi criada, mas não consegui ligá-la ao seu login no painel."),
  );

  // 4. convite de login do app para a dona, se pediram
  if (email) {
    try {
      const u = await banco<{ id: string }>("/auth/v1/invite", { method: "POST", body: JSON.stringify({ email }) });
      await banco("/rest/v1/usuarios_empresa", { method: "POST", body: JSON.stringify({ user_id: u.id, empresa_id: id, papel: "dona" }) });
    } catch {
      avisos.push("A loja foi criada, mas o convite por e-mail falhou. Mande o convite pelo Supabase.");
    }
  }

  return { id, instancia, qr: lerQr(criada.corpo), avisos };
}

export async function novoQr(id: string) {
  const e = await lerEmpresa(id);
  if (!e.instancia_whatsapp) throw new ErroLoja("Esta loja não tem instância de WhatsApp.");
  const r = await evo(`/instance/connect/${encodeURIComponent(e.instancia_whatsapp)}`);
  if (!r.ok) throw new ErroLoja(`A Evolution não devolveu o QR (${r.status}).`);
  if (r.corpo?.instance?.state === "open") return { conectado: true, imagem: "", codigo: "" };
  const qr = lerQr(r.corpo);
  if (!qr.imagem) throw new ErroLoja("A Evolution não mandou a imagem do QR. Tente de novo.");
  return { conectado: false, ...qr };
}

export async function estadoDoWhatsapp(id: string) {
  const e = await lerEmpresa(id);
  if (!e.instancia_whatsapp) return { conectado: false };
  const r = await evo(`/instance/connectionState/${encodeURIComponent(e.instancia_whatsapp)}`);
  return { conectado: r.ok && r.corpo?.instance?.state === "open" };
}

export type Mudanca = {
  liberada?: boolean;
  limiteMes?: number | null;
  blocoMin?: number | null;
  sinal?: { ativo: boolean; valor: number | null; chave: string; nome: string; soParaQuemFaltou: boolean };
};

// Só mexe em config.ia e config.loja.sinal_pix, e só em loja que está no motor: as lojas com conjunto
// próprio (Gleide, Caroline) não são alteradas por aqui.
export async function mudarLoja(id: string, m: Mudanca) {
  const e = await lerEmpresa(id);
  const ia: Config = { ...(e.config?.ia ?? {}) };
  if (ia.motor !== true) throw new ErroLoja("Esta loja não está no motor: ela é configurada pelo conjunto próprio dela.");
  const config: Config = { ...e.config, ia };

  if (m.liberada !== undefined) ia.liberada = m.liberada === true;
  if (m.limiteMes !== undefined) {
    if (m.limiteMes === null) delete ia.limite_mes;
    else if (Number.isInteger(m.limiteMes) && m.limiteMes > 0 && m.limiteMes < 1000000) ia.limite_mes = m.limiteMes;
    else throw new ErroLoja("Teto de conversas: um número inteiro, ou vazio para não ter teto.");
  }
  if (m.blocoMin !== undefined) {
    if (m.blocoMin === null) delete ia.bloco_min;
    else if (Number.isInteger(m.blocoMin) && m.blocoMin >= 30 && m.blocoMin <= 480) ia.bloco_min = m.blocoMin;
    else throw new ErroLoja("Tempo por cliente: de 30 a 480 minutos, ou vazio.");
  }
  if (m.sinal !== undefined) {
    const s = m.sinal;
    const chave = String(s.chave ?? "").trim();
    const nome = String(s.nome ?? "").trim();
    if (s.ativo) {
      if (!(typeof s.valor === "number" && s.valor > 0 && s.valor < 100000)) throw new ErroLoja("Sinal: escreva o valor.");
      if (!chave) throw new ErroLoja("Sinal: escreva a chave Pix.");
      if (!nome) throw new ErroLoja("Sinal: escreva o nome de quem recebe o Pix (o sistema confere no comprovante).");
    }
    const antes: Config = e.config?.loja?.sinal_pix ?? {};
    config.loja = {
      ...(e.config?.loja ?? {}),
      sinal_pix: { ...antes, ativo: s.ativo === true, valor: s.valor, chave, nome_recebedor: nome, so_para_quem_faltou: s.soParaQuemFaltou === true },
    };
  }
  await banco(`/rest/v1/empresas?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ config }) });
}
