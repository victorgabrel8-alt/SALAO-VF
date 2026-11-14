"use client";

import Link from "next/link";
import { TelaDaAba } from "@/components/TelaDaAba";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { FolhaConfirmar } from "@/components/FolhaConfirmar";
import { FormAtendimento } from "@/components/FormAtendimento";
import { LinhaDeslizante, type AcaoDeslizante } from "@/components/LinhaDeslizante";
import {
  buscarAtendimentosDoDia,
  buscarPendentesAnteriores,
  confirmarAtendimento,
  marcarChegou,
  mudarStatus,
  naoAtendida,
  reagendar,
  resumoDosServicos,
  type Atendimento,
} from "@/lib/atendimentos";
import { confirmarAvaliacao, useIntencoes, type Avaliacao } from "@/lib/avaliacoes";
import { useEmpresa } from "@/lib/empresa";
import { estaExcluida } from "@/lib/excluidas";
import { fraseDoDia, mostrarFrase } from "@/lib/frases";
import {
  agoraNoSalao,
  dataNoSalao,
  formatarData,
  formatarDiaLongo,
  formatarHora,
  formatarTelefone,
  hojeNoSalao,
  inicioDoDia,
  primeiroNome,
  somarDias,
} from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import { useAgora } from "@/lib/relogio";
import { useTempoReal } from "@/lib/tempoReal";
import type { ServicoAtivo } from "@/lib/tipos";
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
  // De dias anteriores e ainda sem conclusão (ver buscarPendentesAnteriores)
  pendentes: Atendimento[];
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
  const [clientes, atendimentos, deAmanha, anteriores, mensagensIa, marcadosIa, comAniversario] = await Promise.all([
    db
      .from("clientes_status")
      .select("id, nome, telefone, motivo_pausa, etiquetas")
      .eq("empresa_id", empresaId)
      .eq("ia_pausada", true)
      .in("motivo_pausa", Object.keys(MOTIVOS)),
    buscarAtendimentosDoDia(empresaId, hoje),
    buscarAtendimentosDoDia(empresaId, somarDias(hoje, 1)),
    buscarPendentesAnteriores(empresaId, hoje),
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
  if (anteriores.erro) return { erro: anteriores.erro };

  return {
    precisam: (clientes.data ?? []).filter((c) => !estaExcluida(c.etiquetas)) as Precisa[],
    hoje: atendimentos.atendimentos.filter((a) => a.status !== "cancelado"),
    amanha: deAmanha.atendimentos.filter((a) => a.status !== "cancelado"),
    pendentes: anteriores.atendimentos,
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
  if (Date.parse(a.inicio) + minutosDe(a) * 60_000 <= Date.now()) return "passou da hora";
  if (falta <= 0) return "agora";
  if (falta < 60) return `em ${falta} min`;
  return `em ${Math.round(falta / 60)}h`;
}

function emAndamento(a: Atendimento): boolean {
  const inicio = Date.parse(a.inicio);
  return Date.now() >= inicio && Date.now() < inicio + minutosDe(a) * 60_000;
}

// A próxima da fila: o primeiro horário a atender que ainda não virou "sem baixa". Um horário que já
// passou continua aqui (com "passou da hora") até a dona dar baixa ou ele ir para "sem baixa"
function proximaCliente(hoje: Atendimento[]): Atendimento | null {
  const agora = Date.now();
  return hoje.find((a) => a.status === "agendado" && !naoAtendida(a, agora)) ?? null;
}

// Selo da lista "Hoje", nas mesmas cores da Agenda
function selo(a: Atendimento): { rotulo: string; classe: string } {
  if (a.status === "realizado") return { rotulo: "Concluído", classe: "bg-salvia text-salvia-texto" };
  if (a.status === "faltou") return { rotulo: "Faltou", classe: "bg-rose text-rose-texto" };
  if (a.chegou_em) return { rotulo: "Chegou", classe: "bg-salvia text-salvia-texto" };
  if (naoAtendida(a)) return { rotulo: "Não atendida", classe: "bg-rose text-rose-texto" };
  if (emAndamento(a)) return { rotulo: "Agora", classe: "bg-grafite text-perola" };
  return { rotulo: "A atender", classe: "bg-taupe text-taupe-texto" };
}

function nomeDe(c: { nome: string | null; telefone: string } | null | undefined): string {
  return c?.nome ?? (c ? formatarTelefone(c.telefone) : "Cliente");
}

export default function InicioPage() {
  return (
    <TelaDaAba>
      <InicioPageConteudo />
    </TelaDaAba>
  );
}

function InicioPageConteudo() {
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
  // O relógio anda a cada minuto; quando vira o dia (app aberto de um dia para o outro), o
  // resumo é buscado de novo: "hoje" passa a ser o dia novo e o de ontem vai para os pendentes
  const agora = useAgora();
  const diaAtual = hojeNoSalao();

  // Para a folha "Foi isso / Fez outra coisa" (a mesma da Agenda)
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
  }, [empresa.id, versao, diaAtual]);

  // A IA grava sozinha: quando chega mensagem ou horário novo, a tela se atualiza
  useTempoReal(["agendamentos", "clientes", "mensagens"], empresa.id, recarregar);

  const ok = resumo && !("erro" in resumo) ? resumo : null;
  const proxima = ok ? proximaCliente(ok.hoje) : null;
  // Passou 1 h do horário e ninguém deu baixa: junta com os de dias anteriores sem conclusão
  const [verSemBaixa, setVerSemBaixa] = useState(false);
  const semBaixa = ok ? [...ok.pendentes, ...ok.hoje.filter((a) => naoAtendida(a, agora))] : [];
  // Quem vem depois da próxima (só as que ainda vão ser atendidas)
  const depois = ok && proxima ? ok.hoje.filter((a) => a.status === "agendado" && a.id !== proxima.id && Date.parse(a.inicio) >= Date.parse(proxima.inicio)) : [];
  // Sem próxima hoje: o destaque vira a primeira cliente de amanhã
  const primeiraDeAmanha = ok && !proxima ? (ok.amanha.find((a) => a.status === "agendado") ?? null) : null;
  // O que a IA anotou das clientes de hoje e de amanhã (pré-avaliação)
  const intencoes = useIntencoes(ok ? [...ok.hoje, ...ok.amanha].flatMap((a) => (a.clientes ? [a.clientes.id] : [])) : [], versao);
  // "Chegou" (ou desfazer): grava e atualiza a tela
  const chegou = async (a: Atendimento, sim = true) => {
    const erro = await marcarChegou(a.id, sim);
    if (erro) alert(`Não consegui marcar: ${erro}`);
    else recarregar();
  };

  return (
    // A tela ocupa a altura toda: a cliente no meio e as linhas de aviso embaixo, perto do polegar
    <div className="flex min-h-[calc(100dvh-100px-env(safe-area-inset-top)-env(safe-area-inset-bottom))] flex-col">
      <IndicadorPuxar puxado={puxado} atualizando={atualizando} />
      <Topo titulo={saudacao(agoraNoSalao().hora)} alerta={!!ok && ok.precisam.length > 0} aoRegistrar={() => setRegistrando(true)} />
      {/* Versículo curto do dia, logo abaixo da saudação (a dona desliga em Configurações) */}
      {mostrarFrase(empresa.config) && <FraseDoDia dia={diaAtual} />}

      {!resumo && <p className="carregando-calmo p-5 text-texto-2">Carregando…</p>}
      {resumo && "erro" in resumo && <p className="m-5 rounded-2xl bg-rose p-4 text-rose-texto">Erro ao ler o banco: {resumo.erro}</p>}

      {ok && (
        <div className="chegar-suave flex flex-1 flex-col px-5">
          <div className="pt-7">
            {proxima ? (
              <Destaque
                rotulo="Próxima cliente"
                atendimento={proxima}
                quando={quandoComeca(proxima)}
                intencao={proxima.clientes ? intencoes[proxima.clientes.id] : undefined}
                // "Chegou" a partir de 1 h antes; depois que ela chega, o principal vira "Concluir"
                acao={
                  proxima.chegou_em
                    ? { rotulo: "Concluir atendimento", aoTocar: () => setConfirmando(proxima) }
                    : Date.parse(proxima.inicio) - agora < 60 * 60_000
                      ? { rotulo: `${primeiroNome(nomeDe(proxima.clientes)) || "Ela"} chegou`, aoTocar: () => chegou(proxima) }
                      : null
                }
                aoDesfazerChegada={() => chegou(proxima, false)}
              />
            ) : primeiraDeAmanha ? (
              <Destaque
                rotulo={ok.hoje.length ? "Hoje acabou · amanhã começa com" : "Dia livre hoje · amanhã começa com"}
                atendimento={primeiraDeAmanha}
                intencao={primeiraDeAmanha.clientes ? intencoes[primeiraDeAmanha.clientes.id] : undefined}
                acao={null}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-[14px] font-semibold text-rotulo">{ok.hoje.length ? "Hoje" : "Agenda"}</span>
                <span className="text-[34px] leading-tight font-extrabold tracking-[-0.04em]">{ok.hoje.length ? "Tudo atendido" : "Dia livre"}</span>
                <span className="text-[16px] text-texto-2">Nenhum horário marcado para amanhã ainda.</span>
              </div>
            )}
          </div>

          {/* Avisos embaixo, perto do polegar. Cada linha só aparece quando tem algo */}
          <ul className="mt-auto pt-8">
            {ok.precisam.length > 0 && (
              <LinhaRodape
                href="/conversas"
                ponto="bg-atencao"
                forte
                texto={ok.precisam.length === 1 ? "1 cliente esperando você" : `${ok.precisam.length} clientes esperando você`}
              />
            )}
            {semBaixa.length > 0 && (
              <>
                <LinhaRodape
                  ponto="bg-claro"
                  texto={semBaixa.length === 1 ? "1 horário sem baixa" : `${semBaixa.length} horários sem baixa`}
                  aberta={verSemBaixa}
                  aoTocar={() => setVerSemBaixa((v) => !v)}
                />
                {verSemBaixa && (
                  <li className="pb-3">
                    <ListaHorarios
                      atendimentos={semBaixa}
                      linhaAberta={linhaAberta}
                      aoAbrirLinha={setLinhaAberta}
                      aoConcluir={setConfirmando}
                      comSelo
                    />
                  </li>
                )}
              </>
            )}
            {(ok.iaConversou > 0 || ok.iaMarcou > 0) && (
              <LinhaRodape
                href="/conversas"
                ponto="bg-ouro-antigo"
                texto={[
                  ok.iaConversou ? `A IA conversou com ${ok.iaConversou === 1 ? "1 cliente" : `${ok.iaConversou} clientes`}` : null,
                  ok.iaMarcou ? `${ok.iaConversou ? "marcou" : "A IA marcou"} ${ok.iaMarcou === 1 ? "1 horário" : `${ok.iaMarcou} horários`}` : null,
                ]
                  .filter(Boolean)
                  .join(" e ")}
              />
            )}
            {ok.aniversariantes.length > 0 && <Aniversarios lista={ok.aniversariantes} />}
            {depois.length > 0 && (
              <LinhaRodape
                href="/agenda"
                texto={`Depois, às ${formatarHora(depois[0].inicio)}, ${primeiroESegundo(nomeDe(depois[0].clientes))}${depois.length > 1 ? ` e mais ${depois.length - 1}` : ""}`}
              />
            )}
            {!proxima && ok.hoje.length > 0 && <LinhaRodape href="/agenda" texto="Ver o dia na agenda" />}
          </ul>
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
          intencao={confirmando.clientes ? intencoes[confirmando.clientes.id] : undefined}
          aoConfirmar={async (ids) => {
            const erro = await confirmarAtendimento(empresa.id, confirmando, ids);
            if (!erro) recarregar();
            return erro;
          }}
          aoResultado={async (resultado) => {
            const erro = await confirmarAvaliacao(confirmando.id, confirmando.observacoes, resultado);
            if (!erro) recarregar();
            return erro;
          }}
          aoFaltou={async () => {
            const erro = await mudarStatus(confirmando.id, "faltou");
            if (!erro) recarregar();
            return erro;
          }}
          aoRemarcar={async (inicio) => {
            const erro = await reagendar(confirmando, inicio);
            if (!erro) recarregar();
            return erro;
          }}
          aoCancelar={async () => {
            const erro = await mudarStatus(confirmando.id, "cancelado");
            if (!erro) recarregar();
            return erro;
          }}
          aoFechar={() => setConfirmando(null)}
        />
      )}
    </div>
  );
}

