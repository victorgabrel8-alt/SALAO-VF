"use client";

import { useEffect, useState } from "react";
import { EscolherServicos } from "@/components/EscolherServicos";
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
import {
  buscarMaisUsados,
  buscarServicosAtivos,
  ordenarParaGravar,
  somarEscolhidos,
  type Escolhido,
  type ServicoEscolha,
} from "@/lib/servicos";
import { supabase } from "@/lib/supabase/client";

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

  const [servicos, setServicos] = useState<ServicoEscolha[]>([]);
  const [maisUsados, setMaisUsados] = useState<string[]>([]);

  const [busca, setBusca] = useState("");
  const [resultados, setResultados] = useState<ClienteBusca[]>([]);
  const [cliente, setCliente] = useState<ClienteBusca | null>(null);
  const [novaCliente, setNovaCliente] = useState(false);
  const [nomeNova, setNomeNova] = useState("");
  const [telefoneNova, setTelefoneNova] = useState("");

  // Vários serviços num horário só: o 1º de ordenarParaGravar vira o principal (agendamentos) e os
  // outros vão para atendimento_servicos, cada um com a sua quantidade (supabase/010 e 034)
  const [escolhidos, setEscolhidos] = useState<Escolhido[]>([]);
  const [data, setData] = useState(dia ?? agora.data);
  const [hora, setHora] = useState(horaInicial ?? (modo === "registrar" ? agora.hora : "09:00"));

  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const ordem = ordenarParaGravar(escolhidos, servicos);
  const [principal, ...extras] = ordem;
  const escolhidosDados = ordem.map((e) => servicos.find((s) => s.id === e.id)).filter((s): s is ServicoEscolha => !!s);
  // Tempo do horário: a soma de todos os serviços (com a quantidade). Sem serviço, 1 h como antes
  const minutosTotal = somarEscolhidos(escolhidos, servicos).minutos || 60;
  // Um serviço só, uma unidade: o banco calcula o fim como sempre. Mais que isso: o app grava o fim
  const variosOuQuantidade = extras.length > 0 || (principal?.quantidade ?? 1) > 1;
  const almocoDoSalao = lerAlmoco(empresa.config);
  // O celular deixa apagar o dia ou a hora: sem os dois, nada de contas com data (quebravam a tela)
  const quandoValido = dataValida(data) && horaValida(hora);
  const terminaAs =
    quandoValido && escolhidos.length
      ? formatarHora(new Date(Date.parse(instanteNoSalao(data, hora.slice(0, 5))) + minutosTotal * 60_000).toISOString())
      : null;
  // Registrar com hora que ainda não chegou = horário marcado (a próxima cliente), não atendimento feito
  const noFuturo = quandoValido && Date.parse(instanteNoSalao(data, hora.slice(0, 5))) > agoraMs;
  // Vai entrar na agenda como horário a atender (e não como atendimento já feito)
  const vaiAgendar = modo === "agendar" || noFuturo;

  useEffect(() => {
    buscarServicosAtivos(empresa.id).then(setServicos);
    buscarMaisUsados(empresa.id).then(setMaisUsados);
  }, [empresa.id]);

  // Busca por nome ou telefone enquanto a dona digita
  useEffect(() => {
    const termo = busca.replace(/[,()%*"\\]/g, " ").trim();
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
    if (!principal) {
      setErro("Escolha pelo menos um serviço.");
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
      const problema = await conferirHorario(empresa.id, empresa.config, data, hora, minutosTotal);
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
    const inicio = instanteNoSalao(data, hora.slice(0, 5));
    const db = supabase();
    const { data: criado, error } = await db
      .from("agendamentos")
      .insert({
        empresa_id: empresa.id,
        cliente_id: clienteId,
        servico_id: principal.id,
        quantidade: principal.quantidade,
        // Sem escolha de profissional no app da dona
        profissional_id: null,
        origem: "manual",
        inicio,
        // Vários serviços: o fim é a soma de todos. Um só: o banco calcula, como sempre
        ...(variosOuQuantidade ? { fim: new Date(Date.parse(inicio) + minutosTotal * 60_000).toISOString() } : {}),
        status: realizado ? "realizado" : "agendado",
        // Sem valor: o app não controla dinheiro (o total aparece só para a dona conferir)
        valor: null,
      })
      .select("id")
      .single();
    if (error) {
      setSalvando(false);
      setErro(`Não foi possível salvar: ${error.message}`);
      return;
    }
    const erroExtras = await gravarExtras(criado.id);
    if (erroExtras) {
      // Não deixa o horário pela metade (só com o principal)
      await db.from("agendamentos").delete().eq("id", criado.id);
      setSalvando(false);
      setErro(`Não foi possível salvar os serviços: ${erroExtras}`);
      return;
    }
    setSalvando(false);
    aoSalvar();
  }

  // Os serviços a mais do horário, cada um com a sua quantidade
  async function gravarExtras(agendamentoId: string): Promise<string | undefined> {
    if (!extras.length) return undefined;
    const { error } = await supabase()
      .from("atendimento_servicos")
      .insert(extras.map((e) => ({ empresa_id: empresa.id, agendamento_id: agendamentoId, servico_id: e.id, quantidade: e.quantidade, marcado_junto: true })),
      );
    return error?.message;
  }

  // "Mudar esse horário": o horário que já existia passa para a hora (e o serviço) escolhidos,
  // em vez de nascer um segundo horário da mesma cliente no mesmo dia
  async function mudarHorario(h: HorarioMarcado) {
    setSalvando(true);
    setErro("");
    // O horário que muda não conta como ocupado (ele mesmo sai de onde estava)
    if (vaiAgendar) {
      const problema = await conferirHorario(empresa.id, empresa.config, data, hora, minutosTotal, h.id);
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
    const db = supabase();
    // O horário passa a ter a lista nova inteira: os serviços a mais antigos saem e entram os novos.
    // Isso vem antes de mudar o horário: com fim = null, o banco soma o tempo de todos (supabase/034).
    const { error: erroTirar } = await db.from("atendimento_servicos").delete().eq("agendamento_id", h.id);
    const erroExtras = erroTirar?.message ?? (await gravarExtras(h.id));
    if (erroExtras) {
      setSalvando(false);
      setAviso(null);
      setErro(`Não foi possível mudar os serviços do horário: ${erroExtras}`);
      return;
    }
    const { error } = await db
      .from("agendamentos")
      .update({
        inicio: novoInicio,
        fim: null,
        servico_id: principal.id,
        quantidade: principal.quantidade,
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
    "h-12 w-full rounded-xl border border-claro bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]";

  return (
    <Folha rotulo={modo === "registrar" ? "Registrar atendimento" : "Novo horário"} aoFechar={aoFechar} className="space-y-5 bg-white px-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{modo === "registrar" ? "Registrar atendimento" : "Novo horário"}</h2>
        <button onClick={aoFechar} className="h-11 px-3 text-lg font-semibold text-texto-2">
          Fechar
        </button>
      </div>

      {/* Cliente */}
      <section className="space-y-2">
        <h3 className="text-lg font-semibold">Cliente</h3>
        {cliente ? (
          <div className="flex items-center justify-between rounded-xl bg-campo p-3">
            <div>
              <p className="text-lg font-semibold">{cliente.nome ?? "Sem nome"}</p>
              <p className="text-texto-2">{formatarTelefone(cliente.telefone)}</p>
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
              <ul className="divide-y divide-borda rounded-xl border border-borda">
                {resultados.map((c) => (
                  <li key={c.id}>
                    <button onClick={() => setCliente(c)} className="w-full px-4 py-3 text-left active:bg-campo">
                      <span className="block text-lg font-semibold">{c.nome ?? "Sem nome"}</span>
                      <span className="text-texto-2">{formatarTelefone(c.telefone)}</span>
                    </button>
                  </li>
                ))}
                {resultados.length === 0 && <li className="px-4 py-3 text-rotulo">Nenhuma cliente encontrada.</li>}
              </ul>
            )}
            <button
              onClick={() => {
                setNovaCliente(true);
                setNomeNova(/\d/.test(busca) ? "" : busca);
                setTelefoneNova(/\d/.test(busca) ? busca : "");
              }}
              className="h-12 w-full rounded-xl border-2 border-dashed border-claro font-semibold"
            >
              + Cliente nova
            </button>
          </div>
        )}
      </section>

      {/* Serviços */}
      <EscolherServicos servicos={servicos} maisUsados={maisUsados} escolhidos={escolhidos} aoMudar={setEscolhidos} />

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
      {terminaAs && <p className="-mt-3 text-texto-2">Termina às {terminaAs}</p>}
      {/* Aviso na hora, antes de salvar */}
      {vaiAgendar &&
        almocoDoSalao &&
        conflitaComAlmoco(almocoDoSalao, hora.slice(0, 5), minutosTotal) && (
          <p className="-mt-3 text-sm font-medium text-rose-texto">
            Cai no almoço ({almocoDoSalao.inicio} às {almocoDoSalao.fim}).
          </p>
        )}

      {/* Horário que ainda não chegou: avisa que entra como a próxima cliente */}
      {modo === "registrar" && noFuturo && (
        <p className="rounded-xl bg-campo p-3 text-texto">
          Esse horário ainda não chegou: ela entra na agenda como <strong>próxima cliente</strong>, para você confirmar depois.
        </p>
      )}

      {/* Retorno: só informa a data; quem chama a cliente quando chegar a hora é a IA */}
      {/* Cada serviço tem o próprio retorno: a IA chama pelo que vence primeiro */}
      {modo === "registrar" && !noFuturo && escolhidosDados.length > 0 && (
        <section className="space-y-1 rounded-xl border border-borda p-3">
          <h3 className="text-lg font-semibold">Retorno</h3>
          {escolhidosDados.length === 1 ? (
            <RetornoDoServico servico={escolhidosDados[0]} data={quandoValido ? data : null} />
          ) : (
            <ul className="space-y-1">
              {escolhidosDados.map((s) => (
                <li key={s.id}>
                  <RetornoDoServico servico={s} data={quandoValido ? data : null} curto />
                </li>
              ))}
            </ul>
          )}
          {escolhidosDados.some((s) => s.dias_retorno) && <p className="text-sm text-rotulo">A IA chama a cliente quando a data chegar.</p>}
        </section>
      )}

      {aviso?.tipo === "parecida" && (
        <section className="space-y-3 rounded-xl border border-claro bg-campo p-3">
          {aviso.lista.some((c) => c.mesmoTelefone) ? (
            <>
              <h3 className="text-lg font-semibold text-texto">Esse telefone já está cadastrado</h3>
              <p className="text-texto">Um telefone só pode ter uma ficha. Use a cliente que já existe:</p>
            </>
          ) : (
            <>
              <h3 className="text-lg font-semibold text-texto">Essa cliente já não está cadastrada?</h3>
              <p className="text-texto">
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
              className="flex w-full items-center justify-between gap-3 rounded-xl border border-claro bg-white px-4 py-3 text-left active:bg-campo"
            >
              <span>
                <span className="block font-semibold">{c.nome ?? "Sem nome"}</span>
                <span className="block text-sm text-texto-2">
                  {formatarTelefone(c.telefone)} · {c.motivo}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-[var(--cor-principal)]">{c.mesmoTelefone ? "Usar esta" : "É ela"}</span>
            </button>
          ))}
          {/* Mesmo telefone: não existe "outra pessoa" (o número não pode ter duas fichas) */}
          {aviso.lista.some((c) => c.mesmoTelefone) ? (
            <button onClick={() => setAviso(null)} disabled={salvando} className="h-12 w-full rounded-xl border border-claro bg-white font-semibold">
              Voltar e corrigir o telefone
            </button>
          ) : (
            <button onClick={() => setAviso({ tipo: "nova" })} disabled={salvando} className="h-12 w-full rounded-xl border border-claro bg-white font-semibold">
              Não, é outra pessoa
            </button>
          )}
        </section>
      )}

      {aviso?.tipo === "nova" && (
        <section className="space-y-3 rounded-xl border border-claro bg-campo p-3">
          <h3 className="text-lg font-semibold text-texto">Criar uma ficha nova para {nomeDaCliente}?</h3>
          <p className="text-texto">Ela vai ficar separada da cliente parecida. Só confirme se tiver certeza de que é outra pessoa.</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setAviso(null)} disabled={salvando} className="h-12 rounded-xl border border-claro bg-white font-semibold">
              Voltar
            </button>
            <button onClick={() => salvar({ novaConfirmada: true })} disabled={salvando} className="h-12 rounded-xl bg-grafite font-bold text-white">
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
              <div key={h.id} className="space-y-2 rounded-2xl border border-borda p-3">
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
              className="h-12 w-full rounded-xl border border-claro font-semibold disabled:opacity-50"
            >
              Criar um novo horário
            </button>
            <button onClick={() => setAviso(null)} disabled={salvando} className="h-11 w-full font-semibold text-texto-2">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {erro && <p className="rounded-xl bg-rose p-3 font-medium text-rose-texto">{erro}</p>}

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

// "Ela deve voltar em 20/11 (em 10 dias)". curto: uma linha por serviço, quando são vários
function RetornoDoServico({ servico, data, curto = false }: { servico: ServicoEscolha; data: string | null; curto?: boolean }) {
  const volta = data && servico.dias_retorno ? somarDias(data, servico.dias_retorno) : null;
  if (curto) {
    return (
      <p>
        <span className="font-semibold">{servico.nome}:</span>{" "}
        {volta ? `${formatarData(volta).slice(0, 5)} (${prazo(volta)})` : <span className="text-rotulo">sem retorno</span>}
      </p>
    );
  }
  if (!volta) return <p className="text-texto-2">{servico.nome} não tem retorno programado.</p>;
  return (
    <>
      <p className="text-lg">
        Ela deve voltar em <strong>{formatarData(volta)}</strong> ({prazo(volta)})
      </p>
      <p className="text-sm text-rotulo">
        {servico.nome} tem retorno de {servico.dias_retorno} dias.
      </p>
    </>
  );
}
