"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { supabase, supabaseConfigurado } from "@/lib/supabase/client";
import { SALAO } from "@/lib/config";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);
  const router = useRouter();

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro("");
    setEntrando(true);
    const { error } = await supabase().auth.signInWithPassword({ email, password: senha });
    if (error) {
      setErro("E-mail ou senha incorretos.");
      setEntrando(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex min-h-dvh flex-col bg-perola text-texto">
      {/* Topo grafite com a tesoura e os enfeites (círculo claro e anel bronze) */}
      <div className="relative flex h-[380px] flex-col items-center gap-4 overflow-hidden rounded-b-[40px] bg-grafite px-7 pt-[calc(72px+env(safe-area-inset-top))]">
        <span aria-hidden="true" className="absolute -top-[90px] -right-20 h-[260px] w-[260px] rounded-full bg-white/[0.08]" />
        <span aria-hidden="true" className="absolute -bottom-[70px] -left-[50px] h-[180px] w-[180px] rounded-full border-[1.5px] border-bronze/55" />
        <span aria-hidden="true" className="absolute top-[120px] left-12 h-3.5 w-3.5 rounded-full bg-[#D8C6AE]" />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-3xl bg-card shadow-[0_12px_30px_rgba(30,23,20,0.25)]">
          <IconeTesoura />
        </div>
        <h1 className="relative font-serif text-[34px] font-semibold text-white">{SALAO.nomeApp}</h1>
        <p className="relative text-center text-base text-areia">
          Suas clientes, sua agenda,
          <br />
          tudo na palma da mão.
        </p>
      </div>

      <form
        onSubmit={entrar}
        className="relative mx-5 -mt-14 flex flex-col gap-[18px] rounded-[28px] bg-card px-6 py-7 shadow-[0_20px_50px_rgba(30,23,20,0.14)] sm:mx-auto sm:w-full sm:max-w-sm"
      >
        <p className="font-serif text-[26px] font-semibold">Bem-vinda de volta</p>

        {!supabaseConfigurado && (
          <p className="rounded-2xl bg-ouro p-4 text-sm text-ouro-texto">
            Falta configurar o Supabase: crie o arquivo <code>.env.local</code> a partir do{" "}
            <code>.env.local.example</code>.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="email" className="text-sm font-semibold text-rotulo">
            E-mail
          </label>
          <div className="flex h-[52px] items-center gap-2.5 rounded-2xl bg-campo px-4 focus-within:ring-2 focus-within:ring-bronze">
            <IconeEmail />
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              placeholder="voce@salao.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#9A8C80]"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label htmlFor="senha" className="text-sm font-semibold text-rotulo">
            Senha
          </label>
          <div className="flex h-[52px] items-center gap-2.5 rounded-2xl bg-campo px-4 focus-within:ring-2 focus-within:ring-bronze">
            <IconeCadeado />
            <input
              id="senha"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-[#9A8C80]"
            />
          </div>
        </div>

        {erro && <p className="font-medium text-rose-texto">{erro}</p>}

        <button
          type="submit"
          disabled={entrando || !supabaseConfigurado}
          className="flex h-14 items-center justify-center gap-2 rounded-[18px] bg-grafite text-[17px] font-bold text-white shadow-[0_10px_24px_rgba(30,23,20,0.28)] disabled:opacity-50"
        >
          {entrando ? "Entrando…" : "Entrar"}
          {!entrando && <IconeSeta />}
        </button>
      </form>

      <p className="mt-auto pt-8 pb-[calc(36px+env(safe-area-inset-bottom))] text-center text-[13px] text-texto-2">
        Feito com carinho para o seu salão
      </p>
    </main>
  );
}

function IconeTesoura() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88" />
      <path d="M14.47 14.48 20 20" />
      <path d="M8.12 8.12 12 12" />
    </svg>
  );
}

function IconeEmail() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-10 6L2 7" />
    </svg>
  );
}

function IconeCadeado() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
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
