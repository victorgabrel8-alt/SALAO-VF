"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { FormAtendimento } from "@/components/FormAtendimento";
import { buscarAtendimentosDoDia, type Atendimento } from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { estaExcluida } from "@/lib/excluidas";
import { agoraNoSalao, formatarHora, formatarTelefone, hojeNoSalao, inicioDoDia, primeiroNome, somarDias } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

const MOTIVOS: Record<string, string> = {
  pediu_humano: "Pediu para falar com você",
  reclamacao: "Fez uma reclamação",
  fora_escopo: "Perguntou algo que a IA não sabe",
};

const DIAS_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

type Precisa = { id: string; nome: string | null; telefone: string; motivo_pausa: string };
type Aniversariante = { id: string; nome: string | null; telefone: string; dia: string };

type Resumo = {
  precisam: Precisa[];
  // Todos os horários de hoje e de amanhã, sem os cancelados
  hoje: Atendimento[];
  amanha: Atendimento[];
  iaConversou: number;
  iaMarcou: number;
  aniversariantes: Aniversariante[];
};

// Quem faz aniversário de hoje até daqui a 6 dias (o ano do nascimento não importa)
function aniversariantesDaSemana(clientes: { id: string; nome: string | null; telefone: string; aniversario: string }[]) {
  const hoje = hojeNoSalao();
  const proximos = Array.from({ length: 7 }, (_, i) => somarDias(hoje, i));
  return clientes
    .map((c) => ({ ...c, dia: proximos.find((d) => d.slice(5) === c.aniversario.slice(5)) }))
    .filter((c): c is typeof c & { dia: string } => !!c.dia)
    .sort((a, b) => a.dia.localeCompare(b.dia))
    .map(({ id, nome, telefone, dia }) => ({ id, nome, telefone, dia }));
}

