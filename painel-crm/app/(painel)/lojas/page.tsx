"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDialogo } from "@/components/Dialogo";

// Lojas da agência no motor único (docs/PLANO-MOTOR-UNICO.md): criar loja nova (instância do WhatsApp, loja no
// banco e QR), ver quem conectou e o que falta preencher, liberar a IA, teto de conversas e sinal.
// Tudo passa pelas rotas /api/lojas, que rodam no servidor do painel com as chaves de serviço.

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
type Qr = { lojaId: string; nome: string; imagem: string; codigo: string; conectado: boolean; avisos?: string[] };

const RAMO: Record<string, string> = { manicure: "Unhas", mega_hair: "Mega hair", estudio_beleza: "Estúdio de beleza" };
const campo = "h-11 w-full rounded-xl border border-borda bg-card px-3 outline-none focus:border-cobre";
const botao = "h-10 rounded-xl border border-borda bg-card px-4 text-sm font-semibold hover:bg-campo/60 disabled:opacity-50";
const botaoForte = "h-11 rounded-xl bg-grafite px-5 font-bold text-perola disabled:opacity-50";

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

export default function LojasPage() {
  const [lojas, setLojas] = useState<Loja[] | null>(null);
  const [erro, setErro] = useState("");
  const [criando, setCriando] = useState(false);
  const [qr, setQr] = useState<Qr | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  const carregar = useCallback(() => {
    chamar<{ lojas: Loja[] }>("/api/lojas")
      .then((r) => {
        setLojas(r.lojas);
        setErro("");
      })
      .catch((e: Error) => setErro(e.message));
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4 pt-8 pb-4">
        <div>
          <h1 className="font-serif text-[40px] leading-tight font-semibold">Lojas</h1>
          <p className="text-texto-2">Criar loja nova, conectar o WhatsApp e liberar a IA de cada uma.</p>
        </div>
        {lojas && !criando && (
          <button onClick={() => setCriando(true)} className={botaoForte}>
            Nova loja
          </button>
        )}
      </div>

      {erro && <p role="alert" className="mb-4 rounded-xl bg-rose p-4 text-rose-texto">{erro}</p>}
      {!lojas && !erro && <p className="py-8 text-texto-2">Carregando…</p>}

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

      {lojas && (
        <div className="space-y-3">
          {lojas.map((l) => (
            <CartaoLoja
              key={l.id}
              loja={l}
              aberta={aberta === l.id}
              aoAbrir={() => setAberta(aberta === l.id ? null : l.id)}
              aoMudar={carregar}
              aoPedirQr={(novo) => setQr(novo)}
            />
          ))}
          {lojas.length === 0 && <p className="py-8 text-texto-2">Nenhuma loja ainda.</p>}
        </div>
      )}
    </>
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
    <form onSubmit={enviar} className="mb-6 space-y-4 rounded-2xl border border-grafite/10 bg-card p-6 shadow-[0_4px_14px_rgba(33,22,16,0.05)]">
      <h2 className="text-xl font-bold">Nova loja</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm font-semibold">
          Ramo
          <select value={ramo} onChange={(e) => setRamo(e.target.value)} className={campo}>
            <option value="unhas">Unhas (manicure e pedicure)</option>
            <option value="megahair">Mega hair</option>
          </select>
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Nome da loja
          <input value={nome} onChange={(e) => setNome(e.target.value)} required placeholder="Studio da Ana" className={campo} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Nome da dona (como a IA vai chamar)
          <input value={dona} onChange={(e) => setDona(e.target.value)} required placeholder="Ana" className={campo} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          WhatsApp da dona (55 + DDD + número)
          <input value={whats} onChange={(e) => setWhats(e.target.value)} required inputMode="numeric" placeholder="5566999990000" className={campo} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Cidade
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Sinop" className={campo} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Teto de conversas por mês (vazio = sem teto)
          <input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" className={campo} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          Tempo mínimo por cliente, em minutos (vazio = tempo do serviço)
          <input value={bloco} onChange={(e) => setBloco(e.target.value)} inputMode="numeric" placeholder="ex.: 120" className={campo} />
        </label>
        <label className="space-y-1 text-sm font-semibold">
          E-mail da dona, para o convite do app (opcional)
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="ana@exemplo.com" className={campo} />
        </label>
      </div>
      <p className="text-sm text-texto-2">
        A loja nasce com a IA em teste: só o WhatsApp da agência recebe resposta até você liberar. Com e-mail preenchido, a dona recebe
        um convite de login na hora.
      </p>
      {erro && <p role="alert" className="rounded-xl bg-rose p-3 text-rose-texto">{erro}</p>}
      <div className="flex gap-3">
        <button type="submit" disabled={enviando} className={botaoForte}>
          {enviando ? "Criando…" : "Criar loja e gerar o QR"}
        </button>
        <button type="button" onClick={aoFechar} disabled={enviando} className={botao + " h-11"}>
          Cancelar
        </button>
      </div>
    </form>
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
    <div className="mb-6 rounded-2xl border border-grafite/10 bg-card p-6 shadow-[0_4px_14px_rgba(33,22,16,0.05)]">
      <h2 className="text-xl font-bold">Conectar o WhatsApp · {qr.nome}</h2>
      {qr.avisos && qr.avisos.length > 0 && (
        <p role="alert" className="mt-3 rounded-xl bg-mel p-3 text-mel-texto">
          {qr.avisos.join(" ")}
        </p>
      )}
      {qr.conectado ? (
        <p className="mt-3 rounded-xl bg-salvia p-4 font-semibold text-salvia-texto">WhatsApp conectado. A loja já está ligada ao motor.</p>
      ) : (
        <div className="mt-4 flex flex-wrap items-start gap-6">
          {qr.imagem ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagem em data: vinda da Evolution
            <img src={qr.imagem} alt="QR code para conectar o WhatsApp" className="h-64 w-64 rounded-xl border border-borda bg-white p-2" />
          ) : (
            <div className="flex h-64 w-64 items-center justify-center rounded-xl border border-borda text-center text-texto-2">
              Sem QR ainda.
              <br />
              Clique em Gerar novo QR.
            </div>
          )}
          <div className="max-w-md space-y-3">
            <p>
              No celular da loja: WhatsApp → Aparelhos conectados → Conectar um aparelho, e aponte para este QR.
            </p>
            <p className="text-sm text-texto-2">O QR vale menos de 1 minuto. Se passar, gere outro. Esta tela avisa sozinha quando conectar.</p>
            {qr.codigo && (
              <p className="text-sm">
                Código de pareamento: <b className="font-mono">{qr.codigo}</b>
              </p>
            )}
            <button onClick={novo} disabled={gerando} className={botao}>
              {gerando ? "Gerando…" : "Gerar novo QR"}
            </button>
          </div>
        </div>
      )}
      {erro && <p role="alert" className="mt-3 rounded-xl bg-rose p-3 text-rose-texto">{erro}</p>}
      <button onClick={aoFechar} className={botao + " mt-4"}>
        Fechar
      </button>
    </div>
  );
}

