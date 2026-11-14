"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import {
  dataNoSalao,
  diasEntre,
  formatarData,
  formatarHora,
  formatarTelefone,
  haQuantoTempo,
  hojeNoSalao,
  prazo,
} from "@/lib/formato";
import { useDialogo } from "@/components/Dialogo";
import { Aviso, Chip, Rotulo, Secao, botao, botaoForte, campo, cartao, opcao, type Tom } from "@/components/Pecas";
import { CAMPOS_PRE, ETAPAS_FUNIL, buscarSaberIa, type SaberIa } from "@/lib/avaliacoes";
import { pausarOuReativarIa } from "@/lib/ia";
import { estaExcluida, excluirCliente, restaurarCliente, textoExclusao } from "@/lib/excluidas";
import { ORIGENS, etiquetasDoSistema, etiquetasVisiveis, lerOrigem, rotuloOrigem, trocarOrigem, type Origem } from "@/lib/origem";
import { Etiquetas } from "@/components/Etiquetas";
import { SeloStatus } from "@/lib/status";
import { useEmpresa } from "@/lib/empresa";
import { statusEfetivo } from "@/lib/statusManual";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import type { ClienteStatus, RetornoServico } from "@/lib/tipos";

type Atendimento = {
  id: string;
  inicio: string;
  status: "agendado" | "realizado" | "cancelado" | "faltou";
  origem: "ia" | "manual";
  servicos: { nome: string } | null;
  profissionais: { nome: string } | null;
};
type Contato = { id: string; tipo: string; resultado: string; criado_em: string };
type Mensagem = { criado_em: string };

type Ficha = {
  cliente: ClienteStatus;
  retornos: RetornoServico[];
  atendimentos: Atendimento[];
  contatos: Contato[];
  mensagens: Mensagem[];
  saberIa: SaberIa | null;
};

const ETIQUETAS_SUGERIDAS = ["vip", "alergia", "mega hair", "coloração", "química", "gestante"];

async function buscarFicha(id: string): Promise<Ficha | { erro: string }> {
  const db = supabase();
  const [cliente, retornos, atendimentos, contatos, mensagens, saberIa] = await Promise.all([
    db.from("clientes_status").select("*").eq("id", id).maybeSingle(),
    db.from("retornos_por_servico").select("servico_id, servico_nome, ultima_vez, retorno_previsto").eq("cliente_id", id),
    db
      .from("agendamentos")
      .select("id, inicio, status, origem, servicos (nome), profissionais (nome)")
      .eq("cliente_id", id)
      .order("inicio", { ascending: false }),
    db.from("contatos").select("id, tipo, resultado, criado_em").eq("cliente_id", id),
    db.from("mensagens").select("criado_em").eq("cliente_id", id),
    buscarSaberIa(id),
  ]);
  const falha = [cliente, retornos, atendimentos, contatos, mensagens].find((r) => r.error);
  if (falha?.error) return { erro: falha.error.message };
  if (!cliente.data) return { erro: "Cliente não encontrada." };
  return {
    cliente: cliente.data as ClienteStatus,
    retornos: retornos.data as RetornoServico[],
    atendimentos: atendimentos.data as unknown as Atendimento[],
    contatos: contatos.data as Contato[],
    mensagens: mensagens.data as Mensagem[],
    saberIa,
  };
}

export default function FichaClientePage() {
  return (
    <Suspense fallback={<p className="py-8 text-texto-2">Carregando…</p>}>
      <FichaCliente />
    </Suspense>
  );
}

