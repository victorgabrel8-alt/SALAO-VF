"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { dataNoSalao, diasEntre, formatarData, formatarHora, formatarTelefone, hojeNoSalao, prazo } from "@/lib/formato";
import { useDialogo } from "@/components/Dialogo";
import { estaExcluida, excluirCliente, restaurarCliente, textoExclusao } from "@/lib/excluidas";
import { etiquetasDoSistema, etiquetasVisiveis, lerOrigem, trocarOrigem } from "@/lib/origem";
import { Etiquetas } from "@/components/Etiquetas";
import { STATUS, PontoStatus } from "@/lib/status";
import { RESULTADOS, buscarUltimaAvaliacao, type Avaliacao } from "@/lib/avaliacoes";
import { supabase } from "@/lib/supabase/client";
import type { ClienteStatus, RetornoServico } from "@/lib/tipos";
import { abrirWhatsApp } from "@/lib/whatsapp";

// Ficha enxuta da dona: contato, próximo horário, preferências, retornos e histórico.
// Origem, linha do tempo e IA ficam no CRM da agência (painel-crm).
type Horario = {
  id: string;
  inicio: string;
  valor: number | null;
  servicos: { nome: string } | null;
  profissionais: { nome: string } | null;
};

type Ficha = {
  cliente: ClienteStatus;
  retornos: RetornoServico[];
  proximo: Horario | null;
  historico: Horario[];
  avaliacao: Avaliacao | null;
};

const ETIQUETAS_SUGERIDAS = ["vip", "alergia", "mega hair", "coloração", "química", "gestante"];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

async function buscarFicha(id: string): Promise<Ficha | { erro: string }> {
  const db = supabase();
  const campos = "id, inicio, valor, servicos (nome), profissionais (nome)";
  const [cliente, retornos, proximo, historico, avaliacao] = await Promise.all([
    db.from("clientes_status").select("*").eq("id", id).maybeSingle(),
    db.from("retornos_por_servico").select("servico_id, servico_nome, ultima_vez, retorno_previsto").eq("cliente_id", id),
    db
      .from("agendamentos")
      .select(campos)
      .eq("cliente_id", id)
      .eq("status", "agendado")
      .gt("inicio", new Date().toISOString())
      .order("inicio")
      .limit(1)
      .maybeSingle(),
    db.from("agendamentos").select(campos).eq("cliente_id", id).eq("status", "realizado").order("inicio", { ascending: false }).limit(10),
    buscarUltimaAvaliacao(id),
  ]);
  const falha = [cliente, retornos, proximo, historico].find((r) => r.error);
  if (falha?.error) return { erro: falha.error.message };
  if (!cliente.data) return { erro: "Cliente não encontrada." };
  return {
    cliente: cliente.data as ClienteStatus,
    retornos: retornos.data as RetornoServico[],
    proximo: proximo.data as unknown as Horario | null,
    historico: historico.data as unknown as Horario[],
    avaliacao,
  };
}

function iniciais(nome: string | null): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return (partes[0][0] + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase();
}

