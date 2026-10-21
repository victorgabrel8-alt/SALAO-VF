"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { BotaoFlutuante } from "@/components/BotaoFlutuante";
import { Cabecalho } from "@/components/Cabecalho";
import { FormAtendimento } from "@/components/FormAtendimento";
import { Observacao } from "@/components/Observacao";
import { buscarAtendimentosDoDia, type Atendimento } from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { estaExcluida } from "@/lib/excluidas";
import { formatarDiaLongo, formatarHora, formatarTelefone, hojeNoSalao, inicioDoDia } from "@/lib/formato";
import { PontoStatus } from "@/lib/status";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

const MOTIVOS: Record<string, string> = {
  pediu_humano: "Pediu para falar com você",
  reclamacao: "Fez uma reclamação",
  fora_escopo: "Perguntou algo que a IA não sabe",
};

type Precisa = { id: string; nome: string | null; telefone: string; motivo_pausa: string };

type Resumo = {
  precisam: Precisa[];
  // Só os horários que ainda esperam a dona (status "agendado")
  hoje: Atendimento[];
  iaConversou: number;
  iaMarcou: number;
};

async function buscarResumo(empresaId: string): Promise<Resumo | { erro: string }> {
  const db = supabase();
  const hoje = hojeNoSalao();
  const desde = inicioDoDia(hoje);
  // Leve: não baixa a lista de clientes, só quem precisa da dona agora
  const [clientes, atendimentos, mensagensIa, marcadosIa] = await Promise.all([
    db
      .from("clientes_status")
      .select("id, nome, telefone, motivo_pausa, etiquetas")
      .eq("empresa_id", empresaId)
      .eq("ia_pausada", true)
      .in("motivo_pausa", Object.keys(MOTIVOS)),
    buscarAtendimentosDoDia(empresaId, hoje),
    db.from("mensagens").select("cliente_id").eq("empresa_id", empresaId).eq("autor", "ia").gte("criado_em", desde),
    db
      .from("agendamentos")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .eq("origem", "ia")
      .gte("criado_em", desde),
  ]);
  const erro = clientes.error ?? mensagensIa.error ?? marcadosIa.error;
  if (erro) return { erro: erro.message };
  if (atendimentos.erro) return { erro: atendimentos.erro };

  return {
    precisam: (clientes.data ?? []).filter((c) => !estaExcluida(c.etiquetas)) as Precisa[],
    hoje: atendimentos.atendimentos.filter((a) => a.status === "agendado"),
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
            <Numero valor={resumo.iaConversou} rotulo="conversas da IA hoje" href="/conversas" />
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
                    {/* Toque abre a conversa com a IA, para a dona ver o que ela pediu */}
                    <Link href={`/conversas/${c.id}`} className="min-w-0 flex-1">
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

          {/* Para atender hoje: só horário e nome. As ações (realizado, faltou...) ficam na Agenda. */}
          <Caixa titulo="Para atender hoje" extra={<span className="text-sm text-neutral-500">{resumo.hoje.length}</span>}>
            {resumo.hoje.length === 0 ? (
              <p className="text-neutral-500">Ninguém esperando atendimento hoje.</p>
            ) : (
              <ul className="divide-y divide-neutral-100">
                {resumo.hoje.map((a) => (
                  <li key={a.id}>
                    <Link
                      href={a.clientes ? `/clientes/${a.clientes.id}` : "/agenda"}
                      className="flex items-start gap-4 py-3 active:bg-neutral-50"
                    >
                      <span className="w-14 shrink-0 text-lg font-bold">{formatarHora(a.inicio)}</span>
                      <span className="min-w-0">
                        <span className="block truncate text-lg font-semibold">
                          {a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")}
                        </span>
                        <Observacao texto={a.clientes?.observacoes} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Caixa>
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
