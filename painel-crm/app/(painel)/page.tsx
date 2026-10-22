"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { useDialogo } from "@/components/Dialogo";
import { Etiquetas } from "@/components/Etiquetas";
import { PainelManutencao } from "@/components/PainelManutencao";
import { QuadroRetorno } from "@/components/QuadroRetorno";
import type { StatusCliente } from "@/lib/status";
import { diasDesdeContato } from "@/lib/alo";
import { useEmpresa } from "@/lib/empresa";
import { excluirCliente, restaurarCliente } from "@/lib/excluidas";
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
import { useTempoReal } from "@/lib/tempoReal";

const VISTAS = [
  { chave: "quadro", rotulo: "Quadro" },
  { chave: "lista", rotulo: "Lista" },
  { chave: "manutencao", rotulo: "Manutenção" },
] as const;

const FILTROS: { chave: FiltroClientes; rotulo: string }[] = [
  { chave: "todas", rotulo: "Todas" },
  { chave: "para_chamar", rotulo: "Para chamar" },
  { chave: "retorno_chegando", rotulo: "Retorno chegando" },
  { chave: "atrasadas_recentes", rotulo: "Atrasadas até 30 dias" },
  { chave: "atrasadas_antigas", rotulo: "Atrasadas há +30 dias" },
  { chave: "inativa", rotulo: "Inativas" },
  { chave: "agendadas", rotulo: "Agendadas" },
  { chave: "em_dia", rotulo: "Em dia" },
  { chave: "sem_visita", rotulo: "Sem visita" },
  { chave: "excluidas", rotulo: "Excluídas" },
];

// Linhas em destaque: atrasadas (rosé/argila) e retorno chegando (mel)
const DESTAQUE: Partial<Record<StatusCliente, { linha: string; borda: string; texto: string }>> = {
  retorno_atrasado: { linha: "bg-rose/40 hover:bg-rose/60", borda: "border-status-atrasada", texto: "font-semibold text-rose-texto" },
  retorno_chegando: { linha: "bg-mel/40 hover:bg-mel/60", borda: "border-status-chegando", texto: "font-semibold text-mel-texto" },
};