async function buscarResumo(empresaId: string): Promise<Resumo | { erro: string }> {
  const db = supabase();
  const hoje = hojeNoSalao();
  const desde = inicioDoDia(hoje);
  // Leve: não baixa a lista de clientes, só quem precisa da dona agora
  const [clientes, atendimentos, deAmanha, mensagensIa, marcadosIa, comAniversario] = await Promise.all([
    db
      .from("clientes_status")
      .select("id, nome, telefone, motivo_pausa, etiquetas")
      .eq("empresa_id", empresaId)
      .eq("ia_pausada", true)
      .in("motivo_pausa", Object.keys(MOTIVOS)),
    buscarAtendimentosDoDia(empresaId, hoje),
    buscarAtendimentosDoDia(empresaId, somarDias(hoje, 1)),
    db.from("mensagens").select("cliente_id").eq("empresa_id", empresaId).eq("autor", "ia").gte("criado_em", desde),
    db
      .from("agendamentos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("origem", "ia")
      .gte("criado_em", desde),
    db.from("clientes").select("id, nome, telefone, aniversario, etiquetas").eq("empresa_id", empresaId).not("aniversario", "is", null),
  ]);
  const erro = clientes.error ?? mensagensIa.error ?? marcadosIa.error ?? comAniversario.error;
  if (erro) return { erro: erro.message };
  if (atendimentos.erro) return { erro: atendimentos.erro };
  if (deAmanha.erro) return { erro: deAmanha.erro };

  return {
    precisam: (clientes.data ?? []).filter((c) => !estaExcluida(c.etiquetas)) as Precisa[],
    hoje: atendimentos.atendimentos.filter((a) => a.status !== "cancelado"),
    amanha: deAmanha.atendimentos.filter((a) => a.status !== "cancelado"),
    iaConversou: new Set((mensagensIa.data ?? []).map((m) => m.cliente_id)).size,
    iaMarcou: marcadosIa.count ?? 0,
    aniversariantes: aniversariantesDaSemana((comAniversario.data ?? []).filter((c) => !estaExcluida(c.etiquetas))),
  };
}

function saudacao(hora: string): string {
  const h = Number(hora.slice(0, 2));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

function minutosDe(a: Atendimento): number {
  return a.fim ? Math.round((Date.parse(a.fim) - Date.parse(a.inicio)) / 60_000) : 60;
}

function duracao(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h${String(m).padStart(2, "0")}` : h ? `${h}h` : `${m} min`;
}

// "em 25 min", "em 2h", "agora"
function quandoComeca(a: Atendimento): string {
  const falta = Math.round((Date.parse(a.inicio) - Date.now()) / 60_000);
  if (falta <= 0) return "agora";
  if (falta < 60) return `em ${falta} min`;
  return `em ${Math.round(falta / 60)}h`;
}

function emAndamento(a: Atendimento): boolean {
  const inicio = Date.parse(a.inicio);
  return Date.now() >= inicio && Date.now() < inicio + minutosDe(a) * 60_000;
}

// A próxima da fila: o primeiro horário a atender que ainda não terminou
function proximaCliente(hoje: Atendimento[]): Atendimento | null {
  const agora = Date.now();
  return hoje.find((a) => a.status === "agendado" && Date.parse(a.inicio) + minutosDe(a) * 60_000 > agora) ?? null;
}

// Selo da lista "Hoje", nas mesmas cores da Agenda
function selo(a: Atendimento): { rotulo: string; classe: string } {
  if (a.status === "realizado") return { rotulo: "Concluído", classe: "bg-salvia text-salvia-texto" };
  if (a.status === "faltou") return { rotulo: "Faltou", classe: "bg-rose text-rose-texto" };
  if (emAndamento(a)) return { rotulo: "Agora", classe: "bg-grafite text-perola" };
  return { rotulo: "A atender", classe: "bg-taupe text-taupe-texto" };
}

function nomeDe(c: { nome: string | null; telefone: string } | null | undefined): string {
  return c?.nome ?? (c ? formatarTelefone(c.telefone) : "Cliente");
}

function Secao({ titulo, extra, children }: { titulo: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between">
        <h2 className="rotulo text-texto-2">{titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

export default function InicioPage() {
  const empresa = useEmpresa();
  const [resumo, setResumo] = useState<Resumo | { erro: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const [registrando, setRegistrando] = useState(false);
  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    let ativo = true;
    buscarResumo(empresa.id).then((r) => {
      if (ativo) setResumo(r);
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, versao]);

  // A IA grava sozinha: quando chega mensagem ou horário novo, a tela se atualiza
  useTempoReal(["agendamentos", "clientes", "mensagens"], empresa.id, recarregar);

  const ok = resumo && !("erro" in resumo) ? resumo : null;
  const proxima = ok ? proximaCliente(ok.hoje) : null;
  const paraAtender = ok ? ok.hoje.filter((a) => a.status === "agendado").length : 0;

  return (
    <>
      {/* Topo grafite enxuto: saudação, nome do salão e configurações numa linha só */}
      <header className="relative -mt-[env(safe-area-inset-top)] flex items-center justify-between overflow-hidden rounded-b-[28px] bg-grafite px-5 pt-[calc(50px+env(safe-area-inset-top))] pb-[18px]">
        <span aria-hidden="true" className="absolute -top-20 -right-10 h-[150px] w-[150px] rounded-full border-[1.5px] border-bronze/45" />
        <div className="relative flex min-w-0 flex-col gap-0.5">
          <span className="text-[11px] tracking-[0.3em] text-claro uppercase">{saudacao(agoraNoSalao().hora)}</span>
          <h1 className="truncate font-serif text-2xl leading-tight font-semibold text-white">{empresa.nome}</h1>
        </div>
        <Link
          href="/configuracoes"
          aria-label="Configurações"
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-bronze/50"
        >
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#EFE7DC" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
          </svg>
          {/* Ponto bronze quando alguém precisa da dona */}
          {ok && ok.precisam.length > 0 && <span aria-hidden className="absolute top-2 right-2.5 h-[7px] w-[7px] rounded-full bg-bronze" />}
        </Link>
      </header>

      {!resumo && <p className="p-5 text-texto-2">Carregando…</p>}
      {resumo && "erro" in resumo && <p className="m-5 rounded-2xl bg-rose p-4 text-rose-texto">Erro ao ler o banco: {resumo.erro}</p>}

      {ok && (
        <div className="flex flex-col gap-[22px] px-5 pt-4">
          {/* Próxima cliente, logo abaixo do topo */}
          <Link
            href={proxima?.clientes ? `/clientes/${proxima.clientes.id}` : "/agenda"}
            className="flex flex-col gap-3 rounded-[22px] bg-card p-4 shadow-[0_10px_26px_rgba(30,23,20,0.08)]"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-[0.25em] text-bronze-escuro uppercase">Próxima cliente</span>
              {proxima && <span className="rounded-full bg-grafite px-2.5 py-[5px] text-xs font-semibold text-perola">{quandoComeca(proxima)}</span>}
            </div>
            {proxima ? (
              <div className="flex items-center gap-3">
                <Avatar id={proxima.clientes?.id ?? proxima.id} nome={proxima.clientes?.nome ?? null} tamanho="h-12 w-12 text-xl" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-serif text-[21px] font-semibold">{nomeDe(proxima.clientes)}</span>
                  <span className="text-[13px] text-texto-2">
                    {proxima.servicos?.nome ?? "Serviço não informado"} · {formatarHora(proxima.inicio)} · {duracao(minutosDe(proxima))}
                  </span>
                </div>
                <Seta />
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] text-texto-2">Ninguém mais para atender hoje.</span>
                <Seta />
              </div>
            )}
          </Link>

          {/* Três números do dia */}
          <div className="-mt-2 grid grid-cols-3 gap-2.5">
            <Numero valor={paraAtender} rotulo="para atender hoje" href="/agenda" />
            <Numero valor={ok.iaConversou} rotulo={ok.iaConversou === 1 ? "conversa da IA hoje" : "conversas da IA hoje"} href="/conversas" />
            <Numero valor={ok.iaMarcou} rotulo={ok.iaMarcou === 1 ? "marcado pela IA" : "marcados pela IA"} />
          </div>

          {ok.precisam.length > 0 && (
            <Secao titulo="Precisam de você">
              {ok.precisam.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-[20px] bg-card px-3.5 py-3">
                  {/* Toque abre a conversa com a IA, para a dona ver o que ela pediu */}
                  <Link href={`/conversas/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar id={c.id} nome={c.nome} tamanho="h-11 w-11 text-lg" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-semibold">{nomeDe(c)}</span>
                      <span className="text-[13px] text-rose-texto">{MOTIVOS[c.motivo_pausa]}</span>
                    </span>
                  </Link>
                  {/* Um toque e a dona já está falando com a cliente */}
                  <BotaoWhatsApp rotulo={`Abrir WhatsApp de ${nomeDe(c)}`} aoTocar={() => abrirWhatsApp(c.telefone)} />
                </div>
              ))}
            </Secao>
          )}

          {/* A lista do dia, com a situação de cada horário */}
          <Secao
            titulo="Hoje"
            extra={
              <Link href="/agenda" className="text-[13px] font-semibold text-bronze-escuro">
                Ver agenda
              </Link>
            }
          >
            {ok.hoje.length === 0 ? (
              <p className="rounded-[22px] bg-card p-4 text-[15px] text-texto-2">Nenhum horário marcado hoje.</p>
            ) : (
              <ul className="rounded-[22px] bg-card">
                {ok.hoje.map((a, i) => {
                  const s = selo(a);
                  return (
                    <li key={a.id} className={i > 0 ? "border-t border-borda" : ""}>
                      <Link href={a.clientes ? `/clientes/${a.clientes.id}` : "/agenda"} className="flex items-center gap-3 px-3.5 py-3">
                        <span className="w-11 shrink-0 text-sm font-bold text-rotulo">{formatarHora(a.inicio)}</span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-semibold">{nomeDe(a.clientes)}</span>
                          <span className="truncate text-[13px] text-texto-2">{a.servicos?.nome ?? "Serviço não informado"}</span>
                        </span>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold whitespace-nowrap ${s.classe}`}>{s.rotulo}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Secao>

          {/* Amanhã num resumo de uma linha */}
          <Secao titulo="Amanhã">
            <Link href="/agenda" className="flex items-center gap-3 rounded-[22px] bg-card p-3.5">
              <span className="font-serif text-[30px] leading-none font-semibold">{ok.amanha.length}</span>
              <span className="text-sm text-texto-2">
                {ok.amanha.length === 0 ? (
                  "nenhum horário marcado ainda"
                ) : (
                  <>
                    {ok.amanha.length === 1 ? "horário marcado" : "horários marcados"} · primeiro às{" "}
                    <b className="text-texto">{formatarHora(ok.amanha[0].inicio)}</b> ({nomeDe(ok.amanha[0].clientes)})
                  </>
                )}
              </span>
            </Link>
          </Secao>

          <Secao titulo="Atalhos">
            <div className="grid grid-cols-2 gap-2.5">
              <button onClick={() => setRegistrando(true)} className="flex flex-col gap-2 rounded-[18px] bg-grafite p-3.5 text-left text-perola">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A88A68" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" />
                </svg>
                <span className="text-sm font-semibold">Registrar atendimento</span>
              </button>
              <Link href="/conversas" className="flex flex-col gap-2 rounded-[18px] bg-card p-3.5 text-texto">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#6E5539" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                </svg>
                <span className="text-sm font-semibold">Ver conversas</span>
              </Link>
            </div>
          </Secao>

          {ok.aniversariantes.length > 0 && (
            <Secao titulo="Aniversariantes da semana">
              {ok.aniversariantes.map((c) => {
                const ehHoje = c.dia === hojeNoSalao();
                const quando = ehHoje ? "hoje" : DIAS_SEMANA[new Date(`${c.dia}T12:00:00Z`).getUTCDay()];
                return (
                  <div key={c.id} className="flex items-center gap-3 rounded-[20px] bg-card px-3.5 py-3">
                    <Link href={`/clientes/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar id={c.id} nome={c.nome} tamanho="h-11 w-11 text-lg" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-[15px] font-semibold">{nomeDe(c)}</span>
                        <span className="text-[13px] text-texto-2">
                          {quando.charAt(0).toUpperCase() + quando.slice(1)} · enviar parabéns
                        </span>
                      </span>
                    </Link>
                    <BotaoWhatsApp
                      rotulo={`Mandar parabéns para ${nomeDe(c)}`}
                      aoTocar={() => abrirWhatsApp(c.telefone, `Feliz aniversário${c.nome ? `, ${primeiroNome(c.nome)}` : ""}! 🎉`)}
                    />
                  </div>
                );
              })}
            </Secao>
          )}
        </div>
      )}

      {registrando && (
        <FormAtendimento
          modo="registrar"
          aoFechar={() => setRegistrando(false)}
          aoSalvar={() => {
            setRegistrando(false);
            recarregar();
          }}
        />
      )}
    </>
  );
}

// Número grande com rótulo pequeno, para o resumo do dia
function Numero({ valor, rotulo, href }: { valor: number; rotulo: string; href?: string }) {
  const conteudo = (
    <>
      <span className="font-serif text-[30px] leading-none font-semibold">{valor}</span>
      <span className="text-xs leading-tight text-texto-2">{rotulo}</span>
    </>
  );
  const estilo = "flex flex-col gap-1 rounded-[18px] bg-card p-3";
  return href ? (
    <Link href={href} className={estilo}>
      {conteudo}
    </Link>
  ) : (
    <div className={estilo}>{conteudo}</div>
  );
}

function Seta() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6E5539" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function BotaoWhatsApp({ rotulo, aoTocar }: { rotulo: string; aoTocar: () => void }) {
  return (
    <button
      onClick={aoTocar}
      aria-label={rotulo}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-borda active:bg-campo"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3F5135" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
    </button>
  );
}
