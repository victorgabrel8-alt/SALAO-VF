"use client";

import { useEffect, useState } from "react";
import { Folha } from "@/components/Folha";
import { avisoAlmoco, conflitaComAlmoco, lerAlmoco } from "@/lib/almoco";
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

type Servico = { id: string; nome: string; dias_retorno: number | null; duracao_min: number };
type ClienteBusca = { id: string; nome: string | null; telefone: string; etiquetas: string[] };

// "registrar": cliente que já foi atendida (chegou sem agendar) -> grava como realizado, padrão agora.
// "agendar": horário futuro marcado pela dona -> grava como agendado.
export type ModoAtendimento = "registrar" | "agendar";

export function FormAtendimento({
  modo,
  dia,
  horaInicial,
  aoFechar,
  aoSalvar,
}: {
  modo: ModoAtendimento;
  dia?: string;
  // Ex.: tocar num intervalo livre da Agenda já sugere aquele horário
  horaInicial?: string;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const empresa = useEmpresa();
  const agora = agoraNoSalao();

  const [servicos, setServicos] = useState<Servico[]>([]);

  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ClienteBusca[]>([]);
  const [cliente, setCliente] = useState<ClienteBusca | null>(null);
  const [novaCliente, setNovaCliente] = useState(false);
  const [nomeNova, setNomeNova] = useState("");
  const [telefoneNova, setTelefoneNova] = useState("");

  const [servicoId, setServicoId] = useState("");
  const [data, setData] = useState(dia ?? agora.data);
  const [hora, setHora] = useState(horaInicial ?? (modo === "registrar" ? agora.hora : "09:00"));

  // Retorno: o banco calcula a data sozinho (dia do atendimento + dias de retorno do serviço).
  // A dona vê a data na hora e pode já deixar o horário do retorno marcado.
  const [marcarRetorno, setMarcarRetorno] = useState(false);
  const [retornoData, setRetornoData] = useState<string | null>(null);
  const [retornoHora, setRetornoHora] = useState<string | null>(null);

  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  const servico = servicos.find((s) => s.id === servicoId);
  const almocoDoSalao = lerAlmoco(empresa.config);
  const retornoPrevisto = servico?.dias_retorno ? somarDias(data, servico.dias_retorno) : null;

  useEffect(() => {
    const db = supabase();
    db.from("servicos")
      .select("id, nome, dias_retorno, duracao_min")
      .eq("empresa_id", empresa.id)
      .eq("ativo", true)
      .order("nome")
      .then(({ data }) => setServicos((data ?? []) as Servico[]));
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
    // Não marca horário no almoço (registrar um atendimento que já aconteceu continua liberado)
    const almoco = lerAlmoco(empresa.config);
    const duracao = servico?.duracao_min ?? 60;
    if (almoco && modo === "agendar" && conflitaComAlmoco(almoco, hora, duracao)) {
      setErro(avisoAlmoco(almoco));
      return;
    }
    if (almoco && modo === "registrar" && marcarRetorno && conflitaComAlmoco(almoco, retornoHora ?? hora, duracao)) {
      setErro(`O horário do retorno cai no almoço (${almoco.inicio} às ${almoco.fim}). Escolha outro.`);
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
      // Sem escolha de profissional no app da dona
      profissional_id: null,
      origem: "manual",
    };
    const novos = [
      {
        ...base,
        inicio: instanteNoSalao(data, hora),
        status: realizado ? "realizado" : "agendado",
        // Sem valor: o app não controla dinheiro
        valor: null,
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
    <Folha rotulo={modo === "registrar" ? "Registrar atendimento" : "Novo horário"} aoFechar={aoFechar} className="space-y-5 bg-white px-4">
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
      {/* Aviso na hora, antes de salvar */}
      {modo === "agendar" &&
        almocoDoSalao &&
        conflitaComAlmoco(almocoDoSalao, hora, servico?.duracao_min ?? 60) && (
          <p className="-mt-3 text-sm font-medium text-amber-700">
            Cai no almoço ({almocoDoSalao.inicio} às {almocoDoSalao.fim}).
          </p>
        )}

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
    </Folha>
  );
}
