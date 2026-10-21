"use client";

import { useParams, useRouter } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { diasEntre, formatarData, formatarTelefone, hojeNoSalao, prazo } from "@/lib/formato";
import { useDialogo } from "@/components/Dialogo";
import { estaExcluida, excluirCliente, restaurarCliente, textoExclusao } from "@/lib/excluidas";
import { etiquetasDoSistema, etiquetasVisiveis, lerOrigem, trocarOrigem } from "@/lib/origem";
import { Etiquetas } from "@/components/Etiquetas";
import { PontoStatus, SeloStatus } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";
import type { ClienteStatus, RetornoServico } from "@/lib/tipos";
import { abrirWhatsApp } from "@/lib/whatsapp";

// Ficha enxuta da dona: dados, retornos e observações. Origem, linha do tempo e IA ficam no
// CRM da agência (painel-crm).
type Ficha = {
  cliente: ClienteStatus;
  retornos: RetornoServico[];
};

const ETIQUETAS_SUGERIDAS = ["vip", "alergia", "mega hair", "coloração", "química", "gestante"];

async function buscarFicha(id: string): Promise<Ficha | { erro: string }> {
  const db = supabase();
  const [cliente, retornos] = await Promise.all([
    db.from("clientes_status").select("*").eq("id", id).maybeSingle(),
    db.from("retornos_por_servico").select("servico_id, servico_nome, ultima_vez, retorno_previsto").eq("cliente_id", id),
  ]);
  const falha = [cliente, retornos].find((r) => r.error);
  if (falha?.error) return { erro: falha.error.message };
  if (!cliente.data) return { erro: "Cliente não encontrada." };
  return { cliente: cliente.data as ClienteStatus, retornos: retornos.data as RetornoServico[] };
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
  const [resultado, setResultado] = useState<Ficha | { erro: string } | null>(null);
  // Muda a cada salvamento para buscar a ficha de novo
  const [versao, setVersao] = useState(0);
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

  if (!resultado) return <p className="p-4 text-neutral-500">Carregando…</p>;
  if ("erro" in resultado) return <p className="m-4 rounded-xl bg-red-100 p-4 text-red-900">{resultado.erro}</p>;
  const ficha = resultado;
  const carregar = recarregar;

  return (
    <div className="space-y-6 pb-4">
      <Topo cliente={ficha.cliente} aoMudar={carregar} />
      <Retornos retornos={ficha.retornos} />
      {/* key: se uma etiqueta for tirada lá em cima, o formulário recomeça com as etiquetas certas */}
      <Dados key={ficha.cliente.etiquetas.join("|")} cliente={ficha.cliente} aoSalvar={carregar} />
      <Exclusao cliente={ficha.cliente} aoMudar={carregar} />
    </div>
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
    else router.back();
  }

  return (
    <section className="px-4 pt-2">
      {excluida && (
        <p className="mb-2 rounded-xl border border-neutral-200 bg-white p-3 text-neutral-700">
          Esta cliente está em <strong>Clientes excluídas</strong>: não aparece no Início, na Agenda nem nas Conversas.
        </p>
      )}
      <button
        onClick={alternar}
        disabled={salvando}
        className={`h-12 w-full rounded-xl border bg-white font-semibold disabled:opacity-50 ${
          excluida ? "border-neutral-300 text-neutral-800" : "border-red-200 text-red-700 active:bg-red-50"
        }`}
      >
        {excluida ? "Restaurar cliente" : "Excluir cliente"}
      </button>
      {dialogo}
    </section>
  );
}

