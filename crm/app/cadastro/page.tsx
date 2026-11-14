"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { supabase, supabaseConfigurado } from "@/lib/supabase/client";
import { SALAO } from "@/lib/config";

// Página pública: a dona pede o cadastro da loja dela (docs/PLANO-MOTOR-UNICO.md, etapa 5).
// O pedido só grava uma linha no banco (função pedir_cadastro, supabase/050). Quem cria a loja, o login e o
// WhatsApp é a agência, ao aprovar o pedido no painel.

const RAMOS = [
  { chave: "unhas", titulo: "Unhas", texto: "Manicure e pedicure" },
  { chave: "megahair", titulo: "Mega hair", texto: "Aplicação e manutenção" },
];

// WhatsApp da agência, se configurado: link de ajuda quando o envio não dá certo
const WHATS_AGENCIA = (process.env.NEXT_PUBLIC_AGENCIA_WHATSAPP ?? "").replace(/\D/g, "");

const campo =
  "h-[56px] w-full rounded-2xl bg-card/85 px-[18px] text-[17px] outline-none ring-1 ring-grafite/[0.08] placeholder:text-inativo focus:bg-white focus:ring-2 focus:ring-bronze";

export default function CadastroPage() {
  const [ramo, setRamo] = useState("");
  const [nomeLoja, setNomeLoja] = useState("");
  const [dona, setDona] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [cidade, setCidade] = useState("");
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    if (!ramo) return setErro("Escolha o ramo da sua loja.");
    setEnviando(true);
    const { data, error } = await supabase().rpc("pedir_cadastro", {
      p_nome_loja: nomeLoja,
      p_ramo: ramo,
      p_dona: dona,
      p_whatsapp: whatsapp,
      p_cidade: cidade,
      p_email: email,
    });
    setEnviando(false);
    if (error) return setErro("Não conseguimos enviar agora. Tente de novo em instantes.");
    if (data !== "ok") return setErro(String(data));
    setEnviado(true);
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-perola text-texto">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute top-[-180px] left-1/2 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(168_138_104/0.32),transparent)]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-[440px] flex-1 flex-col px-6 pt-[calc(40px+env(safe-area-inset-top))] pb-[calc(32px+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-3">
          <Image src="/icone-192.png" alt="" width={48} height={48} className="h-12 w-12 rounded-[12px] shadow-[0_6px_14px_rgb(30_23_20/0.18)]" />
          <span className="font-serif text-[28px] leading-none font-semibold tracking-tight">{SALAO.nomeApp}</span>
        </div>

        {enviado ? (
          <div className="mt-10 space-y-4">
            <h1 className="font-serif text-[38px] leading-tight font-semibold">Pedido enviado</h1>
            <p role="status" className="rounded-2xl bg-salvia p-5 text-[17px] leading-relaxed text-salvia-texto">
              Recebemos o cadastro de <b>{nomeLoja}</b>. Vamos falar com você no WhatsApp para conectar o número da loja
              {email.trim() ? " e liberar o seu acesso ao app." : ". Para o acesso ao app, vamos pedir o seu e-mail por lá."}
            </p>
            <p className="text-[15px] leading-relaxed text-texto-2">
              Enquanto isso, já separe: os serviços com preço e duração, o horário de funcionamento e as formas de pagamento. É o que a
              assistente usa para atender as suas clientes.
            </p>
          </div>
        ) : (
          <>
            <h1 className="mt-10 font-serif text-[38px] leading-tight font-semibold">Cadastrar minha loja</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-texto-2">
              Uma assistente que atende as suas clientes no WhatsApp, marca horários e te avisa do que precisa de você.
            </p>

            <form onSubmit={enviar} className="mt-8 flex flex-col gap-4">
              {!supabaseConfigurado && <p className="rounded-2xl bg-ouro p-4 text-sm text-ouro-texto">Falta configurar o Supabase neste app.</p>}

              <fieldset>
                <legend className="mb-2 text-[15px] font-semibold text-rotulo">Qual é o ramo da sua loja?</legend>
                <div className="grid grid-cols-2 gap-3">
                  {RAMOS.map((r) => (
                    <label
                      key={r.chave}
                      className={`cursor-pointer rounded-2xl p-4 ring-1 transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-bronze has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-perola ${
                        ramo === r.chave ? "bg-grafite text-white ring-grafite" : "bg-card/85 ring-grafite/[0.08]"
                      }`}
                    >
                      <input type="radio" name="ramo" value={r.chave} checked={ramo === r.chave} onChange={() => setRamo(r.chave)} className="sr-only" />
                      <span className="block text-[17px] font-semibold">{r.titulo}</span>
                      <span className={`block text-[13px] ${ramo === r.chave ? "text-white/75" : "text-texto-2"}`}>{r.texto}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="block">
                <span className="mb-2 block text-[15px] font-semibold text-rotulo">Nome da loja</span>
                <input value={nomeLoja} onChange={(e) => setNomeLoja(e.target.value)} required maxLength={80} autoComplete="organization" placeholder="Studio da Ana" className={campo} />
              </label>
              <label className="block">
                <span className="mb-2 block text-[15px] font-semibold text-rotulo">Seu nome</span>
                <input value={dona} onChange={(e) => setDona(e.target.value)} required maxLength={40} autoComplete="given-name" placeholder="Ana" className={campo} />
              </label>
              <label className="block">
                <span className="mb-2 block text-[15px] font-semibold text-rotulo">Seu WhatsApp, com DDD</span>
                <input
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  required
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  placeholder="66 99999-0000"
                  className={campo}
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-[15px] font-semibold text-rotulo">Cidade</span>
                <input value={cidade} onChange={(e) => setCidade(e.target.value)} maxLength={60} autoComplete="address-level2" placeholder="Sinop" className={campo} />
              </label>
              <label className="block">
                <span className="mb-2 block text-[15px] font-semibold text-rotulo">E-mail, para o seu login no app (opcional)</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  autoComplete="email"
                  maxLength={120}
                  placeholder="voce@exemplo.com"
                  className={campo}
                />
              </label>

              {erro && (
                <p role="alert" className="rounded-2xl bg-rose p-4 text-[15px] font-medium text-rose-texto">
                  {erro}
                  {WHATS_AGENCIA && (
                    <>
                      {" "}
                      <a href={`https://wa.me/${WHATS_AGENCIA}`} className="underline underline-offset-4">
                        Falar com a gente no WhatsApp
                      </a>
                    </>
                  )}
                </p>
              )}

              <button
                type="submit"
                disabled={enviando || !supabaseConfigurado}
                className="mt-2 flex h-[56px] items-center justify-center rounded-full bg-[linear-gradient(180deg,#2c2a30,#1c1b1f)] text-[17px] font-semibold tracking-wide text-white shadow-[0_10px_24px_rgb(30_23_20/0.25)] transition active:scale-[0.98] disabled:opacity-60"
              >
                {enviando ? "Enviando…" : "Enviar cadastro"}
              </button>
              <p className="text-center text-[13px] leading-relaxed text-texto-2">
                Enviar não cria cobrança nem liga nada sozinho: a gente fala com você antes.
              </p>
            </form>
          </>
        )}

        <p className="mt-auto pt-10 text-center text-[15px] text-texto-2">
          Já tem acesso?{" "}
          <Link href="/login" className="font-semibold text-bronze-escuro underline underline-offset-4">
            Entrar
          </Link>
        </p>
      </div>
    </main>
  );
}
