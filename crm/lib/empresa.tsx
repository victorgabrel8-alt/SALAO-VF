"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

export type Empresa = {
  id: string;
  nome: string;
  config: Record<string, unknown>;
  papel: "dona" | "recepcao";
};

type Estado =
  | { carregando: true }
  | { carregando: false; empresa: Empresa }
  | { carregando: false; erro: string };

const EmpresaContext = createContext<Empresa | null>(null);
// Para uma tela que salvou o config (ex.: dias bloqueados) atualizar o salão em todas as abas
const TrocarConfigContext = createContext<(config: Record<string, unknown>) => void>(() => {});

// Carrega o salão do usuário logado (tabela usuarios_empresa) e entrega para as telas.
export function EmpresaProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ carregando: true });

  useEffect(() => {
    supabase()
      .from("usuarios_empresa")
      .select("papel, empresas (id, nome, config)")
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setEstado({ carregando: false, erro: `Não foi possível carregar o salão: ${error.message}` });
          return;
        }
        const empresa = data?.empresas as unknown as Omit<Empresa, "papel"> | null;
        if (!data || !empresa) {
          setEstado({ carregando: false, erro: "Seu usuário ainda não está ligado a nenhum salão." });
          return;
        }
        setEstado({ carregando: false, empresa: { ...empresa, papel: data.papel } });
      });
  }, []);

  if (estado.carregando) {
    return <p className="p-6 text-lg text-neutral-500">Carregando…</p>;
  }
  if ("erro" in estado) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-lg font-semibold text-red-700">{estado.erro}</p>
        <BotaoSair />
      </div>
    );
  }
  const trocarConfig = (config: Record<string, unknown>) =>
    setEstado((e) => ("empresa" in e ? { carregando: false, empresa: { ...e.empresa, config } } : e));
  return (
    <EmpresaContext value={estado.empresa}>
      <TrocarConfigContext value={trocarConfig}>{children}</TrocarConfigContext>
    </EmpresaContext>
  );
}

export function useTrocarConfig() {
  return useContext(TrocarConfigContext);
}

export function useEmpresa(): Empresa {
  const empresa = useContext(EmpresaContext);
  if (!empresa) throw new Error("useEmpresa precisa estar dentro do EmpresaProvider");
  return empresa;
}

export function BotaoSair() {
  const router = useRouter();

  async function sair() {
    await supabase().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <button
      onClick={sair}
      className="h-12 w-full rounded-xl border-2 border-neutral-300 text-lg font-semibold active:bg-neutral-100"
    >
      Sair
    </button>
  );
}