// Sem "Pausar IA" aqui: cuidar da IA não é tarefa da dona (fica no CRM da agência)
function Topo({ cliente, aoMudar }: { cliente: ClienteStatus; aoMudar: () => void }) {
  const router = useRouter();

  async function removerEtiqueta(etiqueta: string) {
    await supabase()
      .from("clientes")
      .update({ etiquetas: cliente.etiquetas.filter((e) => e !== etiqueta) })
      .eq("id", cliente.id);
    aoMudar();
  }

  return (
    <section className="space-y-3 px-4 pt-2">
      {/* Sem aba de clientes neste app: a ficha abre pela Agenda, Início ou Conversas */}
      <button
        onClick={() => router.back()}
        className="inline-flex h-11 items-center text-lg font-semibold text-[var(--cor-principal)]"
      >
        ‹ Voltar
      </button>
      <div>
        <h1 className="text-3xl font-bold">{cliente.nome ?? "Sem nome"}</h1>
        <Etiquetas etiquetas={cliente.etiquetas} aoRemover={removerEtiqueta} />
        <p className="mt-1 text-lg text-neutral-600">{formatarTelefone(cliente.telefone)}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <SeloStatus status={cliente.status} />
          {cliente.ia_pausada && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-0.5 text-sm font-medium text-neutral-700">
              <PontoStatus cor="bg-yellow-400" />
              IA pausada
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => abrirWhatsApp(cliente.telefone)}
        className="h-12 w-full rounded-xl border border-neutral-300 bg-white text-lg font-semibold text-green-700 active:bg-neutral-100"
      >
        WhatsApp
      </button>
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
          const ponto =
            dias === null ? "bg-neutral-300" : dias < 0 ? "bg-orange-500" : dias <= 7 ? "bg-yellow-400" : "bg-green-500";
          return (
            <li key={r.servico_id} className="rounded-xl border border-neutral-200 bg-white p-3">
              <p className="flex items-center gap-2 text-lg font-semibold">
                <PontoStatus cor={ponto} />
                {r.servico_nome}
              </p>
              <p className="text-neutral-600">Última vez: {formatarData(r.ultima_vez)}</p>
              <p className={`font-medium ${dias !== null && dias < 0 ? "text-orange-700" : ""}`}>
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

function Dados({ cliente, aoSalvar }: { cliente: ClienteStatus; aoSalvar: () => void }) {
  const [nome, setNome] = useState(cliente.nome ?? "");
  const [observacoes, setObservacoes] = useState(cliente.observacoes ?? "");
  // A origem não aparece aqui (é do CRM), mas continua guardada ao salvar
  const origem = lerOrigem(cliente.etiquetas);
  const [etiquetas, setEtiquetas] = useState(etiquetasVisiveis(cliente.etiquetas));
  const [novaEtiqueta, setNovaEtiqueta] = useState("");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);

  function alternarEtiqueta(etiqueta: string) {
    setEtiquetas((atuais) => (atuais.includes(etiqueta) ? atuais.filter((e) => e !== etiqueta) : [...atuais, etiqueta]));
  }

  // A etiqueta escrita em "Nova etiqueta" entra ao tocar em Salvar e aparece só embaixo do
  // nome (com × para tirar), não na lista de opções abaixo.
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
    setAviso("Salvo ✓");
    aoSalvar();
  }
  const campo =
    "h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]";

  return (
    <section className="space-y-4 px-4">
      <h2 className="text-xl font-semibold">Dados da cliente</h2>

      <label className="block space-y-1">
        <span className="font-medium">Nome</span>
        <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} />
      </label>

      <label className="block space-y-1">
        <span className="font-medium">Observações</span>
        <textarea
          rows={4}
          value={observacoes}
          onChange={(e) => setObservacoes(e.target.value)}
          placeholder="Alergias, fórmula da cor, método do mega hair, preferências…"
          className="w-full rounded-xl border border-neutral-300 bg-white p-4 text-lg outline-none focus:border-[var(--cor-principal)]"
        />
      </label>

      <div className="space-y-2">
        <span className="font-medium">Etiquetas</span>
        <div className="flex flex-wrap gap-2">
          {ETIQUETAS_SUGERIDAS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => alternarEtiqueta(e)}
              aria-pressed={etiquetas.includes(e)}
              className={`h-11 rounded-full px-4 font-semibold ${
                etiquetas.includes(e) ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-700"
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
          placeholder="Nova etiqueta (aparece embaixo do nome ao salvar)"
          className={campo}
        />
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
