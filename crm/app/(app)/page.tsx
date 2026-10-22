"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "@/components/Avatar";
import { FolhaConfirmar } from "@/components/FolhaConfirmar";
import { FormAtendimento } from "@/components/FormAtendimento";
import { LinhaDeslizante, type AcaoDeslizante } from "@/components/LinhaDeslizante";
import type { ServicoAtivo } from "@/components/MarcarVolta";
import { buscarAtendimentosDoDia, confirmarAtendimento, type Atendimento } from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { estaExcluida } from "@/lib/excluidas";
import { agoraNoSalao, formatarDiaLongo, formatarHora, formatarTelefone, hojeNoSalao, inicioDoDia, primeiroNome, somarDias } from "@/lib/formato";
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
  // Só uma linha deslizada por vez, como no iPhone
  const [linhaAberta, setLinhaAberta] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<Atendimento | null>(null);
  const [servicos, setServicos] = useState<ServicoAtivo[]>([]);
  const { puxado, atualizando } = usePuxarParaAtualizar(async () => setResumo(await buscarResumo(empresa.id)));

  // Para a folha "Foi isso / Fez outra coisa" (a mesma do ✓ da Agenda)
  useEffect(() => {
    supabase()
      .from("servicos")
      .select("id, nome, dias_retorno, duracao_min")
      .eq("empresa_id", empresa.id)
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => setServicos((data ?? []) as ServicoAtivo[]));
  }, [empresa.id]);

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
      <IndicadorPuxar puxado={puxado} atualizando={atualizando} />
      <Topo
        titulo={saudacao(agoraNoSalao().hora)}
        subtitulo={empresa.nome}
        alerta={!!ok && ok.precisam.length > 0}
        aoRegistrar={() => setRegistrando(true)}
      />

      {!resumo && <p className="p-5 text-texto-2">Carregando…</p>}
      {resumo && "erro" in resumo && <p className="m-5 rounded-2xl bg-rose p-4 text-rose-texto">Erro ao ler o banco: {resumo.erro}</p>}

      {ok && (
        <div className="flex flex-col gap-[22px] px-5 pt-4">
          {/* O mais urgente primeiro, empilhado como as notificações do iPhone */}
          {ok.precisam.length > 0 && <PilhaPrecisam precisam={ok.precisam} />}

          {ok.hoje.length === 0 ? (
            <>
              {/* Dia livre: um cartão só, em vez de "ninguém hoje" repetido em três lugares */}
              <div className="flex flex-col gap-2.5">
                <Link
                  href="/agenda"
                  className="flex items-center gap-3.5 rounded-[22px] bg-card p-4 shadow-[0_10px_26px_rgba(30,23,20,0.08)] active:scale-[0.99]"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-ouro">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#7A5A1E" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                    </svg>
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-serif text-[21px] font-semibold">Dia livre hoje</span>
                    <span className="text-[13px] text-texto-2">Nenhum horário marcado. Se a IA marcar alguém, aparece aqui.</span>
                  </span>
                  <Seta />
                </Link>
                <NumerosDoDia paraAtender={paraAtender} iaConversou={ok.iaConversou} iaMarcou={ok.iaMarcou} />
              </div>

              {/* Num dia parado, o que importa é o dia seguinte: a lista de amanhã já aberta */}
              <Secao titulo={`Amanhã · ${diaDaSemana(somarDias(hojeNoSalao(), 1))}`} extra={<LinkAgenda />}>
                {ok.amanha.length === 0 ? (
                  <p className="rounded-[22px] bg-card p-4 text-[15px] text-texto-2">Nenhum horário marcado amanhã ainda.</p>
                ) : (
                  <ListaHorarios atendimentos={ok.amanha} linhaAberta={linhaAberta} aoAbrirLinha={setLinhaAberta} />
                )}
              </Secao>
            </>
          ) : (
            <>
              {/* Próxima cliente, como um widget, com os números do dia em cápsulas logo abaixo */}
              <div className="flex flex-col gap-2.5">
                <Link
                  href={proxima?.clientes ? `/clientes/${proxima.clientes.id}` : "/agenda"}
                  className="flex flex-col gap-3 rounded-[22px] bg-card p-4 shadow-[0_10px_26px_rgba(30,23,20,0.08)] active:scale-[0.99]"
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
                <NumerosDoDia paraAtender={paraAtender} iaConversou={ok.iaConversou} iaMarcou={ok.iaMarcou} />
              </div>

              {/* A lista do dia, com a situação de cada horário e amanhã no rodapé */}
              <Secao titulo="Hoje" extra={<LinkAgenda />}>
                <ListaHorarios
                  atendimentos={ok.hoje}
                  linhaAberta={linhaAberta}
                  aoAbrirLinha={setLinhaAberta}
                  aoConcluir={setConfirmando}
                  comSelo
                />
                {/* Rodapé da lista, como nos Ajustes do iPhone */}
                <Link href="/agenda" className="flex items-center justify-between gap-2 px-3.5 text-[13px] text-texto-2">
                  <span className="min-w-0">
                    <b className="font-semibold text-texto">Amanhã:</b>{" "}
                    {ok.amanha.length === 0 ? (
                      "nenhum horário marcado ainda"
                    ) : (
                      <>
                        {ok.amanha.length} {ok.amanha.length === 1 ? "horário" : "horários"} · primeiro às {formatarHora(ok.amanha[0].inicio)} ({nomeDe(ok.amanha[0].clientes)})
                      </>
                    )}
                  </span>
                  <Seta pequena />
                </Link>
              </Secao>
            </>
          )}

          {ok.aniversariantes.length > 0 && <Aniversarios lista={ok.aniversariantes} />}
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

      {confirmando && (
        <FolhaConfirmar
          atendimento={confirmando}
          servicos={servicos}
          aoConfirmar={async (ids) => {
            const erro = await confirmarAtendimento(empresa.id, confirmando, ids);
            if (!erro) recarregar();
            return erro;
          }}
          aoFechar={() => setConfirmando(null)}
        />
      )}
    </>
  );
}

