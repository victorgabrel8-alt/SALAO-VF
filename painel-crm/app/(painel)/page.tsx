"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Etiquetas } from "@/components/Etiquetas";
import { QuadroRetorno } from "@/components/QuadroRetorno";
import type { StatusCliente } from "@/lib/status";
import { diasDesdeContato } from "@/lib/alo";
import { useEmpresa } from "@/lib/empresa";
import { restaurarCliente } from "@/lib/excluidas";
import { formatarData, formatarHora, formatarTelefone, haQuantoTempo, prazo } from "@/lib/formato";
import {
  diasLimiteCelular,
  useAtraso,
  useContagemClientes,
  useListaClientes,
  type ClienteLista,
  type FiltroClientes,
} from "@/lib/listaClientes";
import { ORIGENS, lerOrigem, rotuloOrigem } from "@/lib/origem";
import { SeloStatus } from "@/lib/status";
import { mudarStatus, type StatusManual } from "@/lib/statusManual";

const FILTROS: { chave: FiltroClientes; rotulo: string }[] = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "para_chamar", rotulo: "Para chamar" },
  { chave: "retorno_chegando", rotulo: "Retorno chegando" },
  { chave: "atrasadas_recentes", rotulo: "Atrasadas até 30 dias" },
  { chave: "atrasadas_antigas", rotulo: "Atrasadas há +30 dias" },
  { chave: "inativa", rotulo: "Inativas" },
  { chave: "em_dia", rotulo: "Em dia" },
  { chave: "sem_visita", rotulo: "Sem visita" },
  { chave: "excluidas", rotulo: "Excluídas" },
];

// Abas que aceitam soltar uma cliente arrastada: Inativas e Em dia fixam o status à mão;
// Todas devolve o status automático (calculado pelas visitas)
const SOLTAR: Partial<Record<FiltroClientes, StatusManual | null>> = {
  inativa: "inativa",
  em_dia: "em_dia",
  todas: null,
};

// Linhas em destaque: atrasadas (laranja forte) e retorno chegando (amarelo forte)
const DESTAQUE: Partial<Record<StatusCliente, { linha: string; borda: string; texto: string }>> = {
  retorno_atrasado: { linha: "bg-orange-50 hover:bg-orange-100/70", borda: "border-orange-500", texto: "font-semibold text-orange-700" },
  retorno_chegando: { linha: "bg-amber-50 hover:bg-amber-100/70", borda: "border-amber-400", texto: "font-semibold text-amber-700" },
};

