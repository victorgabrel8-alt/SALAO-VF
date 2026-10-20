"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useEmpresa } from "@/lib/empresa";
import {
  dataNoSalao,
  diasEntre,
  formatarData,
  formatarHora,
  formatarTelefone,
  hojeNoSalao,
  prazo,
} from "@/lib/formato";
import { ORIGENS, etiquetasVisiveis, lerOrigem, trocarOrigem, type Origem } from "@/lib/origem";
import { SeloStatus } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";
import type { ClienteStatus, Profissional, RetornoServico } from "@/lib/tipos";
import { abrirWhatsApp } from "@/lib/whatsapp";

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
  profissionais: Profissional[];
  atendimentos: Atendimento[];
  contatos: Contato[];
  mensagens: Mensagem[];
};

const ETIQUETAS_SUGERIDAS = ["vip", "alergia", "mega hair", "coloração", "química", "gestante"];

async function buscarFicha(id: string, empresaId: string): Promise<Ficha | { erro: string }> {
  const db = supabase();
  const [cliente, retornos, profissionais, atendimentos, contatos, mensagens] = await Promise.all([
    db.from("clientes_status").select("*").eq("id", id).maybeSingle(),
    db.from("retornos_por_servico").select("servico_id, servico_nome, ultima_vez, retorno_previsto").eq("cliente_id", id),
    db.from("profissionais").select("id, nome").eq("empresa_id", empresaId).eq("ativo", true).order("nome"),
    db
      .from("agendamentos")
      .select("id, inicio, status, origem, servicos (nome), profissionais (nome)")
      .eq("cliente_id", id)
      .order("inicio", { ascending: false }),
    db.from("contatos").select("id, tipo, resultado, criado_em").eq("cliente_id", id),
    db.from("mensagens").select("criado_em").eq("cliente_id", id),
  ]);
  const falha = [cliente, retornos, profissionais, atendimentos, contatos, mensagens].find((r) => r.error);
  if (falha?.error) return { erro: falha.error.message };
  if (!cliente.data) return { erro: "Cliente não encontrada." };
  return {
    cliente: cliente.data as ClienteStatus,
    retornos: retornos.data as RetornoServico[],
    profissionais: profissionais.data as Profissional[],
    atendimentos: atendimentos.data as unknown as Atendimento[],
    contatos: contatos.data as Contato[],
    mensagens: mensagens.data as Mensagem[],
  };
}

export default function FichaClientePage() {
  return (
    <Suspense fallback={<p className="p-4 text-neutral-500">Carregando…</p>}>
      <FichaCliente />
    </Suspense>
  );
}

function FichaCliente() {
  const { id } = useParams<{ id: string }>();
  const empresa = useEmpresa();
  const [resultado, setResultado] = useState<Ficha | { erro: string } | null>(null);
  // Muda a cada salvamento para buscar a ficha de novo
  const [versao, setVersao] = useState(0);
  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    let ativo = true;
    buscarFicha(id, empresa.id).then((r) => {
      if (ativo) setResultado(r);
    });
    return () => {
      ativo = false;
    };
  }, [id, empresa.id, versao]);

  if (!resultado) return <p className="p-4 text-neutral-500">Carregando…</p>;
  if ("erro" in resultado) return <p className="m-4 rounded-xl bg-red-100 p-4 text-red-900">{resultado.erro}</p>;
  const ficha = resultado;
  const carregar = recarregar;

  return (
    <div className="space-y-6 pb-4">
      <Topo cliente={ficha.cliente} aoMudar={carregar} />
      <Retornos retornos={ficha.retornos} />
      <Dados cliente={ficha.cliente} profissionais={ficha.profissionais} aoSalvar={carregar} />
      <LinhaDoTempo ficha={ficha} />
    </div>
  );
}