// A ficha é lida de cima para baixo:
//   1. quem é e como falar com ela (nome, telefone, status, etiquetas, observações);
//   2. o que está combinado (próximo horário, retorno previsto e o retorno de cada procedimento);
//   3. o que a IA sabe dela;
//   4. histórico;
//   5. por último, os campos de edição e a exclusão.
// As ações (Pausar IA, Editar dados) ficam sempre no canto direito do cabeçalho.
function FichaCliente() {
  const { id } = useParams<{ id: string }>();
  const [resultado, setResultado] = useState<Ficha | { erro: string } | null>(null);
  // Muda a cada salvamento para buscar a ficha de novo
  const [versao, setVersao] = useState(0);
  const recarregar = () => setVersao((v) => v + 1);
  // Atendimento marcado ou desmarcado na Agenda do salão aparece aqui na hora
  const empresa = useEmpresa();
  useTempoReal(["agendamentos", "clientes"], empresa.id, recarregar);

  useEffect(() => {
    let ativo = true;
    buscarFicha(id).then((r) => {
      if (ativo) setResultado(r);
    });
    return () => {
      ativo = false;
    };
  }, [id, versao]);

  if (!resultado) return <p className="py-8 text-texto-2">Carregando…</p>;
  if ("erro" in resultado)
    return (
      <div className="pt-9">
        <Aviso tom="atencao">{resultado.erro}</Aviso>
      </div>
    );
  const ficha = resultado;
  const carregar = recarregar;

  return (
    // Uma coluna só, de leitura confortável no computador
    <div className="mx-auto max-w-4xl pb-4">
      <Topo cliente={ficha.cliente} salao={empresa.nome} aoMudar={carregar} />
      <QuemE cliente={ficha.cliente} />
      <Combinado ficha={ficha} />
      {ficha.saberIa && <OQueAIaSabe saber={ficha.saberIa} />}
      <LinhaDoTempo ficha={ficha} />
      {/* key: se uma etiqueta for tirada lá em cima, o formulário recomeça com as etiquetas certas */}
      <Dados key={ficha.cliente.etiquetas.join("|")} cliente={ficha.cliente} aoSalvar={carregar} />
      <Exclusao cliente={ficha.cliente} aoMudar={carregar} />
    </div>
  );
}

// 1. Cabeçalho: quem é, com as ações sempre à direita
function Topo({ cliente, salao, aoMudar }: { cliente: ClienteStatus; salao: string; aoMudar: () => void }) {
  const [salvando, setSalvando] = useState(false);
  const router = useRouter();

  async function alternarIa() {
    setSalvando(true);
    await pausarOuReativarIa(cliente.id, !cliente.ia_pausada);
    setSalvando(false);
    aoMudar();
  }

  async function removerEtiqueta(etiqueta: string) {
    await supabase()
      .from("clientes")
      .update({ etiquetas: cliente.etiquetas.filter((e) => e !== etiqueta) })
      .eq("id", cliente.id);
    aoMudar();
  }

  return (
    <header className="pt-5 pb-6">
      <button onClick={() => router.push("/")} className="-ml-2 inline-flex h-10 items-center gap-1 rounded-lg px-2 text-[14px] font-bold text-apoio hover:text-grafite">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 6-6 6 6 6" />
        </svg>
        Clientes
      </button>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="rotulo">{salao}</p>
          <h1 className="mt-1 font-serif text-[30px] leading-tight [overflow-wrap:anywhere]">{cliente.nome ?? "Sem nome"}</h1>
          <p className="mt-1 text-[18px] font-semibold text-texto-2 tabular-nums">{formatarTelefone(cliente.telefone)}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <SeloStatus status={statusEfetivo(cliente)} />
            {cliente.ia_pausada && <Chip tom="aviso">IA pausada</Chip>}
            <Etiquetas etiquetas={cliente.etiquetas} aoRemover={removerEtiqueta} className="" />
          </div>
        </div>
        {/* Sem botão de WhatsApp: no CRM quem fala com a cliente é a IA */}
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={alternarIa} disabled={salvando} className={botao + " h-11"}>
            {cliente.ia_pausada ? "Reativar IA" : "Pausar IA"}
          </button>
          <a href="#editar" className={botao + " h-11"}>
            Editar dados
          </a>
        </div>
      </div>
    </header>
  );
}