function textoChamada(dias: number): string {
  return dias === 0 ? "hoje" : `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

// CRM completo do salão escolhido: tabela com todas as clientes, filtros e origem.
// Quem chama as clientes é a IA de retorno; aqui a agência só acompanha.
export default function CrmPage() {
  return (
    <Suspense fallback={<p className="py-8 text-neutral-500">Carregando…</p>}>
      <Crm />
    </Suspense>
  );
}

function textoProximo(c: ClienteLista) {
  if (c.proximo_agendamento)
    return {
      rotulo: "Marcado",
      valor: formatarData(c.proximo_agendamento).slice(0, 5),
      detalhe: `às ${formatarHora(c.proximo_agendamento)}`,
      atrasado: false,
    };
  if (c.retorno_previsto)
    return {
      rotulo: "Retorno",
      valor: formatarData(c.retorno_previsto).slice(0, 5),
      detalhe: prazo(c.retorno_previsto),
      atrasado: c.status === "retorno_atrasado" || c.status === "inativa",
    };
  return null;
}

function Crm() {
  const empresa = useEmpresa();
  const router = useRouter();
  const params = useSearchParams();
  // Quadro (colunas de retorno) é o padrão; a lista completa fica em ?vista=lista
  const vista = params.get("vista") === "lista" ? "lista" : "quadro";
  const filtro = FILTROS.find((f) => f.chave === params.get("filtro"))?.chave ?? "todas";
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState("");
  const [arrastando, setArrastando] = useState<ClienteLista | null>(null);
  const [sobre, setSobre] = useState<FiltroClientes | null>(null);
  const buscaAtrasada = useAtraso(busca);
  const diasLimite = diasLimiteCelular(empresa.config);
  const contagem = useContagemClientes(empresa.id, diasLimite, versao);
  const { lista, verMais } = useListaClientes(
    empresa.id,
    { filtro, busca: buscaAtrasada, origem, diasLimite },
    50,
    versao,
  );

  function escolherFiltro(chave: FiltroClientes) {
    router.replace(`/?vista=lista&filtro=${chave}`, { scroll: false });
  }

  // A excluída volta para as listas (e para o Início, a Agenda e as Conversas do salão)
  async function restaurar(c: ClienteLista) {
    setRestaurando(c.id);
    const erro = await restaurarCliente(c.id);
    setRestaurando(null);
    setErroAcao(erro ? `Não foi possível restaurar ${c.nome ?? "a cliente"}: ${erro}` : "");
    if (!erro) setVersao((v) => v + 1);
  }

  // Cliente solta numa aba (ver SOLTAR)
  async function soltar(chave: FiltroClientes) {
    const c = arrastando;
    setArrastando(null);
    setSobre(null);
    if (!c) return;
    const erro = await mudarStatus(c.id, SOLTAR[chave] ?? null);
    setErroAcao(erro ? `Não foi possível mover ${c.nome ?? "a cliente"}: ${erro}` : "");
    if (!erro) setVersao((v) => v + 1);
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold">Clientes</h1>
          <p className="text-neutral-600">
            {contagem ? `${contagem.todas} clientes` : "…"} · {empresa.nome}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex h-11 rounded-xl bg-neutral-200/70 p-1" role="group" aria-label="Como ver as clientes">
            {(["quadro", "lista"] as const).map((v) => (
              <button
                key={v}
                onClick={() => router.replace(v === "quadro" ? "/" : "/?vista=lista", { scroll: false })}
                aria-pressed={vista === v}
                className={`rounded-lg px-4 font-semibold ${vista === v ? "bg-white shadow-sm" : "text-neutral-600 hover:text-neutral-900"}`}
              >
                {v === "quadro" ? "Quadro" : "Lista"}
              </button>
            ))}
          </div>
          {vista === "lista" && (
            <select
              value={origem ?? ""}
              onChange={(e) => setOrigem(e.target.value || null)}
              aria-label="Filtrar por origem"
              className="h-11 rounded-xl border border-neutral-300 bg-white px-3"
            >
              <option value="">Todas as origens</option>
              {ORIGENS.map((o) => (
                <option key={o.chave} value={o.chave}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          )}
          <input
            type="search"
            placeholder="Buscar por nome ou telefone"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-11 w-72 rounded-xl border border-neutral-300 bg-white px-4 outline-none focus:border-[var(--cor-principal)]"
          />
        </div>
      </div>

      {vista === "quadro" ? (
        <QuadroRetorno busca={buscaAtrasada} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {FILTROS.map((f) => {
              const aceita = arrastando !== null && f.chave in SOLTAR;
              return (
                <button
                  key={f.chave}
                  onClick={() => escolherFiltro(f.chave)}
                  aria-pressed={filtro === f.chave}
                  onDragOver={(e) => {
                    if (!aceita) return;
                    e.preventDefault();
                    setSobre(f.chave);
                  }}
                  onDragLeave={() => setSobre((s) => (s === f.chave ? null : s))}
                  onDrop={(e) => {
                    e.preventDefault();
                    soltar(f.chave);
                  }}
                  className={`h-10 rounded-full px-4 font-semibold transition ${
                    filtro === f.chave ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50"
                  } ${aceita ? "ring-2 ring-[var(--cor-principal)] ring-offset-2" : ""} ${
                    sobre === f.chave ? "scale-110 bg-[var(--cor-principal)] text-white" : ""
                  } ${arrastando && !aceita ? "opacity-40" : ""}`}
                >
                  {f.rotulo} ({contagem?.[f.chave] ?? "…"})
                </button>
              );
            })}
          </div>
          <p className="-mt-2 mb-4 text-sm text-neutral-500">
            {arrastando
              ? `Solte ${arrastando.nome ?? "a cliente"} em Inativas ou Em dia, ou em Todas para voltar ao status automático.`
              : "Dica: arraste uma cliente para Inativas ou Em dia para mudar o status dela."}
          </p>

          {erroAcao && <p className="mb-4 rounded-xl bg-red-100 p-4 text-red-900">{erroAcao}</p>}
          {lista?.erro && <p className="rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler as clientes: {lista.erro}</p>}

          <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
            <table className="w-full text-left">
              <thead className="bg-neutral-50 text-sm text-neutral-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Cliente</th>
                  <th className="px-4 py-3 font-medium">Telefone</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Última visita</th>
                  <th className="px-4 py-3 font-medium">Retorno / horário</th>
                  <th className="px-4 py-3 font-medium">Visitas</th>
                  <th className="px-4 py-3 font-medium">Origem</th>
                  <th className="px-4 py-3 font-medium">Último contato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {!lista && (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-neutral-500">
                      Carregando…
                    </td>
                  </tr>
                )}
                {lista && !lista.erro && lista.itens.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-neutral-500">
                      Nenhuma cliente aqui.
                    </td>
                  </tr>
                )}
                {lista?.itens.map((c) => {
                  const proximo = textoProximo(c);
                  const dias = diasDesdeContato(c.ultimo_contato);
                  const o = lerOrigem(c.etiquetas);
                  const destaque = DESTAQUE[c.status];
                  return (
                    <tr
                      key={c.id}
                      draggable={filtro !== "excluidas"}
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = "move";
                        e.dataTransfer.setData("text/plain", c.id);
                        setArrastando(c);
                      }}
                      onDragEnd={() => {
                        setArrastando(null);
                        setSobre(null);
                      }}
                      className={`align-top ${destaque?.linha ?? "hover:bg-neutral-50"} ${
                        filtro !== "excluidas" ? "cursor-grab active:cursor-grabbing" : ""
                      } ${arrastando?.id === c.id ? "opacity-40" : ""}`}
                    >
                      <td className={`px-4 py-3 ${destaque ? `border-l-4 ${destaque.borda}` : "border-l-4 border-transparent"}`}>
                        <Link href={`/clientes/${c.id}`} draggable={false} className="font-semibold hover:underline">
                          {c.nome ?? "Sem nome"}
                        </Link>
                        <Etiquetas etiquetas={c.etiquetas} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-700">{formatarTelefone(c.telefone)}</td>
                      <td className="px-4 py-3">
                        {filtro === "excluidas" ? (
                          <button
                            onClick={() => restaurar(c)}
                            disabled={restaurando === c.id}
                            className="h-9 rounded-lg border border-neutral-300 bg-white px-3 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"
                          >
                            {restaurando === c.id ? "…" : "Restaurar"}
                          </button>
                        ) : (
                          <SeloStatus status={c.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.ultima_visita ? (
                          <>
                            {formatarData(c.ultima_visita)}
                            <span className="block text-sm text-neutral-500">{haQuantoTempo(c.ultima_visita)}</span>
                          </>
                        ) : (
                          <span className="text-neutral-500">Nunca veio</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {proximo ? (
                          <>
                            {proximo.rotulo === "Marcado" ? "Marcado " : ""}
                            {proximo.valor}
                            <span className={`block text-sm ${destaque && proximo.rotulo !== "Marcado" ? destaque.texto : "text-neutral-500"}`}>
                              {proximo.detalhe}
                            </span>
                          </>
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">{c.total_visitas}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-700">{o ? rotuloOrigem(o) : "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-neutral-700">
                        {dias === null ? "—" : textoChamada(dias)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {lista?.temMais && (
            <button
              onClick={verMais}
              disabled={lista.carregandoMais}
              className="mt-4 h-11 w-full rounded-xl border border-neutral-300 bg-white font-semibold hover:bg-neutral-50 disabled:opacity-50"
            >
              {lista.carregandoMais ? "Carregando…" : "Ver mais"}
            </button>
          )}
        </>
      )}
    </>
  );
}
