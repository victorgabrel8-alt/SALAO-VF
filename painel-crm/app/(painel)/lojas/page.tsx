"use client";

import { useCallback, useEffect, useId, useState, type FormEvent, type ReactNode } from "react";
import { useDialogo } from "@/components/Dialogo";

// Lojas da agência no motor único (docs/PLANO-MOTOR-UNICO.md): criar loja nova (instância do WhatsApp, loja no
// banco e QR), ver quem conectou e o que falta preencher, liberar a IA, teto de conversas e sinal.
// Tudo passa pelas rotas /api/lojas, que rodam no servidor do painel com as chaves de serviço.
//
// A tela é lida de cima para baixo, na ordem do que pede atenção:
//   1. resumo (quatro números);
//   2. pedidos de cadastro esperando resposta;
//   3. lojas em implantação, cada uma com os três passos até ficar no ar e o próximo passo em destaque;
//   4. lojas no ar, em linhas curtas.
// Formulários (nova loja, QR, ajustes) abrem numa folha por cima, para a lista não pular de lugar.

type Sinal = { ativo: boolean; valor: number | null; chave: string; nome: string; soParaQuemFaltou: boolean };
type Loja = {
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
  sinal: Sinal;
};
type Cadastro = { id: string; criadoEm: string; nomeLoja: string; ramo: string; dona: string; whatsapp: string; cidade: string; email: string; preso: boolean; jaUsadoEm: string };
type Qr = { lojaId: string; nome: string; imagem: string; codigo: string; conectado: boolean; avisos?: string[] };

const RAMO: Record<string, string> = { manicure: "Unhas", mega_hair: "Mega hair", estudio_beleza: "Estúdio de beleza" };
// custo médio de IA por conversa, medido na fatura de novembro de 2026 (docs/PLANO-MOTOR-UNICO.md): só para a estimativa do resumo
const CUSTO_POR_CONVERSA = 0.43;

// ---------- peças de desenho (identidade Oi Studio: cartão branco com borda, sem sombra; botão Ônix) ----------
const campo =
  "h-11 w-full rounded-xl border border-borda bg-card px-3 text-[15px] outline-none placeholder:text-apoio/70 focus:border-onix focus-visible:ring-2 focus-visible:ring-onix/15";
const botao =
  "inline-flex h-10 items-center justify-center rounded-xl border border-borda-forte bg-card px-4 text-[14px] font-bold text-grafite hover:bg-campo/50 disabled:opacity-50";
const botaoForte = "inline-flex h-10 items-center justify-center rounded-xl bg-onix px-5 text-[14px] font-bold text-porcelana hover:bg-carvao disabled:opacity-50";
const cartao = "rounded-[18px] border border-borda bg-card";

