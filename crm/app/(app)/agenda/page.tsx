"use client";

import Link from "next/link";
import { TelaDaAba } from "@/components/TelaDaAba";
import { useEffect, useRef, useState } from "react";
import { useDialogo } from "@/components/Dialogo";
import { Etiquetas } from "@/components/Etiquetas";
import { Folha } from "@/components/Folha";
import { FolhaConfirmar, type TelaConfirmar } from "@/components/FolhaConfirmar";
import { FormAtendimento } from "@/components/FormAtendimento";
import { Observacao } from "@/components/Observacao";
import {
  buscarAtendimentosDoDia,
  buscarDiasComHorario,
  comQuantidade,
  confirmarAtendimento,
  corDaProfissional,
  desfazerConfirmacao,
  ehFeitoJunto,
  naoAtendida,
  excluirAtendimento,
  feitosJunto,
  marcarChegou,
  mudarStatus,
  nomeCurto,
  reagendar,
  resumoDosServicos,
  ultimoReagendamento,
  type Atendimento,
} from "@/lib/atendimentos";
import { lerAlmoco } from "@/lib/almoco";
import { confirmarAvaliacao, useIntencoes, type Avaliacao, type ResultadoAvaliacao } from "@/lib/avaliacoes";
import { bloqueioDoDia, bloqueiosHorarioDoDia } from "@/lib/bloqueios";
import { useEmpresa } from "@/lib/empresa";
import {
  formatarData,
  formatarHora,
  formatarTelefone,
  hojeNoSalao,
  instanteNoSalao,
  somarDias,
} from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import { useAgora } from "@/lib/relogio";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";
import type { Profissional, ServicoAtivo } from "@/lib/tipos";

// Agenda (desenho Oi Studio): mês e "+" no topo, faixa da semana (deslizar troca de semana) e o dia
// numa lista só, em ordem de hora, com a situação de cada horário à direita, o almoço e os
// intervalos livres ("Encaixar"). Tocar num horário abre a folha com Chegou, Concluir e Faltou.
const DIAS_LONGOS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

type Dia = { atendimentos: Atendimento[]; profissionais: Profissional[]; comHorario: Set<string> } | { erro: string };

// Segunda-feira da semana do dia
function inicioDaSemana(dia: string): string {
  const semana = new Date(`${dia}T12:00:00Z`).getUTCDay();
  return somarDias(dia, -((semana + 6) % 7));
}

async function buscarDia(empresaId: string, dia: string): Promise<Dia> {
  const segunda = inicioDaSemana(dia);
  const [atendimentos, profissionais, comHorario] = await Promise.all([
    buscarAtendimentosDoDia(empresaId, dia),
    supabase().from("profissionais").select("id, nome").eq("empresa_id", empresaId).order("nome"),
    buscarDiasComHorario(empresaId, segunda, somarDias(segunda, 6)),
  ]);
  if (atendimentos.erro) return { erro: atendimentos.erro };
  if (profissionais.error) return { erro: profissionais.error.message };
  return {
    atendimentos: atendimentos.atendimentos,
    profissionais: profissionais.data as Profissional[],
    comHorario,
  };
}

function minutos(a: Atendimento): number {
  if (!a.fim) return 60;
  return Math.max(15, Math.round((Date.parse(a.fim) - Date.parse(a.inicio)) / 60_000));
}

