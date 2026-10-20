"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { Etiquetas } from "@/components/Etiquetas";
import { BotaoMandarAlo, textoChamada } from "@/components/MandarAlo";
import { diasDesdeContato } from "@/lib/alo";
import { useEmpresa } from "@/lib/empresa";
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

const FILTROS: { chave: FiltroClientes; rotulo: string }[] = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "para_chamar", rotulo: "Para chamar" },
  { chave: "retorno_chegando", rotulo: "Retorno chegando" },
  { chave: "atrasadas_recentes", rotulo: "Atrasadas até 30 dias" },
  { chave: "atrasadas_antigas", rotulo: "Atrasadas há +30 dias" },
  { chave: "inativa", rotulo: "Inativas" },
  { chave: "em_dia", rotulo: "Em dia" },
  { chave: "sem_visita", rotulo: "Sem visita" },
];

// CRM completo do salão escolhido: tabela com todas as clientes, filtros, origem e o
// "Mandar alô" manual (plano B; o normal é a IA de retorno chamar sozinha).
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
  const filtro = FILTROS.find((f) => f.chave === params.get("filtro"))?.chave ?? "todas";
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
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
    router.replace(`/?filtro=${chave}`, { scroll: false });
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
          <input
            type="search"
            placeholder="Buscar por nome ou telefone"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-11 w-72 rounded-xl border border-neutral-300 bg-white px-4 outline-none focus:border-[var(--cor-principal)]"
          />
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.chave}
            onClick={() => escolherFiltro(f.chave)}
            aria-pressed={filtro === f.chave}
            className={`h-10 rounded-full px-4 font-semibold ${
              filtro === f.chave ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50"
            }`}
          >
            {f.rotulo} ({contagem?.[f.chave] ?? "…"})
          </button>
        ))}
      </div>

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
              <th className="px-4 py-3 font-medium">Último alô</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {!lista && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-neutral-500">
                  Carregando…
                </td>
              </tr>
            )}
            {lista && !lista.erro && lista.itens.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-neutral-500">
                  Nenhuma cliente aqui.
                </td>
              </tr>
            )}
            {lista?.itens.map((c) => {
              const proximo = textoProximo(c);
              const dias = diasDesdeContato(c.ultimo_contato);
              const o = lerOrigem(c.etiquetas);
              return (
                <tr key={c.id} className="align-top hover:bg-neutral-50">
                  <td className="px-4 py-3">
                    <Link href={`/clientes/${c.id}`} className="font-semibold hover:underline">
                      {c.nome ?? "Sem nome"}
                    </Link>
                    <Etiquetas etiquetas={c.etiquetas} />
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-neutral-700">{formatarTelefone(c.telefone)}</td>
                  <td className="px-4 py-3">
                    <SeloStatus status={c.status} />
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
                        <span className={`block text-sm ${proximo.atrasado ? "text-orange-700" : "text-neutral-500"}`}>
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
                  <td className="px-4 py-3 text-right">
                    <BotaoMandarAlo
                      cliente={c}
                      servico={lista.servicos[c.id] ?? null}
                      aoChamar={() => setVersao((v) => v + 1)}
                      compacto
                    />
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
  );
}
