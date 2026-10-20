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
          <h1 className="text-3xl font-bold">{SALAO.nomeApp}</h1>
          <p className="text-lg text-neutral-600">Entre para ver suas clientes</p>
        </div>

        {!supabaseConfigurado && (
          <p className="rounded-xl bg-amber-100 p-4 text-amber-900">
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
              className="h-14 w-full rounded-xl border border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
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
              className="h-14 w-full rounded-xl border border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
            />
          </label>

          {erro && <p className="text-lg font-medium text-red-700">{erro}</p>}

          <button
            type="submit"
            disabled={entrando || !supabaseConfigurado}
            className="h-14 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-50"
          >
            {entrando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