function duracao(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}h${String(m).padStart(2, "0")}` : h ? `${h}h` : `${m} min`;
}


export default function AgendaPage() {
  return (
    <TelaDaAba>
      <AgendaPageConteudo />
    </TelaDaAba>
  );
}

// Iniciais dos dias na faixa da semana (de segunda a domingo)
const LETRAS = ["S", "T", "Q", "Q", "S", "S", "D"];

function AgendaPageConteudo() {
  const empresa = useEmpresa();
  const [dia, setDia] = useState(hojeNoSalao());
  const [resultado, setResultado] = useState<{ dia: string; dados: Dia } | null>(null);
  const [versao, setVersao] = useState(0);
  // Folha do horário tocado (ações e detalhes)
  const [aberto, setAberto] = useState<string | null>(null);
  // Folha "Foi isso / Fez outra coisa / Faltou / Remarcar"
  const [confirmando, setConfirmando] = useState<{ atendimento: Atendimento; tela: TelaConfirmar } | null>(null);
  // "+" e "Encaixar": novo horário marcado pela dona, já com o dia (e a hora do intervalo livre)
  const [novo, setNovo] = useState<{ hora?: string } | null>(null);
  const [servicos, setServicos] = useState<ServicoAtivo[]>([]);
  const agora = useAgora();
  const { dialogo, perguntar, avisar } = useDialogo();
  const recarregar = () => setVersao((v) => v + 1);

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
    buscarDia(empresa.id, dia).then((dados) => {
      if (ativo) setResultado({ dia, dados });
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, dia, versao]);

  useTempoReal(["agendamentos"], empresa.id, recarregar);

  const hoje = hojeNoSalao();
  // Virou o dia com o app aberto (o relógio anda a cada minuto): quem estava olhando "hoje"
  // passa para o dia novo, em vez de ficar parada no dia anterior
  const [hojeVisto, setHojeVisto] = useState(hoje);
  if (hoje !== hojeVisto) {
    setHojeVisto(hoje);
    if (dia === hojeVisto) setDia(hoje);
  }
  const dados = resultado?.dia === dia ? resultado.dados : null;
  const ok = dados && !("erro" in dados) ? dados : null;
  const ordem = ok ? ok.profissionais.map((p) => p.id) : [];
  // Cor por profissional só quando a loja tem mais de uma
  const variasProfissionais = ordem.length > 1;
  const segunda = inicioDaSemana(dia);
  const semana = Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
  const [ano, mes] = dia.split("-").map(Number);

  const visiveis = ok?.atendimentos.filter((a) => a.status !== "cancelado") ?? [];
  const selecionado = visiveis.find((a) => a.id === aberto) ?? null;
  // O que a IA anotou de cada cliente do dia (pré-avaliação)
  const intencoes = useIntencoes(
    visiveis.flatMap((a) => (a.clientes ? [a.clientes.id] : [])),
    versao,
  );
  const intencaoDe = (a: Atendimento) => (a.clientes ? intencoes[a.clientes.id] : undefined);
  // Mesma cliente com mais de um horário no dia (ex.: mudou de horário e alguém criou outro em vez
  // de remarcar): a linha avisa, para a dona conferir
  const horariosDaCliente = new Map<string, number>();
  for (const a of visiveis) if (a.clientes && a.status !== "faltou") horariosDaCliente.set(a.clientes.id, (horariosDaCliente.get(a.clientes.id) ?? 0) + 1);
  const repetidaNoDia = (a: Atendimento) => (a.clientes ? (horariosDaCliente.get(a.clientes.id) ?? 0) : 0);

  // O dia numa lista só, em ordem de hora: horários (inclusive concluídos e faltas, com a situação
  // à direita), o almoço e os intervalos livres de 30 min ou mais entre eles
  const almoco = lerAlmoco(empresa.config);
  const blocos = [
    ...visiveis.map((a) => ({ tipo: "atendimento" as const, atendimento: a, inicio: Date.parse(a.inicio), fim: Date.parse(a.inicio) + minutos(a) * 60_000 })),
    ...(almoco && visiveis.length > 0
      ? [{ tipo: "almoco" as const, inicio: Date.parse(instanteNoSalao(dia, almoco.inicio)), fim: Date.parse(instanteNoSalao(dia, almoco.fim)) }]
      : []),
  ].sort((x, y) => x.inicio - y.inicio);
  // Encaixar só de agora em diante: hoje, a partir da próxima meia hora; precisa sobrar 30 min
  const inicioDoEncaixe = (l: { inicio: number; minutos: number }) => {
    if (dia > hoje) return l.inicio;
    if (dia < hoje) return null;
    const proximaMeiaHora = Math.ceil(agora / (30 * 60_000)) * 30 * 60_000;
    const inicio = Math.max(l.inicio, proximaMeiaHora);
    return l.inicio + l.minutos * 60_000 - inicio >= 30 * 60_000 ? inicio : null;
  };
  const linhas: Linha[] = [];
  let fimAte: number | null = null;
  for (const b of blocos) {
    // Falta não ocupa a agenda: o horário dela conta como livre (inclusive quando é o primeiro do dia)
    const falta = b.tipo === "atendimento" && b.atendimento.status === "faltou";
    if (falta && fimAte === null) fimAte = b.inicio;
    if (fimAte !== null && b.inicio - fimAte >= 30 * 60_000) linhas.push({ tipo: "livre", inicio: fimAte, minutos: Math.round((b.inicio - fimAte) / 60_000) });
    linhas.push(b);
    if (!falta) fimAte = Math.max(fimAte ?? 0, b.fim);
  }
  // Na mesma hora, o "Livre" vem antes da falta que liberou o horário
  linhas.sort((x, y) => x.inicio - y.inicio || (x.tipo === "livre" ? -1 : y.tipo === "livre" ? 1 : 0));
  // Conta clientes que vêm (faltas não entram)
  const clientesDoDia = visiveis.filter((a) => a.status !== "faltou").length;
  const marcadoPelaIa = visiveis.some((a) => a.origem === "ia");

  // Trocar de semana: na semana de hoje, abre hoje; nas outras, abre no mesmo dia da semana e,
  // se ele estiver vazio, pula para o primeiro dia que tem horário
  async function irParaSemana(delta: number) {
    const novaSegunda = somarDias(segunda, delta);
    const dias = Array.from({ length: 7 }, (_, i) => somarDias(novaSegunda, i));
    if (dias.includes(hoje)) {
      setDia(hoje);
      return;
    }
    const provisorio = somarDias(dia, delta);
    setDia(provisorio);
    const comHorario = await buscarDiasComHorario(empresa.id, novaSegunda, somarDias(novaSegunda, 6));
    if (comHorario.has(provisorio)) return;
    const primeiro = dias.find((d) => comHorario.has(d));
    if (primeiro) setDia((atual) => (atual === provisorio ? primeiro : atual));
  }

  // Deslizar a faixa da semana para o lado troca de semana
  const toque = useRef<{ x: number; y: number } | null>(null);

  // Concluído ou faltou -> desfaz (pergunta antes quando algo vai sumir: os serviços feitos junto)
  async function desfazer(a: Atendimento) {
    let erro: string | undefined;
    if (a.status === "faltou") {
      if (!(await perguntar(`Desfazer a falta de ${a.clientes?.nome ?? "a cliente"}? Ela volta para os clientes do dia.`, { confirmar: "Desfazer" }))) return;
      erro = await mudarStatus(a.id, "agendado");
    } else if (ehFeitoJunto(a)) {
      if (!(await perguntar(`Tirar ${a.servicos?.nome ?? "este serviço"} deste atendimento?`, { confirmar: "Tirar", perigo: true }))) return;
      erro = await excluirAtendimento(a.id);
    } else {
      const extras = feitosJunto(a);
      // Só os que entraram no ✓: os escolhidos junto ao marcar o horário ficam
      const nomes = (a.extrasDaConfirmacao ?? []).join(", ");
      if (nomes && !(await perguntar(`Voltar para "a atender"? O que foi feito junto (${nomes}) sai deste horário.`, { confirmar: "Desfazer" }))) return;
      erro = await desfazerConfirmacao(empresa.id, a, extras);
    }
    if (erro) await avisar(`Não deu certo: ${erro}`);
    recarregar();
  }

  // A folha continua aberta depois de salvar: em seguida pergunta se já combinou a volta
  async function confirmar(a: Atendimento, servicoIds: string[]) {
    const erro = await confirmarAtendimento(empresa.id, a, servicoIds);
    if (!erro) recarregar();
    return erro;
  }

  // Avaliação: o ✓ já leva o resultado (Fechou / Ficou de pensar / Não fechou)
  async function confirmarComResultado(a: Atendimento, resultado: ResultadoAvaliacao) {
    const erro = await confirmarAvaliacao(a.id, a.observacoes, resultado);
    if (!erro) recarregar();
    return erro;
  }

  // "Chegou" marca a chegada (a IA para de cobrar atraso)
  async function chegou(a: Atendimento, sim = true) {
    const erro = await marcarChegou(a.id, sim);
    if (erro) await avisar(`Não deu certo: ${erro}`);
    recarregar();
  }

  // Faltou: pergunta antes; a IA vê a falta na ficha
  async function faltou(a: Atendimento) {
    if (!(await perguntar(`${a.clientes?.nome ?? "A cliente"} faltou?`, { confirmar: "Faltou" }))) return;
    const erro = await marcarFalta(a);
    if (erro) await avisar(`Não deu certo: ${erro}`);
    else setAberto(null);
  }

  async function marcarFalta(a: Atendimento) {
    const erro = await mudarStatus(a.id, "faltou");
    if (!erro) recarregar();
    return erro;
  }

  // Remarcou: o mesmo horário vai para o novo dia (anota "Reagendado de ...")
  async function remarcar(a: Atendimento, novoInicio: string) {
    const erro = await reagendar(a, novoInicio);
    if (!erro) recarregar();
    return erro;
  }

  // Desmarcou: sai da agenda (cancelado não é falta) e a IA pode oferecer a vaga
  async function cancelar(a: Atendimento) {
    const erro = await mudarStatus(a.id, "cancelado");
    if (!erro) recarregar();
    return erro;
  }

  // Da folha do horário para a de confirmar (Concluir) ou direto para Remarcar
  function abrirConfirmar(a: Atendimento, tela: TelaConfirmar) {
    setAberto(null);
    setConfirmando({ atendimento: a, tela });
  }

  const nomeDoMes = MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1);
  const diaSemana = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7;
  const tituloDoDia = dia === hoje ? "Hoje" : `${DIAS_LONGOS[diaSemana(dia)]}, ${Number(dia.slice(8))}`;

  return (
    <>
      <header className="px-5 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col">
            {/* Tocar no mês abre as próximas semanas e meses numa lista só */}
            <Link
              href="/agenda/proximas"
              className="-ml-1 flex h-11 w-fit items-center gap-1 rounded-lg px-1 text-[14px] font-semibold text-rotulo active:bg-campo"
            >
              {nomeDoMes} de {ano}
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="m6 9 6 6 6-6" />
              </svg>
            </Link>
            <h1 className="text-[30px] leading-tight font-bold tracking-[-0.035em]">Agenda</h1>
          </div>
          <div className="flex items-center gap-1">
            {!semana.includes(hoje) && (
              <button onClick={() => setDia(hoje)} className="h-11 rounded-full px-3 text-[14px] font-bold underline underline-offset-2 active:bg-campo">
                Hoje
              </button>
            )}
            <button onClick={() => setNovo({})} aria-label="Novo horário" className="flex h-12 w-12 items-center justify-center rounded-full active:bg-campo">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
        </div>

        {/* Faixa da semana: deslizar para o lado troca de semana. Pontinho = dia com horário;
            número riscado = dia sem atender */}
        <div
          className="mt-3 grid touch-pan-y grid-cols-7 text-center"
          onTouchStart={(e) => {
            toque.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          }}
          onTouchEnd={(e) => {
            const t = toque.current;
            toque.current = null;
            if (!t) return;
            const dx = e.changedTouches[0].clientX - t.x;
            const dy = e.changedTouches[0].clientY - t.y;
            if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) irParaSemana(dx < 0 ? 7 : -7);
          }}
        >
          {semana.map((d, i) => {
            const escolhido = d === dia;
            const bloqueado = Boolean(bloqueioDoDia(empresa.config, d));
            return (
              <button
                key={d}
                onClick={() => setDia(d)}
                aria-pressed={escolhido}
                aria-label={`${formatarData(d)}${d === hoje ? " (hoje)" : ""}${bloqueado ? " (sem atender)" : ""}`}
                className="flex flex-col items-center gap-1 py-1"
              >
                <span className={`text-[12px] ${escolhido || d === hoje ? "font-extrabold text-texto" : "font-semibold text-rotulo"}`}>{LETRAS[i]}</span>
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-full text-[17px] transition-colors duration-200 ${
                    escolhido ? "bg-grafite font-extrabold text-perola" : d === hoje ? "font-extrabold text-texto ring-[1.5px] ring-grafite" : "font-medium"
                  } ${bloqueado && !escolhido ? "text-claro line-through decoration-2" : ""}`}
                >
                  {Number(d.slice(8))}
                </span>
                <span aria-hidden className={`h-1 w-1 rounded-full ${ok?.comHorario.has(d) ? "bg-claro" : "bg-transparent"}`} />
              </button>
            );
          })}
        </div>
      </header>

      <section className="mt-3 px-5">
        <p className="pb-2 text-[14px] font-semibold text-rotulo">
          {tituloDoDia}
          {ok && clientesDoDia > 0 && ` · ${clientesDoDia === 1 ? "1 cliente" : `${clientesDoDia} clientes`}`}
        </p>

        {/* Dia bloqueado (viagem, folga...): a IA não marca ninguém; quem já estava marcado aparece abaixo */}
        {bloqueioDoDia(empresa.config, dia) && (
          <Link href="/agenda/bloqueios" className="mb-3 flex min-h-12 items-center gap-2.5 rounded-[14px] bg-rose px-4 py-3 text-rose-texto active:scale-[0.99]">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-atencao" />
            <span className="min-w-0 flex-1 text-[15px]">
              <b>Dia sem atender</b>
              {bloqueioDoDia(empresa.config, dia)?.motivo && ` · ${bloqueioDoDia(empresa.config, dia)?.motivo}`}
            </span>
            <span aria-hidden className="text-lg">›</span>
          </Link>
        )}
        {/* Horas sem atender, que a dona pede à assistente */}
        {bloqueiosHorarioDoDia(empresa.config, dia).map((b) => (
          <p key={`${b.inicio}-${b.fim}`} className="mb-3 rounded-[14px] bg-rose px-4 py-3 text-[15px] text-rose-texto">
            <b>
              Sem atender das {b.inicio} às {b.fim}
            </b>
            {b.motivo && ` · ${b.motivo}`}
          </p>
        ))}
        {!dados && <p className="carregando-calmo text-texto-2">Carregando…</p>}
        {dados && "erro" in dados && <p className="rounded-2xl bg-rose p-4 text-rose-texto">Erro: {dados.erro}</p>}

        {ok && (
          <div className="chegar-suave">
            {visiveis.length === 0 ? (
              <div className="flex flex-col items-center gap-3 border-t border-campo py-10 text-center">
                <span className="text-[17px] font-bold">Dia livre</span>
                <span className="text-[15px] text-texto-2">Nenhum horário marcado.</span>
                {(dia >= hoje) && (
                  <button onClick={() => setNovo({})} className="mt-1 h-12 rounded-[13px] border border-claro bg-card px-5 text-[16px] font-bold active:bg-campo">
                    Marcar horário
                  </button>
                )}
              </div>
            ) : (
              <ul>
                {linhas.map((l) =>
                  l.tipo === "atendimento" ? (
                    <LinhaHorario
                      key={l.atendimento.id}
                      atendimento={l.atendimento}
                      cor={variasProfissionais ? corDaProfissional(l.atendimento.profissional_id, ordem).ponto : null}
                      vezesNoDia={repetidaNoDia(l.atendimento)}
                      agora={agora}
                      aoTocar={() => setAberto(l.atendimento.id)}
                    />
                  ) : l.tipo === "almoco" ? (
                    <li key="almoco" className="flex min-h-[52px] items-center gap-3 border-t border-campo text-[15px] text-rotulo">
                      <span className="w-[52px] shrink-0 font-semibold">{almoco!.inicio}</span>
                      <span>Almoço até {almoco!.fim}</span>
                    </li>
                  ) : (
                    <li key={`livre-${l.inicio}`} className="flex min-h-[52px] items-center gap-3 border-t border-campo text-[15px] text-rotulo">
                      <span className="w-[52px] shrink-0 font-semibold">{formatarHora(new Date(l.inicio).toISOString())}</span>
                      <span className="min-w-0 flex-1">Livre por {duracaoPorExtenso(l.minutos)}</span>
                      {inicioDoEncaixe(l) !== null && (
                        <button
                          onClick={() => setNovo({ hora: formatarHora(new Date(inicioDoEncaixe(l)!).toISOString()) })}
                          className="-mr-2 h-11 shrink-0 rounded-lg px-2 text-[15px] font-bold text-texto active:bg-campo"
                        >
                          Encaixar
                        </button>
                      )}
                    </li>
                  ),
                )}
              </ul>
            )}
            {marcadoPelaIa && (
              <p className="mt-4 flex items-center gap-2 text-[13px] text-rotulo">
                <span aria-hidden className="h-2 w-2 rounded-full bg-ouro-antigo" />
                Marcado pela IA
              </p>
            )}
          </div>
        )}
      </section>

      <div className="h-6" />

      {dialogo}

      {selecionado && (
        <FolhaHorario
          atendimento={selecionado}
          intencao={intencaoDe(selecionado)}
          vezesNoDia={repetidaNoDia(selecionado)}
          ehHoje={dia === hoje}
          noPassado={dia < hoje}
          agora={agora}
          aoChegou={(sim) => chegou(selecionado, sim)}
          aoConcluir={() => abrirConfirmar(selecionado, "pergunta")}
          aoFaltou={() => faltou(selecionado)}
          aoRemarcar={() => abrirConfirmar(selecionado, "remarcar")}
          aoDesfazer={async () => {
            setAberto(null);
            await desfazer(selecionado);
          }}
          aoFechar={() => setAberto(null)}
        />
      )}

      {confirmando && (
        <FolhaConfirmar
          atendimento={confirmando.atendimento}
          servicos={servicos}
          telaInicial={confirmando.tela}
          aoConfirmar={(ids) => confirmar(confirmando.atendimento, ids)}
          aoResultado={(r) => confirmarComResultado(confirmando.atendimento, r)}
          aoFaltou={() => marcarFalta(confirmando.atendimento)}
          aoRemarcar={(inicio) => remarcar(confirmando.atendimento, inicio)}
          aoCancelar={() => cancelar(confirmando.atendimento)}
          intencao={intencaoDe(confirmando.atendimento)}
          aoFechar={() => setConfirmando(null)}
        />
      )}

      {novo && (
        <FormAtendimento
          modo="agendar"
          dia={dia < hoje ? hoje : dia}
          horaInicial={novo.hora}
          aoFechar={() => setNovo(null)}
          aoSalvar={() => {
            setNovo(null);
            recarregar();
          }}
        />
      )}
    </>
  );
}