type Tom = "ok" | "atencao" | "aviso" | "neutro";
const TONS: Record<Tom, string> = {
  ok: "bg-salvia text-salvia-texto",
  atencao: "bg-rose text-rose-texto",
  aviso: "bg-mel text-mel-texto",
  neutro: "bg-campo text-grafite",
};
const Chip = ({ tom, children }: { tom: Tom; children: ReactNode }) => (
  <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold whitespace-nowrap ${TONS[tom]}`}>{children}</span>
);
const Aviso = ({ tom, children }: { tom: Tom; children: ReactNode }) => (
  <p role={tom === "atencao" ? "alert" : undefined} className={`rounded-xl px-3.5 py-3 text-[14px] leading-relaxed ${TONS[tom]}`}>
    {children}
  </p>
);
const Rotulo = ({ children }: { children: ReactNode }) => <span className="mb-1.5 block text-[13px] font-bold text-texto-2">{children}</span>;

// Folha por cima da tela (formulários). Fecha no ×, no Esc e no clique fora.
function Folha({ titulo, aoFechar, largura = "max-w-2xl", children }: { titulo: string; aoFechar: () => void; largura?: string; children: ReactNode }) {
  const idTitulo = useId();
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);
  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-onix/45 px-4 py-10" onClick={aoFechar}>
      <div role="dialog" aria-modal="true" aria-labelledby={idTitulo} onClick={(e) => e.stopPropagation()} className={`w-full ${largura} rounded-[20px] border border-borda bg-card p-6`}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 id={idTitulo} className="text-[22px] leading-tight font-bold tracking-[-0.02em]">
            {titulo}
          </h2>
          <button onClick={aoFechar} aria-label="Fechar" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-apoio hover:bg-campo/60 hover:text-grafite">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

async function chamar<T>(rota: string, opcoes?: RequestInit): Promise<T> {
  const r = await fetch(rota, { ...opcoes, headers: { "Content-Type": "application/json" } });
  // sessão vencida: o painel manda para a tela de login e a resposta deixa de ser JSON
  if (r.redirected || !(r.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Sua sessão no painel venceu. Recarregue a página e entre de novo.");
  }
  const corpo = await r.json().catch(() => null);
  if (!r.ok || !corpo) throw new Error(corpo?.erro || "Não deu certo agora. Tente de novo.");
  return corpo as T;
}

// Campo de número inteiro: "" vira null; "1.000", "abc" ou "12,5" são recusados aqui, antes de ir para o servidor
function inteiro(texto: string, nome: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  if (!/^\d{1,6}$/.test(t)) throw new Error(`${nome}: use só números, sem ponto nem vírgula.`);
  return Number(t);
}

// Valor em reais: "25", "25,50" ou "25.50"
function reais(texto: string): number | null {
  const t = texto.trim();
  if (t === "") return null;
  if (!/^\d{1,5}([.,]\d{1,2})?$/.test(t)) throw new Error("Valor do sinal: escreva como 20 ou 20,50.");
  return Number(t.replace(",", "."));
}

// O que falta a dona preencher no app para a IA conseguir atender
const faltasDoApp = (l: Loja) =>
  [l.servicosSemPreco > 0 && `${l.servicosSemPreco} serviço${l.servicosSemPreco > 1 ? "s" : ""} sem preço`, !l.temHorario && "horário de funcionamento", !l.temRecado && "recado da dona"].filter(
    Boolean,
  ) as string[];

export default function LojasPage() {
  const [lojas, setLojas] = useState<Loja[] | null>(null);
  const [cadastros, setCadastros] = useState<Cadastro[]>([]);
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);
  const [qr, setQr] = useState<Qr | null>(null);
  const [ajustando, setAjustando] = useState<string | null>(null);

  const carregar = useCallback(() => {
    chamar<{ lojas: Loja[]; cadastros: Cadastro[] }>("/api/lojas")
      .then((r) => {
        setLojas(r.lojas);
        setCadastros(r.cadastros ?? []);
        setErro("");
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const implantando = (lojas ?? []).filter((l) => l.noMotor && !l.liberada);
  const noAr = (lojas ?? []).filter((l) => !l.noMotor || l.liberada);
  const pendentes = cadastros.filter((c) => !c.preso).length;
  const conversas = (lojas ?? []).reduce((soma, l) => soma + l.usoMes, 0);
  const desconectadas = noAr.filter((l) => l.whatsapp === "desconectado").length;
  const lojaAjustando = (lojas ?? []).find((l) => l.id === ajustando) ?? null;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 pt-9 pb-6">
        <div>
          <p className="rotulo">Agência</p>
          <h1 className="mt-1 font-serif text-[30px] leading-tight">Lojas</h1>
        </div>
        {lojas && (
          <button onClick={() => setCriando(true)} className={botaoForte + " h-11"}>
            Nova loja
          </button>
        )}
      </header>

      {erro && (
        <div className="mb-5">
          <Aviso tom="atencao">{erro}</Aviso>
        </div>
      )}
      {!lojas && !erro && <p className="py-8 text-texto-2">Carregando…</p>}

      {lojas && (
        <>
          {/* 1. Resumo */}
          <section aria-label="Resumo" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Numero rotulo="Lojas no ar" valor={noAr.length} apoio={desconectadas > 0 ? `${desconectadas} com o WhatsApp desconectado` : "todas com o WhatsApp conectado"} tom={desconectadas > 0 ? "atencao" : undefined} />
            <Numero rotulo="Em implantação" valor={implantando.length} apoio={implantando.length ? "faltam passos para liberar a IA" : "nenhuma loja esperando"} />
            <Numero rotulo="Pedidos de cadastro" valor={pendentes} apoio={pendentes ? "esperando a sua resposta" : "nenhum pedido novo"} tom={pendentes ? "aviso" : undefined} />
            <Numero
              rotulo="Conversas no mês"
              valor={conversas}
              apoio={`cerca de ${(conversas * CUSTO_POR_CONVERSA).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })} de IA (estimativa)`}
            />
          </section>

          {/* 2. Pedidos de cadastro */}
          {cadastros.length > 0 && (
            <Secao
              titulo="Pedidos de cadastro"
              apoio="Donas que pediram a loja pelo app. Aprovar cria a loja e o WhatsApp para conectar."
              acao={pendentes > 1 ? <RecusarTodos quantos={pendentes} aoMudar={carregar} /> : null}
            >
              <div className="space-y-3">
                {cadastros.map((c) => (
                  <CartaoCadastro key={c.id} cadastro={c} aoMudar={carregar} aoAprovar={(novo) => (setQr(novo), carregar())} />
                ))}
              </div>
            </Secao>
          )}

          {/* 3. Em implantação */}
          {implantando.length > 0 && (
            <Secao titulo="Em implantação" apoio="Três passos até a IA atender as clientes. O próximo passo de cada loja está em destaque.">
              <div className="space-y-3">
                {implantando.map((l) => (
                  <LojaImplantando key={l.id} loja={l} aoMudar={carregar} aoPedirQr={setQr} aoAjustar={() => setAjustando(l.id)} />
                ))}
              </div>
            </Secao>
          )}

          {/* 4. No ar */}
          <Secao titulo="No ar" apoio="Lojas atendendo as clientes.">
            {noAr.length === 0 ? (
              <p className={`${cartao} px-5 py-8 text-center text-texto-2`}>Nenhuma loja no ar ainda.</p>
            ) : (
              <div className={`${cartao} divide-y divide-borda overflow-hidden`}>
                {noAr.map((l) => (
                  <LojaNoAr key={l.id} loja={l} aoMudar={carregar} aoPedirQr={setQr} aoAjustar={() => setAjustando(l.id)} />
                ))}
              </div>
            )}
          </Secao>
        </>
      )}

      {criando && (
        <NovaLoja
          aoFechar={() => setCriando(false)}
          aoCriar={(novo) => {
            setCriando(false);
            setQr(novo);
            carregar();
          }}
        />
      )}
      {qr && <PainelQr qr={qr} aoMudar={setQr} aoFechar={() => (setQr(null), carregar())} />}
      {lojaAjustando && <Ajustes loja={lojaAjustando} aoFechar={() => setAjustando(null)} aoMudar={carregar} />}
    </>
  );
}

// Um número do resumo: rótulo pequeno, número grande, uma linha de apoio
function Numero({ rotulo, valor, apoio, tom }: { rotulo: string; valor: number; apoio: string; tom?: "atencao" | "aviso" }) {
  return (
    <div className={`${cartao} px-5 py-4`}>
      <p className="rotulo">{rotulo}</p>
      <p className="mt-1.5 text-[34px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{valor.toLocaleString("pt-BR")}</p>
      <p className={`mt-2 text-[13px] font-semibold ${tom === "atencao" ? "text-rose-texto" : tom === "aviso" ? "text-mel-texto" : "text-apoio"}`}>{apoio}</p>
    </div>
  );
}

function Secao({ titulo, apoio, acao, children }: { titulo: string; apoio: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[19px] font-bold tracking-[-0.02em]">{titulo}</h2>
          <p className="text-[14px] text-apoio">{apoio}</p>
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

// Uso do mês contra o teto: o número vem escrito e a barra só acompanha
function Conversas({ loja }: { loja: Loja }) {
  const { usoMes, limiteMes } = loja;
  if (limiteMes === null) {
    return (
      <div className="min-w-40">
        <p className="text-[15px] font-bold tabular-nums">{usoMes}</p>
        <p className="text-[13px] text-apoio">conversas no mês, sem teto</p>
      </div>
    );
  }
  const parte = Math.min(1, usoMes / limiteMes);
  const noTeto = usoMes >= limiteMes;
  const perto = !noTeto && parte >= 0.8;
  return (
    <div className="min-w-40">
      <p className="text-[15px] font-bold tabular-nums">
        {usoMes} <span className="font-medium text-apoio">de {limiteMes}</span>
      </p>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-campo" aria-hidden="true">
        <div className={`h-full rounded-full ${noTeto ? "bg-atencao" : perto ? "bg-status-atrasada" : "bg-onix"}`} style={{ width: `${Math.max(parte * 100, usoMes > 0 ? 4 : 0)}%` }} />
      </div>
      <p className={`mt-1 text-[13px] font-semibold ${noTeto ? "text-rose-texto" : perto ? "text-mel-texto" : "text-apoio"}`}>
        {noTeto ? "no teto: cliente nova sem resposta" : perto ? "perto do teto do mês" : "conversas no mês"}
      </p>
    </div>
  );
}

const ChipWhatsapp = ({ loja }: { loja: Loja }) =>
  loja.whatsapp === "conectado" ? (
    <Chip tom="ok">WhatsApp conectado</Chip>
  ) : loja.whatsapp === "não conferido" ? (
    <Chip tom="aviso">WhatsApp não conferido</Chip>
  ) : (
    <Chip tom="atencao">WhatsApp {loja.whatsapp}</Chip>
  );

// Ações de uma loja do motor, usadas nas duas listas
function useAcoesDaLoja(loja: Loja, aoMudar: () => void, aoPedirQr: (qr: Qr) => void) {
  const { dialogo, perguntar, avisar } = useDialogo();
  const [ocupado, setOcupado] = useState(false);

  async function mudar(mudanca: object, pergunta: string, confirmar: string) {
    if (!(await perguntar(pergunta, { confirmar }))) return;
    setOcupado(true);
    try {
      await chamar(`/api/lojas/${loja.id}`, { method: "PATCH", body: JSON.stringify(mudanca) });
      aoMudar();
    } catch (e) {
      await avisar((e as Error).message);
    }
    setOcupado(false);
  }

  async function pedirQr() {
    setOcupado(true);
    try {
      const r = await chamar<{ conectado: boolean; imagem: string; codigo: string }>(`/api/lojas/${loja.id}/qr`, { method: "POST" });
      aoPedirQr({ lojaId: loja.id, nome: loja.nome, ...r });
    } catch (e) {
      await avisar((e as Error).message);
    }
    setOcupado(false);
  }

  const liberar = () => mudar({ liberada: true }, `Liberar a IA de ${loja.nome}?\nEla passa a responder TODAS as clientes que escreverem para o WhatsApp da loja.`, "Liberar a IA");
  const voltarParaTeste = () => mudar({ liberada: false }, `Voltar ${loja.nome} para teste?\nA IA para de responder as clientes e só responde o WhatsApp da agência.`, "Voltar para teste");

  return { dialogo, ocupado, pedirQr, liberar, voltarParaTeste };
}

// Um passo da implantação: feito (verde com visto), o da vez (Ônix) ou ainda por vir (neutro)
function Passo({ numero, titulo, estado, detalhe }: { numero: number; titulo: string; estado: "feito" | "agora" | "depois"; detalhe: string }) {
  return (
    <li className="flex min-w-0 flex-1 items-start gap-3">
      <span
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold ${
          estado === "feito" ? "bg-salvia text-salvia-texto" : estado === "agora" ? "bg-onix text-porcelana" : "bg-campo text-apoio"
        }`}
      >
        {estado === "feito" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-label="feito">
            <path d="M5 12.5 10 17 19 7.5" />
          </svg>
        ) : (
          numero
        )}
      </span>
      <span className="min-w-0">
        <span className={`block text-[15px] font-bold ${estado === "depois" ? "text-apoio" : ""}`}>{titulo}</span>
        <span className="block text-[13px] leading-snug text-apoio">{detalhe}</span>
      </span>
    </li>
  );
}

