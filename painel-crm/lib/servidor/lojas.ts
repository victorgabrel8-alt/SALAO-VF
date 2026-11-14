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
  if (!r.ok) throw new Error(`banco ${r.status}: ${texto.slice(0, 300)}`); // erro comum: a tela recebe só a mensagem genérica
  return (texto ? JSON.parse(texto) : null) as T;
}

async function evo(rota: string, opcoes: RequestInit = {}, limiteMs = 20000) {
  const r = await fetch(`${env("EVOLUTION_URL").replace(/\/$/, "")}${rota}`, {
    ...opcoes,
    cache: "no-store",
    signal: AbortSignal.timeout(limiteMs),
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
  whatsapp: "conectado" | "desconectado" | "sem instância" | "não conferido";
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

async function montar(e: LinhaEmpresa, estados: Map<string, string> | null): Promise<Loja> {
  const ia: Config = e.config?.ia ?? {};
  const sinal: Config = e.config?.loja?.sinal_pix ?? {};
  const [uso, servicos] = await Promise.all([
    banco<number>("/rest/v1/rpc/motor_uso_mes", { method: "POST", body: JSON.stringify({ p_empresa_id: e.id }) }),
    banco<{ preco: number | null }[]>(`/rest/v1/servicos?select=preco&ativo=eq.true&empresa_id=eq.${e.id}`),
  ]);
  const estado = e.instancia_whatsapp && estados ? estados.get(e.instancia_whatsapp) : undefined;
  return {
    id: e.id,
    nome: e.nome,
    ramo: e.nicho,
    instancia: e.instancia_whatsapp,
    noMotor: ia.motor === true,
    whatsapp: !e.instancia_whatsapp ? "sem instância" : !estados ? "não conferido" : estado === "open" ? "conectado" : estado ? "desconectado" : "sem instância",
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
async function estadosDaEvolution(): Promise<Map<string, string> | null> {
  const r = await evo("/instance/fetchInstances").catch(() => null);
  if (!r?.ok || !Array.isArray(r.corpo)) return null; // Evolution fora do ar: o estado fica "não conferido"
  const mapa = new Map<string, string>();
  for (const i of r.corpo as any[]) if (i?.name) mapa.set(String(i.name), String(i.connectionStatus ?? ""));
  return mapa;
}

export async function listarLojas(): Promise<Loja[]> {
  const [empresas, estados] = await Promise.all([banco<LinhaEmpresa[]>(`/rest/v1/empresas?select=${SELECAO}&order=criado_em.desc`), estadosDaEvolution()]);
  return Promise.all(empresas.map((e) => montar(e, estados)));
}

async function lerEmpresa(id: string): Promise<LinhaEmpresa> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new ErroLoja("Loja inválida.");
  const l = await banco<LinhaEmpresa[]>(`/rest/v1/empresas?select=${SELECAO}&id=eq.${id}`);
  if (!l.length) throw new ErroLoja("Loja não encontrada.");
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
  if (!dados || typeof dados !== "object") throw new ErroLoja("Preencha os dados da loja.");
  const ramo = RAMOS[dados.ramo as Ramo];
  if (!ramo) throw new ErroLoja("Escolha o ramo.");
  const nome = String(dados.nome ?? "").trim();
  const dona = String(dados.dona ?? "").trim();
  const whats = digitos(dados.whatsappDona);
  const cidade = String(dados.cidade ?? "").trim();
  const email = String(dados.email ?? "").trim();
  // nome, dona e cidade entram no prompt da IA e em mensagens: sem quebra de linha, controle ou caractere invisível
  const ruim = /[\u0000-\u001f\u007f\u00a0\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/;
  if (ruim.test(nome) || ruim.test(dona) || ruim.test(cidade)) throw new ErroLoja("Nome da loja, da dona ou cidade com caractere inválido.");
  if (nome.length < 3 || nome.length > 80) throw new ErroLoja("Escreva o nome da loja (até 80 letras).");
  if (dona.length > 40 || cidade.length > 60 || email.length > 120) throw new ErroLoja("Nome da dona, cidade ou e-mail longo demais.");
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
  const apagarInstancia = () =>
    evo(`/instance/delete/${encodeURIComponent(instancia)}`, { method: "DELETE" })
      .then((r) => r.ok)
      .catch(() => false);
  const criada = await evo(
    "/instance/create",
    {
    method: "POST",
    body: JSON.stringify({
      instanceName: instancia,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
      webhook: { url: `${n8n}/webhook/${ramo.motor}-whatsapp-salao`, byEvents: false, base64: true, headers: { "x-webhook-token": token }, events: ["MESSAGES_UPSERT"] },
    }),
    },
    45000,
  ).catch(async () => {
    // a Evolution demorou: a instância pode ter sido criada mesmo assim; tenta apagar para não ficar órfã
    const apagou = await apagarInstancia();
    throw new ErroLoja(
      `A Evolution demorou para criar o WhatsApp da loja e nada foi criado no banco.${apagou ? "" : ` Confira na Evolution se ficou a instância "${instancia}".`} Tente de novo.`,
    );
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
    console.error("[lojas] criar_loja", e);
    const apagou = await apagarInstancia();
    throw new ErroLoja(`Não consegui criar a loja no banco.${apagou ? "" : ` A instância "${instancia}" ficou na Evolution: apague por lá.`} Tente de novo.`);
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
  if (e.config?.ia?.motor !== true) throw new ErroLoja("Esta loja não está no motor.");
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
  if (e.config?.ia?.motor !== true) throw new ErroLoja("Esta loja não está no motor.");
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
// próprio (Gleide, Caroline) não são alteradas por aqui. A gravação é feita pela função motor_configurar
// (supabase/049), que troca só esses campos: o que a dona salvar no app ao mesmo tempo não é sobrescrito.
export async function mudarLoja(id: string, m: Mudanca) {
  if (!m || typeof m !== "object") throw new ErroLoja("Nada para mudar.");
  const e = await lerEmpresa(id);
  if (e.config?.ia?.motor !== true) throw new ErroLoja("Esta loja não está no motor: ela é configurada pelo conjunto próprio dela.");
  const ia: Config = {};
  const remover: string[] = [];
  let sinal: Config | null = null;

  if (m.liberada !== undefined) {
    if (typeof m.liberada !== "boolean") throw new ErroLoja("Liberar: sim ou não.");
    ia.liberada = m.liberada;
  }
  if (m.limiteMes !== undefined) {
    if (m.limiteMes === null) remover.push("limite_mes");
    else if (Number.isInteger(m.limiteMes) && m.limiteMes > 0 && m.limiteMes < 1000000) ia.limite_mes = m.limiteMes;
    else throw new ErroLoja("Teto de conversas: um número inteiro, ou vazio para não ter teto.");
  }
  if (m.blocoMin !== undefined) {
    if (m.blocoMin === null) remover.push("bloco_min");
    else if (Number.isInteger(m.blocoMin) && m.blocoMin >= 30 && m.blocoMin <= 480) ia.bloco_min = m.blocoMin;
    else throw new ErroLoja("Tempo por cliente: de 30 a 480 minutos, ou vazio.");
  }
  if (m.sinal !== undefined) {
    const s = m.sinal;
    if (!s || typeof s !== "object" || typeof s.ativo !== "boolean" || typeof s.soParaQuemFaltou !== "boolean") throw new ErroLoja("Sinal: dados incompletos.");
    const chave = String(s.chave ?? "").trim();
    const nome = String(s.nome ?? "").trim();
    if (chave.length > 120 || nome.length > 80) throw new ErroLoja("Sinal: chave ou nome longo demais.");
    if (s.valor !== null && !(typeof s.valor === "number" && Number.isFinite(s.valor) && s.valor > 0 && s.valor < 100000)) throw new ErroLoja("Sinal: escreva o valor em reais.");
    if (s.ativo) {
      if (s.valor === null) throw new ErroLoja("Sinal: escreva o valor.");
      if (!chave) throw new ErroLoja("Sinal: escreva a chave Pix.");
      if (!nome) throw new ErroLoja("Sinal: escreva o nome de quem recebe o Pix (o sistema confere no comprovante).");
    }
    // a loja pode aceitar mais de um nome de recebedor (lista): a tela edita o primeiro e os outros ficam
    const antes = e.config?.loja?.sinal_pix?.nome_recebedor;
    const nomes = Array.isArray(antes) && antes.length > 1 ? [nome, ...antes.slice(1)] : nome;
    sinal = { ativo: s.ativo, valor: s.valor === null ? null : Math.round(s.valor * 100) / 100, chave, nome_recebedor: nomes, so_para_quem_faltou: s.soParaQuemFaltou };
  }
  const feito = await banco<boolean>("/rest/v1/rpc/motor_configurar", {
    method: "POST",
    body: JSON.stringify({ p_empresa_id: id, p_ia: ia, p_ia_remover: remover, p_sinal: sinal }),
  });
  if (feito !== true) throw new ErroLoja("Esta loja não está no motor.");
}

// ---------- Pedidos de cadastro (supabase/050 e 051): a dona pede pelo app, a agência aprova aqui ----------
// "preso" = pedido marcado como aprovado, mas a loja não chegou a ser criada (queda no meio da aprovação):
// aparece na lista para poder ser reaberto.
// "jaUsadoEm" = nome da loja que já tem esse WhatsApp como número da dona (vazio se nenhuma)
export type Cadastro = { id: string; criadoEm: string; nomeLoja: string; ramo: string; dona: string; whatsapp: string; cidade: string; email: string; preso: boolean; jaUsadoEm: string };
type LinhaCadastro = { id: string; criado_em: string; nome_loja: string; ramo: string; dona: string; whatsapp: string; cidade: string; email: string; status: string; empresa_id: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CAMPOS_CADASTRO = "id,criado_em,nome_loja,ramo,dona,whatsapp,cidade,email,status,empresa_id";
const paraTela = (c: LinhaCadastro, preso: boolean, donas: Map<string, string>): Cadastro => ({ id: c.id, criadoEm: c.criado_em, nomeLoja: c.nome_loja, ramo: c.ramo, dona: c.dona, whatsapp: c.whatsapp, cidade: c.cidade, email: c.email, preso, jaUsadoEm: donas.get(sem9(digitos(c.whatsapp))) ?? "" });

// WhatsApp das donas das lojas que já existem (número da assistente e número de avisos), sem o 9, -> nome da loja
async function whatsappDasDonas(): Promise<Map<string, string>> {
  const lojas = await banco<{ nome: string; config: Config }[]>("/rest/v1/empresas?select=nome,config");
  const mapa = new Map<string, string>();
  for (const l of lojas) {
    const numeros = [...(Array.isArray(l.config?.assistente_numeros) ? l.config.assistente_numeros : []), l.config?.whatsapp_alerta];
    for (const n of numeros) if (n) mapa.set(sem9(digitos(n)), l.nome);
  }
  return mapa;
}

// Os mais antigos primeiro (quem pediu antes é atendida antes e pedido real não some atrás de pedido falso).
// Falha aqui não derruba a tela Lojas: a lista de pedidos só vem vazia.
export async function listarCadastros(): Promise<{ cadastros: Cadastro[]; pendentes: number }> {
  try {
    const dezMin = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const semana = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const [pendentes, presos, donas] = await Promise.all([
      banco<LinhaCadastro[]>(`/rest/v1/motor_cadastros?select=${CAMPOS_CADASTRO}&status=eq.pendente&order=criado_em.asc&limit=200`),
      banco<LinhaCadastro[]>(`/rest/v1/motor_cadastros?select=${CAMPOS_CADASTRO}&status=eq.aprovado&empresa_id=is.null&resolvido_em=lt.${dezMin}&resolvido_em=gt.${semana}&order=criado_em.asc&limit=20`),
      whatsappDasDonas().catch(() => new Map<string, string>()),
    ]);
    return { cadastros: [...presos.map((c) => paraTela(c, true, donas)), ...pendentes.map((c) => paraTela(c, false, donas))], pendentes: pendentes.length };
  } catch (e) {
    console.error("[lojas] listarCadastros", e);
    return { cadastros: [], pendentes: 0 };
  }
}

async function lerCadastro(id: string): Promise<LinhaCadastro> {
  if (!UUID.test(id)) throw new ErroLoja("Pedido inválido.");
  const l = await banco<LinhaCadastro[]>(`/rest/v1/motor_cadastros?select=${CAMPOS_CADASTRO}&id=eq.${id}`);
  if (!l.length) throw new ErroLoja("Pedido não encontrado.");
  return l[0];
}

const resolver = (id: string, status: "aprovado" | "recusado", empresaId: string | null) =>
  banco<boolean>("/rest/v1/rpc/motor_resolver_cadastro", { method: "POST", body: JSON.stringify({ p_id: id, p_status: status, p_empresa_id: empresaId }) });

// Aprovar = criar a loja com os dados do pedido (instância, loja no banco, convite se houver e-mail) e devolver o QR.
// - O pedido é marcado como aprovado ANTES de criar, para dois cliques ao mesmo tempo não criarem duas lojas.
// - Se a criação falhar, o pedido volta a ficar pendente.
// - Depois que a loja existe, nada mais desfaz a aprovação: falha ao anotar a loja no pedido vira só um aviso.
// - `email`: o que a agência confirmou com a dona (pode corrigir ou apagar o do pedido; vazio = sem convite).
export async function aprovarCadastro(id: string, criadoPor: string, limiteMes: number | null, email?: string) {
  const c = await lerCadastro(id);
  if (c.status !== "pendente") throw new ErroLoja("Este pedido já foi resolvido.");
  if (limiteMes !== null && !(Number.isInteger(limiteMes) && limiteMes > 0 && limiteMes < 1000000)) throw new ErroLoja("Teto de conversas: um número inteiro.");
  const emailFinal = String(email ?? c.email ?? "").trim().toLowerCase();
  if (emailFinal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailFinal)) throw new ErroLoja("E-mail inválido.");
  if ((await resolver(id, "aprovado", null)) !== true) throw new ErroLoja("Este pedido já foi resolvido.");

  let r: Awaited<ReturnType<typeof criarLoja>>;
  try {
    r = await criarLoja({ ramo: c.ramo, nome: c.nome_loja, dona: c.dona, whatsappDona: c.whatsapp, cidade: c.cidade, email: emailFinal, limiteMes, blocoMin: null }, criadoPor);
  } catch (e) {
    await banco(`/rest/v1/motor_cadastros?id=eq.${id}&status=eq.aprovado&empresa_id=is.null`, { method: "PATCH", body: JSON.stringify({ status: "pendente", resolvido_em: null }) }).catch(() => null);
    throw e;
  }
  await banco(`/rest/v1/motor_cadastros?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ empresa_id: r.id }) }).catch(() => {
    r.avisos.push("A loja foi criada, mas o pedido não foi ligado a ela: ele pode aparecer como preso na lista. Recuse-o para tirar de lá.");
  });
  return { ...r, nome: c.nome_loja };
}

export async function recusarCadastro(id: string) {
  const c = await lerCadastro(id);
  // pedido preso (aprovado sem loja) também pode ser recusado: volta a pendente e é recusado em seguida
  if (c.status === "aprovado" && !c.empresa_id) await reabrirCadastro(id);
  else if (c.status !== "pendente") throw new ErroLoja("Este pedido já foi resolvido.");
  if ((await resolver(id, "recusado", null)) !== true) throw new ErroLoja("Este pedido já foi resolvido.");
}

// Pedido preso volta a pendente, para ser aprovado de novo.
export async function reabrirCadastro(id: string) {
  const c = await lerCadastro(id);
  if (!(c.status === "aprovado" && !c.empresa_id)) throw new ErroLoja("Este pedido não está preso.");
  await banco(`/rest/v1/motor_cadastros?id=eq.${id}&status=eq.aprovado&empresa_id=is.null`, { method: "PATCH", body: JSON.stringify({ status: "pendente", resolvido_em: null }) });
}

// Recusa de uma vez todos os pendentes (limpar pedidos falsos). Devolve quantos foram.
export async function recusarTodosCadastros() {
  const l = await banco<{ id: string }[]>("/rest/v1/motor_cadastros?status=eq.pendente", {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "recusado", resolvido_em: new Date().toISOString() }),
  });
  return l.length;
}
