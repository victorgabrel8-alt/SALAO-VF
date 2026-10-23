"use client";

import { useEffect, useState } from "react";
import { Folha } from "@/components/Folha";
import { conflitaComAlmoco, lerAlmoco } from "@/lib/almoco";
import { buscarParecidas, horariosMarcadosDaCliente, type ClienteParecida, type HorarioMarcado } from "@/lib/duplicidade";
import { useEmpresa } from "@/lib/empresa";
import { estaExcluida, restaurarCliente } from "@/lib/excluidas";
import {
  agoraNoSalao,
  dataValida,
  formatarData,
  formatarHora,
  formatarTelefone,
  horaValida,
  instanteNoSalao,
  normalizarTelefone,
  prazo,
  somarDias,
  telefoneValido,
} from "@/lib/formato";
import { conferirHorario } from "@/lib/horarios";
import { useAgora } from "@/lib/relogio";
import { supabase } from "@/lib/supabase/client";

type Servico = { id: string; nome: string; dias_retorno: number | null; duracao_min: number };
type ClienteBusca = { id: string; nome: string | null; telefone: string; etiquetas: string[] };

// "registrar": cliente que já foi atendida (chegou sem agendar) -> grava como realizado, padrão agora.
//   Se a hora escolhida ainda não chegou, grava como agendado: ela vira a próxima cliente.
// "agendar": horário futuro marcado pela dona -> grava como agendado.
// A volta (retorno) não é marcada aqui: quem chama a cliente na data certa é a IA.
export type ModoAtendimento = "registrar" | "agendar";

// Conferências antes de gravar (ver lib/duplicidade.ts):
//   parecida -> já existe cliente parecida: usar ela ou dizer que é outra pessoa. Se for o MESMO
//               telefone, não há "outra pessoa": só dá para usar a ficha que existe
//   nova     -> 2ª etapa: confirmar que é mesmo uma cliente nova
//   horario  -> pop-up: a cliente já tem horário marcado; substituir pelo novo ou criar um novo
type Aviso =
  | { tipo: "parecida"; lista: ClienteParecida[] }
  | { tipo: "nova" }
  | { tipo: "horario"; lista: HorarioMarcado[] };