// Loja do motor que ainda não atende as clientes: três passos e o próximo em destaque
function LojaImplantando({ loja, aoMudar, aoPedirQr, aoAjustar }: { loja: Loja; aoMudar: () => void; aoPedirQr: (qr: Qr) => void; aoAjustar: () => void }) {
  const { dialogo, ocupado, pedirQr, liberar } = useAcoesDaLoja(loja, aoMudar, aoPedirQr);
  const conectado = loja.whatsapp === "conectado";
  const faltas = faltasDoApp(loja);
  const preenchido = faltas.length === 0;
  // o passo da vez é o primeiro que falta
  const daVez = !conectado ? 1 : !preenchido ? 2 : 3;
  const estado = (n: number, feito: boolean) => (feito ? "feito" : n === daVez ? "agora" : "depois");

  return (
    <article className={`${cartao} p-5`}>
      {dialogo}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="truncate text-[18px] font-bold">{loja.nome}</h3>
          <p className="text-[14px] text-apoio">
            {RAMO[loja.ramo] ?? loja.ramo}
            {loja.dona && ` · ${loja.dona}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {daVez === 1 && loja.instancia && (
            <button onClick={pedirQr} disabled={ocupado} className={botaoForte}>
              Conectar WhatsApp
            </button>
          )}
          {daVez === 3 && (
            <button onClick={liberar} disabled={ocupado} className={botaoForte}>
              Liberar a IA
            </button>
          )}
          <button onClick={aoAjustar} className={botao}>
            Ajustes
          </button>
        </div>
      </div>

      <ol className="mt-5 flex flex-col gap-4 border-t border-borda pt-4 md:flex-row md:gap-6">
        <Passo
          numero={1}
          titulo="Conectar o WhatsApp"
          estado={estado(1, conectado)}
          detalhe={conectado ? "número da loja conectado" : loja.instancia ? "a dona lê o QR no celular da loja" : "esta loja está sem WhatsApp criado"}
        />
        <Passo numero={2} titulo="Dona preenche o app" estado={estado(2, preenchido)} detalhe={preenchido ? "preços, horário e recado prontos" : `falta: ${faltas.join(", ")}`} />
        <Passo
          numero={3}
          titulo="Testar e liberar a IA"
          estado={estado(3, false)}
          detalhe={loja.permitidos.length ? `em teste, só responde ${loja.permitidos.join(", ")}` : "em teste, ainda não responde ninguém"}
        />
      </ol>

      {daVez === 2 && (
        <div className="mt-4">
          <Aviso tom="aviso">
            A loja já pode ser liberada, mas sem preço e horário a IA passa as conversas para a dona.{" "}
            <button onClick={liberar} disabled={ocupado} className="font-bold underline underline-offset-4">
              Liberar mesmo assim
            </button>
          </Aviso>
        </div>
      )}
    </article>
  );
}

// Loja atendendo as clientes: uma linha
function LojaNoAr({ loja, aoMudar, aoPedirQr, aoAjustar }: { loja: Loja; aoMudar: () => void; aoPedirQr: (qr: Qr) => void; aoAjustar: () => void }) {
  const { dialogo, ocupado, pedirQr, voltarParaTeste } = useAcoesDaLoja(loja, aoMudar, aoPedirQr);
  const faltas = loja.noMotor ? faltasDoApp(loja) : [];
  return (
    <div className="px-5 py-4">
      {dialogo}
      <div className="grid items-center gap-x-6 gap-y-3 lg:grid-cols-[minmax(0,1.6fr)_auto_minmax(10rem,1fr)_auto]">
        <div className="min-w-0">
          <h3 className="truncate text-[17px] font-bold">{loja.nome}</h3>
          <p className="text-[14px] text-apoio">
            {RAMO[loja.ramo] ?? loja.ramo}
            {loja.dona && ` · ${loja.dona}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ChipWhatsapp loja={loja} />
          {loja.noMotor ? (
            <span className="ia-tag">
              <span className="ia-dot" />
              IA liberada
            </span>
          ) : (
            <Chip tom="neutro">Fluxo próprio</Chip>
          )}
        </div>
        <Conversas loja={loja} />
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          {loja.noMotor ? (
            <>
              {loja.whatsapp === "desconectado" && loja.instancia && (
                <button onClick={pedirQr} disabled={ocupado} className={botaoForte}>
                  Reconectar
                </button>
              )}
              <button onClick={aoAjustar} className={botao}>
                Ajustes
              </button>
              <button onClick={voltarParaTeste} disabled={ocupado} className="h-10 rounded-xl px-3 text-[14px] font-bold text-apoio hover:bg-campo/50 hover:text-grafite disabled:opacity-50">
                Voltar para teste
              </button>
            </>
          ) : (
            <span className="text-[13px] text-apoio">configurada no n8n</span>
          )}
        </div>
      </div>
      {faltas.length > 0 && (
        <div className="mt-3">
          <Aviso tom="aviso">Falta a dona preencher no app: {faltas.join(", ")}. Sem isso a IA passa as conversas para ela.</Aviso>
        </div>
      )}
    </div>
  );
}

function NovaLoja({ aoFechar, aoCriar }: { aoFechar: () => void; aoCriar: (qr: Qr) => void }) {
  const [ramo, setRamo] = useState("unhas");
  const [nome, setNome] = useState("");
  const [dona, setDona] = useState("");
  const [whats, setWhats] = useState("55");
  const [cidade, setCidade] = useState("");
  const [limite, setLimite] = useState("200");
  const [bloco, setBloco] = useState("");
  const [email, setEmail] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEnviando(true);
    try {
      const r = await chamar<{ id: string; qr: { imagem: string; codigo: string }; avisos: string[] }>("/api/lojas", {
        method: "POST",
        body: JSON.stringify({
          ramo,
          nome,
          dona,
          whatsappDona: whats,
          cidade,
          limiteMes: inteiro(limite, "Teto de conversas"),
          blocoMin: inteiro(bloco, "Tempo por cliente"),
          email,
        }),
      });
      // os avisos (convite que falhou, por exemplo) seguem para o painel do QR, que é o que fica na tela
      aoCriar({ lojaId: r.id, nome, imagem: r.qr.imagem, codigo: r.qr.codigo, conectado: false, avisos: r.avisos });
    } catch (e) {
      setErro((e as Error).message);
      setEnviando(false);
    }
  }

  return (
    <Folha titulo="Nova loja" aoFechar={enviando ? () => {} : aoFechar}>
      <form onSubmit={enviar} className="space-y-5">
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-bold text-texto-2">Ramo</legend>
          <div className="grid grid-cols-2 gap-2.5">
            {[
              { chave: "unhas", titulo: "Unhas", texto: "Manicure e pedicure" },
              { chave: "megahair", titulo: "Mega hair", texto: "Aplicação e manutenção" },
            ].map((r) => (
              <label
                key={r.chave}
                className={`cursor-pointer rounded-xl border px-4 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-onix/30 ${
                  ramo === r.chave ? "border-onix bg-onix text-porcelana" : "border-borda bg-card hover:bg-campo/40"
                }`}
              >
                <input type="radio" name="ramo" value={r.chave} checked={ramo === r.chave} onChange={() => setRamo(r.chave)} className="sr-only" />
                <span className="block text-[15px] font-bold">{r.titulo}</span>
                <span className={`block text-[13px] ${ramo === r.chave ? "text-campo" : "text-apoio"}`}>{r.texto}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <Rotulo>Nome da loja</Rotulo>
            <input value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Studio da Ana" className={campo} />
          </label>
          <label className="block">
            <Rotulo>Nome da dona (como a IA vai chamar)</Rotulo>
            <input value={dona} onChange={(e) => setDona(e.target.value)} required placeholder="Ana" className={campo} />
          </label>
          <label className="block">
            <Rotulo>WhatsApp da dona (55 + DDD + número)</Rotulo>
            <input value={whats} onChange={(e) => setWhats(e.target.value)} required inputMode="numeric" placeholder="5566999990000" className={campo} />
          </label>
          <label className="block">
            <Rotulo>Cidade</Rotulo>
            <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Sinop" className={campo} />
          </label>
          <label className="block">
            <Rotulo>E-mail da dona, para o convite do app (opcional)</Rotulo>
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="ana@exemplo.com" className={campo} />
          </label>
          <label className="block">
            <Rotulo>Teto de conversas por mês (vazio = sem teto)</Rotulo>
            <input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" className={campo} />
          </label>
          <label className="block md:col-span-2">
            <Rotulo>Tempo mínimo por cliente, em minutos (vazio = tempo de cada serviço)</Rotulo>
            <input value={bloco} onChange={(e) => setBloco(e.target.value)} inputMode="numeric" placeholder="ex.: 120" className={campo + " md:max-w-[calc(50%-0.5rem)]"} />
          </label>
        </div>

        <p className="text-[14px] leading-relaxed text-apoio">
          A loja nasce com a IA em teste: só o WhatsApp da agência recebe resposta até você liberar. Com e-mail preenchido, a dona recebe o
          convite de login na hora.
        </p>
        {erro && <Aviso tom="atencao">{erro}</Aviso>}
        <div className="flex gap-2.5">
          <button type="submit" disabled={enviando} className={botaoForte + " h-11"}>
            {enviando ? "Criando…" : "Criar loja e gerar o QR"}
          </button>
          <button type="button" onClick={aoFechar} disabled={enviando} className={botao + " h-11"}>
            Cancelar
          </button>
        </div>
      </form>
    </Folha>
  );
}

// QR para a dona escanear. Confere sozinho, a cada 4 segundos, se o WhatsApp conectou.
function PainelQr({ qr, aoMudar, aoFechar }: { qr: Qr; aoMudar: (q: Qr) => void; aoFechar: () => void }) {
  const [erro, setErro] = useState("");
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    if (qr.conectado) return;
    // vivo = este painel ainda está aberto para esta loja; pedido que voltar depois de fechar é ignorado
    let vivo = true;
    let pedindo = false;
    const inicio = Date.now();
    const t = setInterval(() => {
      // para de conferir depois de 5 minutos (aba esquecida) e não empilha pedidos
      if (Date.now() - inicio > 5 * 60 * 1000) return clearInterval(t);
      if (pedindo) return;
      pedindo = true;
      chamar<{ conectado: boolean }>(`/api/lojas/${qr.lojaId}`)
        .then((r) => vivo && r.conectado && aoMudar({ ...qr, conectado: true }))
        .catch(() => {})
        .finally(() => (pedindo = false));
    }, 4000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [qr, aoMudar]);

  async function novo() {
    setErro("");
    setGerando(true);
    try {
      const r = await chamar<{ conectado: boolean; imagem: string; codigo: string }>(`/api/lojas/${qr.lojaId}/qr`, { method: "POST" });
      aoMudar({ ...qr, ...r });
    } catch (e) {
      setErro((e as Error).message);
    }
    setGerando(false);
  }

  return (
    <Folha titulo={`Conectar o WhatsApp de ${qr.nome}`} aoFechar={aoFechar}>
      <div className="space-y-4">
        {qr.avisos && qr.avisos.length > 0 && <Aviso tom="aviso">{qr.avisos.join(" ")}</Aviso>}
        {qr.conectado ? (
          <Aviso tom="ok">
            <b>WhatsApp conectado.</b> A loja já está ligada ao motor.
          </Aviso>
        ) : (
          <div className="flex flex-wrap items-start gap-6">
            {qr.imagem ? (
              // eslint-disable-next-line @next/next/no-img-element -- imagem em data: vinda da Evolution
              <img src={qr.imagem} alt="QR code para conectar o WhatsApp" className="h-60 w-60 rounded-2xl border border-borda bg-white p-2" />
            ) : (
              <div className="flex h-60 w-60 items-center justify-center rounded-2xl border border-dashed border-borda-forte px-6 text-center text-[14px] text-apoio">
                Sem QR ainda. Clique em Gerar novo QR.
              </div>
            )}
            <div className="max-w-xs flex-1 space-y-3">
              <ol className="list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
                <li>Abra o WhatsApp no celular da loja.</li>
                <li>Toque em Aparelhos conectados.</li>
                <li>Toque em Conectar um aparelho e aponte para o QR.</li>
              </ol>
              <p className="text-[13px] leading-relaxed text-apoio">O QR vale menos de 1 minuto. Se passar, gere outro. Esta tela avisa sozinha quando conectar.</p>
              {qr.codigo && (
                <p className="text-[14px]">
                  Código de pareamento: <b className="font-mono">{qr.codigo}</b>
                </p>
              )}
              <button onClick={novo} disabled={gerando} className={botao}>
                {gerando ? "Gerando…" : "Gerar novo QR"}
              </button>
            </div>
          </div>
        )}
        {erro && <Aviso tom="atencao">{erro}</Aviso>}
        <button onClick={aoFechar} className={qr.conectado ? botaoForte : botao}>
          {qr.conectado ? "Pronto" : "Fechar"}
        </button>
      </div>
    </Folha>
  );
}

// Recusar todos os pedidos pendentes de uma vez (para limpar pedidos falsos)
function RecusarTodos({ quantos, aoMudar }: { quantos: number; aoMudar: () => void }) {
  const { dialogo, perguntar, avisar } = useDialogo();
  const [ocupado, setOcupado] = useState(false);
  async function recusar() {
    if (!(await perguntar(`Recusar os ${quantos} pedidos pendentes?\nNada é criado e todos saem da lista. Não dá para desfazer por esta tela.`, { confirmar: "Recusar todos", perigo: true }))) return;
    setOcupado(true);
    try {
      await chamar("/api/cadastros/todos", { method: "POST", body: JSON.stringify({ acao: "recusar" }) });
    } catch (e) {
      await avisar((e as Error).message);
    }
    setOcupado(false);
    aoMudar();
  }
  return (
    <>
      {dialogo}
      <button onClick={recusar} disabled={ocupado} className={botao}>
        Recusar todos
      </button>
    </>
  );
}

// Pedido que a dona fez pelo app (página Cadastrar minha loja). Aprovar cria a loja e abre o QR.
function CartaoCadastro({ cadastro, aoMudar, aoAprovar }: { cadastro: Cadastro; aoMudar: () => void; aoAprovar: (qr: Qr) => void }) {
  const { dialogo, perguntar, avisar } = useDialogo();
  const [ocupado, setOcupado] = useState(false);
  const [limite, setLimite] = useState("200");
  const [email, setEmail] = useState(cadastro.email);
  const c = cadastro;

  async function resolver(acao: "aprovar" | "recusar" | "reabrir") {
    let limiteMes: number | null = null;
    try {
      if (acao === "aprovar") limiteMes = inteiro(limite, "Teto de conversas");
    } catch (e) {
      return void avisar((e as Error).message);
    }
    const destino = email.trim();
    const pergunta =
      acao === "aprovar"
        ? `Aprovar ${c.nomeLoja}?\nCria a loja e o WhatsApp para conectar. A IA nasce em teste.\n\n${
            destino
              ? `O convite do app vai para ${destino}. Quem recebe esse e-mail entra como dona e vê clientes, conversas e agenda: confirme o endereço com a ${c.dona} pelo WhatsApp antes.`
              : "Sem e-mail: nenhum convite do app será enviado agora."
          }`
        : acao === "recusar"
          ? `Recusar o pedido de ${c.nomeLoja}?\nNada é criado e o pedido sai da lista.`
          : `Reabrir o pedido de ${c.nomeLoja}?\nEle volta para a lista como pendente, para ser aprovado de novo. Antes, confira na lista de lojas se a loja não chegou a ser criada.`;
    const confirmar = acao === "aprovar" ? "Aprovar" : acao === "recusar" ? "Recusar" : "Reabrir";
    if (!(await perguntar(pergunta, { confirmar, perigo: acao === "recusar" }))) return;
    setOcupado(true);
    try {
      const r = await chamar<{ id: string; nome: string; qr: { imagem: string; codigo: string }; avisos: string[] }>(`/api/cadastros/${c.id}`, {
        method: "POST",
        body: JSON.stringify({ acao, limiteMes, email: destino }),
      });
      if (acao === "aprovar") aoAprovar({ lojaId: r.id, nome: r.nome, imagem: r.qr.imagem, codigo: r.qr.codigo, conectado: false, avisos: r.avisos });
      else aoMudar();
    } catch (e) {
      await avisar((e as Error).message);
      aoMudar();
    }
    setOcupado(false);
  }

  return (
    <article className={`${cartao} p-5`}>
      {dialogo}
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[18px] font-bold">{c.nomeLoja}</h3>
            <Chip tom="neutro">{c.ramo === "megahair" ? "Mega hair" : "Unhas"}</Chip>
          </div>
          <p className="mt-0.5 text-[14px] text-texto-2">
            {c.dona} · {c.whatsapp}
            {c.cidade && ` · ${c.cidade}`}
          </p>
          <p className="text-[13px] text-apoio">Pedido em {new Date(c.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</p>
        </div>
        {c.preso ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => resolver("reabrir")} disabled={ocupado} className={botaoForte}>
              Reabrir
            </button>
            <button onClick={() => resolver("recusar")} disabled={ocupado} className={botao}>
              Recusar
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2.5">
            <label className="block">
              <Rotulo>E-mail do convite (confirme com a dona)</Rotulo>
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="sem convite" className={campo + " h-10 w-64"} />
            </label>
            <label className="block">
              <Rotulo>Teto de conversas</Rotulo>
              <input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" className={campo + " h-10 w-28"} />
            </label>
            <button onClick={() => resolver("aprovar")} disabled={ocupado} className={botaoForte}>
              {ocupado ? "Aguarde…" : "Aprovar"}
            </button>
            <button onClick={() => resolver("recusar")} disabled={ocupado} className={botao}>
              Recusar
            </button>
          </div>
        )}
      </div>
      {(c.jaUsadoEm || c.preso) && (
        <div className="mt-4 space-y-2">
          {c.jaUsadoEm && (
            <Aviso tom="aviso">
              Este WhatsApp já é o número da dona de <b>{c.jaUsadoEm}</b>. Se for a mesma pessoa abrindo outra loja, tudo bem; senão, confira
              com ela antes de aprovar.
            </Aviso>
          )}
          {c.preso && <Aviso tom="atencao">Este pedido ficou marcado como aprovado, mas a loja não foi criada. Reabra para aprovar de novo, ou recuse.</Aviso>}
        </div>
      )}
    </article>
  );
}

// Ajustes de uma loja do motor: teto de conversas, tempo por cliente e sinal por Pix
function Ajustes({ loja, aoFechar, aoMudar }: { loja: Loja; aoFechar: () => void; aoMudar: () => void }) {
  const { dialogo, avisar } = useDialogo();
  const [limite, setLimite] = useState(loja.limiteMes?.toString() ?? "");
  const [bloco, setBloco] = useState(loja.blocoMin?.toString() ?? "");
  const [sinal, setSinal] = useState({ ...loja.sinal, valor: loja.sinal.valor?.toString() ?? "" });
  const [ocupado, setOcupado] = useState(false);
  const [salvo, setSalvo] = useState("");

  // número escrito errado é avisado aqui e nada é enviado
  async function salvar(montar: () => object, qual: string) {
    let mudanca: object;
    try {
      mudanca = montar();
    } catch (e) {
      return void avisar((e as Error).message);
    }
    setOcupado(true);
    setSalvo("");
    try {
      await chamar(`/api/lojas/${loja.id}`, { method: "PATCH", body: JSON.stringify(mudanca) });
      setSalvo(qual);
      aoMudar();
    } catch (e) {
      await avisar((e as Error).message);
    }
    setOcupado(false);
  }

  return (
    <Folha titulo={`Ajustes de ${loja.nome}`} aoFechar={aoFechar} largura="max-w-3xl">
      {dialogo}
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
        <section className="space-y-4">
          <h3 className="rotulo">Conversas e agenda</h3>
          <label className="block">
            <Rotulo>Teto de conversas por mês (vazio = sem teto)</Rotulo>
            <input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" className={campo} />
          </label>
          <label className="block">
            <Rotulo>Tempo mínimo por cliente, em minutos (vazio = tempo de cada serviço)</Rotulo>
            <input value={bloco} onChange={(e) => setBloco(e.target.value)} inputMode="numeric" className={campo} />
          </label>
          <div className="flex items-center gap-3">
            <button
              onClick={() => salvar(() => ({ limiteMes: inteiro(limite, "Teto de conversas"), blocoMin: inteiro(bloco, "Tempo por cliente") }), "conversas")}
              disabled={ocupado}
              className={botaoForte}
            >
              Salvar
            </button>
            {salvo === "conversas" && (
              <span role="status" className="text-[14px] font-bold text-salvia-texto">
                Salvo
              </span>
            )}
          </div>
          {loja.permitidos.length > 0 && !loja.liberada && <p className="text-[13px] leading-relaxed text-apoio">Em teste, a IA só responde: {loja.permitidos.join(", ")}.</p>}
        </section>

        <section className="space-y-4">
          <h3 className="rotulo">Sinal por Pix</h3>
          <label className="flex items-center gap-2.5 text-[15px] font-bold">
            <input type="checkbox" checked={sinal.ativo} onChange={(e) => setSinal({ ...sinal, ativo: e.target.checked })} className="h-5 w-5 accent-[var(--cor-principal)]" />
            A loja cobra sinal
          </label>
          {sinal.ativo && (
            <>
              <label className="block">
                <Rotulo>Valor do sinal (R$)</Rotulo>
                <input value={sinal.valor} onChange={(e) => setSinal({ ...sinal, valor: e.target.value })} inputMode="decimal" className={campo} />
              </label>
              <label className="block">
                <Rotulo>Chave Pix</Rotulo>
                <input value={sinal.chave} onChange={(e) => setSinal({ ...sinal, chave: e.target.value })} className={campo} />
              </label>
              <label className="block">
                <Rotulo>Nome de quem recebe (como aparece no comprovante)</Rotulo>
                <input value={sinal.nome} onChange={(e) => setSinal({ ...sinal, nome: e.target.value })} className={campo} />
              </label>
              <label className="flex items-start gap-2.5 text-[14px] font-semibold">
                <input
                  type="checkbox"
                  checked={sinal.soParaQuemFaltou}
                  onChange={(e) => setSinal({ ...sinal, soParaQuemFaltou: e.target.checked })}
                  className="mt-0.5 h-5 w-5 accent-[var(--cor-principal)]"
                />
                Só para quem faltou ou cancelou em cima da hora
              </label>
            </>
          )}
          <div className="flex items-center gap-3">
            <button onClick={() => salvar(() => ({ sinal: { ...sinal, valor: reais(sinal.valor) } }), "sinal")} disabled={ocupado} className={botaoForte}>
              Salvar sinal
            </button>
            {salvo === "sinal" && (
              <span role="status" className="text-[14px] font-bold text-salvia-texto">
                Salvo
              </span>
            )}
          </div>
        </section>
      </div>
    </Folha>
  );
}