type Linha =
  | { tipo: "atendimento"; atendimento: Atendimento; inicio: number; fim: number }
  | { tipo: "almoco"; inicio: number; fim: number }
  | { tipo: "livre"; inicio: number; minutos: number };

// "1 hora", "1 hora e 30 min", "45 min"
function duracaoPorExtenso(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const horas = h ? `${h} ${h === 1 ? "hora" : "horas"}` : "";
  return h && m ? `${horas} e ${m} min` : h ? horas : `${m} min`;
}

// Situação à direita de cada horário: o que já aconteceu fica escrito; "a atender" não leva nada
function Situacao({ atendimento: a, agora }: { atendimento: Atendimento; agora: number }) {
  if (a.status === "realizado") return <span className="shrink-0 text-[14px] font-bold text-salvia-texto">✓ Concluído</span>;
  if (a.status === "faltou") return <span className="shrink-0 text-[14px] font-bold text-rose-texto">Faltou</span>;
  if (a.chegou_em) return <span className="shrink-0 rounded-full bg-salvia px-2.5 py-1 text-[13px] font-bold text-salvia-texto">Chegou</span>;
  if (naoAtendida(a, agora)) return <span className="shrink-0 text-[14px] font-bold text-rose-texto">Sem baixa</span>;
  const inicio = Date.parse(a.inicio);
  if (agora >= inicio && agora < inicio + minutos(a) * 60_000)
    return <span className="shrink-0 rounded-full bg-grafite px-2.5 py-1 text-[13px] font-bold text-perola">Agora</span>;
  return null;
}