function dinheiro(valor: number): string {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function FichaClientePage() {
  return (
    <Suspense fallback={<p className="p-5 text-texto-2">Carregando…</p>}>
      <FichaCliente />
    </Suspense>
  );
}

function FichaCliente() {
  const { id } = useParams<{ id: string }>();
  const [resultado, setResultado] = useState<Ficha | { erro: string } | null>(null);
  // Muda a cada salvamento para buscar a ficha de novo
  const [versao, setVersao] = useState(0);
  // Tocar no cartão Preferências abre a edição (nome, observações, etiquetas e excluir)
  const [editando, setEditando] = useState(false);
  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    let ativo = true;
    buscarFicha(id).then((r) => {
      if (ativo) setResultado(r);
    });
    return () => {
      ativo = false;
    };
  }, [id, versao]);

  if (!resultado) return <p className="p-5 text-texto-2">Carregando…</p>;
  if ("erro" in resultado) return <p className="m-5 rounded-2xl bg-rose p-4 text-rose-texto">{resultado.erro}</p>;
  const ficha = resultado;

  return (
    <div className="pb-4">
      <Topo cliente={ficha.cliente} />
      <Contato cliente={ficha.cliente} />

      <div className="flex flex-col gap-4 px-5 pt-5">
        {/* A edição abre e fecha deslizando; salvou, ela se recolhe sozinha */}
        <Recolhivel aberto={editando}>
          {/* key: se uma etiqueta for tirada, o formulário recomeça com as etiquetas certas */}
          <Dados
            key={ficha.cliente.etiquetas.join("|")}
            cliente={ficha.cliente}
            aoSalvar={recarregar}
            aoConcluir={() => setEditando(false)}
          />
          <Exclusao cliente={ficha.cliente} aoMudar={recarregar} />
        </Recolhivel>
        {ficha.proximo && <ProximoHorario horario={ficha.proximo} />}
        {ficha.avaliacao && <OQueEla avaliacao={ficha.avaliacao} />}
        <Preferencias cliente={ficha.cliente} aoMudar={recarregar} aoEditar={() => setEditando(true)} />
        <Retornos retornos={ficha.retornos} />
        <Historico historico={ficha.historico} />
      </div>
    </div>
  );
}

