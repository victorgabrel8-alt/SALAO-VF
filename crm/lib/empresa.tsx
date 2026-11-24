"use client";

import { esquecerTudo } from "@/lib/memoriaTela";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase/client";

export type Empresa = {
  id: string;
  nome: string;
  config: Record<string, unknown>;
  // mega_hair | manicure | estudio_beleza (supabase/024); ver lib/nicho.ts
  nicho: string | null;
  papel: "dona" | "recepcao";
  // A profissional deste login (supabase/070), ex.: a Duda no Studio Caroline. Sem ela, o login vê o salão inteiro.
  profissional: { id: string; nome: string } | null;
  // Login de profissional que não é a dona: vê só o que é dela (agenda, horários do Início, conversas das clientes
  // dela) e não mexe nos dados do salão
  soDela: boolean;
};

type Estado =
  | { carregando: true }
  | { carregando: false; empresa: Empresa }
  | { carregando: false; erro: string };

const EmpresaContext = createContext<Empresa | null>(null);
// Para uma tela que salvou o config (ex.: dias bloqueados) atualizar o salão em todas as abas;
// a tela Dados do salão também manda o nome novo
const TrocarConfigContext = createContext<(config: Record<string, unknown>, nome?: string) => void>(() => {});

// Carrega o salão do usuário logado (tabela usuarios_empresa) e entrega para as telas.
export function EmpresaProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>({ carregando: true });

  useEffect(() => {
    supabase()
      .from("usuarios_empresa")
      .select("papel, empresas (id, nome, config, nicho), profissionais (id, nome)")
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setEstado({ carregando: false, erro: `Não foi possível carregar o salão: ${error.message}` });
          return;
        }
        const empresa = data?.empresas as unknown as Omit<Empresa, "papel" | "profissional" | "soDela"> | null;
        if (!data || !empresa) {
          setEstado({ carregando: false, erro: "Seu usuário ainda não está ligado a nenhum salão." });
          return;
        }
        const profissional = (data.profissionais as unknown as { id: string; nome: string } | null) ?? null;
        setEstado({
          carregando: false,
          empresa: { ...empresa, papel: data.papel, profissional, soDela: !!profissional && data.papel !== "dona" },
        });
      });
  }, []);

  if (estado.carregando) {
    return <p className="carregando-calmo p-6 text-lg text-rotulo">Carregando…</p>;
  }
  if ("erro" in estado) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-lg font-semibold text-red-700">{estado.erro}</p>
        <BotaoSair />
      </div>
    );
  }
  const trocarConfig = (config: Record<string, unknown>, nome?: string) =>
    setEstado((e) => ("empresa" in e ? { carregando: false, empresa: { ...e.empresa, config, nome: nome ?? e.empresa.nome } } : e));
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

// Telas do salão (dados, serviços e preços, dias e horas sem atender, cadastros repetidos): o login de profissional que não
// é a dona (supabase/070) não mexe nelas, nem chegando pelo endereço
export function SoDaDona({ children }: { children: ReactNode }) {
  const empresa = useEmpresa();
  const router = useRouter();
  if (!empresa.soDela) return <>{children}</>;
  return (
    <div className="space-y-4 p-6">
      <p className="text-lg">Essa parte é do salão e fica com a dona.</p>
      <button onClick={() => router.replace("/agenda")} className="h-12 w-full rounded-xl border-2 border-claro text-lg font-semibold active:bg-campo">
        Ir para a minha agenda
      </button>
    </div>
  );
}

export function BotaoSair() {
  const router = useRouter();

  async function sair() {
    await supabase().auth.signOut();
    esquecerTudo();
    router.replace("/login");
    router.refresh();
  }
  return (
    <button
      onClick={sair}
      className="h-12 w-full rounded-xl border-2 border-claro text-lg font-semibold active:bg-campo"
    >
      Sair
    </button>
  );
}