// Um horário na lista: hora, nome (bolinha dourada = marcado pela IA), serviço e a situação.
// Tocar abre a folha com as ações.
function LinhaHorario({
  atendimento: a,
  cor,
  vezesNoDia,
  agora,
  aoTocar,
}: {
  atendimento: Atendimento;
  cor: string | null;
  vezesNoDia: number;
  agora: number;
  aoTocar: () => void;
}) {
  const resolvido = a.status === "realizado" || a.status === "faltou";
  const nome = a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente");
  return (
    <li className="border-t border-campo">
      <button onClick={aoTocar} className="flex min-h-[64px] w-full items-center gap-3 py-3 text-left active:bg-campo/60">
        <span className={`w-[52px] shrink-0 text-[17px] tracking-[-0.02em] ${resolvido ? "font-semibold text-rotulo" : "font-extrabold"}`}>{formatarHora(a.inicio)}</span>
        {cor && <span aria-hidden className={`h-9 w-1 shrink-0 rounded-full ${cor}`} />}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={`flex items-center gap-2 text-[16px] font-bold ${resolvido ? "text-texto-2" : ""}`}>
            {a.origem === "ia" && <span role="img" aria-label="Marcado pela IA" className="h-2 w-2 shrink-0 rounded-full bg-ouro-antigo" />}
            <span className="truncate">{primeiroESegundo(nome)}</span>
          </span>
          <span className="line-clamp-2 text-[14px] text-texto-2">
            {resumoDosServicos(a)} · {duracao(minutos(a))}
          </span>
          {vezesNoDia > 1 && <span className="text-[13px] font-bold text-rose-texto">{vezesNoDia} horários dela hoje · conferir</span>}
        </span>
        <Situacao atendimento={a} agora={agora} />
      </button>
    </li>
  );
}