// O que a IA anotou na conversa (pré-avaliação) e, se já teve, o resultado da avaliação
function OQueEla({ avaliacao: a }: { avaliacao: Avaliacao }) {
  const sim = (v: boolean | null) => (v === null ? null : v ? "sim" : "não");
  const linhas: [string, string | null][] = [
    ["Cabelo hoje", a.pre_comprimento_atual],
    ["Quer chegar em", a.pre_comprimento_desejado],
    ["Cor", a.pre_cor],
    ["Já usa mega hair", sim(a.pre_usa_mega)],
    ["Técnica atual", a.pre_tecnica_atual],
    ["Química recente", a.pre_quimica_recente],
    ["Técnica de interesse", a.pre_tecnica_interesse],
    ["Orçamento", a.pre_orcamento],
    ["Ocasião", [a.pre_ocasiao, a.pre_data_ocasiao && formatarData(a.pre_data_ocasiao)].filter(Boolean).join(" · ") || null],
  ];
  const preenchidas = linhas.filter((l): l is [string, string] => !!l[1]);
  const resultado = RESULTADOS.find((r) => r.chave === a.resultado)?.rotulo;
  if (!a.pre_resumo && preenchidas.length === 0 && !resultado) return null;
  return (
    <Cartao titulo="O que ela quer">
      {resultado && (
        <span className="w-fit rounded-full bg-areia px-2.5 py-1 text-xs font-bold text-bronze-escuro">Avaliação: {resultado}</span>
      )}
      {a.pre_resumo && <p className="text-[15px] leading-normal">{a.pre_resumo}</p>}
      {preenchidas.length > 0 && (
        <dl className="divide-y divide-borda">
          {preenchidas.map(([rotulo, valor]) => (
            <div key={rotulo} className="flex justify-between gap-4 py-2 text-sm">
              <dt className="text-texto-2">{rotulo}</dt>
              <dd className="text-right font-medium">{valor}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="text-xs text-texto-2">Anotado pela IA na conversa{a.proximo_passo ? ` · próximo passo: ${a.proximo_passo}` : ""}</p>
    </Cartao>
  );
}

// Abre crescendo e fecha encolhendo (a altura anima pelo grid 0fr -> 1fr), e o que vem abaixo
// desliza junto em vez de pular. Fechado, sai da página depois da animação.
function Recolhivel({ aberto, children }: { aberto: boolean; children: ReactNode }) {
  const [montado, setMontado] = useState(aberto);
  const [visivel, setVisivel] = useState(aberto);
  // Abriu: monta já (fechado), e o efeito abaixo abre no quadro seguinte
  if (aberto && !montado) setMontado(true);

  useEffect(() => {
    if (aberto) {
      const abrir = setTimeout(() => setVisivel(true), 20);
      return () => clearTimeout(abrir);
    }
    const fechar = setTimeout(() => setVisivel(false), 0);
    const fim = setTimeout(() => setMontado(false), 450);
    return () => {
      clearTimeout(fechar);
      clearTimeout(fim);
    };
  }, [aberto]);

  if (!montado) return null;
  return (
    <div
      className={`grid transition-[grid-template-rows,opacity] duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        visivel ? "grid-rows-[1fr] opacity-100" : "-mb-4 grid-rows-[0fr] opacity-0"
      }`}
    >
      <div
        className={`flex min-h-0 flex-col gap-4 overflow-hidden transition-transform duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
          visivel ? "translate-y-0 scale-100" : "-translate-y-3 scale-[0.98]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function Cartao({ titulo, children }: { titulo?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[22px] bg-card p-[18px]">
      {titulo && <h2 className="font-serif text-[21px] font-semibold">{titulo}</h2>}
      {children}
    </section>
  );
}

// Topo grafite compacto: voltar em cima; iniciais ao lado do nome, "cliente desde" e a situação
// (como o cartão de contato do iPhone, sem ocupar meia tela). Editar é tocando em Preferências.
// Sem "Pausar IA" aqui: cuidar da IA não é tarefa da dona (fica no CRM da agência)
function Topo({ cliente }: { cliente: ClienteStatus }) {
  const router = useRouter();
  // Mês e ano no fuso do salão (no fuso do aparelho, quem chegou no dia 1º às 23h podia virar o mês anterior)
  const [anoDesde, mesDesde] = dataNoSalao(cliente.criado_em).split("-").map(Number);
  const status = STATUS[cliente.status];

  return (
    <header className="relative -mt-[env(safe-area-inset-top)] flex flex-col gap-4 overflow-clip rounded-b-[32px] bg-grafite px-5 pt-[calc(16px+env(safe-area-inset-top))] pb-[60px]">
      <span aria-hidden="true" className="pointer-events-none absolute -top-24 -right-16 h-[200px] w-[200px] rounded-full bg-[radial-gradient(circle,rgb(168_138_104/0.24),transparent_68%)]" />
      <span aria-hidden="true" className="pointer-events-none absolute -top-[70px] -right-[40px] h-40 w-40 rounded-full border border-bronze/35" />
      {/* Sem aba de clientes neste app: a ficha abre pela Agenda, Início ou Conversas */}
      <button
        onClick={() => router.back()}
        aria-label="Voltar"
        className="relative flex h-10 w-10 items-center justify-center rounded-[14px] bg-white/[0.16] active:scale-95"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
      <div className="relative flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-card font-serif text-[26px] font-semibold text-taupe-texto shadow-[0_10px_24px_rgba(0,0,0,0.3)]">
          {iniciais(cliente.nome)}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="truncate font-serif text-[26px] leading-tight font-semibold text-white">{cliente.nome ?? "Sem nome"}</h1>
          <span className="text-[13px] text-areia">
            Cliente desde {MESES_CURTOS[mesDesde - 1]}/{anoDesde} · {cliente.total_visitas}{" "}
            {cliente.total_visitas === 1 ? "visita" : "visitas"}
          </span>
          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-bronze/40 px-2.5 py-0.5 text-[12px] font-medium text-perola">
              <PontoStatus cor={status.ponto} />
              {status.rotulo}
            </span>
            {cliente.ia_pausada && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-bronze/40 px-2.5 py-0.5 text-[12px] font-medium text-perola">
                <PontoStatus cor="bg-bronze" />
                IA pausada
              </span>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}

// WhatsApp e Ligar, sobrepostos ao fim do topo
function Contato({ cliente }: { cliente: ClienteStatus }) {
  const estilo =
    "flex flex-col items-center gap-1.5 rounded-[20px] bg-card px-2 py-3.5 text-[13px] font-bold text-texto shadow-[0_10px_26px_rgba(30,23,20,0.12)] active:bg-campo";
  return (
    <div className="relative mx-5 -mt-9 grid grid-cols-2 gap-2.5">
      <button onClick={() => abrirWhatsApp(cliente.telefone)} className={estilo}>
        <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-salvia">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3F5135" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
        </span>
        WhatsApp
      </button>
      <a href={`tel:+${cliente.telefone}`} className={estilo}>
        <span className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-[#E2E6EA]">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#36485A" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92Z" />
          </svg>
        </span>
        Ligar
      </a>
      <p className="col-span-2 text-center text-sm text-texto-2">{formatarTelefone(cliente.telefone)}</p>
    </div>
  );
}

function ProximoHorario({ horario: h }: { horario: Horario }) {
  const data = formatarData(h.inicio);
  return (
    <section className="flex items-center gap-3.5 rounded-[22px] bg-grafite p-[18px] text-white">
      <div className="flex h-[60px] w-14 shrink-0 flex-col items-center justify-center rounded-2xl bg-bronze text-grafite">
        <span className="text-[11px] font-bold uppercase">{MESES_CURTOS[Number(data.slice(3, 5)) - 1]}</span>
        <span className="font-serif text-[28px] leading-none font-semibold">{data.slice(0, 2)}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-xs font-semibold tracking-[0.06em] text-bronze uppercase">Próximo horário</span>
        <span className="truncate text-base font-bold">{h.servicos?.nome ?? "Serviço não informado"}</span>
        <span className="text-[13px] text-[#C7BBAC]">
          {formatarHora(h.inicio)}
          {h.profissionais && ` · com ${h.profissionais.nome}`}
        </span>
      </div>
    </section>
  );
}

function Preferencias({ cliente, aoMudar, aoEditar }: { cliente: ClienteStatus; aoMudar: () => void; aoEditar: () => void }) {
  async function removerEtiqueta(etiqueta: string) {
    await supabase()
      .from("clientes")
      .update({ etiquetas: cliente.etiquetas.filter((e) => e !== etiqueta) })
      .eq("id", cliente.id);
    aoMudar();
  }

  const temEtiqueta = etiquetasVisiveis(cliente.etiquetas).length > 0;
  // O cartão inteiro abre a edição (nome, observações, etiquetas). O × das etiquetas continua
  // tirando só a etiqueta, sem abrir nada.
  function tocar(e: MouseEvent<HTMLElement>) {
    if ((e.target as HTMLElement).closest("button")) return;
    aoEditar();
  }
  return (
    <section
      role="button"
      tabIndex={0}
      onClick={tocar}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && aoEditar()}
      aria-label="Editar preferências"
      className="flex cursor-pointer flex-col gap-3 rounded-[22px] bg-card p-[18px] transition-transform duration-150 active:scale-[0.99] active:bg-campo/60"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[21px] font-semibold">Preferências</h2>
        <span className="flex items-center gap-0.5 text-sm font-semibold text-bronze-escuro">
          Editar
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </span>
      </div>
      <Etiquetas etiquetas={cliente.etiquetas} aoRemover={removerEtiqueta} className="" />
      {cliente.observacoes ? (
        <p className="text-sm leading-normal whitespace-pre-line text-rotulo">{cliente.observacoes}</p>
      ) : (
        <p className="text-sm text-texto-2">{temEtiqueta ? "Toque para escrever observações." : "Sem preferências anotadas. Toque para escrever."}</p>
      )}
    </section>
  );
}

// Cada procedimento tem o seu prazo de retorno (servicos.dias_retorno). O banco calcula o
// retorno previsto quando o atendimento é marcado como realizado.
function Retornos({ retornos }: { retornos: RetornoServico[] }) {
  const hoje = hojeNoSalao();
  const ordenados = [...retornos].sort((a, b) => {
    if (!a.retorno_previsto) return 1;
    if (!b.retorno_previsto) return -1;
    return a.retorno_previsto.localeCompare(b.retorno_previsto);
  });
  if (ordenados.length === 0) return null;

  return (
    <Cartao titulo="Retornos">
      <ul className="flex flex-col gap-3">
        {ordenados.map((r) => {
          const dias = r.retorno_previsto ? diasEntre(hoje, r.retorno_previsto) : null;
          const ponto = dias === null ? "bg-borda" : dias < 0 ? "bg-rose-texto" : dias <= 7 ? "bg-bronze" : "bg-[#5E7A50]";
          return (
            <li key={r.servico_id} className="flex gap-3">
              <PontoStatus cor={`${ponto} mt-[7px]`} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-bold">{r.servico_nome}</span>
                <span className={`text-[13px] ${dias !== null && dias < 0 ? "font-semibold text-rose-texto" : "text-texto-2"}`}>
                  {r.retorno_previsto ? `Voltar ${formatarData(r.retorno_previsto).slice(0, 5)} (${prazo(r.retorno_previsto)})` : "Sem retorno programado"}
                  {" · última vez "}
                  {formatarData(r.ultima_vez).slice(0, 5)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </Cartao>
  );
}

function Historico({ historico }: { historico: Horario[] }) {
  return (
    <Cartao titulo="Histórico">
      {historico.length === 0 ? (
        <p className="text-sm text-texto-2">Nenhum atendimento realizado ainda.</p>
      ) : (
        <ul className="flex flex-col gap-3.5">
          {historico.map((h, i) => (
            <li key={h.id} className="flex gap-3">
              <span aria-hidden="true" className={`mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full ${i === 0 ? "bg-grafite" : "bg-bronze"}`} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-[15px] font-bold">{h.servicos?.nome ?? "Serviço não informado"}</span>
                <span className="text-[13px] text-texto-2">
                  {formatarData(h.inicio)}
                  {h.valor !== null && ` · ${dinheiro(h.valor)}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function Dados({ cliente, aoSalvar, aoConcluir }: { cliente: ClienteStatus; aoSalvar: () => void; aoConcluir: () => void }) {
  const [nome, setNome] = useState(cliente.nome ?? "");
  const [observacoes, setObservacoes] = useState(cliente.observacoes ?? "");
  // A origem não aparece aqui (é do CRM), mas continua guardada ao salvar
  const origem = lerOrigem(cliente.etiquetas);
  const [etiquetas, setEtiquetas] = useState(etiquetasVisiveis(cliente.etiquetas));
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);

  function alternarEtiqueta(etiqueta: string) {
    setEtiquetas((atuais) => (atuais.includes(etiqueta) ? atuais.filter((e) => e !== etiqueta) : [...atuais, etiqueta]));
  }

  // A etiqueta escrita em "Nova etiqueta" entra ao tocar em Salvar e aparece em Preferências
  // (com × para tirar), não na lista de opções abaixo.
  async function salvar() {
    setSalvando(true);
    setAviso("");
    const nova = novaEtiqueta.trim().toLowerCase();
    const finais = nova && !etiquetas.includes(nova) ? [...etiquetas, nova] : etiquetas;
    const { error } = await supabase()
      .from("clientes")
      .update({
        nome: nome.trim() || null,
        observacoes: observacoes.trim() || null,
        // Mantém as etiquetas internas do app (ex.: cliente excluída)
        etiquetas: [...trocarOrigem(finais, origem), ...etiquetasDoSistema(cliente.etiquetas)],
      })
      .eq("id", cliente.id);
    setSalvando(false);
    if (error) {
      setAviso(`Não foi possível salvar: ${error.message}`);
      return;
    }
    setNovaEtiqueta("");
    // O botão fica verde com o ✓ se desenhando e, em seguida, a edição se recolhe
    setSalvo(true);
    navigator.vibrate?.(35);
    aoSalvar();
    setTimeout(aoConcluir, 900);
  }
  const campo = "h-[52px] w-full rounded-2xl bg-campo px-4 text-base outline-none focus:ring-2 focus:ring-bronze";

  return (
    <Cartao titulo="Editar dados">
      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-rotulo">Nome</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} />
      </label>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-rotulo">Observações</span>
        <textarea
          rows={4}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Alergias, fórmula da cor, método do mega hair, preferências…"
          className="w-full rounded-2xl bg-campo p-4 text-base outline-none placeholder:text-[#9A8C80] focus:ring-2 focus:ring-bronze"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-rotulo">Etiquetas</span>
        <div className="flex flex-wrap gap-2">
          {ETIQUETAS_SUGERIDAS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => alternarEtiqueta(e)}
              aria-pressed={etiquetas.includes(e)}
              className={`h-11 rounded-full px-4 text-sm font-semibold ${
                etiquetas.includes(e) ? "bg-bronze text-grafite" : "border border-borda text-rotulo"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <input
          value={novaEtiqueta}
          onChange={(e) => setNovaEtiqueta(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && salvar()}
          placeholder="Nova etiqueta (aparece ao salvar)"
          className={`${campo} placeholder:text-[#9A8C80]`}
        />
      </div>

      <button
        onClick={salvar}
        disabled={salvando || salvo}
        className={`flex h-14 w-full items-center justify-center gap-2 rounded-[18px] text-[17px] font-bold text-white transition-colors duration-300 active:scale-[0.98] ${
          salvo ? "bg-[#5E7A50]" : "bg-grafite disabled:opacity-50"
        }`}
      >
        {salvo ? (
          <>
            <span className="selo-pop flex">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path className="check-desenhar" d="m5 12 5 5L20 7" />
              </svg>
            </span>
            Salvo
          </>
        ) : salvando ? (
          "Salvando…"
        ) : (
          "Salvar"
        )}
      </button>
      {aviso && <p className="text-center font-medium">{aviso}</p>}
      {!salvo && (
        <button onClick={aoConcluir} disabled={salvando} className="-mt-1 h-11 text-[16px] font-semibold text-texto-2 active:opacity-60">
          Cancelar
        </button>
      )}
    </Cartao>
  );
}

// Na edição: excluir a cliente (vai para Clientes excluídas, no Painel CRM) ou,
// se ela já está lá, restaurar.
function Exclusao({ cliente, aoMudar }: { cliente: ClienteStatus; aoMudar: () => void }) {
  const router = useRouter();
  const [salvando, setSalvando] = useState(false);
  const { dialogo, perguntar, avisar } = useDialogo();
  const excluida = estaExcluida(cliente.etiquetas);

  async function alternar() {
    if (!excluida && !(await perguntar(textoExclusao(cliente.nome), { confirmar: "Excluir", perigo: true }))) return;
    setSalvando(true);
    const erro = excluida ? await restaurarCliente(cliente.id) : await excluirCliente(cliente.id);
    setSalvando(false);
    if (erro) {
      await avisar(`Não foi possível salvar: ${erro}`);
      return;
    }
    if (excluida) aoMudar();
    else router.back();
  }

  return (
    <section className="flex flex-col gap-2">
      {excluida && (
        <p className="rounded-2xl bg-card p-3 text-sm text-rotulo">
          Esta cliente está em <strong>Clientes excluídas</strong>: não aparece no Início, na Agenda nem nas Conversas.
        </p>
      )}
      <button
        onClick={alternar}
        disabled={salvando}
        className={`h-12 w-full rounded-2xl border font-semibold disabled:opacity-50 ${
          excluida ? "border-borda text-texto" : "border-rose-texto/30 text-rose-texto active:bg-rose"
        }`}
      >
        {excluida ? "Restaurar cliente" : "Excluir cliente"}
      </button>
      {dialogo}
    </section>
  );
}
