"use client";

import Link from "next/link";
import { useState } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { lerAlmoco } from "@/lib/almoco";
import { BotaoSair, useEmpresa } from "@/lib/empresa";
import { formatarTelefone, normalizarTelefone, telefoneValido } from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";

export default function ConfiguracoesPage() {
  return (
    <>
      <Cabecalho
        titulo="Configurações"
        acao={
          <Link href="/" className="flex h-11 items-center px-2 text-lg font-semibold text-[var(--cor-principal)]">
            Voltar
          </Link>
        }
      />
      <div className="space-y-4">
        <Link
          href="/configuracoes/loja"
          className="mx-4 flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm active:bg-neutral-50"
        >
          <span>
            <span className="block text-lg font-semibold">Dados do salão</span>
            <span className="block text-neutral-600">Endereço, horário de funcionamento, pagamento e regras.</span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-neutral-500" aria-hidden>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
        <AlertaWhatsApp />
        <HorarioAlmoco />
        <Link
          href="/configuracoes/servicos"
          className="mx-4 flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm active:bg-neutral-50"
        >
          <span>
            <span className="block text-lg font-semibold">Serviços e preços</span>
            <span className="block text-neutral-600">Valores, duração e retorno de cada serviço. A IA usa o que estiver aqui.</span>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-neutral-500" aria-hidden>
            <path d="m9 18 6-6-6-6" />
          </svg>
        </Link>
        <div className="px-4">
          <BotaoSair />
        </div>
      </div>
    </>
  );
}

// Salva um pedaço de empresas.config sem apagar o resto
async function salvarConfig(empresaId: string, mudanca: Record<string, unknown>) {
  const db = supabase();
  const atual = await db.from("empresas").select("config").eq("id", empresaId).single();
  if (atual.error) return atual.error.message;
  const config = { ...(atual.data.config as Record<string, unknown>), ...mudanca };
  const { error } = await db.from("empresas").update({ config }).eq("id", empresaId);
  return error?.message;
}

// Horário de almoço: a Agenda não deixa marcar nem reagendar nesse intervalo, e a IA
// também deve respeitar (empresas.config.almoco, ver CONTRATO.md)
function HorarioAlmoco() {
  const empresa = useEmpresa();
  const inicial = lerAlmoco(empresa.config);
  const [ativo, setAtivo] = useState(inicial !== null);
  const [inicio, setInicio] = useState(inicial?.inicio ?? "11:00");
  const [fim, setFim] = useState(inicial?.fim ?? "13:00");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setAviso("");
    if (ativo && inicio >= fim) {
      setAviso("O fim do almoço precisa ser depois do começo.");
      return;
    }
    setSalvando(true);
    const erro = await salvarConfig(empresa.id, { almoco: ativo ? { inicio, fim } : null });
    setSalvando(false);
    setAviso(erro ? `Não foi possível salvar: ${erro}` : "Salvo ✓");
  }

  const campo = "h-12 w-full rounded-xl border border-neutral-300 bg-white px-3 text-lg";

  return (
    <section className="mx-4 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Horário de almoço</h2>
          <p className="text-neutral-600">Nesse intervalo não dá para marcar horário.</p>
        </div>
        <button
          onClick={() => setAtivo(!ativo)}
          role="switch"
          aria-checked={ativo}
          aria-label="Bloquear horário de almoço"
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${ativo ? "bg-[var(--cor-principal)]" : "bg-neutral-300"}`}
        >
          <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${ativo ? "left-7" : "left-1"}`} />
        </button>
      </div>
      {ativo && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="font-medium">Começa</span>
            <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} className={campo} />
          </label>
          <label className="block space-y-1">
            <span className="font-medium">Termina</span>
            <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} className={campo} />
          </label>
        </div>
      )}
      <button
        onClick={salvar}
        disabled={salvando}
        className="h-12 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-50"
      >
        {salvando ? "Salvando…" : "Salvar almoço"}
      </button>
      {aviso && <p className="text-center font-medium">{aviso}</p>}
    </section>
  );
}

// Número que recebe o aviso quando uma cliente pede para falar com alguém (pediu humano,
// reclamou ou perguntou algo fora do escopo). Fica em empresas.config.whatsapp_alerta;
// quem manda a mensagem é o n8n (ver CONTRATO.md).
function AlertaWhatsApp() {
  const empresa = useEmpresa();
  const salvo = typeof empresa.config.whatsapp_alerta === "string" ? empresa.config.whatsapp_alerta : "";
  const [telefone, setTelefone] = useState(salvo ? formatarTelefone(salvo) : "");
  const [aviso, setAviso] = useState("");
  const [salvando, setSalvando] = useState(false);

  async function salvar() {
    setAviso("");
    const numero = normalizarTelefone(telefone);
    if (telefone.trim() && !telefoneValido(numero)) {
      setAviso("Telefone inválido. Digite com DDD, ex.: (66) 99999-8888.");
      return;
    }
    setSalvando(true);
    const db = supabase();
    // Lê o config atual do banco para não apagar outras configurações
    const atual = await db.from("empresas").select("config").eq("id", empresa.id).single();
    if (atual.error) {
      setSalvando(false);
      setAviso(`Não foi possível salvar: ${atual.error.message}`);
      return;
    }
    const config = { ...(atual.data.config as Record<string, unknown>), whatsapp_alerta: telefone.trim() ? numero : null };
    const { error } = await db.from("empresas").update({ config }).eq("id", empresa.id);
    setSalvando(false);
    if (error) {
      setAviso(`Não foi possível salvar: ${error.message}`);
      return;
    }
    if (telefone.trim()) setTelefone(formatarTelefone(numero));
    setAviso("Salvo ✓");
  }

  return (
    <section className="mx-4 space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">WhatsApp para alertas</h2>
        <p className="text-neutral-600">
          A IA manda para este número o resumo de quem pediu para falar com você e as perguntas rápidas que ela não
          sabe responder. Para responder uma pergunta, toque em Responder na mensagem dela.
        </p>
      </div>
      <input
        inputMode="tel"
        placeholder="(66) 99999-8888"
        value={telefone}
        onChange={(e) => setTelefone(e.target.value)}
        className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
      />
      <button
        onClick={salvar}
        disabled={salvando}
        className="h-12 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-50"
      >
        {salvando ? "Salvando…" : "Salvar número"}
      </button>
      {aviso && <p className="text-center font-medium">{aviso}</p>}
    </section>
  );
}