// "Cleris Fernanda Gonçalves da Silva" -> "Cleris Fernanda" (telefone fica como está)
function primeiroESegundo(nome: string): string {
  if (/^\(?\d/.test(nome)) return nome;
  const [p, s] = nome.trim().split(/\s+/);
  return s && !["da", "de", "do", "das", "dos", "e"].includes(s.toLowerCase()) ? `${p} ${s}` : p;
}

// A cliente em destaque: a hora bem grande, o nome, o serviço, o que a IA anotou e uma ação só
function Destaque({
  rotulo,
  atendimento: a,
  quando,
  intencao,
  acao,
  aoDesfazerChegada,
}: {
  rotulo: string;
  atendimento: Atendimento;
  quando?: string;
  intencao: Avaliacao | undefined;
  acao: { rotulo: string; aoTocar: () => void } | null;
  aoDesfazerChegada?: () => void;
}) {
  const resumoIa = intencao?.pre_resumo?.trim();
  const conversa = a.clientes ? `/conversas/${a.clientes.id}` : null;
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-semibold text-rotulo">{rotulo}</span>
        {quando && <span className="shrink-0 text-[14px] font-bold">{quando}</span>}
      </div>
      <Link href={a.clientes ? `/clientes/${a.clientes.id}` : "/agenda"} className="flex flex-col active:opacity-70">
        <span className="text-[64px] leading-none font-extrabold tracking-[-0.05em]">{formatarHora(a.inicio)}</span>
        <span className="mt-3 truncate text-[20px] font-bold">{primeiroESegundo(nomeDe(a.clientes))}</span>
        <span className="text-[16px] text-texto-2">
          {resumoDosServicos(a)} · {duracao(minutosDe(a))}
        </span>
      </Link>
      {(resumoIa || a.origem === "ia") && (
        <p className="mt-3 flex gap-2 text-[15px] leading-[1.45] text-texto-2">
          <span aria-hidden className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-ouro-antigo" />
          <span className="line-clamp-3">
            {intencao?.resultado === "pensando" && <b>Ficou de pensar. </b>}
            {resumoIa ?? "Marcado pela IA."}
          </span>
        </p>
      )}
      {a.chegou_em && (
        <p className="mt-4 flex min-h-11 items-center justify-between rounded-[13px] bg-salvia px-4 text-[15px] text-salvia-texto">
          <span>
            <b>Chegou</b> às {formatarHora(a.chegou_em)}
          </span>
          {aoDesfazerChegada && (
            <button onClick={aoDesfazerChegada} className="h-11 font-semibold underline underline-offset-2">
              Desfazer
            </button>
          )}
        </p>
      )}
      {acao ? (
        <>
          <button onClick={acao.aoTocar} className="mt-4 h-[52px] rounded-[14px] bg-grafite text-[17px] font-bold text-perola active:scale-[0.99]">
            {acao.rotulo}
          </button>
          {conversa && (
            <Link href={conversa} className="mx-auto flex h-11 items-center px-3 text-[15px] font-bold underline underline-offset-2">
              Ver conversa
            </Link>
          )}
        </>
      ) : (
        conversa && (
          <Link
            href={conversa}
            className="mt-4 flex h-[52px] items-center justify-center rounded-[14px] bg-grafite text-[17px] font-bold text-perola active:scale-[0.99]"
          >
            Ver conversa
          </Link>
        )
      )}
    </div>
  );
}

