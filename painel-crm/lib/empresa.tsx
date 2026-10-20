"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

// A agência atende vários salões: o painel lista os salões ligados ao login
// (tabela usuarios_empresa) e deixa escolher qual ver. A escolha fica salva no navegador.

export type Empresa = {
  id: string;
  nome: string;
  config: Record<string, unknown>;
  papel: string;
};

type Painel = { empresa: Empresa; empresas: Empresa[]; trocar: (id: string) => void };

const EmpresaContext = createContext<Painel | null>(null);
const CHAVE = "painel-crm:empresa";

function lerEscolha(): string | null {
  try {
    return localStorage.getItem(CHAVE);
  } catch {
    return null;
  }
}

function salvarEscolha(id: string) {
  try {
    localStorage.setItem(CHAVE, id);
  } catch {
    // sem armazenamento (aba anônima): só não lembra a escolha
  }
}

type Estado = { carregando: true } | { carregando: false; empresas: Empresa[] } | { carregando: false; erro: string };

export function EmpresaProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ carregando: true });
  const [escolhida, setEscolhida] = useState<string | null>(null);

  useEffect(() => {
    supabase()
      .from("usuarios_empresa")
      .select("papel, empresas (id, nome, config)")
      .then(({ data, error }) => {
        if (error) {
          setEstado({ carregando: false, erro: `Não foi possível carregar os salões: ${error.message}` });
          return;
        }
        const empresas = (data ?? [])
          .map((l) => ({ ...(l.empresas as unknown as Omit<Empresa, "papel">), papel: l.papel as string }))
          .filter((e) => e.id)
          .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        if (empresas.length === 0) {
          setEstado({ carregando: false, erro: "Este login ainda não está ligado a nenhum salão." });
          return;
        }
        setEscolhida(lerEscolha());
        setEstado({ carregando: false, empresas });
      });
  }, []);

  if (estado.carregando) return <p className="p-8 text-lg text-neutral-500">Carregando…</p>;
  if ("erro" in estado) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-8">
        <p className="text-lg font-semibold text-red-700">{estado.erro}</p>
        <BotaoSair />
      </div>
    );
  }

  const empresa = estado.empresas.find((e) => e.id === escolhida) ?? estado.empresas[0];
  function trocar(id: string) {
    salvarEscolha(id);
    setEscolhida(id);
  }

  return <EmpresaContext value={{ empresa, empresas: estado.empresas, trocar }}>{children}</EmpresaContext>;
}

function usePainel(): Painel {
  const painel = useContext(EmpresaContext);
  if (!painel) throw new Error("useEmpresa precisa estar dentro do EmpresaProvider");
  return painel;
}

// O salão escolhido no topo do painel
export function useEmpresa(): Empresa {
  return usePainel().empresa;
}

export function SeletorSalao() {
  const { empresa, empresas, trocar } = usePainel();
  if (empresas.length === 1) return <span className="font-semibold">{empresa.nome}</span>;
  return (
    <select
      value={empresa.id}
      onChange={(e) => trocar(e.target.value)}
      aria-label="Salão"
      className="h-10 rounded-xl border border-neutral-300 bg-white px-3 font-semibold"
    >
      {empresas.map((e) => (
        <option key={e.id} value={e.id}>
          {e.nome}
        </option>
      ))}
    </select>
  );
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
      className="h-10 rounded-xl border border-neutral-300 bg-white px-4 font-semibold hover:bg-neutral-50"
    >
      Sair
    </button>
  );
}