function textoChamada(dias: number): string {
  return dias === 0 ? "hoje" : `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

// CRM completo do salão escolhido: tabela com todas as clientes, filtros e origem.
// Quem chama as clientes é a IA de retorno; aqui a agência só acompanha.
export default function CrmPage() {
  return (
    <Suspense fallback={<p className="py-8 text-texto-2">Carregando…</p>}>
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
  // e o controle da manutenção (quem está perto do retorno) em ?vista=manutencao
  const vista = VISTAS.find((v) => v.chave === params.get("vista"))?.chave ?? "quadro";
  const filtro = FILTROS.find((f) => f.chave === params.get("filtro"))?.chave ?? "todas";
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const [erroAcao, setErroAcao] = useState("");
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [processando, setProcessando] = useState<{ feitas: number; total: number } | null>(null);
  const { dialogo, perguntar } = useDialogo();
  const buscaAtrasada = useAtraso(busca);
  // Atendimento marcado/desmarcado na Agenda do salão atualiza a lista e as contagens sozinho
  useTempoReal(["agendamentos", "clientes"], empresa.id, () => setVersao((v) => v + 1));
  const diasLimite = diasLimiteCelular(empresa.config);
  const contagem = useContagemClientes(empresa.id, diasLimite, versao);
  const { lista, verMais } = useListaClientes(
    empresa.id,
    { filtro, busca: buscaAtrasada, origem, diasLimite },
    50,
    versao,
  );

  function escolherFiltro(chave: FiltroClientes) {
    setSelecionadas([]);
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

  // Seleção da Lista: marcar várias clientes e excluir (ou, em "Excluídas", restaurar) de uma vez
  const idsNaTela = lista?.itens.map((c) => c.id) ?? [];
  const todasMarcadas = idsNaTela.length > 0 && idsNaTela.every((id) => selecionadas.includes(id));

  function alternarSelecao(id: string) {
    setSelecionadas((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function acaoEmMassa() {
    const ids = selecionadas;
    const restaurarTodas = filtro === "excluidas";
    const quantas = `${ids.length} ${ids.length === 1 ? "cliente" : "clientes"}`;
    const ok = await perguntar(
      restaurarTodas
        ? `Restaurar ${quantas}?\n\nElas voltam para o Quadro, a Lista e o app do salão.`
        : `Excluir ${quantas}?\n\nElas saem do Quadro, da Lista e do app do salão (Início, Agenda e Conversas). ` +
            "O histórico fica guardado e dá para restaurar no filtro Excluídas.",
      { confirmar: restaurarTodas ? "Restaurar" : "Excluir", perigo: !restaurarTodas },
    );
    if (!ok) return;
    const falhas: string[] = [];
    setProcessando({ feitas: 0, total: ids.length });
    for (const [i, id] of ids.entries()) {
      const erro = restaurarTodas ? await restaurarCliente(id) : await excluirCliente(id);
      if (erro) falhas.push(erro);
      setProcessando({ feitas: i + 1, total: ids.length });
    }
    setProcessando(null);
    setSelecionadas([]);
    setErroAcao(falhas.length ? `${falhas.length} de ${ids.length} não foram salvas: ${falhas[0]}` : "");
    setVersao((v) => v + 1);
  }

  return (
    <>
      <div className="flex items-end justify-between gap-4 pt-8 pb-4">
        <div>
          <h1 className="font-serif text-[40px] leading-tight font-semibold">Clientes</h1>
          <p className="text-texto-2">
            {contagem ? `${contagem.todas} clientes` : "…"} · {empresa.nome}
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex h-11 rounded-xl bg-campo p-1" role="group" aria-label="Como ver as clientes">
            {VISTAS.map((v) => (
              <button
                key={v.chave}
                onClick={() => router.replace(v.chave === "quadro" ? "/" : `/?vista=${v.chave}`, { scroll: false })}
                aria-pressed={vista === v.chave}
                className={`rounded-lg px-4 font-semibold ${vista === v.chave ? "bg-card shadow-[0_1px_2px_rgba(33,22,16,0.08)]" : "text-texto-2 hover:text-grafite"}`}
              >
                {v.rotulo}
              </button>
            ))}
          </div>
          {vista === "lista" && (
            <select
              value={origem ?? ""}
              onChange={(e) => {
                setOrigem(e.target.value || null);
                setSelecionadas([]);
              }}
              aria-label="Filtrar por origem"
              className="h-11 rounded-xl border border-borda bg-card px-3"
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
            onChange={(e) => {
              setBusca(e.target.value);
              setSelecionadas([]);
            }}
            className="h-11 w-72 rounded-xl border border-borda bg-card px-4 outline-none focus:border-[var(--cor-principal)]"
          />
        </div>
      </div>

      {vista === "quadro" ? (
        <QuadroRetorno busca={buscaAtrasada} />
      ) : vista === "manutencao" ? (
        <PainelManutencao busca={buscaAtrasada} />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            {FILTROS.map((f) => (
              <button
                key={f.chave}
                onClick={() => escolherFiltro(f.chave)}
                aria-pressed={filtro === f.chave}
                className={`h-10 rounded-full px-4 font-semibold ${
                  filtro === f.chave ? "chip-ativo" : "border border-grafite/10 bg-card text-grafite hover:bg-campo/60"
                }`}
              >
                {f.rotulo} ({contagem?.[f.chave] ?? "…"})
              </button>
            ))}
          </div>
          <p className="-mt-2 mb-4 text-sm text-texto-2">
            Para mudar a cliente de etapa ou de status, use o Quadro: lá dá para arrastar.
          </p>

          {selecionadas.length > 0 && (
            <div className="sticky top-16 z-10 mb-4 flex items-center justify-between gap-4 rounded-2xl border border-grafite/10 bg-card px-4 py-3 shadow-md">
              <span className="font-semibold">
                {selecionadas.length} {selecionadas.length === 1 ? "cliente selecionada" : "clientes selecionadas"}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setSelecionadas([])}
                  disabled={processando !== null}
                  className="h-10 rounded-xl border border-borda px-4 font-semibold hover:bg-campo/60 disabled:opacity-50"
                >
                  Limpar seleção
                </button>
                <button
                  onClick={acaoEmMassa}
                  disabled={processando !== null}
                  className={`h-10 rounded-xl px-4 font-bold disabled:opacity-60 ${
                    filtro === "excluidas" ? "bg-grafite text-perola" : "bg-rose-texto text-white hover:bg-[#7a301f]"
                  }`}
                >
                  {processando
                    ? `${filtro === "excluidas" ? "Restaurando" : "Excluindo"} ${processando.feitas} de ${processando.total}…`
                    : filtro === "excluidas"
                      ? "Restaurar selecionadas"
                      : "Excluir selecionadas"}
                </button>
              </div>
            </div>
          )}
          {erroAcao && <p className="mb-4 rounded-xl bg-rose p-4 text-rose-texto">{erroAcao}</p>}
          {lista?.erro && <p className="rounded-xl bg-rose p-4 text-rose-texto">Erro ao ler as clientes: {lista.erro}</p>}

          <div className="overflow-hidden rounded-2xl border border-grafite/10 bg-card shadow-[0_1px_2px_rgba(33,22,16,0.05),0_4px_14px_rgba(33,22,16,0.05)]">
            <table className="w-full text-left">
              <thead className="bg-campo/60 text-sm text-texto-2">
                <tr>
                  <th className="w-10 py-3 pr-1 pl-4">
                    <input
                      type="checkbox"
                      checked={todasMarcadas}
                      onChange={() => setSelecionadas(todasMarcadas ? [] : idsNaTela)}
                      disabled={idsNaTela.length === 0}
                      aria-label="Selecionar todas desta lista"
                      title="Selecionar todas desta lista"
                      className="h-5 w-5 accent-[var(--cor-principal)]"
                    />
                  </th>
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
              <tbody className="divide-y divide-borda/60">
                {!lista && (
                  <tr>
                    <td colSpan={9} className="px-4 py-6 text-texto-2">
                      Carregando…
                    </td>
                  </tr>
                )}
                {lista && !lista.erro && lista.itens.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-texto-2">
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
                      className={`align-top ${selecionadas.includes(c.id) ? "bg-cobre-claro/60" : (destaque?.linha ?? "hover:bg-campo/60")}`}
                    >
                      <td className={`py-3 pr-1 pl-3 ${destaque ? `border-l-4 ${destaque.borda}` : "border-l-4 border-transparent"}`}>
                        <input
                          type="checkbox"
                          checked={selecionadas.includes(c.id)}
                          onChange={() => alternarSelecao(c.id)}
                          aria-label={`Selecionar ${c.nome ?? "cliente"}`}
                          className="h-5 w-5 accent-[var(--cor-principal)]"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/clientes/${c.id}`} className="font-semibold hover:underline">
                          {c.nome ?? "Sem nome"}
                        </Link>
                        <Etiquetas etiquetas={c.etiquetas} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-texto-2">{formatarTelefone(c.telefone)}</td>
                      <td className="px-4 py-3">
                        {filtro === "excluidas" ? (
                          <button
                            onClick={() => restaurar(c)}
                            disabled={restaurando === c.id}
                            className="h-9 rounded-lg border border-borda bg-card px-3 text-sm font-semibold hover:bg-campo/60 disabled:opacity-50"
                          >
                            {restaurando === c.id ? "…" : "Restaurar"}
                          </button>
                        ) : (
                          // Marcou ou remarcou: aparece como Agendada (o banco diz "em dia")
                          c.proximo_agendamento ? (
                            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-salvia px-2.5 py-0.5 text-sm font-semibold text-salvia-texto">
                              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-salvia-viva" />
                              Agendada
                            </span>
                          ) : (
                            <SeloStatus status={c.status} />
                          )
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.ultima_visita ? (
                          <>
                            {formatarData(c.ultima_visita)}
                            <span className="block text-sm text-texto-2">{haQuantoTempo(c.ultima_visita)}</span>
                          </>
                        ) : (
                          <span className="text-texto-2">Nunca veio</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {proximo ? (
                          <>
                            {proximo.rotulo === "Marcado" ? "Marcado " : ""}
                            {proximo.valor}
                            <span className={`block text-sm ${destaque && proximo.rotulo !== "Marcado" ? destaque.texto : "text-texto-2"}`}>
                              {proximo.detalhe}
                            </span>
                          </>
                        ) : (
                          <span className="text-inativo">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">{c.total_visitas}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-texto-2">{o ? rotuloOrigem(o) : "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-texto-2">
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
              className="mt-4 h-11 w-full rounded-xl border border-borda bg-card font-semibold hover:bg-campo/60 disabled:opacity-50"
            >
              {lista.carregandoMais ? "Carregando…" : "Ver mais"}
            </button>
          )}
          {dialogo}
        </>
      )}
    </>
  );
}