const Linha = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div>
    <dt className="text-[13px] font-bold text-apoio">{rotulo}</dt>
    <dd className="mt-0.5 text-[15px] font-semibold">{children}</dd>
  </div>
);

// 1 (continuação). O que a agência já sabe dela: de onde veio, quantas vezes veio e as observações
function QuemE({ cliente }: { cliente: ClienteStatus }) {
  const origem = lerOrigem(cliente.etiquetas);
  return (
    <section aria-label="Quem é" className={`${cartao} px-5 py-4`}>
      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        <Linha rotulo="Como conheceu o salão">{origem ? rotuloOrigem(origem) : <span className="font-normal text-apoio">Não informado</span>}</Linha>
        <Linha rotulo="Visitas">{cliente.total_visitas}</Linha>
        <Linha rotulo="Última visita">
          {cliente.ultima_visita ? (
            <>
              {formatarData(cliente.ultima_visita)} <span className="font-normal text-apoio">({haQuantoTempo(cliente.ultima_visita)})</span>
            </>
          ) : (
            <span className="font-normal text-apoio">Nunca veio</span>
          )}
        </Linha>
        <Linha rotulo="Cliente desde">{formatarData(cliente.criado_em)}</Linha>
      </dl>
      <div className="mt-4 border-t border-borda pt-4">
        <p className="text-[13px] font-bold text-apoio">Observações</p>
        <p className={`mt-0.5 text-[15px] leading-relaxed whitespace-pre-line ${cliente.observacoes ? "" : "text-apoio"}`}>{cliente.observacoes || "Nenhuma observação anotada."}</p>
      </div>
    </section>
  );
}