// Frase do dia: o versículo entre aspas e a referência pequena ao lado
function FraseDoDia({ dia }: { dia: string }) {
  const f = fraseDoDia(dia);
  return (
    <p className="px-5 pt-3 text-[15px] leading-[1.45] text-texto-2">
      “{f.texto}” <span className="text-[13px] font-semibold whitespace-nowrap text-rotulo">{f.referencia}</span>
    </p>
  );
}

// Linha de aviso do rodapé do Início: bolinha (opcional), texto e seta. Vai para outra tela
// (href) ou abre/fecha algo logo abaixo (aoTocar)
function LinhaRodape({
  texto,
  ponto,
  forte,
  href,
  aoTocar,
  aberta,
}: {
  texto: string;
  ponto?: string;
  forte?: boolean;
  href?: string;
  aoTocar?: () => void;
  aberta?: boolean;
}) {
  const conteudo = (
    <>
      {ponto && <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${ponto}`} />}
      <span className={`min-w-0 flex-1 truncate text-[16px] ${forte ? "font-bold" : ""}`}>{texto}</span>
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#7A5870"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        className={`shrink-0 transition-transform duration-200 ${aberta ? "rotate-90" : ""}`}
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </>
  );
  const classe = "flex min-h-14 w-full items-center gap-3 text-left active:opacity-60";
  return (
    <li className="border-t border-borda">
      {href ? (
        <Link href={href} className={classe}>
          {conteudo}
        </Link>
      ) : (
        <button onClick={aoTocar} aria-expanded={aberta} className={classe}>
          {conteudo}
        </button>
      )}
    </li>
  );
}

// Lista de horários (hoje ou amanhã). Toque abre a ficha; deslizar mostra os atalhos.
// Sem aoConcluir (amanhã) não aparece o ✓ Concluído, só o WhatsApp.
function ListaHorarios({
  atendimentos,
  linhaAberta,
  aoAbrirLinha,
  aoConcluir,
  aoChegou,
  comSelo,
}: {
  atendimentos: Atendimento[];
  linhaAberta: string | null;
  aoAbrirLinha: (id: string | null) => void;
  aoConcluir?: (a: Atendimento) => void;
  aoChegou?: (a: Atendimento) => void;
  comSelo?: boolean;
}) {
  const router = useRouter();
  const hoje = hojeNoSalao();
  return (
    <ul className="overflow-hidden rounded-[18px] bg-card borda-suave">
      {atendimentos.map((a, i) => {
        const s = selo(a);
        // Pendente de um dia anterior: a data aparece em cima da hora
        const diaAnterior = dataNoSalao(a.inicio) < hoje;
        return (
          <li key={a.id} className={i > 0 ? "border-t border-campo" : ""}>
            <LinhaDeslizante
              aberta={linhaAberta === a.id}
              aoAbrir={(sim) => aoAbrirLinha(sim ? a.id : null)}
              aoTocar={() => router.push(a.clientes ? `/clientes/${a.clientes.id}` : "/agenda")}
              acoes={acoesDoHorario(a, aoConcluir && (() => aoConcluir(a)), aoChegou && (() => aoChegou(a)))}
              className="gap-3 bg-card px-3.5 py-3 active:bg-campo"
            >
              <span className="flex w-[52px] shrink-0 flex-col text-[17px] font-extrabold tracking-[-0.02em]">
                {diaAnterior && <span className="text-[11px] font-semibold text-rose-texto">{formatarData(a.inicio).slice(0, 5)}</span>}
                {formatarHora(a.inicio)}
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[16px] font-bold">{nomeDe(a.clientes)}</span>
                <span className="truncate text-[15px] text-texto-2">{resumoDosServicos(a)}</span>
              </span>
              {comSelo && <span className={`shrink-0 rounded-full px-2.5 py-1 text-[13px] font-bold whitespace-nowrap ${s.classe}`}>{s.rotulo}</span>}
            </LinhaDeslizante>
          </li>
        );
      })}
    </ul>
  );
}

// Atalhos atrás de um horário da lista
function acoesDoHorario(a: Atendimento, aoConcluir?: () => void, aoChegou?: () => void): AcaoDeslizante[] {
  const acoes: AcaoDeslizante[] = [];
  // Chegou: só hoje, para quem ainda não chegou nem foi concluída
  if (aoChegou && a.status === "agendado" && !a.chegou_em) {
    acoes.push({
      rotulo: "Chegou",
      cor: "bg-ouro-texto",
      aoTocar: aoChegou,
      icone: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M9 21V9l6-4v16M5 21h14M12 13h.01" />
        </svg>
      ),
    });
  }
  if (aoConcluir && a.status === "agendado") {
    acoes.push({
      rotulo: "Concluído",
      cor: "bg-[#2F7D5B]",
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
        stroke="#7A5870"
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
function Topo({ titulo, alerta, aoRegistrar }: { titulo: string; alerta: boolean; aoRegistrar: () => void }) {
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
          <span className="w-[96px] shrink-0" aria-hidden />
          <span className="truncate text-[17px] font-semibold">{titulo}</span>
          <div className="flex w-[96px] shrink-0 justify-end gap-2">
            <BolhaRegistrar aoTocar={aoRegistrar} pequena />
            <BolhaConfiguracoes alerta={alerta} pequena />
          </div>
        </div>
      </div>

      <header className="flex items-end justify-between gap-3 px-5 pt-6">
        <div className="flex min-w-0 flex-col">
          <span className="text-[13px] font-semibold text-rotulo">{formatarDiaLongo(hojeNoSalao())}</span>
          <h1 className="text-[30px] leading-tight tracking-[-0.035em] font-bold">{titulo}</h1>
          {/* Quando este ponto sai da tela, o topo encolhe */}
          <div ref={marco} aria-hidden className="h-px" />
        </div>
        <div className="mb-4 flex gap-2">
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
      className={`relative flex shrink-0 items-center justify-center rounded-full active:scale-95 ${pequena ? "vidro h-11 w-11" : "h-11 w-11 border border-claro bg-card"}`}
    >
      <svg width={pequena ? 17 : 20} height={pequena ? 17 : 20} viewBox="0 0 24 24" fill="none" stroke="#1B1719" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
      </svg>
      {alerta && <span aria-hidden className={`absolute rounded-full bg-atencao ${pequena ? "top-1.5 right-1.5 h-[6px] w-[6px]" : "top-2 right-2 h-[7px] w-[7px]"}`} />}
    </Link>
  );
}

// "+" numa bolha de vidro, como no Calendário e nos Contatos: registrar atendimento
function BolhaRegistrar({ aoTocar, pequena }: { aoTocar: () => void; pequena?: boolean }) {
  return (
    <button
      onClick={aoTocar}
      aria-label="Registrar atendimento"
      className={`flex shrink-0 items-center justify-center rounded-full active:scale-95 ${pequena ? "vidro h-11 w-11" : "h-11 w-11 active:bg-campo"}`}
    >
      <svg width={pequena ? 18 : 24} height={pequena ? 18 : 24} viewBox="0 0 24 24" fill="none" stroke="#1B1719" strokeWidth={2} strokeLinecap="round" aria-hidden>
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  );
}

// Aniversários numa linha só; quem faz hoje aparece no resumo. Um toque abre a lista.
function Aniversarios({ lista }: { lista: Aniversariante[] }) {
  const [aberta, setAberta] = useState(false);
  const deHoje = lista.filter((c) => c.dia === hojeNoSalao());
  const resumo = deHoje.length
    ? `Aniversário hoje: ${deHoje.map((c) => primeiroNome(c.nome) || nomeDe(c)).join(", ")}${lista.length > deHoje.length ? ` · +${lista.length - deHoje.length} na semana` : ""}`
    : `${lista.length} ${lista.length === 1 ? "aniversário" : "aniversários"} esta semana`;

  return (
    <li className="border-t border-borda">
      <button onClick={() => setAberta((a) => !a)} aria-expanded={aberta} className="flex min-h-14 w-full items-center gap-3 text-left active:opacity-60">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A5870" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0">
          <rect x="3" y="8" width="18" height="4" rx="1" />
          <path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5" />
        </svg>
        <span className={`min-w-0 flex-1 truncate text-[16px] ${deHoje.length ? "font-bold" : ""}`}>{resumo}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A5870" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 transition-transform ${aberta ? "rotate-90" : ""}`}>
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
      {aberta && (
        <ul className="mb-3 rounded-[18px] bg-card borda-suave">
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
    </li>
  );
}

function BotaoWhatsApp({ rotulo, aoTocar }: { rotulo: string; aoTocar: () => void }) {
  return (
    <button
      onClick={aoTocar}
      aria-label={rotulo}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-borda active:bg-campo"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#1F5C42" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
      </svg>
    </button>
  );
}
