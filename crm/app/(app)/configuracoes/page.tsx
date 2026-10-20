"use client";

import Link from "next/link";
import { useState } from "react";
import { Cabecalho, EmBreve } from "@/components/Cabecalho";
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
        <AlertaWhatsApp />
        <Link
          href="/configuracoes/excluidas"
          className="mx-4 flex h-14 items-center justify-between rounded-2xl border border-neutral-200 bg-white px-4 shadow-sm active:bg-neutral-50"
        >
          <span className="text-lg font-semibold">Clientes excluídas</span>
          <span className="text-2xl text-neutral-400" aria-hidden>
            ›
          </span>
        </Link>
        <EmBreve fase={5} oQue="Serviços, profissionais e mensagens" />
        <div className="px-4">
          <BotaoSair />
        </div>
      </div>
    </>
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
          Quando uma cliente pedir para falar com alguém, a IA avisa neste número com o nome e o telefone dela.
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
