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
  // Só os horários que ainda esperam a dona (status "agendado")
  hoje: Atendimento[];
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
  const [clientes, atendimentos, mensagensIa, marcadosIa, comAniversario] = await Promise.all([
    db
      .from("clientes_status")
      .select("id, nome, telefone, motivo_pausa, etiquetas")
      .eq("empresa_id", empresaId)
      .eq("ia_pausada", true)
      .in("motivo_pausa", Object.keys(MOTIVOS)),
    buscarAtendimentosDoDia(empresaId, hoje),
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

  return {
    precisam: (clientes.data ?? []).filter((c) => !estaExcluida(c.etiquetas)) as Precisa[],
    hoje: atendimentos.atendimentos.filter((a) => a.status === "agendado"),
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

// A próxima da fila: o primeiro horário a atender que ainda não terminou
function proximaCliente(hoje: Atendimento[]): Atendimento | null {
  const agora = Date.now();
  return hoje.find((a) => Date.parse(a.inicio) + minutosDe(a) * 60_000 > agora) ?? null;
}

function nomeDe(c: { nome: string | null; telefone: string } | null | undefined): string {
  return c?.nome ?? (c ? formatarTelefone(c.telefone) : "Cliente");
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="rotulo text-texto-2">{titulo}</h2>
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

  return (
    <>
      {/* Topo grafite: saudação, configurações e a próxima cliente */}
      <header className="relative -mt-[env(safe-area-inset-top)] flex flex-col gap-5 overflow-hidden rounded-b-[32px] bg-grafite px-5 pt-[calc(56px+env(safe-area-inset-top))] pb-7">
        <span aria-hidden="true" className="absolute -top-[110px] -right-[70px] h-60 w-60 rounded-full border-[1.5px] border-bronze/45" />
        <div className="relative flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <span className="text-xs tracking-[0.3em] text-claro uppercase">{saudacao(agoraNoSalao().hora)}</span>
            <h1 className="font-serif text-[30px] leading-tight font-semibold text-white">{empresa.nome}</h1>
          </div>
          <Link
            href="/configuracoes"
            aria-label="Configurações"
            className="relative flex h-11 w-11 items-center justify-center rounded-full border border-bronze/50"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EFE7DC" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
            {/* Ponto bronze quando alguém precisa da dona */}
            {ok && ok.precisam.length > 0 && <span aria-hidden className="absolute top-2 right-2.5 h-[7px] w-[7px] rounded-full bg-bronze" />}
          </Link>
        </div>

        {ok && (
          <Link
            href={proxima?.clientes ? `/clientes/${proxima.clientes.id}` : "/agenda"}
            className="relative flex flex-col gap-3.5 rounded-3xl bg-perola p-[18px] text-texto"
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-[0.25em] text-bronze-escuro uppercase">Próxima cliente</span>
              {proxima && <span className="rounded-full bg-grafite px-2.5 py-[5px] text-xs font-semibold text-perola">{quandoComeca(proxima)}</span>}
            </div>
            {proxima ? (
              <div className="flex items-center gap-3.5">
                <Avatar id={proxima.clientes?.id ?? proxima.id} nome={proxima.clientes?.nome ?? null} tamanho="h-[52px] w-[52px] text-[22px]" />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-serif text-[22px] font-semibold">{nomeDe(proxima.clientes)}</span>
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
        )}
      </header>

      {!resumo && <p className="p-5 text-texto-2">Carregando…</p>}
      {resumo && "erro" in resumo && <p className="m-5 rounded-2xl bg-rose p-4 text-rose-texto">Erro ao ler o banco: {resumo.erro}</p>}

      {ok && (
        <div className="flex flex-col gap-[22px] px-5 pt-[22px]">
          {/* Horários de hoje + o que a IA fez */}
          <Link href="/agenda" className="flex flex-col gap-1 rounded-[20px] bg-card px-[18px] py-3.5">
            <span className="flex items-center gap-3.5">
              <span className="font-serif text-4xl leading-none font-semibold">{ok.hoje.length}</span>
              <span className="text-sm text-texto-2">{ok.hoje.length === 1 ? "horário para atender hoje" : "horários para atender hoje"}</span>
            </span>
            {(ok.iaConversou > 0 || ok.iaMarcou > 0) && (
              <span className="text-[13px] text-texto-2">
                A IA conversou com {ok.iaConversou} {ok.iaConversou === 1 ? "cliente" : "clientes"} e marcou {ok.iaMarcou} hoje
              </span>
            )}
          </Link>

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

          <Secao titulo="Atalhos">
            <button onClick={() => setRegistrando(true)} className="flex items-center gap-3.5 rounded-[20px] bg-grafite p-4 text-left text-perola">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#A88A68" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" />
              </svg>
              <span className="text-[15px] font-semibold">Registrar atendimento</span>
            </button>
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
