"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BotaoFlutuante } from "@/components/BotaoFlutuante";
import { Cabecalho } from "@/components/Cabecalho";
import { CartaoAtendimento } from "@/components/CartaoAtendimento";
import { FormAtendimento } from "@/components/FormAtendimento";
import {
  buscarAtendimentosDoDia,
  buscarReagendadosDoDia,
  corDaProfissional,
  type Atendimento,
} from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { estaExcluida } from "@/lib/excluidas";
import {
  formatarData,
  formatarDiaLongo,
  formatarHora,
  formatarTelefone,
  hojeNoSalao,
  inicioDoDia,
} from "@/lib/formato";
import { PontoStatus, STATUS, type StatusCliente } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

const LINHAS_CLIENTES: { status: StatusCliente; rotulo: string }[] = [
  { status: "retorno_chegando", rotulo: "Retorno chegando" },
  { status: "retorno_atrasado", rotulo: "Atrasadas" },
  { status: "inativa", rotulo: "Inativas" },
  { status: "em_dia", rotulo: "Em dia" },
  { status: "sem_visita", rotulo: "Sem visita" },
];

const MOTIVOS: Record<string, string> = {
  pediu_humano: "Pediu para falar com você",
  reclamacao: "Fez uma reclamação",
  fora_escopo: "Perguntou algo que a IA não sabe",
};

type Precisa = { id: string; nome: string | null; telefone: string; motivo_pausa: string };

type Resolvido = "realizado" | "faltou" | "cancelado" | "reagendado";

type Resumo = {
  precisam: Precisa[];
  // Só os horários que ainda esperam a dona (status "agendado")
  hoje: Atendimento[];
  // Os que já foram resolvidos hoje saem da lista e vão para estas abas
  resolvidos: Record<Resolvido, Atendimento[]>;
  contagem: Record<string, number>;
  ordemProfissionais: string[];
  iaConversou: number;
  iaMarcou: number;
};

