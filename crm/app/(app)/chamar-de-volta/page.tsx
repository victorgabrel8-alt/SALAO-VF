"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { Voltar } from "@/components/Voltar";
import {
  buscarParaChamar,
  contarProfissionais,
  mensagemChamarDeVolta,
  textoPassou,
  type ParaChamar,
} from "@/lib/chamarDeVolta";
import { useEmpresa } from "@/lib/empresa";
import { formatarData, formatarTelefone, primeiroNome } from "@/lib/formato";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

// Chamar de volta: as clientes que já passaram do tempo de voltar (retorno do serviço) e não têm
// horário marcado, quem passou mais primeiro. A dona toca em "Chamar" e o WhatsApp do celular
// dela abre com a mensagem pronta; o app não envia nada. Quando a mensagem sai pelo WhatsApp do
// salão (ou ela marca horário), a cliente sai da lista sozinha (ver supabase/063).

function nomeDe(c: ParaChamar): string {
  return c.nome ?? formatarTelefone(c.telefone);
}

export default function ChamarDeVoltaPage() {
  const empresa = useEmpresa();
  const [resultado, setResultado] = useState<{ clientes: ParaChamar[] } | { erro: string } | null>(null);
  const [variasProfissionais, setVariasProfissionais] = useState(false);
  const [versao, setVersao] = useState(0);
  // Quem a dona já tocou em "Chamar" agora (só nesta tela, para ela não chamar duas vezes)
  const [chamadas, setChamadas] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let ativo = true;
    buscarParaChamar(empresa.id).then((r) => {
      if (ativo) setResultado(r.erro ? { erro: r.erro } : { clientes: r.clientes });
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, versao]);

  useEffect(() => {
    contarProfissionais(empresa.id).then((n) => setVariasProfissionais(n > 1));
  }, [empresa.id]);

  // Marcou horário ou o salão mandou mensagem: a lista se atualiza
  useTempoReal(["agendamentos", "mensagens"], empresa.id, () => setVersao((v) => v + 1));

  const lista = resultado && "clientes" in resultado ? resultado.clientes : null;
  // O mesmo prazo da view (empresas.config.chamar_de_volta_dias, padrão 7)
  const diasSemChamar = Number(empresa.config.chamar_de_volta_dias) || 7;

  function chamar(c: ParaChamar) {
    abrirWhatsApp(c.telefone, mensagemChamarDeVolta(empresa.config, c));
    setChamadas((s) => new Set(s).add(c.id));
  }

  return (
    <>
      <header className="flex flex-col gap-3 px-4 pt-4">
        <Voltar para="/" className="vidro flex h-10 w-fit items-center gap-0.5 rounded-full pr-4 pl-2.5 text-[15px] font-semibold active:scale-95">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1B1719" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          Início
        </Voltar>
        <div>
          <h1 className="text-[30px] leading-tight tracking-[-0.035em] font-bold">Chamar de volta</h1>
          <p className="text-sm text-texto-2">
            {!resultado
              ? "Vendo quem passou do tempo…"
              : lista && lista.length > 0
                ? `${lista.length} ${lista.length === 1 ? "cliente passou" : "clientes passaram"} do tempo de voltar e não ${lista.length === 1 ? "tem" : "têm"} horário`
                : lista
                  ? "Ninguém passou do tempo de voltar"
                  : ""}
          </p>
        </div>
      </header>

      {resultado && "erro" in resultado && (
        <p className="m-4 rounded-2xl bg-rose p-4 text-rose-texto">Não consegui ler a lista: {resultado.erro}</p>
      )}

      {lista && lista.length === 0 && (
        <p className="mx-4 mt-6 rounded-[22px] bg-card p-5 text-center text-[15px] text-texto-2 borda-suave">
          Todas as clientes estão no prazo ou já têm horário marcado.
        </p>
      )}

      {lista && lista.length > 0 && (
        <div className="flex flex-col gap-3 px-4 pt-5">
          <ul className="overflow-hidden rounded-[22px] bg-card borda-suave">
            {lista.map((c, i) => {
              const chamada = chamadas.has(c.id);
              return (
                <li key={c.id} className={`flex items-center gap-3 px-3.5 py-3 ${i > 0 ? "border-t border-borda" : ""}`}>
                  <Link href={`/clientes/${c.id}`} className="flex min-w-0 flex-1 items-center gap-3 active:opacity-60">
                    <Avatar id={c.id} nome={c.nome} tamanho="h-10 w-10 text-base" />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-semibold">{nomeDe(c)}</span>
                      <span className="truncate text-[13px] text-texto-2">
                        {c.servico_nome ?? "Atendimento"} em {formatarData(c.feito_em).slice(0, 5)}
                        {variasProfissionais && c.profissional_nome ? ` · com ${primeiroNome(c.profissional_nome)}` : ""}
                      </span>
                      <span className="w-fit rounded-full bg-rose px-2 py-0.5 text-[11px] font-bold text-rose-texto">{textoPassou(c.dias_passados)}</span>
                    </span>
                  </Link>
                  <button
                    onClick={() => chamar(c)}
                    aria-label={`Chamar ${nomeDe(c)} no WhatsApp`}
                    className={`flex h-11 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[14px] font-semibold active:scale-95 ${
                      chamada ? "border border-borda text-texto-2" : "bg-salvia text-salvia-texto"
                    }`}
                  >
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                    </svg>
                    {chamada ? "Chamada" : "Chamar"}
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="text-center text-xs text-texto-2">
            O WhatsApp abre com a mensagem pronta para você conferir e enviar. Quem o salão já chamou ou com quem falou nos últimos {diasSemChamar} dias, combinou
            uma data ou marcou horário não aparece aqui.
          </p>
        </div>
      )}
    </>
  );
}