function Topo({ cliente, aoMudar }: { cliente: ClienteStatus; aoMudar: () => void }) {
  const [salvando, setSalvando] = useState(false);

  // Pausar: a IA para de responder esta cliente por 12 horas (o n8n lê ia_pausada_ate)
  async function alternarIa() {
    setSalvando(true);
    const pausar = !cliente.ia_pausada;
    await supabase()
      .from("clientes")
      .update(
        pausar
          ? { ia_pausada_ate: new Date(Date.now() + 12 * 3_600_000).toISOString(), motivo_pausa: "manual" }
          : { ia_pausada_ate: null, motivo_pausa: null },
      )
      .eq("id", cliente.id);
    setSalvando(false);
    aoMudar();
  }

  return (
    <section className="space-y-3 px-4 pt-2">
      <Link href="/clientes" className="inline-flex h-11 items-center text-lg font-semibold text-[var(--cor-principal)]">
        ‹ Clientes
      </Link>
      <div>
        <h1 className="text-3xl font-bold">{cliente.nome ?? "Sem nome"}</h1>
        <p className="text-lg text-neutral-600">{formatarTelefone(cliente.telefone)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SeloStatus status={cliente.status} />
          {cliente.ia_pausada && (
            <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-sm font-semibold text-yellow-900">
              IA pausada
            </span>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => abrirWhatsApp(cliente.telefone)}
          className="h-12 rounded-xl bg-green-600 text-lg font-bold text-white active:bg-green-700"
        >
          WhatsApp
        </button>
        <button
          onClick={alternarIa}
          disabled={salvando}
          className="h-12 rounded-xl border-2 border-neutral-300 text-lg font-bold active:bg-neutral-100 disabled:opacity-50"
        >
          {cliente.ia_pausada ? "Reativar IA" : "Pausar IA"}
        </button>
      </div>
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

  return (
    <section className="space-y-2 px-4">
      <h2 className="text-xl font-semibold">Retornos por procedimento</h2>
      {ordenados.length === 0 && <p className="text-neutral-500">Nenhum procedimento realizado ainda.</p>}
      <ul className="space-y-2">
        {ordenados.map((r) => {
          const dias = r.retorno_previsto ? diasEntre(hoje, r.retorno_previsto) : null;
          const cor =
            dias === null
              ? "border-neutral-200"
              : dias < 0
                ? "border-orange-400 bg-orange-50"
                : dias <= 7
                  ? "border-yellow-400 bg-yellow-50"
                  : "border-green-400 bg-green-50";
          return (
            <li key={r.servico_id} className={`rounded-xl border-2 p-3 ${cor}`}>
              <p className="text-lg font-semibold">{r.servico_nome}</p>
              <p className="text-neutral-700">Última vez: {formatarData(r.ultima_vez)}</p>
              <p className="font-medium">
                {r.retorno_previsto
                  ? `Voltar: ${formatarData(r.retorno_previsto)} (${prazo(r.retorno_previsto)})`
                  : "Sem retorno programado"}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Dados({
  cliente,
  profissionais,
  aoSalvar,
}: {
  cliente: ClienteStatus;
  profissionais: Profissional[];
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState(cliente.nome ?? "");
  const [aniversario, setAniversario] = useState(cliente.aniversario ?? "");
  const [profissional, setProfissional] = useState(cliente.profissional_preferida_id ?? "");
  const [observacoes, setObservacoes] = useState(cliente.observacoes ?? "");
  const [origem, setOrigem] = useState<Origem | null>(lerOrigem(cliente.etiquetas));
  const [etiquetas, setEtiquetas] = useState(etiquetasVisiveis(cliente.etiquetas));
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);

  function alternarEtiqueta(etiqueta: string) {
    setEtiquetas((atuais) => (atuais.includes(etiqueta) ? atuais.filter((e) => e !== etiqueta) : [...atuais, etiqueta]));
  }

  function adicionarEtiqueta() {
    const etiqueta = novaEtiqueta.trim().toLowerCase();
    if (etiqueta && !etiquetas.includes(etiqueta)) setEtiquetas([...etiquetas, etiqueta]);
    setNovaEtiqueta("");
  }

  async function salvar() {
    setSalvando(true);
    setAviso("");
    const { error } = await supabase()
      .from("clientes")
      .update({
        nome: nome.trim() || null,
        aniversario: aniversario || null,
        profissional_preferida_id: profissional || null,
        observacoes: observacoes.trim() || null,
        etiquetas: trocarOrigem(etiquetas, origem),
      })
      .eq("id", cliente.id);
    setSalvando(false);
    if (error) {
      setAviso(`Não foi possível salvar: ${error.message}`);
      return;
    }
    setAviso("Salvo ✓");
    aoSalvar();
  }

  const todasEtiquetas = [...new Set([...ETIQUETAS_SUGERIDAS, ...etiquetas])];
  const campo =
    "h-12 w-full rounded-xl border-2 border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]";

  return (
    <section className="space-y-4 px-4">
      <h2 className="text-xl font-semibold">Dados da cliente</h2>

      <label className="block space-y-1">
        <span className="font-medium">Nome</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} />
      </label>

      <div className="space-y-1">
        <span className="font-medium">Como conheceu o salão?</span>
        <div className="flex flex-wrap gap-2">
          {ORIGENS.map((o) => (
            <button
              key={o.chave}
              type="button"
              onClick={() => setOrigem(origem === o.chave ? null : o.chave)}
              aria-pressed={origem === o.chave}
              className={`h-11 rounded-full px-4 font-semibold ${
                origem === o.chave ? "bg-[var(--cor-principal)] text-white" : "bg-neutral-100 text-neutral-800"
              }`}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1">
          <span className="font-medium">Aniversário</span>
          <input type="date" value={aniversario} onChange={(e) => setAniversario(e.target.value)} className={campo} />
        </label>
        <label className="block space-y-1">
          <span className="font-medium">Profissional</span>
          <select value={profissional} onChange={(e) => setProfissional(e.target.value)} className={campo}>
            <option value="">Qualquer</option>
            {profissionais.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="font-medium">Observações</span>
        <textarea
          rows={4}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Alergias, fórmula da cor, método do mega hair, preferências…"
          className="w-full rounded-xl border-2 border-neutral-300 p-4 text-lg outline-none focus:border-[var(--cor-principal)]"
        />
      </label>

      <div className="space-y-2">
        <span className="font-medium">Etiquetas</span>
        <div className="flex flex-wrap gap-2">
          {todasEtiquetas.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => alternarEtiqueta(e)}
              aria-pressed={etiquetas.includes(e)}
              className={`h-11 rounded-full px-4 font-semibold ${
                etiquetas.includes(e) ? "bg-neutral-800 text-white" : "bg-neutral-100 text-neutral-700"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={novaEtiqueta}
            onChange={(e) => setNovaEtiqueta(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && adicionarEtiqueta()}
            placeholder="Nova etiqueta"
            className={campo}
          />
          <button
            type="button"
            onClick={adicionarEtiqueta}
            className="h-12 shrink-0 rounded-xl border-2 border-neutral-300 px-4 font-semibold active:bg-neutral-100"
          >
            Adicionar
          </button>
        </div>
      </div>

      <button
        onClick={salvar}
        disabled={salvando}
        className="h-14 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-50"
      >
        {salvando ? "Salvando…" : "Salvar"}
      </button>
      {aviso && <p className="text-center text-lg font-medium">{aviso}</p>}
    </section>
  );
}

const STATUS_ATENDIMENTO: Record<Atendimento["status"], string> = {
  agendado: "Agendado",
  realizado: "Realizado",
  cancelado: "Cancelado",
  faltou: "Faltou",
};

const RESULTADO_CONTATO: Record<string, string> = {
  pendente: "aguardando resposta",
  sem_resposta: "sem resposta",
  respondeu: "respondeu",
  agendou: "agendou",
};

type Evento = { quando: string; titulo: string; detalhe: string };

// Junta atendimentos, contatos ("Mandar alô") e mensagens (agrupadas por dia) em ordem de data
function LinhaDoTempo({ ficha }: { ficha: Ficha }) {
  const eventos: Evento[] = [
    ...ficha.atendimentos.map((a) => ({
      quando: a.inicio,
      titulo: `${a.servicos?.nome ?? "Atendimento"} — ${STATUS_ATENDIMENTO[a.status]}`,
      detalhe: [formatarHora(a.inicio), a.profissionais?.nome, a.origem === "ia" ? "marcado pela IA" : null]
        .filter(Boolean)
        .join(" · "),
    })),
    ...ficha.contatos.map((c) => ({
      quando: c.criado_em,
      titulo: c.tipo === "reativacao" ? "Alô de reativação enviado" : "Alô de retorno enviado",
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
    <section className="space-y-2 px-4">
      <h2 className="text-xl font-semibold">Linha do tempo</h2>
      {eventos.length === 0 && <p className="text-neutral-500">Nada registrado ainda.</p>}
      <ol className="space-y-3 border-l-2 border-neutral-200 pl-4">
        {eventos.map((e, i) => (
          <li key={i}>
            <p className="text-sm font-semibold text-neutral-500">{formatarData(e.quando)}</p>
            <p className="text-lg font-medium">{e.titulo}</p>
            <p className="text-neutral-600">{e.detalhe}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