// 2. O que está combinado: o próximo horário, o retorno previsto e o retorno de cada procedimento.
// Cada procedimento tem o seu prazo de retorno (servicos.dias_retorno). O banco calcula o
// retorno previsto quando o atendimento é marcado como realizado.
function Combinado({ ficha }: { ficha: Ficha }) {
  const { cliente, retornos, atendimentos } = ficha;
  const hoje = hojeNoSalao();
  const ordenados = [...retornos].sort((a, b) => {
    if (!a.retorno_previsto) return 1;
    if (!b.retorno_previsto) return -1;
    return a.retorno_previsto.localeCompare(b.retorno_previsto);
  });
  const marcado = cliente.proximo_agendamento;
  // o atendimento desse horário, para mostrar o serviço e quem marcou
  const doHorario = marcado ? atendimentos.find((a) => a.status === "agendado" && Date.parse(a.inicio) === Date.parse(marcado)) : undefined;
  const diasRetorno = cliente.retorno_previsto ? diasEntre(hoje, cliente.retorno_previsto) : null;

  return (
    <Secao titulo="O que está combinado">
      <div className="grid gap-3 md:grid-cols-2">
        <div className={`${cartao} px-5 py-4`}>
          <p className="rotulo">Próximo horário</p>
          {marcado ? (
            <>
              <p className="mt-1.5 text-[22px] leading-tight font-extrabold tracking-[-0.03em] tabular-nums">
                {formatarData(marcado)} às {formatarHora(marcado)}
              </p>
              <p className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px] font-semibold text-texto-2">
                {[prazo(dataNoSalao(marcado)), doHorario?.servicos?.nome, doHorario?.profissionais?.nome].filter(Boolean).join(" · ")}
                {doHorario?.origem === "ia" && (
                  <span className="ia-tag">
                    <span className="ia-dot" />
                    IA marcou
                  </span>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[22px] leading-tight font-extrabold tracking-[-0.03em]">Nenhum</p>
              <p className="mt-1.5 text-[14px] font-semibold text-apoio">sem horário marcado daqui para frente</p>
            </>
          )}
        </div>
        <div className={`${cartao} px-5 py-4`}>
          <p className="rotulo">Retorno previsto</p>
          {cliente.retorno_previsto ? (
            <>
              <p className="mt-1.5 text-[22px] leading-tight font-extrabold tracking-[-0.03em] tabular-nums">{formatarData(cliente.retorno_previsto)}</p>
              <p className={`mt-1.5 text-[14px] font-semibold ${diasRetorno !== null && diasRetorno < 0 ? "text-rose-texto" : diasRetorno !== null && diasRetorno <= 7 ? "text-mel-texto" : "text-apoio"}`}>
                {prazo(cliente.retorno_previsto)}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-[22px] leading-tight font-extrabold tracking-[-0.03em]">Sem data</p>
              <p className="mt-1.5 text-[14px] font-semibold text-apoio">nenhum retorno programado</p>
            </>
          )}
        </div>
      </div>

      <h3 className="mt-5 mb-2 text-[15px] font-bold">Retorno de cada procedimento</h3>
      {ordenados.length === 0 ? (
        <p className={`${cartao} px-5 py-5 text-[15px] text-texto-2`}>Nenhum procedimento realizado ainda.</p>
      ) : (
        <ul className={`${cartao} divide-y divide-borda`}>
          {ordenados.map((r) => {
            const dias = r.retorno_previsto ? diasEntre(hoje, r.retorno_previsto) : null;
            return (
              <li key={r.servico_id} className="grid items-center gap-x-6 gap-y-1 px-5 py-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                <p className="text-[15px] font-bold">{r.servico_nome}</p>
                <p className="text-[14px] text-texto-2">Última vez: {formatarData(r.ultima_vez)}</p>
                {r.retorno_previsto ? (
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold sm:justify-end">
                    Voltar em {formatarData(r.retorno_previsto)}
                    <Chip tom={dias !== null && dias < 0 ? "atencao" : dias !== null && dias <= 7 ? "aviso" : "neutro"}>{prazo(r.retorno_previsto)}</Chip>
                  </p>
                ) : (
                  <p className="text-[14px] text-apoio sm:text-right">Sem retorno programado</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Secao>
  );
}

// 3. O que a IA anotou nas conversas (pré-avaliação), o resultado que a Gleide deu no app e a etapa
// do funil. É o que a IA usa para continuar a conversa com a cliente.
function OQueAIaSabe({ saber }: { saber: SaberIa }) {
  const a = saber.avaliacao;
  const valor = (v: string | number | boolean | null | undefined, campo: string) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "boolean") return v ? "sim" : "não";
    if (campo === "pre_data_ocasiao") return formatarData(String(v));
    if (campo === "valor_orcado") return Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
    return String(v);
  };
  const linhas = a
    ? CAMPOS_PRE.map(([campo, rotulo]) => [rotulo, valor(a[campo], campo)] as const).filter((l): l is [string, string] => l[1] !== null)
    : [];
  return (
    <Secao
      titulo="O que a IA sabe"
      apoio="Anotado pela IA nas conversas. É o que ela usa para continuar falando com a cliente."
      acao={<Chip tom="neutro">{ETAPAS_FUNIL[saber.etapa]}</Chip>}
    >
      <div className={`${cartao} space-y-4 px-5 py-4`}>
        {typeof a?.pre_resumo === "string" && a.pre_resumo && (
          <div className="flex items-start gap-2.5">
            <span className="ia-tag mt-1">
              <span className="ia-dot" />
              IA
            </span>
            <p className="text-[15px] leading-relaxed">{a.pre_resumo}</p>
          </div>
        )}
        {linhas.length > 0 && (
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {linhas.map(([rotulo, v]) => (
              <div key={rotulo} className="flex justify-between gap-4 border-b border-borda py-2 text-[15px]">
                <dt className="text-texto-2">{rotulo}</dt>
                <dd className="text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {saber.resumoConversas && (
          <p className="text-[15px] leading-relaxed text-texto-2">
            <b className="font-bold text-grafite">Conversas com a Gleide:</b> {saber.resumoConversas}
          </p>
        )}
        {!a && !saber.resumoConversas && <p className="text-[15px] text-texto-2">A IA ainda não anotou nada sobre ela.</p>}
      </div>
    </Secao>
  );
}

const STATUS_ATENDIMENTO: Record<Atendimento["status"], { rotulo: string; tom: Tom }> = {
  agendado: { rotulo: "Agendado", tom: "neutro" },
  realizado: { rotulo: "Realizado", tom: "ok" },
  cancelado: { rotulo: "Cancelado", tom: "neutro" },
  faltou: { rotulo: "Faltou", tom: "atencao" },
};

const RESULTADO_CONTATO: Record<string, string> = {
  pendente: "aguardando resposta",
  sem_resposta: "sem resposta",
  respondeu: "respondeu",
  agendou: "agendou",
};

type Evento = { quando: string; titulo: string; detalhe: string; selo?: { rotulo: string; tom: Tom }; ia?: boolean };

// 4. Histórico: junta atendimentos, contatos ("Mandar alô") e mensagens (agrupadas por dia) em ordem de data
function LinhaDoTempo({ ficha }: { ficha: Ficha }) {
  const eventos: Evento[] = [
    ...ficha.atendimentos.map((a) => ({
      quando: a.inicio,
      titulo: a.servicos?.nome ?? "Atendimento",
      selo: STATUS_ATENDIMENTO[a.status],
      detalhe: [formatarHora(a.inicio), a.profissionais?.nome].filter(Boolean).join(" · "),
      ia: a.origem === "ia",
    })),
    ...ficha.contatos.map((c) => ({
      quando: c.criado_em,
      titulo:
        c.tipo === "reativacao" ? "Alô de reativação enviado" : c.tipo === "remarcacao" ? "Pedido de remarcação enviado" : "Alô de retorno enviado",
      detalhe: RESULTADO_CONTATO[c.resultado] ?? c.resultado,
    })),
    ...Object.entries(
      ficha.mensagens.reduce<Record<string, number>>((dias, m) => {
        const dia = dataNoSalao(m.criado_em);
        dias[dia] = (dias[dia] ?? 0) + 1;
        return dias;
      }, {}),
    ).map(([dia, total]) => ({
      quando: `${dia}T12:00:00-04:00`,
      titulo: "Conversa no WhatsApp",
      detalhe: `${total} ${total === 1 ? "mensagem" : "mensagens"}`,
    })),
  ].sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));

  return (
    <Secao titulo="Histórico" apoio="Atendimentos, mensagens de retorno e conversas, do mais novo para o mais antigo.">
      {eventos.length === 0 ? (
        <p className={`${cartao} px-5 py-5 text-[15px] text-texto-2`}>Nada registrado ainda.</p>
      ) : (
        <ol className={`${cartao} divide-y divide-borda`}>
          {eventos.map((e, i) => (
            <li key={i} className="grid gap-x-5 gap-y-0.5 px-5 py-3 sm:grid-cols-[6.5rem_1fr]">
              <p className="text-[14px] font-bold text-apoio tabular-nums sm:pt-0.5">{formatarData(e.quando)}</p>
              <div>
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-bold">
                  {e.titulo}
                  {e.selo && <Chip tom={e.selo.tom}>{e.selo.rotulo}</Chip>}
                  {e.ia && (
                    <span className="ia-tag">
                      <span className="ia-dot" />
                      IA marcou
                    </span>
                  )}
                </p>
                <p className="text-[14px] text-texto-2">{e.detalhe}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Secao>
  );
}

// 5. Campos de edição
function Dados({ cliente, aoSalvar }: { cliente: ClienteStatus; aoSalvar: () => void }) {
  const [nome, setNome] = useState(cliente.nome ?? "");
  const [observacoes, setObservacoes] = useState(cliente.observacoes ?? "");
  const [origem, setOrigem] = useState<Origem | null>(lerOrigem(cliente.etiquetas));
  const [etiquetas, setEtiquetas] = useState(etiquetasVisiveis(cliente.etiquetas));
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [aviso, setAviso] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  function alternarEtiqueta(etiqueta: string) {
    setEtiquetas((atuais) => (atuais.includes(etiqueta) ? atuais.filter((e) => e !== etiqueta) : [...atuais, etiqueta]));
  }

  // A etiqueta escrita em "Nova etiqueta" entra ao tocar em Salvar e aparece só embaixo do
  // nome (com × para tirar), não na lista de opções abaixo.
  async function salvar() {
    setSalvando(true);
    setAviso("");
    setErro("");
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
      setErro(`Não foi possível salvar: ${error.message}`);
      return;
    }
    setNovaEtiqueta("");
    setAviso("Salvo");
    aoSalvar();
  }

  return (
    <section id="editar" className="mt-9 scroll-mt-6">
      <h2 className="mb-3 text-[19px] font-bold tracking-[-0.02em]">Editar dados</h2>
      <div className={`${cartao} space-y-5 p-5`}>
        <label className="block">
          <Rotulo>Nome</Rotulo>
          <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo + " md:max-w-md"} />
        </label>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-bold text-texto-2">Como conheceu o salão?</legend>
          <div className="flex flex-wrap gap-2">
            {ORIGENS.map((o) => (
              <button key={o.chave} type="button" onClick={() => setOrigem(origem === o.chave ? null : o.chave)} aria-pressed={origem === o.chave} className={opcao(origem === o.chave)}>
                {o.rotulo}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="block">
          <Rotulo>Observações</Rotulo>
          <textarea
            rows={4}
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            placeholder="Alergias, fórmula da cor, método do mega hair, preferências…"
            className="w-full rounded-xl border border-borda bg-card p-3 text-[15px] leading-relaxed outline-none placeholder:text-apoio/70 focus:border-onix focus-visible:ring-2 focus-visible:ring-onix/15"
          />
        </label>

        <fieldset>
          <legend className="mb-1.5 text-[13px] font-bold text-texto-2">Etiquetas</legend>
          <div className="flex flex-wrap gap-2">
            {ETIQUETAS_SUGERIDAS.map((e) => (
              <button key={e} type="button" onClick={() => alternarEtiqueta(e)} aria-pressed={etiquetas.includes(e)} className={opcao(etiquetas.includes(e))}>
                {e}
              </button>
            ))}
          </div>
          <label className="mt-3 block">
            <Rotulo>Nova etiqueta (aparece embaixo do nome ao salvar)</Rotulo>
            <input value={novaEtiqueta} onChange={(e) => setNovaEtiqueta(e.target.value)} onKeyDown={(e) => e.key === "Enter" && salvar()} className={campo + " md:max-w-md"} />
          </label>
        </fieldset>

        {erro && <Aviso tom="atencao">{erro}</Aviso>}
        <div className="flex items-center gap-3 border-t border-borda pt-4">
          <button onClick={salvar} disabled={salvando} className={botaoForte + " h-11"}>
            {salvando ? "Salvando…" : "Salvar"}
          </button>
          {aviso && (
            <span role="status" className="text-[14px] font-bold text-salvia-texto">
              {aviso}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

// No fim da ficha: excluir a cliente (vai para Clientes excluídas, no Painel CRM) ou,
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
    else router.replace("/");
  }

  return (
    <section className={`${cartao} mt-9 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4`}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold">{excluida ? "Cliente excluída" : "Excluir cliente"}</h2>
        <p className="text-[14px] text-apoio">
          {excluida
            ? "Ela está em Clientes excluídas: não aparece na lista do CRM nem no app da dona."
            : "Ela sai do Quadro, da Lista e do app da dona. O histórico fica guardado e dá para restaurar."}
        </p>
      </div>
      <button
        onClick={alternar}
        disabled={salvando}
        className={excluida ? botao + " h-11" : "inline-flex h-11 items-center justify-center rounded-xl border border-atencao bg-card px-4 text-[14px] font-bold text-rose-texto hover:bg-rose disabled:opacity-50"}
      >
        {excluida ? "Restaurar cliente" : "Excluir cliente"}
      </button>
      {dialogo}
    </section>
  );
}
