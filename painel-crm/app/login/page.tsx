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
    <main className="flex min-h-dvh flex-col justify-center px-6 pt-safe pb-safe">
      <div className="mx-auto w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={SALAO.icone} alt="" className="mx-auto h-20 w-20 rounded-2xl" />
          <h1 className="font-serif text-[40px] leading-tight font-semibold">{SALAO.nomeApp}</h1>
          <p className="text-lg text-texto-2">Entre para ver suas clientes</p>
        </div>

        {!supabaseConfigurado && (
          <p className="rounded-xl bg-mel p-4 text-mel-texto">
            Falta configurar o Supabase: crie o arquivo <code>.env.local</code> a partir do{" "}
            <code>.env.local.example</code>.
          </p>
        )}

        <form onSubmit={entrar} className="space-y-4">
          <label className="block space-y-1">
            <span className="text-lg font-medium">E-mail</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-14 w-full rounded-xl border border-borda bg-card px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-lg font-medium">Senha</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="h-14 w-full rounded-xl border border-borda bg-card px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
            />
          </label>

          {erro && <p className="text-lg font-medium text-rose-texto">{erro}</p>}

          <button
            type="submit"
            disabled={entrando || !supabaseConfigurado}
            className="h-14 w-full rounded-xl bg-grafite text-lg font-bold text-perola disabled:opacity-50"
          >
            {entrando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