function Selo({ cor, children }: { cor: "salvia" | "mel" | "rose" | "taupe"; children: React.ReactNode }) {
  const cores = { salvia: "bg-salvia text-salvia-texto", mel: "bg-mel text-mel-texto", rose: "bg-rose text-rose-texto", taupe: "bg-taupe text-taupe-texto" };
  return <span className={`rounded-full px-3 py-1 text-sm font-semibold ${cores[cor]}`}>{children}</span>;
}

function CartaoLoja({
  loja,
  aberta,
  aoAbrir,
  aoMudar,
  aoPedirQr,
}: {
  loja: Loja;
  aberta: boolean;
  aoAbrir: () => void;
  aoMudar: () => void;
  aoPedirQr: (qr: Qr) => void;
}) {
  const { dialogo, perguntar, avisar } = useDialogo();
  const [ocupado, setOcupado] = useState(false);

  const faltas = [
    loja.servicosSemPreco > 0 && `${loja.servicosSemPreco} serviço(s) sem preço`,
    !loja.temHorario && "horário de funcionamento",
    !loja.temRecado && "recado da dona",
  ].filter(Boolean) as string[];
  const noTeto = loja.limiteMes !== null && loja.usoMes >= loja.limiteMes;

  async function mudar(mudanca: object, pergunta?: string, confirmar?: string) {
    if (pergunta && !(await perguntar(pergunta, { confirmar }))) return;
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

  return (
    <div className="rounded-2xl border border-grafite/10 bg-card p-5 shadow-[0_1px_2px_rgba(33,22,16,0.05)]">
      {dialogo}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-lg font-bold">{loja.nome}</p>
          <p className="text-sm text-texto-2">
            {RAMO[loja.ramo] ?? loja.ramo}
            {loja.dona && ` · ${loja.dona}`}
            {loja.instancia && ` · ${loja.instancia}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Selo cor={loja.whatsapp === "conectado" ? "salvia" : loja.whatsapp === "não conferido" ? "mel" : "rose"}>WhatsApp {loja.whatsapp}</Selo>
          {loja.noMotor ? (
            <Selo cor={loja.liberada ? "salvia" : "mel"}>{loja.liberada ? "IA liberada" : "IA em teste"}</Selo>
          ) : (
            <Selo cor="taupe">Conjunto próprio</Selo>
          )}
          <Selo cor={noTeto ? "rose" : "taupe"}>
            {loja.usoMes}
            {loja.limiteMes !== null ? ` de ${loja.limiteMes}` : ""} conversas no mês
          </Selo>
        </div>
      </div>

      {loja.noMotor && faltas.length > 0 && (
        <p className="mt-3 rounded-xl bg-mel p-3 text-sm text-mel-texto">
          Falta a dona preencher no app: {faltas.join(", ")}. Sem preço e horário a IA passa as conversas para ela.
        </p>
      )}

      {loja.noMotor ? (
        <div className="mt-4 flex flex-wrap gap-2">
          {loja.whatsapp !== "conectado" && loja.instancia && (
            <button onClick={pedirQr} disabled={ocupado} className={botao}>
              Conectar WhatsApp (QR)
            </button>
          )}
          {loja.liberada ? (
            <button
              onClick={() => mudar({ liberada: false }, `Voltar ${loja.nome} para teste?\nA IA para de responder as clientes e só responde o WhatsApp da agência.`, "Voltar para teste")}
              disabled={ocupado}
              className={botao}
            >
              Voltar para teste
            </button>
          ) : (
            <button
              onClick={() => mudar({ liberada: true }, `Liberar a IA de ${loja.nome}?\nEla passa a responder TODAS as clientes que escreverem para o WhatsApp da loja.`, "Liberar")}
              disabled={ocupado}
              className={botao}
            >
              Liberar a IA
            </button>
          )}
          <button onClick={aoAbrir} aria-expanded={aberta} className={botao}>
            {aberta ? "Fechar ajustes" : "Teto, tempo e sinal"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-texto-2">Esta loja usa os workflows próprios dela no n8n. Não é configurada por esta tela.</p>
      )}

      {aberta && loja.noMotor && <Ajustes loja={loja} salvar={(m) => mudar(m)} avisar={avisar} ocupado={ocupado} />}
    </div>
  );
}

function Ajustes({
  loja,
  salvar,
  avisar,
  ocupado,
}: {
  loja: Loja;
  salvar: (m: object) => void;
  avisar: (texto: string) => Promise<void>;
  ocupado: boolean;
}) {
  const [limite, setLimite] = useState(loja.limiteMes?.toString() ?? "");
  const [bloco, setBloco] = useState(loja.blocoMin?.toString() ?? "");
  const [sinal, setSinal] = useState({ ...loja.sinal, valor: loja.sinal.valor?.toString() ?? "" });

  // número escrito errado é avisado aqui e nada é enviado
  function enviar(montar: () => object) {
    try {
      salvar(montar());
    } catch (e) {
      void avisar((e as Error).message);
    }
  }

  return (
    <div className="mt-4 grid gap-6 border-t border-borda/60 pt-4 md:grid-cols-2">
      <div className="space-y-3">
        <p className="font-bold">Conversas e agenda</p>
        <label className="block space-y-1 text-sm font-semibold">
          Teto de conversas por mês (vazio = sem teto)
          <input value={limite} onChange={(e) => setLimite(e.target.value)} inputMode="numeric" className={campo} />
        </label>
        <label className="block space-y-1 text-sm font-semibold">
          Tempo mínimo por cliente, em minutos (vazio = tempo do serviço)
          <input value={bloco} onChange={(e) => setBloco(e.target.value)} inputMode="numeric" className={campo} />
        </label>
        <button
          onClick={() => enviar(() => ({ limiteMes: inteiro(limite, "Teto de conversas"), blocoMin: inteiro(bloco, "Tempo por cliente") }))}
          disabled={ocupado}
          className={botao}
        >
          Salvar
        </button>
        {loja.permitidos.length > 0 && !loja.liberada && <p className="text-sm text-texto-2">Em teste, a IA só responde: {loja.permitidos.join(", ")}.</p>}
      </div>
      <div className="space-y-3">
        <p className="font-bold">Sinal por Pix</p>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={sinal.ativo} onChange={(e) => setSinal({ ...sinal, ativo: e.target.checked })} className="h-5 w-5" />
          A loja cobra sinal
        </label>
        {sinal.ativo && (
          <>
            <label className="block space-y-1 text-sm font-semibold">
              Valor do sinal (R$)
              <input value={sinal.valor} onChange={(e) => setSinal({ ...sinal, valor: e.target.value })} inputMode="decimal" className={campo} />
            </label>
            <label className="block space-y-1 text-sm font-semibold">
              Chave Pix
              <input value={sinal.chave} onChange={(e) => setSinal({ ...sinal, chave: e.target.value })} className={campo} />
            </label>
            <label className="block space-y-1 text-sm font-semibold">
              Nome de quem recebe (como aparece no comprovante)
              <input value={sinal.nome} onChange={(e) => setSinal({ ...sinal, nome: e.target.value })} className={campo} />
            </label>
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={sinal.soParaQuemFaltou}
                onChange={(e) => setSinal({ ...sinal, soParaQuemFaltou: e.target.checked })}
                className="h-5 w-5"
              />
              Só para quem faltou ou cancelou em cima da hora
            </label>
          </>
        )}
        <button
          onClick={() => enviar(() => ({ sinal: { ...sinal, valor: reais(sinal.valor) } }))}
          disabled={ocupado}
          className={botao}
        >
          Salvar sinal
        </button>
      </div>
    </div>
  );
}
