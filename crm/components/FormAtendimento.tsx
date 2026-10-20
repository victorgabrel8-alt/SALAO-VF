"use client";

import { useEffect, useState } from "react";
import { useEmpresa } from "@/lib/empresa";
import { estaExcluida, restaurarCliente } from "@/lib/excluidas";
import {
  agoraNoSalao,
  formatarData,
  formatarTelefone,
  instanteNoSalao,
  normalizarTelefone,
  prazo,
  somarDias,
  telefoneValido,
} from "@/lib/formato";
import { supabase } from "@/lib/supabase/client";
import type { Profissional } from "@/lib/tipos";

type Servico = { id: string; nome: string; preco: number | null; dias_retorno: number | null };
type ClienteBusca = { id: string; nome: string | null; telefone: string; etiquetas: string[] };

// "registrar": cliente que já foi atendida (chegou sem agendar) -> grava como realizado, padrão agora.
// "agendar": horário futuro marcado pela dona -> grava como agendado.
export type ModoAtendimento = "registrar" | "agendar";

export function FormAtendimento({
  modo,
  dia,
  aoFechar,
  aoSalvar,
}: {
  modo: ModoAtendimento;
  dia?: string;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const empresa = useEmpresa();
  const agora = agoraNoSalao();

  const [servicos, setServicos] = useState<Servico[]>([]);
  const [profissionais, setProfissionais] = useState<Profissional[]>([]);

  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ClienteBusca[]>([]);
  const [cliente, setCliente] = useState<ClienteBusca | null>(null);
  const [novaCliente, setNovaCliente] = useState(false);
  const [nomeNova, setNomeNova] = useState("");
  const [telefoneNova, setTelefoneNova] = useState("");

  const [servicoId, setServicoId] = useState("");
  const [profissionalId, setProfissionalId] = useState("");
  const [data, setData] = useState(dia ?? agora.data);
  const [hora, setHora] = useState(modo === "registrar" ? agora.hora : "09:00");

  // Retorno: o banco calcula a data sozinho (dia do atendimento + dias de retorno do serviço).
  // A dona vê a data na hora e pode já deixar o horário do retorno marcado.
  const [marcarRetorno, setMarcarRetorno] = useState(false);
  const [retornoData, setRetornoData] = useState<string | null>(null);
  const [retornoHora, setRetornoHora] = useState<string | null>(null);

  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const servico = servicos.find((s) => s.id === servicoId);
  const retornoPrevisto = servico?.dias_retorno ? somarDias(data, servico.dias_retorno) : null;

  useEffect(() => {
    const db = supabase();
    db.from("servicos")
      .select("id, nome, preco, dias_retorno")
      .eq("empresa_id", empresa.id)
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => setServicos((data ?? []) as Servico[]));
    db.from("profissionais")
      .select("id, nome")
      .eq("empresa_id", empresa.id)
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => setProfissionais((data ?? []) as Profissional[]));
  }, [empresa.id]);

  // Busca por nome ou telefone enquanto a dona digita
  useEffect(() => {
    const termo = busca.replace(/[,()%*]/g, " ").trim();
    if (termo.length < 2) return;
    const digitos = busca.replace(/\D/g, "");
    const filtros = [`nome.ilike.%${termo}%`];
    if (digitos.length >= 3) filtros.push(`telefone.like.%${digitos}%`);
    let ativo = true;
    supabase()
      .from("clientes")
      .select("id, nome, telefone, etiquetas")
      .eq("empresa_id", empresa.id)
      .or(filtros.join(","))
      .order("nome")
      .limit(10)
      .then(({ data }) => {
        if (ativo) setResultados(((data ?? []) as ClienteBusca[]).filter((c) => !estaExcluida(c.etiquetas)).slice(0, 6));
      });
    return () => {
      ativo = false;
    };
  }, [busca, empresa.id]);

  async function clienteEscolhida(): Promise<string | null> {
    if (cliente) return cliente.id;
    const telefone = normalizarTelefone(telefoneNova);
    if (!nomeNova.trim()) {
      setErro("Escreva o nome da cliente.");
      return null;
    }
    if (!telefoneValido(telefone)) {
      setErro("Telefone inválido. Digite com DDD, ex.: (66) 99999-8888.");
      return null;
    }
    const db = supabase();
    const { data, error } = await db
      .from("clientes")
      .insert({ empresa_id: empresa.id, nome: nomeNova.trim(), telefone })
      .select("id")
      .single();
    if (!error) return data.id;
    // Já existe uma cliente com esse telefone: usa ela
    if (error.code === "23505") {
      const existente = await db
        .from("clientes")
        .select("id")
        .eq("empresa_id", empresa.id)
        .eq("telefone", telefone)
        .single();
      if (existente.data) {
        // Se ela estava em "Clientes excluídas", volta para a lista
        await restaurarCliente(existente.data.id);
        return existente.data.id;
      }
    }
    setErro(`Não foi possível cadastrar a cliente: ${error.message}`);
    return null;
  }

  async function salvar() {
    setErro("");
    if (!cliente && !novaCliente) {
      setErro("Escolha a cliente.");
      return;
    }
    if (!servicoId) {
      setErro("Escolha o serviço.");
      return;
    }
    setSalvando(true);
    const clienteId = await clienteEscolhida();
    if (!clienteId) {
      setSalvando(false);
      return;
    }
    const realizado = modo === "registrar";
    const base = {
      empresa_id: empresa.id,
      cliente_id: clienteId,
      servico_id: servicoId,
      profissional_id: profissionalId || null,
      origem: "manual",
    };
    const novos = [
      {
        ...base,
        inicio: instanteNoSalao(data, hora),
        status: realizado ? "realizado" : "agendado",
        valor: realizado ? (servico?.preco ?? null) : null,
      },
    ];
    const diaRetorno = retornoData ?? retornoPrevisto;
    if (realizado && marcarRetorno && diaRetorno) {
      novos.push({ ...base, inicio: instanteNoSalao(diaRetorno, retornoHora ?? hora), status: "agendado", valor: null });
    }
    const { error } = await supabase().from("agendamentos").insert(novos);
    setSalvando(false);
    if (error) {
      setErro(`Não foi possível salvar: ${error.message}`);
      return;
    }
    aoSalvar();
  }

  const campo =
    "h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]";
  const chip = (ativo: boolean) =>
    `h-11 rounded-full px-4 font-semibold ${ativo ? "chip-ativo" : "bg-neutral-100 text-neutral-800"}`;

  return (
    <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={aoFechar}>
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="mx-auto max-h-[92dvh] w-full max-w-xl space-y-5 overflow-y-auto rounded-t-3xl bg-white px-4 pt-5 pb-safe"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">{modo === "registrar" ? "Registrar atendimento" : "Novo horário"}</h2>
          <button onClick={aoFechar} className="h-11 px-3 text-lg font-semibold text-neutral-600">
            Fechar
          </button>
        </div>

        {/* Cliente */}
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Cliente</h3>
          {cliente ? (
            <div className="flex items-center justify-between rounded-xl bg-neutral-100 p-3">
              <div>
                <p className="text-lg font-semibold">{cliente.nome ?? "Sem nome"}</p>
                <p className="text-neutral-600">{formatarTelefone(cliente.telefone)}</p>
              </div>
              <button onClick={() => setCliente(null)} className="h-11 px-3 font-semibold text-[var(--cor-principal)]">
                Trocar
              </button>
            </div>
          ) : novaCliente ? (
            <div className="space-y-2">
              <input placeholder="Nome" value={nomeNova} onChange={(e) => setNomeNova(e.target.value)} className={campo} />
              <input
                placeholder="Telefone com DDD"
                inputMode="tel"
                value={telefoneNova}
                onChange={(e) => setTelefoneNova(e.target.value)}
                className={campo}
              />
              <button onClick={() => setNovaCliente(false)} className="h-11 font-semibold text-[var(--cor-principal)]">
                Buscar cliente já cadastrada
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <input
                type="search"
                placeholder="Buscar por nome ou telefone"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                className={campo}
              />
              {busca.trim().length >= 2 && (
                <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200">
                  {resultados.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => setCliente(c)} className="w-full px-4 py-3 text-left active:bg-neutral-50">
                        <span className="block text-lg font-semibold">{c.nome ?? "Sem nome"}</span>
                        <span className="text-neutral-600">{formatarTelefone(c.telefone)}</span>
                      </button>
                    </li>
                  ))}
                  {resultados.length === 0 && <li className="px-4 py-3 text-neutral-500">Nenhuma cliente encontrada.</li>}
                </ul>
              )}
              <button
                onClick={() => {
                  setNovaCliente(true);
                  setNomeNova(/\d/.test(busca) ? "" : busca);
                  setTelefoneNova(/\d/.test(busca) ? busca : "");
                }}
                className="h-12 w-full rounded-xl border-2 border-dashed border-neutral-300 font-semibold"
              >
                + Cliente nova
              </button>
            </div>
          )}
        </section>

        {/* Serviço */}
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Serviço</h3>
          <div className="flex flex-wrap gap-2">
            {servicos.map((s) => (
              <button key={s.id} onClick={() => setServicoId(s.id)} aria-pressed={servicoId === s.id} className={chip(servicoId === s.id)}>
                {s.nome}
              </button>
            ))}
          </div>
        </section>

        {/* Profissional */}
        <section className="space-y-2">
          <h3 className="text-lg font-semibold">Profissional</h3>
          <div className="flex flex-wrap gap-2">
            {profissionais.map((p) => (
              <button
                key={p.id}
                onClick={() => setProfissionalId(profissionalId === p.id ? "" : p.id)}
                aria-pressed={profissionalId === p.id}
                className={chip(profissionalId === p.id)}
              >
                {p.nome}
              </button>
            ))}
          </div>
        </section>

        {/* Quando */}
        <section className="grid grid-cols-2 gap-3">
          <label className="block space-y-1">
            <span className="text-lg font-semibold">Dia</span>
            <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} />
          </label>
          <label className="block space-y-1">
            <span className="text-lg font-semibold">Hora</span>
            <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} className={campo} />
          </label>
        </section>

        {/* Retorno: aparece assim que a dona escolhe o serviço */}
        {modo === "registrar" && servico && (
          <section className="space-y-3 rounded-xl border border-neutral-200 p-3">
            <h3 className="text-lg font-semibold">Retorno</h3>
            {retornoPrevisto ? (
              <>
                <p className="text-lg">
                  Ela deve voltar em <strong>{formatarData(retornoPrevisto)}</strong> ({prazo(retornoPrevisto)})
                </p>
                <p className="text-sm text-neutral-500">
                  {servico.nome} tem retorno de {servico.dias_retorno} dias. A cliente entra na lista &quot;Para chamar&quot;
                  quando a data chegar.
                </p>
                <button
                  type="button"
                  onClick={() => setMarcarRetorno(!marcarRetorno)}
                  aria-pressed={marcarRetorno}
                  className={`h-12 w-full rounded-xl font-semibold ${
                    marcarRetorno ? "chip-ativo" : "border border-neutral-300 active:bg-neutral-100"
                  }`}
                >
                  {marcarRetorno ? "✓ Retorno será marcado na agenda" : "Já marcar o horário do retorno"}
                </button>
                {marcarRetorno && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block space-y-1">
                      <span className="font-medium">Dia do retorno</span>
                      <input
                        type="date"
                        value={retornoData ?? retornoPrevisto}
                        onChange={(e) => setRetornoData(e.target.value)}
                        className={campo}
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium">Hora</span>
                      <input
                        type="time"
                        value={retornoHora ?? hora}
                        onChange={(e) => setRetornoHora(e.target.value)}
                        className={campo}
                      />
                    </label>
                  </div>
                )}
              </>
            ) : (
              <p className="text-neutral-600">{servico.nome} não tem retorno programado.</p>
            )}
          </section>
        )}

        {erro && <p className="rounded-xl bg-red-100 p-3 font-medium text-red-900">{erro}</p>}

        <button
          onClick={salvar}
          disabled={salvando}
          className="mb-4 h-14 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-50"
        >
          {salvando ? "Salvando…" : modo === "registrar" ? "Registrar atendimento" : "Marcar horário"}
        </button>
      </div>
    </div>
  );
}