// "Cleris Fernanda Gonçalves da Silva" -> "Cleris Fernanda" (telefone fica como está)
function primeiroESegundo(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (/^\(?\d/.test(nome)) return nome;
  const [p, s] = partes;
  const curtas = ["da", "de", "do", "das", "dos", "e"];
  return s && !curtas.includes(s.toLowerCase()) ? `${p} ${s}` : p;
}

// Folha que sobe ao tocar num horário: o principal em cima (Chegou, Concluir, Faltou) e os atalhos
// embaixo (WhatsApp, Ficha, Remarcar). Os detalhes (serviços, telefone, reagendado) vêm por último.
function FolhaHorario({
  atendimento: a,
  intencao,
  vezesNoDia,
  ehHoje,
  noPassado,
  agora,
  aoChegou,
  aoConcluir,
  aoFaltou,
  aoRemarcar,
  aoDesfazer,
  aoFechar,
}: {
  atendimento: Atendimento;
  intencao: Avaliacao | undefined;
  vezesNoDia: number;
  ehHoje: boolean;
  noPassado: boolean;
  agora: number;
  aoChegou: (sim: boolean) => void;
  aoConcluir: () => void;
  aoFaltou: () => void;
  aoRemarcar: () => void;
  aoDesfazer: () => void;
  aoFechar: () => void;
}) {
  const nome = a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente");
  const pendente = a.status === "agendado";
  const reagendado = ultimoReagendamento(a);
  const resumoIa = pendente ? intencao?.pre_resumo?.trim() : undefined;
  // Chegou/Concluir/Faltou: nos dias que já passaram (sem baixa) e, hoje, a partir de 1 h antes do horário
  const daParaFechar = pendente && (noPassado || (ehHoje && Date.parse(a.inicio) - agora < 60 * 60_000));
  const quando = `${ehHoje ? "Hoje" : formatarData(a.inicio).slice(0, 5)} às ${formatarHora(a.inicio)}`;

  return (
    <Folha rotulo={`Horário de ${nome}`} aoFechar={aoFechar} className="bg-perola px-5 pt-2.5">
      <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-claro" />
      <p className="text-[14px] text-rotulo">
        {quando} · {resumoDosServicos(a)} · {duracao(minutos(a))}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 className="text-[24px] leading-tight font-bold tracking-[-0.02em]">{nome}</h2>
        {a.clientes && <Etiquetas etiquetas={a.clientes.etiquetas} className="" />}
      </div>
      {pendente && !daParaFechar && ehHoje && (
        <p className="mt-3 text-[14px] text-rotulo">Chegou, Concluir e Faltou aparecem a partir de 1 hora antes do horário.</p>
      )}
      {(a.origem === "ia" || resumoIa) && (
        <p className="mt-2 flex gap-2 text-[15px] leading-[1.45] text-texto-2">
          <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-ouro-antigo" />
          <span>
            {a.origem === "ia" && "Marcado pela IA. "}
            {intencao?.resultado === "pensando" && <b>Ficou de pensar. </b>}
            {resumoIa}
          </span>
        </p>
      )}
      <Observacao texto={a.clientes?.observacoes} />
      {vezesNoDia > 1 && <p className="mt-2 text-[14px] font-bold text-rose-texto">{vezesNoDia} horários dela neste dia · conferir</p>}

      {/* Ações principais */}
      <div className="mt-4 flex flex-col gap-2">
        {daParaFechar && (
          <>
            {a.chegou_em ? (
              <p className="flex min-h-11 items-center justify-between rounded-[13px] bg-salvia px-4 text-[15px] text-salvia-texto">
                <span>
                  <b>Chegou</b> às {formatarHora(a.chegou_em)}
                </span>
                <button onClick={() => aoChegou(false)} className="h-11 font-semibold underline underline-offset-2">
                  Desfazer
                </button>
              </p>
            ) : (
              ehHoje && (
                <button onClick={() => aoChegou(true)} className="h-12 rounded-[13px] bg-grafite text-[16px] font-bold text-perola active:scale-[0.99]">
                  Chegou
                </button>
              )
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={aoConcluir}
                className={`h-12 rounded-[13px] text-[16px] font-bold active:scale-[0.98] ${
                  a.chegou_em || !ehHoje ? "bg-grafite text-perola" : "border border-claro bg-card"
                }`}
              >
                Concluir
              </button>
              <button onClick={aoFaltou} className="h-12 rounded-[13px] border border-claro bg-card text-[16px] font-bold text-rose-texto active:scale-[0.98]">
                Faltou
              </button>
            </div>
          </>
        )}
        {!pendente && (
          <p className="flex min-h-12 items-center justify-between rounded-[13px] bg-card px-4 text-[15px] borda-suave">
            <b className={a.status === "faltou" ? "text-rose-texto" : "text-salvia-texto"}>{a.status === "faltou" ? "Faltou" : "✓ Concluído"}</b>
            <button onClick={aoDesfazer} className="h-11 font-semibold underline underline-offset-2">
              Desfazer
            </button>
          </p>
        )}
      </div>

      {/* Atalhos */}
      <div className="mt-4 flex gap-2 text-center text-[13px] font-semibold text-texto-2 [&>*]:flex-1">
        {a.clientes && (
          <button onClick={() => abrirWhatsApp(a.clientes!.telefone)} className="flex h-16 flex-col items-center justify-center gap-1 rounded-[13px] active:bg-campo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
            </svg>
            WhatsApp
          </button>
        )}
        {a.clientes && (
          <Link href={`/clientes/${a.clientes.id}`} className="flex h-16 flex-col items-center justify-center gap-1 rounded-[13px] active:bg-campo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            Ficha
          </Link>
        )}
        {pendente && (
          <button onClick={aoRemarcar} className="flex h-16 flex-col items-center justify-center gap-1 rounded-[13px] active:bg-campo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18M12 14v4M10 16h4" />
            </svg>
            Remarcar
          </button>
        )}
      </div>

      {/* Detalhes */}
      <dl className="mt-3 mb-5 border-t border-campo text-[15px]">
        <div className="flex justify-between gap-4 py-2.5">
          <dt className="text-texto-2">{a.extras?.length ? "Serviços" : "Serviço"}</dt>
          <dd className="text-right font-medium">
            <ServicosDoHorario atendimento={a} />
          </dd>
        </div>
        {a.clientes && (
          <div className="flex justify-between gap-4 border-t border-campo py-2.5">
            <dt className="text-texto-2">Telefone</dt>
            <dd className="font-medium">{formatarTelefone(a.clientes.telefone)}</dd>
          </div>
        )}
        {reagendado && (
          <div className="flex justify-between gap-4 border-t border-campo py-2.5">
            <dt className="text-texto-2">Reagendado</dt>
            <dd className="text-right font-medium">{reagendado.replace("Reagendado de ", "era ")}</dd>
          </div>
        )}
      </dl>
    </Folha>
  );
}

// Serviços do horário nos detalhes: só o principal, com nome curto ("Aplicação tela adesiva");
// os outros ficam recolhidos em "+ 5 serviços" e aparecem ao tocar
function ServicosDoHorario({ atendimento: a }: { atendimento: Atendimento }) {
  const [aberto, setAberto] = useState(false);
  const principal = a.servicos ? comQuantidade(nomeCurto(a.servicos.nome), a.quantidade) : "Não informado";
  const extras = (a.extras ?? []).map(nomeCurto);
  if (!extras.length) return principal;
  return (
    <span className="flex flex-col items-end gap-1">
      <span>{principal}</span>
      {aberto &&
        extras.map((nome, i) => (
          <span key={i} className="text-texto-2">
            {nome}
          </span>
        ))}
      <button
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="-mr-1 rounded-full px-2.5 py-1 text-sm font-semibold text-bronze-escuro active:bg-campo"
      >
        {aberto ? "Mostrar menos" : `+ ${extras.length} ${extras.length === 1 ? "serviço" : "serviços"}`}
      </button>
    </span>
  );
}

