"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import { useDialogo } from "@/components/Dialogo";
import { Etiquetas } from "@/components/Etiquetas";
import { PainelManutencao } from "@/components/PainelManutencao";
import { Aviso, Chip, Numero, botao, botaoForte, campoBase, cartao, opcao } from "@/components/Pecas";
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
import { etapaDe, faltaEnviar, useQuadro, type Etapa } from "@/lib/quadro";
import { SeloStatus } from "@/lib/status";
import { useTempoReal } from "@/lib/tempoReal";

// A tela é lida de cima para baixo:
//   1. resumo do que pede atenção hoje (quatro números, tirados do quadro);
//   2. como ver as clientes (Quadro, Lista ou Manutenção) e a busca;
//   3. a vista escolhida, com os filtros dela.

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

// Os filtros da Lista em dois grupos: quem pede uma ação da agência e as demais situações
const GRUPOS: { titulo: string; filtros: FiltroClientes[] }[] = [
  { titulo: "Pedem atenção", filtros: ["para_chamar", "retorno_chegando", "atrasadas_recentes", "atrasadas_antigas", "inativa"] },
  { titulo: "Situação", filtros: ["todas", "agendadas", "em_dia", "sem_visita", "excluidas"] },
];

// Prazo em destaque: atrasadas (rosé) e retorno chegando (mel). O status vem escrito no selo ao lado.
const DESTAQUE: Partial<Record<StatusCliente, string>> = {
  retorno_atrasado: "font-bold text-rose-texto",
  retorno_chegando: "font-bold text-mel-texto",
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
  // O quadro (colunas de retorno) alimenta o resumo do topo e a vista Quadro. Horário novo da IA, alô que
  // saiu pelo WhatsApp do salão etc.: ele se atualiza sozinho
  const [versaoQuadro, setVersaoQuadro] = useState(0);
  const { quadro, trocarCard } = useQuadro(empresa.id, versaoQuadro);
  // Fora da vista Quadro a mudança só fica anotada (para não pesar no banco); ao voltar para o Quadro ele é lido de novo
  const quadroVelho = useRef(false);
  useTempoReal(["agendamentos", "clientes", "mensagens"], empresa.id, () => {
    if (vista === "quadro") setVersaoQuadro((v) => v + 1);
    else quadroVelho.current = true;
  });
  function escolherVista(chave: (typeof VISTAS)[number]["chave"]) {
    if (chave === "quadro" && quadroVelho.current) {
      quadroVelho.current = false;
      setVersaoQuadro((v) => v + 1);
    }
    router.replace(chave === "quadro" ? "/" : `/?vista=${chave}`, { scroll: false });
  }
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
    setVersaoQuadro((v) => v + 1);
  }

  // Resumo do dia: sai do mesmo quadro que a vista Quadro mostra, para os números baterem com as colunas
  const cards = quadro && !quadro.erro ? quadro.cards : null;
  const naEtapa = (etapa: Etapa) => (cards ? cards.filter((c) => etapaDe(c) === etapa).length : null);
  const paraChamar = naEtapa("para_chamar");
  const responderam = naEtapa("respondeu");
  const agendadas = naEtapa("agendado");
  const atrasadas = cards ? cards.filter((c) => c.status === "retorno_atrasado").length : null;
  const faltamEnviar = cards ? cards.filter(faltaEnviar).length : 0;
  const espera = quadro?.erro ? "não deu para ler agora" : "carregando…";

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4 pt-9 pb-6">
        <div>
          <p className="rotulo">{empresa.nome}</p>
          <h1 className="mt-1 font-serif text-[30px] leading-tight">Clientes</h1>
        </div>
        <p className="text-[14px] font-semibold text-apoio">{contagem ? `${contagem.todas.toLocaleString("pt-BR")} clientes no salão` : "…"}</p>
      </header>

      {/* 1. O que pede atenção hoje */}
      <section aria-label="Resumo de hoje" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Numero
          rotulo="Para chamar"
          valor={paraChamar}
          apoio={!cards ? espera : faltamEnviar > 0 ? `${faltamEnviar} com mensagem aberta, falta enviar` : paraChamar ? "esperando a primeira mensagem" : "ninguém para chamar agora"}
          tom={faltamEnviar > 0 ? "aviso" : undefined}
        />
        <Numero rotulo="Responderam" valor={responderam} apoio={!cards ? espera : responderam ? "falta marcar o horário" : "nenhuma resposta esperando"} tom={responderam ? "aviso" : undefined} />
        <Numero rotulo="Atrasadas" valor={atrasadas} apoio={!cards ? espera : atrasadas ? "passaram da data de retorno" : "ninguém atrasada"} tom={atrasadas ? "atencao" : undefined} />
        <Numero rotulo="Agendadas" valor={agendadas} apoio={!cards ? espera : agendadas ? "com horário marcado" : "nenhum horário marcado"} />
      </section>

      {quadro?.erro && vista !== "quadro" && (
        <div className="mt-3">
          <Aviso tom="atencao">Erro ao ler o resumo: {quadro.erro}</Aviso>
        </div>
      )}

      {/* 2. Como ver as clientes, e a busca */}
      <div className="mt-9 mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-[14px] bg-campo p-1" role="group" aria-label="Como ver as clientes">
          {VISTAS.map((v) => (
            <button
              key={v.chave}
              onClick={() => escolherVista(v.chave)}
              aria-pressed={vista === v.chave}
              className={`h-10 rounded-[10px] px-5 text-[14px] ${vista === v.chave ? "bg-onix font-bold text-porcelana" : "font-semibold text-grafite hover:bg-card/60"}`}
            >
              {v.rotulo}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {vista === "lista" && (
            <select
              value={origem ?? ""}
              onChange={(e) => {
                setOrigem(e.target.value || null);
                setSelecionadas([]);
              }}
              aria-label="Filtrar por origem"
              className={campoBase + " font-semibold"}
            >
              <option value="">Todas as origens</option>
              {ORIGENS.map((o) => (
                <option key={o.chave} value={o.chave}>
                  {o.rotulo}
                </option>
              ))}
            </select>
          )}
          <div className="relative">
            <label htmlFor="busca-clientes" className="sr-only">
              Buscar cliente por nome ou telefone
            </label>
            <svg
              className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-apoio"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="busca-clientes"
              type="search"
              placeholder="Buscar por nome ou telefone"
              value={busca}
              onChange={(e) => {
                setBusca(e.target.value);
                setSelecionadas([]);
              }}
              className={campoBase + " w-72 pl-10"}
            />
          </div>
        </div>
      </div>

      {/* 3. A vista escolhida */}
      {vista === "quadro" ? (
        <QuadroRetorno busca={buscaAtrasada} quadro={quadro} trocarCard={trocarCard} aoRecarregar={() => setVersaoQuadro((v) => v + 1)} />
      ) : vista === "manutencao" ? (
        <PainelManutencao busca={buscaAtrasada} />
      ) : (
        <>
          <div className={`${cartao} mb-4 px-5 py-4`}>
            <div className="grid gap-x-5 gap-y-3 md:grid-cols-[9.5rem_1fr]">
              {GRUPOS.map((g) => (
                <div key={g.titulo} className="contents">
                  <p className="rotulo md:pt-3.5">{g.titulo}</p>
                  <div className="flex flex-wrap gap-2" role="group" aria-label={`Filtros: ${g.titulo}`}>
                    {g.filtros.map((chave) => {
                      const f = FILTROS.find((x) => x.chave === chave)!;
                      return (
                        <button key={f.chave} onClick={() => escolherFiltro(f.chave)} aria-pressed={filtro === f.chave} className={opcao(filtro === f.chave)}>
                          {f.rotulo}
                          <span className={`font-semibold tabular-nums ${filtro === f.chave ? "" : "text-apoio"}`}>{contagem?.[f.chave] ?? "…"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-borda pt-3 text-[14px] text-apoio">Para mudar a cliente de etapa ou de status, use o Quadro: lá dá para arrastar.</p>
          </div>

          {selecionadas.length > 0 && (
            <div className="sticky top-3 z-10 mb-4 flex flex-wrap items-center justify-between gap-3 rounded-[18px] border border-onix bg-card px-5 py-3">
              <span className="text-[15px] font-bold" role="status">
                {selecionadas.length} {selecionadas.length === 1 ? "cliente selecionada" : "clientes selecionadas"}
              </span>
              <div className="flex gap-2">
                <button onClick={() => setSelecionadas([])} disabled={processando !== null} className={botao}>
                  Limpar seleção
                </button>
                <button
                  onClick={acaoEmMassa}
                  disabled={processando !== null}
                  className={
                    filtro === "excluidas"
                      ? botaoForte
                      : "inline-flex h-10 items-center justify-center rounded-xl bg-atencao px-5 text-[14px] font-bold text-white hover:bg-rose-texto disabled:opacity-50"
                  }
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
          {erroAcao && (
            <div className="mb-4">
              <Aviso tom="atencao">{erroAcao}</Aviso>
            </div>
          )}
          {lista?.erro && (
            <div className="mb-4">
              <Aviso tom="atencao">Erro ao ler as clientes: {lista.erro}</Aviso>
            </div>
          )}

          <div className={`${cartao} overflow-x-auto`}>
            <table className="w-full text-left text-[15px]">
              <thead className="border-b border-borda bg-campo/50 text-[13px] text-texto-2">
                <tr>
                  <th className="w-12 py-1 pr-1 pl-3">
                    <label className="flex h-10 w-10 cursor-pointer items-center justify-center" title="Selecionar todas desta lista">
                      <input
                        type="checkbox"
                        checked={todasMarcadas}
                        onChange={() => setSelecionadas(todasMarcadas ? [] : idsNaTela)}
                        disabled={idsNaTela.length === 0}
                        aria-label="Selecionar todas desta lista"
                        className="h-5 w-5 accent-[var(--color-onix)]"
                      />
                    </label>
                  </th>
                  <th className="px-4 py-3 font-bold">Cliente</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold">Última visita</th>
                  <th className="px-4 py-3 font-bold">Retorno ou horário</th>
                  <th className="px-4 py-3 text-right font-bold">Visitas</th>
                  <th className="px-4 py-3 font-bold">Origem</th>
                  <th className="px-4 py-3 font-bold">Último contato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {!lista && (
                  <tr>
                    <td colSpan={8} className="px-5 py-6 text-texto-2">
                      Carregando…
                    </td>
                  </tr>
                )}
                {lista && !lista.erro && lista.itens.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-5 py-8 text-center text-texto-2">
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
                    <tr key={c.id} className={`align-top ${selecionadas.includes(c.id) ? "bg-campo/70" : "hover:bg-campo/40"}`}>
                      <td className="py-1.5 pr-1 pl-3">
                        <label className="flex h-10 w-10 cursor-pointer items-center justify-center">
                          <input
                            type="checkbox"
                            checked={selecionadas.includes(c.id)}
                            onChange={() => alternarSelecao(c.id)}
                            aria-label={`Selecionar ${c.nome ?? "cliente"}`}
                            className="h-5 w-5 accent-[var(--color-onix)]"
                          />
                        </label>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/clientes/${c.id}`} className="-my-2.5 inline-block py-2.5 font-bold underline-offset-4 hover:underline">
                          {c.nome?.trim() || "Sem nome"}
                        </Link>
                        <span className="block text-[14px] whitespace-nowrap text-apoio">{formatarTelefone(c.telefone)}</span>
                        <Etiquetas etiquetas={c.etiquetas} className="mt-1.5" />
                      </td>
                      <td className="px-4 py-3">
                        {filtro === "excluidas" ? (
                          <button onClick={() => restaurar(c)} disabled={restaurando === c.id} className={botao}>
                            {restaurando === c.id ? "…" : "Restaurar"}
                          </button>
                        ) : // Marcou ou remarcou: aparece como Agendada (o banco diz "em dia")
                        c.proximo_agendamento ? (
                          <Chip tom="ok">Agendada</Chip>
                        ) : (
                          <SeloStatus status={c.status} />
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.ultima_visita ? (
                          <>
                            {formatarData(c.ultima_visita)}
                            <span className="block text-[14px] text-apoio">{haQuantoTempo(c.ultima_visita)}</span>
                          </>
                        ) : (
                          <span className="text-apoio">Nunca veio</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {proximo ? (
                          <>
                            {proximo.rotulo === "Marcado" ? "Marcado " : ""}
                            {proximo.valor}
                            <span className={`block text-[14px] ${destaque && proximo.rotulo !== "Marcado" ? destaque : "text-apoio"}`}>{proximo.detalhe}</span>
                          </>
                        ) : (
                          <span className="text-apoio">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.total_visitas}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-texto-2">{o ? rotuloOrigem(o) : "—"}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-texto-2">{dias === null ? "—" : textoChamada(dias)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {lista?.temMais && (
            <button onClick={verMais} disabled={lista.carregandoMais} className={botao + " mt-4 h-11 w-full"}>
              {lista.carregandoMais ? "Carregando…" : "Ver mais"}
            </button>
          )}
          {dialogo}
        </>
      )}
    </>
  );
}