function LinkAgenda() {
  return (
    <Link href="/agenda" className="text-[13px] font-semibold text-bronze-escuro">
      Ver agenda
    </Link>
  );
}

// "2026-10-23" -> "sexta"
function diaDaSemana(data: string): string {
  return DIAS_SEMANA[new Date(`${data}T12:00:00Z`).getUTCDay()];
}

// Lista de horários (hoje ou amanhã). Toque abre a ficha; deslizar mostra os atalhos.
// Sem aoConcluir (amanhã) não aparece o ✓ Concluído, só o WhatsApp.
function ListaHorarios({
  atendimentos,
  linhaAberta,
  aoAbrirLinha,
  aoConcluir,
  comSelo,
}: {
  atendimentos: Atendimento[];
  linhaAberta: string | null;
  aoAbrirLinha: (id: string | null) => void;
  aoConcluir?: (a: Atendimento) => void;
  comSelo?: boolean;
}) {
  const router = useRouter();
  return (
    <ul className="overflow-hidden rounded-[22px] bg-card">
      {atendimentos.map((a, i) => {
        const s = selo(a);
        return (
          <li key={a.id} className={i > 0 ? "border-t border-borda" : ""}>
            <LinhaDeslizante
              aberta={linhaAberta === a.id}
              aoAbrir={(sim) => aoAbrirLinha(sim ? a.id : null)}
              aoTocar={() => router.push(a.clientes ? `/clientes/${a.clientes.id}` : "/agenda")}
              acoes={acoesDoHorario(a, aoConcluir && (() => aoConcluir(a)))}
              className="gap-3 bg-card px-3.5 py-3 active:bg-campo"
            >
              <span className="w-11 shrink-0 text-sm font-bold text-rotulo">{formatarHora(a.inicio)}</span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{nomeDe(a.clientes)}</span>
                <span className="truncate text-[13px] text-texto-2">{a.servicos?.nome ?? "Serviço não informado"}</span>
              </span>
              {comSelo && <span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-bold whitespace-nowrap ${s.classe}`}>{s.rotulo}</span>}
            </LinhaDeslizante>
          </li>
        );
      })}
    </ul>
  );
}

// Os números do dia em cápsulas; zero não aparece (e sem nenhum, a linha some)
function NumerosDoDia({ paraAtender, iaConversou, iaMarcou }: { paraAtender: number; iaConversou: number; iaMarcou: number }) {
  const itens = [
    { valor: paraAtender, rotulo: "a atender", href: "/agenda" },
    { valor: iaConversou, rotulo: iaConversou === 1 ? "conversa da IA" : "conversas da IA", href: "/conversas" },
    { valor: iaMarcou, rotulo: iaMarcou === 1 ? "marcado pela IA" : "marcados pela IA" },
  ].filter((n) => n.valor > 0);
  if (!itens.length) return null;
  return (
    // Numa linha só; em tela estreita desliza para o lado, como os filtros do iPhone
    <div className="sem-barra -mx-5 flex gap-1.5 overflow-x-auto px-5">
      {itens.map((n) => (
        <Capsula key={n.rotulo} {...n} />
      ))}
    </div>
  );
}

// Atalhos atrás de um horário da lista
function acoesDoHorario(a: Atendimento, aoConcluir?: () => void): AcaoDeslizante[] {
  const acoes: AcaoDeslizante[] = [];
  if (aoConcluir && a.status === "agendado") {
    acoes.push({
      rotulo: "Concluído",
      cor: "bg-[#5E7A50]",
      aoTocar: aoConcluir,
      icone: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m5 12 5 5L20 7" />
        </svg>
      ),
    });
  }
  const cliente = a.clientes;
  if (cliente) {
    acoes.push({
      rotulo: "WhatsApp",
      cor: "bg-salvia-texto",
      aoTocar: () => abrirWhatsApp(cliente.telefone),
      icone: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
      ),
    });
  }
  return acoes;
}

const LIMITE_PUXAR = 64;

// Puxar para atualizar, como no Mail: com a tela no topo, arrastar para baixo recarrega.
// No app instalado no iPhone não existe o do navegador, então fazemos o nosso.
function usePuxarParaAtualizar(aoAtualizar: () => Promise<unknown>) {
  const [puxado, setPuxado] = useState(0);
  const [atualizando, setAtualizando] = useState(false);
  const atual = useRef(aoAtualizar);

  useEffect(() => {
    atual.current = aoAtualizar;
  });

  useEffect(() => {
    let inicio: number | null = null;
    let distancia = 0;
    let ocupado = false;
    // Evita o "puxar" do próprio navegador (Android) disputar com o nosso
    const html = document.documentElement;
    const antes = html.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "contain";

    function comecar(e: TouchEvent) {
      // Dentro de uma folha aberta (registrar, confirmar) o arrasto é da folha
      const naFolha = e.target instanceof Element && e.target.closest("[role=dialog]");
      inicio = window.scrollY <= 0 && !ocupado && !naFolha ? e.touches[0].clientY : null;
    }
    function mover(e: TouchEvent) {
      if (inicio === null) return;
      const dy = e.touches[0].clientY - inicio;
      distancia = dy > 0 ? Math.min(dy * 0.5, LIMITE_PUXAR + 30) : 0;
      setPuxado(distancia);
    }
    async function soltar() {
      if (inicio === null) return;
      inicio = null;
      const passou = distancia >= LIMITE_PUXAR;
      distancia = 0;
      setPuxado(0);
      if (!passou) return;
      ocupado = true;
      setAtualizando(true);
      await atual.current();
      ocupado = false;
      setAtualizando(false);
    }

    window.addEventListener("touchstart", comecar, { passive: true });
    window.addEventListener("touchmove", mover, { passive: true });
    window.addEventListener("touchend", soltar);
    return () => {
      window.removeEventListener("touchstart", comecar);
      window.removeEventListener("touchmove", mover);
      window.removeEventListener("touchend", soltar);
      html.style.overscrollBehaviorY = antes;
    };
  }, []);

  return { puxado, atualizando };
}

// A rodinha que aparece no topo ao puxar: gira conforme o dedo desce e fica girando enquanto atualiza
function IndicadorPuxar({ puxado, atualizando }: { puxado: number; atualizando: boolean }) {
  const altura = atualizando ? 52 : puxado;
  return (
    <div
      aria-live="polite"
      className={`flex items-end justify-center overflow-hidden ${puxado ? "" : "transition-[height] duration-200"}`}
      style={{ height: altura }}
    >
      {atualizando && <span className="sr-only">Atualizando…</span>}
      <svg
        width="26"
        height="26"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#6E5539"
        strokeWidth={2.2}
        strokeLinecap="round"
        aria-hidden
        className={`mb-3 ${atualizando ? "animate-spin" : ""}`}
        style={atualizando ? undefined : { transform: `rotate(${(puxado / LIMITE_PUXAR) * 270}deg)`, opacity: Math.min(1, puxado / LIMITE_PUXAR) }}
      >
        <path d="M21 12a9 9 0 1 1-6.2-8.6" />
      </svg>
    </div>
  );
}

// Título grande como no iPhone (Mail, Saúde, App Store): data, saudação e nome do salão.
// Ao rolar, o título sai de cena e uma barra de vidro com a saudação pequena aparece no topo.
function Topo({ titulo, subtitulo, alerta, aoRegistrar }: { titulo: string; subtitulo: string; alerta: boolean; aoRegistrar: () => void }) {
  const marco = useRef<HTMLDivElement>(null);
  const [encolhido, setEncolhido] = useState(false);

  useEffect(() => {
    const el = marco.current;
    if (!el) return;
    const observador = new IntersectionObserver(([e]) => setEncolhido(!e.isIntersecting));
    observador.observe(el);
    return () => observador.disconnect();
  }, []);

  return (
    <>
      <div
        inert={!encolhido}
        className={`vidro-barra fixed inset-x-0 top-0 z-20 pt-[env(safe-area-inset-top)] transition-opacity duration-200 ${
          encolhido ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="mx-auto flex h-[52px] max-w-xl items-center justify-between gap-3 px-5">
          {/* Mesma largura das bolhas da direita, para o título ficar no centro */}
          <span className="w-[80px] shrink-0" aria-hidden />
          <span className="truncate text-[17px] font-semibold">{titulo}</span>
          <div className="flex w-[80px] shrink-0 justify-end gap-2">
            <BolhaRegistrar aoTocar={aoRegistrar} pequena />
            <BolhaConfiguracoes alerta={alerta} pequena />
          </div>
        </div>
      </div>

      <header className="flex items-end justify-between gap-3 px-5 pt-6">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold tracking-wide text-texto-2 uppercase">{formatarDiaLongo(hojeNoSalao())}</span>
          <h1 className="font-serif text-[34px] leading-tight font-semibold">{titulo}</h1>
          <span className="truncate text-sm text-texto-2">{subtitulo}</span>
          {/* Quando este ponto sai da tela, o topo encolhe */}
          <div ref={marco} aria-hidden className="h-px" />
        </div>
        <div className="mb-5 flex gap-2">
          <BolhaRegistrar aoTocar={aoRegistrar} />
          <BolhaConfiguracoes alerta={alerta} />
        </div>
      </header>
    </>
  );
}

// Engrenagem numa bolha de vidro, com ponto bronze quando alguém precisa da dona
function BolhaConfiguracoes({ alerta, pequena }: { alerta: boolean; pequena?: boolean }) {
  return (
    <Link
      href="/configuracoes"
      aria-label={alerta ? "Configurações (alguém precisa de você)" : "Configurações"}
      className={`vidro relative flex shrink-0 items-center justify-center rounded-full active:scale-95 ${pequena ? "h-9 w-9" : "h-11 w-11"}`}
    >
      <svg width={pequena ? 17 : 20} height={pequena ? 17 : 20} viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
      {alerta && <span aria-hidden className={`absolute rounded-full bg-bronze ${pequena ? "top-1.5 right-1.5 h-[6px] w-[6px]" : "top-2 right-2 h-[7px] w-[7px]"}`} />}
    </Link>
  );
}

// "+" numa bolha de vidro, como no Calendário e nos Contatos: registrar atendimento
function BolhaRegistrar({ aoTocar, pequena }: { aoTocar: () => void; pequena?: boolean }) {
  return (
    <button
      onClick={aoTocar}
      aria-label="Registrar atendimento"
      className={`vidro flex shrink-0 items-center justify-center rounded-full active:scale-95 ${pequena ? "h-9 w-9" : "h-11 w-11"}`}
    >
      <svg width={pequena ? 18 : 21} height={pequena ? 18 : 21} viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth={2} strokeLinecap="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

// Quem precisa da dona, empilhado como as notificações da tela de bloqueio:
// com mais de uma, aparece só a primeira com as outras "atrás"; um toque abre a pilha.
function PilhaPrecisam({ precisam }: { precisam: Precisa[] }) {
  const [aberta, setAberta] = useState(false);
  const empilhada = precisam.length > 1 && !aberta;
  const [primeira] = precisam;

  return (
    <Secao
      titulo={`Precisam de você · ${precisam.length}`}
      extra={
        precisam.length > 1 && aberta ? (
          <button onClick={() => setAberta(false)} className="text-[13px] font-semibold text-bronze-escuro">
            Mostrar menos
          </button>
        ) : undefined
      }
    >
      {empilhada ? (
        <button onClick={() => setAberta(true)} aria-label={`Ver as ${precisam.length} clientes que precisam de você`} className="relative pb-3 text-left active:scale-[0.99]">
          {/* Cartões "atrás", mais estreitos, como na pilha do iPhone */}
          <span aria-hidden className="absolute inset-x-4 bottom-0 h-6 rounded-b-[20px] bg-card/50" />
          {precisam.length > 2 && <span aria-hidden className="absolute inset-x-2 bottom-1.5 h-6 rounded-b-[20px] bg-card/75" />}
          <span className="relative flex items-center gap-3 rounded-[20px] bg-card px-3.5 py-3 shadow-[0_6px_18px_rgba(30,23,20,0.08)]">
            <Avatar id={primeira.id} nome={primeira.nome} tamanho="h-11 w-11 text-lg" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[15px] font-semibold">{nomeDe(primeira)}</span>
              <span className="truncate text-[13px] text-rose-texto">{MOTIVOS[primeira.motivo_pausa]}</span>
            </span>
            <span className="shrink-0 rounded-full bg-rose px-2.5 py-1 text-xs font-bold text-rose-texto">+{precisam.length - 1}</span>
          </span>
        </button>
      ) : (
        precisam.map((c) => (
          <div key={c.id} className="flex items-center gap-3 rounded-[20px] bg-card px-3.5 py-3 shadow-[0_6px_18px_rgba(30,23,20,0.08)]">
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
        ))
      )}
    </Secao>
  );
}

// Número do dia numa cápsula pequena: "3 conversas da IA"
function Capsula({ valor, rotulo, href }: { valor: number; rotulo: string; href?: string }) {
  const conteudo = (
    <>
      <b className="font-serif text-[17px] leading-none font-semibold">{valor}</b>
      <span>{rotulo}</span>
    </>
  );
  const estilo = "flex shrink-0 items-baseline gap-1 rounded-full bg-card px-2.5 py-1.5 text-[12px] whitespace-nowrap text-texto-2";
  return href ? (
    <Link href={href} className={`${estilo} active:bg-campo`}>
      {conteudo}
    </Link>
  ) : (
    <span className={estilo}>{conteudo}</span>
  );
}

// Aniversários numa linha só; quem faz hoje aparece no resumo. Um toque abre a lista.
function Aniversarios({ lista }: { lista: Aniversariante[] }) {
  const [aberta, setAberta] = useState(false);
  const deHoje = lista.filter((c) => c.dia === hojeNoSalao());
  const resumo = deHoje.length
    ? `Hoje: ${deHoje.map((c) => primeiroNome(c.nome) || nomeDe(c)).join(", ")}${lista.length > deHoje.length ? ` · +${lista.length - deHoje.length} na semana` : ""}`
    : `${lista.length} ${lista.length === 1 ? "aniversário" : "aniversários"} esta semana`;

  return (
    <section className="flex flex-col gap-2.5">
      <button
        onClick={() => setAberta((a) => !a)}
        aria-expanded={aberta}
        className={`flex items-center gap-3 rounded-[20px] px-3.5 py-3 text-left ${deHoje.length ? "bg-ouro" : "bg-card"}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={deHoje.length ? "#7A5A1E" : "#6E5539"} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <rect x="3" y="8" width="18" height="4" rx="1" />
          <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
        </svg>
        <span className={`min-w-0 flex-1 truncate text-[15px] font-semibold ${deHoje.length ? "text-ouro-texto" : ""}`}>{resumo}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6E5539" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition-transform ${aberta ? "rotate-90" : ""}`}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {aberta && (
        <ul className="rounded-[20px] bg-card">
          {lista.map((c, i) => {
            const ehHoje = c.dia === hojeNoSalao();
            const quando = ehHoje ? "hoje" : DIAS_SEMANA[new Date(`${c.dia}T12:00:00Z`).getUTCDay()];
            return (
              <li key={c.id} className={`flex items-center gap-3 px-3.5 py-3 ${i > 0 ? "border-t border-borda" : ""}`}>
                <Link href={`/clientes/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar id={c.id} nome={c.nome} tamanho="h-10 w-10 text-base" />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-[15px] font-semibold">{nomeDe(c)}</span>
                    <span className="text-[13px] text-texto-2">{quando.charAt(0).toUpperCase() + quando.slice(1)}</span>
                  </span>
                </Link>
                <BotaoWhatsApp
                  rotulo={`Mandar parabéns para ${nomeDe(c)}`}
                  aoTocar={() => abrirWhatsApp(c.telefone, `Feliz aniversário${c.nome ? `, ${primeiroNome(c.nome)}` : ""}! 🎉`)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Seta({ pequena }: { pequena?: boolean }) {
  return (
    <svg width={pequena ? 16 : 20} height={pequena ? 16 : 20} viewBox="0 0 24 24" fill="none" stroke="#6E5539" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
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