type Confirmado = { clienteFixa?: ClienteBusca; novaConfirmada?: boolean; diaConfirmado?: boolean };

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
  const agoraMs = useAgora();

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

  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const servico = servicos.find((s) => s.id === servicoId);
  const almocoDoSalao = lerAlmoco(empresa.config);
  // O celular deixa apagar o dia ou a hora: sem os dois, nada de contas com data (quebravam a tela)
  const quandoValido = dataValida(data) && horaValida(hora);
  const retornoPrevisto = quandoValido && servico?.dias_retorno ? somarDias(data, servico.dias_retorno) : null;
  // Registrar com hora que ainda não chegou = horário marcado (a próxima cliente), não atendimento feito
  const noFuturo = quandoValido && Date.parse(instanteNoSalao(data, hora.slice(0, 5))) > agoraMs;
  // Vai entrar na agenda como horário a atender (e não como atendimento já feito)
  const vaiAgendar = modo === "agendar" || noFuturo;

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

  async function clienteEscolhida(fixa?: ClienteBusca): Promise<string | null> {
    if (fixa) {
      // Escolhida no aviso de mesmo telefone, mas estava em "Clientes excluídas": volta para a lista
      if (estaExcluida(fixa.etiquetas)) await restaurarCliente(fixa.id);
      return fixa.id;
    }
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

  async function salvar(conf: Confirmado = {}) {
    setErro("");
    setAviso(null);
    const escolhida = conf.clienteFixa ?? cliente;
    const nova = !escolhida && novaCliente;
    if (!escolhida && !novaCliente) {
      setErro("Escolha a cliente.");
      return;
    }
    if (!servicoId) {
      setErro("Escolha o serviço.");
      return;
    }
    if (!quandoValido) {
      setErro("Escolha o dia e a hora.");
      return;
    }
    if (modo === "agendar" && !noFuturo) {
      setErro("Esse horário já passou. Para um atendimento que já aconteceu, use Registrar atendimento.");
      return;
    }
    setSalvando(true);
    // Horário a atender: confere a agenda (salão aberto, expediente, almoço e sem encavalar com
    // outra cliente). Registrar um atendimento que já aconteceu continua liberado.
    if (vaiAgendar) {
      const problema = await conferirHorario(empresa.id, empresa.config, data, hora, servico?.duracao_min ?? 60);
      if (problema) {
        setSalvando(false);
        setErro(problema);
        return;
      }
    }
    // 1) Cliente nova parecida com uma que já existe? Pergunta antes de criar outra ficha
    if (nova && !conf.novaConfirmada) {
      const telefone = normalizarTelefone(telefoneNova);
      if (nomeNova.trim() && telefoneValido(telefone)) {
        const lista = await buscarParecidas(empresa.id, nomeNova, telefone);
        if (lista.length) {
          setSalvando(false);
          setAviso({ tipo: "parecida", lista });
          return;
        }
      }
    }
    // 2) A cliente já tem horário marcado (de hoje em diante)? Pop-up: substituir ou criar um novo
    if (escolhida && !conf.diaConfirmado) {
      const lista = await horariosMarcadosDaCliente(escolhida.id, agora.data);
      if (lista.length) {
        setSalvando(false);
        setAviso({ tipo: "horario", lista });
        return;
      }
    }
    const clienteId = await clienteEscolhida(conf.clienteFixa);
    if (!clienteId) {
      setSalvando(false);
      return;
    }
    const realizado = modo === "registrar" && !noFuturo;
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
        inicio: instanteNoSalao(data, hora.slice(0, 5)),
        status: realizado ? "realizado" : "agendado",
        // Sem valor: o app não controla dinheiro
        valor: null,
      },
    ];
    const { error } = await supabase().from("agendamentos").insert(novos);
    setSalvando(false);
    if (error) {
      setErro(`Não foi possível salvar: ${error.message}`);
      return;
    }
    aoSalvar();
  }

  // "Mudar esse horário": o horário que já existia passa para a hora (e o serviço) escolhidos,
  // em vez de nascer um segundo horário da mesma cliente no mesmo dia
  async function mudarHorario(h: HorarioMarcado) {
    setSalvando(true);
    setErro("");
    // O horário que muda não conta como ocupado (ele mesmo sai de onde estava)
    if (vaiAgendar) {
      const problema = await conferirHorario(empresa.id, empresa.config, data, hora, servico?.duracao_min ?? 60, h.id);
      if (problema) {
        setSalvando(false);
        setAviso(null);
        setErro(problema);
        return;
      }
    }
    const novoInicio = instanteNoSalao(data, hora.slice(0, 5));
    const mudou = Date.parse(h.inicio) !== Date.parse(novoInicio);
    const anotacao = `Reagendado de ${formatarData(h.inicio).slice(0, 5)} às ${formatarHora(h.inicio)}`;
    const { error } = await supabase()
      .from("agendamentos")
      .update({
        inicio: novoInicio,
        fim: null,
        servico_id: servicoId,
        status: modo === "registrar" && !noFuturo ? "realizado" : "agendado",
        ...(mudou ? { observacoes: [h.observacoes, anotacao].filter(Boolean).join("\n") } : {}),
      })
      .eq("id", h.id);
    setSalvando(false);
    if (error) {
      setErro(`Não foi possível mudar o horário: ${error.message}`);
      return;
    }
    aoSalvar();
  }

  const nomeDaCliente = cliente?.nome ?? (nomeNova.trim() || "a cliente");

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
      {vaiAgendar &&
        almocoDoSalao &&
        conflitaComAlmoco(almocoDoSalao, hora.slice(0, 5), servico?.duracao_min ?? 60) && (
          <p className="-mt-3 text-sm font-medium text-amber-700">
            Cai no almoço ({almocoDoSalao.inicio} às {almocoDoSalao.fim}).
          </p>
        )}

      {/* Horário que ainda não chegou: avisa que entra como a próxima cliente */}
      {modo === "registrar" && noFuturo && (
        <p className="rounded-xl bg-amber-50 p-3 text-amber-900">
          Esse horário ainda não chegou: ela entra na agenda como <strong>próxima cliente</strong>, para você confirmar depois.
        </p>
      )}

      {/* Retorno: só informa a data; quem chama a cliente quando chegar a hora é a IA */}
      {modo === "registrar" && !noFuturo && servico && (
        <section className="space-y-1 rounded-xl border border-neutral-200 p-3">
          <h3 className="text-lg font-semibold">Retorno</h3>
          {retornoPrevisto ? (
            <>
              <p className="text-lg">
                Ela deve voltar em <strong>{formatarData(retornoPrevisto)}</strong> ({prazo(retornoPrevisto)})
              </p>
              <p className="text-sm text-neutral-500">
                {servico.nome} tem retorno de {servico.dias_retorno} dias. A IA chama a cliente quando a data chegar.
              </p>
            </>
          ) : (
            <p className="text-neutral-600">{servico.nome} não tem retorno programado.</p>
          )}
        </section>
      )}

      {aviso?.tipo === "parecida" && (
        <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          {aviso.lista.some((c) => c.mesmoTelefone) ? (
            <>
              <h3 className="text-lg font-semibold text-amber-900">Esse telefone já está cadastrado</h3>
              <p className="text-amber-900">Um telefone só pode ter uma ficha. Use a cliente que já existe:</p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-amber-900">Essa cliente já não está cadastrada?</h3>
              <p className="text-amber-900">
                {aviso.lista.length === 1 ? "Achamos uma cliente parecida." : "Achamos clientes parecidas."} Se for ela, use a ficha que já existe:
              </p>
            </>
          )}
          {aviso.lista.filter((c) => c.mesmoTelefone || !aviso.lista.some((x) => x.mesmoTelefone)).map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCliente(c);
                setNovaCliente(false);
                salvar({ clienteFixa: c });
              }}
              disabled={salvando}
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-amber-300 bg-white px-4 py-3 text-left active:bg-amber-100"
            >
              <span>
                <span className="block font-semibold">{c.nome ?? "Sem nome"}</span>
                <span className="block text-sm text-neutral-600">
                  {formatarTelefone(c.telefone)} · {c.motivo}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-[var(--cor-principal)]">{c.mesmoTelefone ? "Usar esta" : "É ela"}</span>
            </button>
          ))}
          {/* Mesmo telefone: não existe "outra pessoa" (o número não pode ter duas fichas) */}
          {aviso.lista.some((c) => c.mesmoTelefone) ? (
            <button onClick={() => setAviso(null)} disabled={salvando} className="h-12 w-full rounded-xl border border-neutral-300 bg-white font-semibold">
              Voltar e corrigir o telefone
            </button>
          ) : (
            <button onClick={() => setAviso({ tipo: "nova" })} disabled={salvando} className="h-12 w-full rounded-xl border border-neutral-300 bg-white font-semibold">
              Não, é outra pessoa
            </button>
          )}
        </section>
      )}

      {aviso?.tipo === "nova" && (
        <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <h3 className="text-lg font-semibold text-amber-900">Criar uma ficha nova para {nomeDaCliente}?</h3>
          <p className="text-amber-900">Ela vai ficar separada da cliente parecida. Só confirme se tiver certeza de que é outra pessoa.</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setAviso(null)} disabled={salvando} className="h-12 rounded-xl border border-neutral-300 bg-white font-semibold">
              Voltar
            </button>
            <button onClick={() => salvar({ novaConfirmada: true })} disabled={salvando} className="h-12 rounded-xl bg-amber-700 font-bold text-white">
              {salvando ? "Salvando…" : "Sim, criar nova"}
            </button>
          </div>
        </section>
      )}

      {/* Pop-up: a cliente já tem horário marcado. Substituir pelo novo (o mesmo horário muda de
          dia/hora/serviço) ou, se ela vai vir mais de uma vez, criar um novo */}
      {aviso?.tipo === "horario" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setAviso(null)}>
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="titulo-horario-marcado"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm space-y-3 rounded-3xl bg-white p-5 shadow-2xl"
          >
            <h3 id="titulo-horario-marcado" className="text-xl font-bold">
              {nomeDaCliente} já tem horário marcado
            </h3>
            {aviso.lista.map((h) => (
              <div key={h.id} className="space-y-2 rounded-2xl border border-neutral-200 p-3">
                <p className="font-semibold">
                  {formatarData(h.inicio).slice(0, 5)} às {formatarHora(h.inicio)} · {h.servicos?.nome ?? "Serviço não informado"}
                </p>
                <button
                  onClick={() => mudarHorario(h)}
                  disabled={salvando}
                  className="h-12 w-full rounded-xl bg-[var(--cor-principal)] font-bold text-white disabled:opacity-50"
                >
                  {salvando ? "Salvando…" : `Substituir pelo novo (${quandoValido ? formatarData(data).slice(0, 5) : "—"} às ${hora.slice(0, 5)})`}
                </button>
              </div>
            ))}
            <button
              onClick={() => salvar({ diaConfirmado: true })}
              disabled={salvando}
              className="h-12 w-full rounded-xl border border-neutral-300 font-semibold disabled:opacity-50"
            >
              Criar um novo horário
            </button>
            <button onClick={() => setAviso(null)} disabled={salvando} className="h-11 w-full font-semibold text-neutral-600">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && <p className="rounded-xl bg-red-100 p-3 font-medium text-red-900">{erro}</p>}

      {/* Com um aviso aberto, quem decide é ele: o botão de salvar sai de cena */}
      {!aviso && (
        <button
          onClick={() => salvar()}
          disabled={salvando}
          className="mb-4 h-14 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-50"
        >
          {salvando ? "Salvando…" : modo === "registrar" && !noFuturo ? "Registrar atendimento" : "Marcar horário"}
        </button>
      )}
    </Folha>
  );
}
