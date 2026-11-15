"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { supabase, supabaseConfigurado } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [verSenha, setVerSenha] = useState(false);
  const [erro, setErro] = useState("");
  // Muda a cada erro para a animação de "tremer" rodar de novo
  const [tentativa, setTentativa] = useState(0);
  const [entrando, setEntrando] = useState(false);
  const router = useRouter();

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    const { error } = await supabase().auth.signInWithPassword({ email, password: senha });
    if (error) {
      setErro("E-mail ou senha incorretos.");
      setTentativa((t) => t + 1);
      setEntrando(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="relative flex min-h-dvh flex-col overflow-hidden bg-perola text-texto">
      <div className="relative mx-auto flex w-full max-w-[400px] flex-1 flex-col px-6 pt-[calc(64px+env(safe-area-inset-top))] sm:justify-center sm:pt-12">
        {/* Logo horizontal Oi Studio: o ícone já diz "oi", embaixo só "studio" */}
        <div className="login-icone relative mx-auto">
          <Image
            src="/logo/oi-icon.svg"
            unoptimized
            alt=""
            width={112}
            height={112}
            priority
            className="relative z-10 h-28 w-28"
          />
        </div>

        <div className="login-subir mt-9 text-center [animation-delay:80ms]">
          <h1 className="text-[34px] leading-none font-bold tracking-[-0.045em]">
            <span className="sr-only">oi </span>studio
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-texto-2">
            Suas clientes, sua agenda,
            <br />
            tudo na palma da mão.
          </p>
        </div>

        <form onSubmit={entrar} className="login-subir mt-10 flex flex-col gap-4 [animation-delay:160ms]">
          {!supabaseConfigurado && (
            <p className="rounded-2xl bg-ouro p-4 text-sm text-ouro-texto">
              Falta configurar o Supabase: crie o arquivo <code>.env.local</code> a partir do{" "}
              <code>.env.local.example</code>.
            </p>
          )}

          {/* Lista agrupada do iPhone: os dois campos no mesmo cartão, separados por uma linha fina */}
          <div
            key={tentativa}
            className={`overflow-hidden rounded-[22px] bg-card/85 shadow-[0_1px_2px_rgb(30_23_20/0.05),0_12px_32px_rgb(30_23_20/0.08)] ring-1 ring-grafite/[0.06] backdrop-blur-xl ${erro ? "login-tremer" : ""}`}
          >
            <label className="flex h-[60px] items-center gap-3.5 px-[18px] transition-colors focus-within:bg-white/60">
              <IconeEmail />
              <span className="sr-only">E-mail</span>
              <input
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                required
                placeholder="E-mail"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-inativo"
              />
            </label>
            <div className="ml-[52px] h-px bg-grafite/[0.08]" />
            <label className="flex h-[60px] items-center gap-3.5 pr-2 pl-[18px] transition-colors focus-within:bg-white/60">
              <IconeCadeado />
              <span className="sr-only">Senha</span>
              <input
                type={verSenha ? "text" : "password"}
                autoComplete="current-password"
                required
                placeholder="Senha"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-inativo"
              />
              <button
                type="button"
                onClick={() => setVerSenha((v) => !v)}
                aria-label={verSenha ? "Esconder senha" : "Mostrar senha"}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-texto-2 transition active:scale-90 active:bg-grafite/5"
              >
                {verSenha ? <IconeOlhoFechado /> : <IconeOlho />}
              </button>
            </label>
          </div>

          {erro && (
            <p role="alert" className="login-subir flex items-center justify-center gap-1.5 text-[15px] font-medium text-rose-texto">
              <IconeAlerta />
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={entrando || !supabaseConfigurado}
            className="relative flex h-[56px] items-center justify-center gap-2 overflow-hidden rounded-full bg-[linear-gradient(180deg,#2B2629,#1B1719)] text-[17px] font-semibold tracking-wide text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.14),0_1px_2px_rgb(30_23_20/0.2),0_12px_28px_rgb(30_23_20/0.28)] transition duration-150 active:scale-[0.97] disabled:opacity-50"
          >
            {entrando ? (
              <>
                <IconeCarregando />
                Entrando…
              </>
            ) : (
              <>
                Entrar
                <IconeSeta />
              </>
            )}
          </button>
        </form>

        <p className="login-subir mt-auto flex items-center justify-center gap-1.5 pt-10 pb-[calc(32px+env(safe-area-inset-bottom))] text-[13px] text-texto-2 [animation-delay:240ms] sm:mt-14">
          <IconeEscudo />
          Acesso seguro · Feito com carinho para o seu salão
        </p>
      </div>
    </main>
  );
}

function IconeEmail() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7A5870" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <rect x="2" y="4" width="20" height="16" rx="3" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

function IconeCadeado() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7A5870" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <rect x="3" y="11" width="18" height="11" rx="3" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function IconeOlho() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconeOlhoFechado() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.7 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.2" />
      <path d="M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function IconeAlerta() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

function IconeEscudo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
    </svg>
  );
}

function IconeCarregando() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" className="animate-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </svg>
  );
}

function IconeSeta() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