async function buscarResumo(empresaId: string): Promise<Resumo | { erro: string }> {
  const db = supabase();
  const hoje = hojeNoSalao();
  const desde = inicioDoDia(hoje);
  const [clientes, atendimentos, reagendados, profissionais, mensagensIa, marcadosIa] = await Promise.all([
    db
      .from("clientes_status")
      .select("id, nome, telefone, status, ia_pausada, motivo_pausa, etiquetas")
      .eq("empresa_id", empresaId),
    buscarAtendimentosDoDia(empresaId, hoje),
    buscarReagendadosDoDia(empresaId, hoje),
    db.from("profissionais").select("id").eq("empresa_id", empresaId).order("nome"),
    db.from("mensagens").select("cliente_id").eq("empresa_id", empresaId).eq("autor", "ia").gte("criado_em", desde),
    db
      .from("agendamentos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("origem", "ia")
      .gte("criado_em", desde),
  ]);
  const erro = clientes.error ?? profissionais.error ?? mensagensIa.error ?? marcadosIa.error;
  if (erro) return { erro: erro.message };
  if (atendimentos.erro) return { erro: atendimentos.erro };
  if (reagendados.erro) return { erro: reagendados.erro };
  const doDia = atendimentos.atendimentos;

  const lista = (clientes.data ?? []).filter((c) => !estaExcluida(c.etiquetas));
  const contagem: Record<string, number> = {};
  for (const c of lista) contagem[c.status] = (contagem[c.status] ?? 0) + 1;

  return {
    precisam: lista.filter((c) => c.ia_pausada && c.motivo_pausa in MOTIVOS) as Precisa[],
    hoje: doDia.filter((a) => a.status === "agendado"),
    resolvidos: {
      realizado: doDia.filter((a) => a.status === "realizado"),
      faltou: doDia.filter((a) => a.status === "faltou"),
      cancelado: doDia.filter((a) => a.status === "cancelado"),
      reagendado: reagendados.atendimentos,
    },
    contagem,
    ordemProfissionais: (profissionais.data ?? []).map((p) => p.id),
    iaConversou: new Set((mensagensIa.data ?? []).map((m) => m.cliente_id)).size,
    iaMarcou: marcadosIa.count ?? 0,
  };
}

// Caixa branca com título: cada assunto do Início fica separado do outro
function Caixa({ titulo, extra, children }: { titulo: ReactNode; extra?: ReactNode; children: ReactNode }) {
  return (
    <section className="mx-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">{titulo}</h2>
        {extra}
      </div>
      {children}
    </section>
  );
}

// Número grande com rótulo pequeno, para o resumo do dia
function Numero({ valor, rotulo, href }: { valor: number; rotulo: string; href?: string }) {
  const conteudo = (
    <>
      <p className="text-2xl font-bold">{valor}</p>
      <p className="text-sm leading-tight text-neutral-500">{rotulo}</p>
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl bg-neutral-50 p-3 active:bg-neutral-100">
      {conteudo}
    </Link>
  ) : (
    <div className="rounded-xl bg-neutral-50 p-3">{conteudo}</div>
  );
}

const ABAS_RESOLVIDOS: { chave: Resolvido; rotulo: string; vazio: string }[] = [
  { chave: "realizado", rotulo: "Realizados", vazio: "Nenhum atendimento realizado hoje ainda." },
  { chave: "faltou", rotulo: "Faltaram", vazio: "Ninguém faltou hoje." },
  { chave: "cancelado", rotulo: "Cancelados", vazio: "Nenhum horário cancelado hoje." },
  { chave: "reagendado", rotulo: "Reagendados", vazio: "Nenhum horário de hoje foi reagendado." },
];

// Horários de hoje que já foram resolvidos, separados em quatro abas. Tocar de novo no
// botão do status (ex.: "Realizado") desfaz e o horário volta para "Para atender hoje".
function ResolvidosHoje({
  resolvidos,
  ordemProfissionais,
  aoMudar,
}: {
  resolvidos: Record<Resolvido, Atendimento[]>;
  ordemProfissionais: string[];
  aoMudar: () => void;
}) {
  const [aba, setAba] = useState<Resolvido>("realizado");
  const atual = ABAS_RESOLVIDOS.find((a) => a.chave === aba)!;
  const lista = resolvidos[aba];

  return (
    <Caixa titulo="Resolvidos hoje">
      <div className="grid grid-cols-2 gap-2">
        {ABAS_RESOLVIDOS.map((a) => (
          <button
            key={a.chave}
            onClick={() => setAba(a.chave)}
            aria-pressed={aba === a.chave}
            className={`h-11 rounded-xl font-semibold ${
              aba === a.chave ? "chip-ativo" : "border border-neutral-200 bg-white text-neutral-700"
            }`}
          >
            {a.rotulo} ({resolvidos[a.chave].length})
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {lista.length === 0 && <p className="text-neutral-500">{atual.vazio}</p>}
        {aba === "reagendado"
          ? lista.map((a) => (
              <div key={a.id} className="rounded-xl bg-neutral-50 p-3">
                <p className="font-semibold">{a.clientes?.nome ?? "Cliente"}</p>
                <p className="text-sm text-neutral-600">{a.servicos?.nome ?? "Serviço não informado"}</p>
                <p className="text-sm">
                  Nova data: <strong>{formatarData(a.inicio).slice(0, 5)} às {formatarHora(a.inicio)}</strong>
                </p>
              </div>
            ))
          : lista.map((a) => (
              <CartaoAtendimento
                key={a.id}
                atendimento={a}
                cor={corDaProfissional(a.profissional_id, ordemProfissionais).borda}
                aoMudar={aoMudar}
                permitirExcluir
              />
            ))}
      </div>
    </Caixa>
  );
}

export default function InicioPage() {
  const empresa = useEmpresa();
  const [resumo, setResumo] = useState<Resumo | { erro: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const [registrando, setRegistrando] = useState(false);
  const recarregar = () => setVersao((v) => v + 1);

  useEffect(() => {
    let ativo = true;
    buscarResumo(empresa.id).then((r) => {
      if (ativo) setResumo(r);
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, versao]);

  // A IA grava sozinha: quando chega mensagem ou horário novo, a tela se atualiza
  useTempoReal(["agendamentos", "clientes", "mensagens"], empresa.id, recarregar);

  const paraChamar = resumo && !("erro" in resumo)
    ? (resumo.contagem.retorno_chegando ?? 0) + (resumo.contagem.retorno_atrasado ?? 0)
    : 0;

  return (
    <>
      <Cabecalho
        titulo={empresa.nome}
        acao={
          <Link
            href="/configuracoes"
            aria-label="Configurações"
            className="flex h-12 w-12 items-center justify-center rounded-full active:bg-neutral-100"
          >
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
            </svg>
          </Link>
        }
      />
      <p className="-mt-1 px-4 text-lg text-neutral-600">{formatarDiaLongo(hojeNoSalao())}</p>

      {!resumo && <p className="p-4 text-neutral-500">Carregando…</p>}
      {resumo && "erro" in resumo && (
        <p className="m-4 rounded-xl bg-red-100 p-4 text-red-900">Erro ao ler o banco: {resumo.erro}</p>
      )}
      {resumo && !("erro" in resumo) && (
        <div className="mt-4 space-y-4">
          {/* Resumo do dia em três números */}
          <section className="mx-4 grid grid-cols-3 gap-2 rounded-2xl border border-neutral-200 bg-white p-2 shadow-sm">
            <Numero valor={resumo.hoje.length} rotulo="para atender hoje" href="/agenda" />
            <Numero valor={paraChamar} rotulo="para chamar" href="/clientes?filtro=para_chamar" />
            <Numero valor={resumo.iaMarcou} rotulo="marcados pela IA" />
          </section>

          {resumo.precisam.length > 0 && (
            <Caixa
              titulo={
                <>
                  <PontoStatus cor="bg-red-500" tamanho="h-3 w-3" />
                  Precisam de você
                </>
              }
              extra={<span className="text-sm text-neutral-500">{resumo.precisam.length}</span>}
            >
              <ul className="space-y-2">
                {resumo.precisam.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 rounded-xl bg-neutral-50 p-3">
                    {/* Na fase 4 este toque abre a conversa */}
                    <Link href={`/clientes/${c.id}`} className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{c.nome ?? formatarTelefone(c.telefone)}</p>
                      <p className="text-sm text-red-700">{MOTIVOS[c.motivo_pausa]}</p>
                      <p className="text-sm text-neutral-500">{formatarTelefone(c.telefone)}</p>
                    </Link>
                    {/* Um toque e a dona já está falando com a cliente */}
                    <button
                      onClick={() => abrirWhatsApp(c.telefone)}
                      className="h-11 shrink-0 rounded-xl border border-neutral-300 bg-white px-3 font-semibold text-green-700 active:bg-neutral-100"
                    >
                      WhatsApp
                    </button>
                  </li>
                ))}
              </ul>
            </Caixa>
          )}

          {/* Os horários já são caixinhas: ficam soltos, sem outra caixa em volta */}
          <section className="space-y-3 px-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Para atender hoje</h2>
              <span className="text-sm text-neutral-500">{resumo.hoje.length}</span>
            </div>
            {resumo.hoje.length === 0 && (
              <p className="rounded-2xl border border-neutral-200 bg-white p-4 text-neutral-500">
                {Object.values(resumo.resolvidos).some((l) => l.length > 0)
                  ? "Todos os horários de hoje já foram resolvidos."
                  : "Nenhum horário para hoje."}
              </p>
            )}
            <div className="space-y-3">
              {resumo.hoje.map((a) => (
                <CartaoAtendimento
                  key={a.id}
                  atendimento={a}
                  cor={corDaProfissional(a.profissional_id, resumo.ordemProfissionais).borda}
                  aoMudar={recarregar}
                  permitirExcluir
                />
              ))}
            </div>
          </section>

          <ResolvidosHoje
            resolvidos={resumo.resolvidos}
            ordemProfissionais={resumo.ordemProfissionais}
            aoMudar={recarregar}
          />

          <Caixa titulo="Suas clientes">
            <ul className="divide-y divide-neutral-100">
              {LINHAS_CLIENTES.map((l) => (
                <li key={l.status}>
                  <Link
                    href={`/clientes?filtro=${l.status}`}
                    className="flex h-12 items-center justify-between gap-2 active:bg-neutral-50"
                  >
                    <span className="flex items-center gap-2 text-neutral-800">
                      <PontoStatus cor={STATUS[l.status].ponto} />
                      {l.rotulo}
                    </span>
                    <span className="flex items-center gap-2 font-semibold">
                      {resumo.contagem[l.status] ?? 0}
                      <span className="text-xl text-neutral-400" aria-hidden>
                        ›
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Caixa>

          <p className="px-4 text-center text-sm text-neutral-500">
            Hoje a IA conversou com {resumo.iaConversou} {resumo.iaConversou === 1 ? "cliente" : "clientes"}.
          </p>
        </div>
      )}

      {/* Espaço para o botão flutuante não cobrir o fim da tela */}
      <div className="h-20" />
      <BotaoFlutuante rotulo="+ Registrar atendimento" aoTocar={() => setRegistrando(true)} />
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
    </>
  );
}
