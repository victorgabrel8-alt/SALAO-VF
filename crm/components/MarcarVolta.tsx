"use client";

import { useEffect, useRef, useState } from "react";
import type { Atendimento } from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { dataNoSalao, formatarDiaLongo, formatarHora, hojeNoSalao, instanteNoSalao, prazo, somarDias } from "@/lib/formato";
import { abreNoDia, horariosLivres, proximoDiaAberto } from "@/lib/horarios";
import { supabase } from "@/lib/supabase/client";

export type ServicoAtivo = { id: string; nome: string; dias_retorno: number | null; duracao_min: number };

const semAcento = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const DIAS_NA_FAIXA = 21;

// A volta de uma aplicação é a manutenção da mesma técnica
// ("Aplicação de mega hair – queratina" -> "Manutenção – queratina"); dos outros, o próprio serviço.
function servicoDaVolta(feito: ServicoAtivo, todos: ServicoAtivo[]): ServicoAtivo {
  const nome = semAcento(feito.nome);
  if (!nome.startsWith("aplicacao")) return feito;
  const tecnica = nome.split(/[–-]/).pop()!.trim();
  return todos.find((s) => semAcento(s.nome).startsWith("manutencao") && semAcento(s.nome).includes(tecnica)) ?? feito;
}

function mesCurto(dia: string): string {
  return new Date(`${dia}T12:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC", month: "short" }).replace(".", "");
}

// "qua, 6 jan"
function diaCurto(dia: string): string {
  return `${DIAS_CURTOS[new Date(`${dia}T12:00:00Z`).getUTCDay()]}, ${Number(dia.slice(8))} ${mesCurto(dia)}`;
}

type Futuro = { inicio: string; servico: string | null; origem: string };

// Depois do ✓: "Já combinou a volta?". Antes, olha se a cliente já tem horário marcado para frente
// (a IA costuma marcar sozinha pelo WhatsApp); se tiver, mostra esse horário em vez de sugerir outro.
// Senão, o dia sugerido (atendimento + dias de retorno do serviço) já vem escolhido numa faixa de
// dias para tocar, e o melhor horário livre já vem marcado: na maioria das vezes é um toque só.
export function MarcarVolta({
  atendimento: a,
  feitos,
  servicos,
  aoFechar,
}: {
  atendimento: Atendimento;
  feitos: ServicoAtivo[];
  servicos: ServicoAtivo[];
  aoFechar: () => void;
}) {
  const empresa = useEmpresa();
  const nome = a.clientes?.nome?.trim().split(/\s+/)[0] ?? "a cliente";
  const [base, setBase] = useState(feitos[0]);
  const volta = servicoDaVolta(base, servicos);
  const sugerido = proximoDiaAberto(empresa.config, somarDias(dataNoSalao(a.inicio), base.dias_retorno ?? 0));
  const [dia, setDia] = useState(sugerido);
  const [livres, setLivres] = useState<{ chave: string; horas: string[] } | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [futuro, setFuturo] = useState<Futuro | null | undefined>(undefined);
  const [marcarMesmoAssim, setMarcarMesmoAssim] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const outraData = useRef<HTMLInputElement>(null);
  const faixa = useRef<HTMLDivElement>(null);

  // A cliente já tem horário marcado daqui para frente?
  useEffect(() => {
    if (!a.clientes) return;
    supabase()
      .from("agendamentos")
      .select("inicio, origem, servicos (nome)")
      .eq("cliente_id", a.clientes.id)
      .neq("id", a.id)
      .eq("status", "agendado")
      .gt("inicio", new Date().toISOString())
      .order("inicio")
      .limit(1)
      .then(({ data }) => {
        const r = data?.[0] as { inicio: string; origem: string; servicos: { nome: string } | null } | undefined;
        setFuturo(r ? { inicio: r.inicio, origem: r.origem, servico: r.servicos?.nome ?? null } : null);
      });
  }, [a.clientes, a.id]);

  const chave = `${dia}|${volta.id}`;
  useEffect(() => {
    let ativo = true;
    horariosLivres(empresa.id, empresa.config, dia, volta.duracao_min).then((horas) => {
      if (ativo) setLivres({ chave: `${dia}|${volta.id}`, horas });
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, empresa.config, dia, volta.id, volta.duracao_min]);
  const horas = livres?.chave === chave ? livres.horas : null;

  // O horário que vale: o que a dona tocou; senão o mesmo horário de hoje (costume da cliente),
  // se estiver livre; senão o primeiro livre do dia
  const horaDeHoje = formatarHora(a.inicio);
  const escolhida = hora && horas?.includes(hora) ? hora : horas?.includes(horaDeHoje) ? horaDeHoje : (horas?.[0] ?? null);

  // Faixa de dias: começa um pouco antes do sugerido (nunca antes de amanhã)
  const amanha = somarDias(hojeNoSalao(), 1);
  const inicioFaixa = somarDias(sugerido, -3) < amanha ? amanha : somarDias(sugerido, -3);
  const diasFaixa = Array.from({ length: DIAS_NA_FAIXA }, (_, i) => somarDias(inicioFaixa, i));
  const foraDaFaixa = !diasFaixa.includes(dia);

  // O dia escolhido sempre à vista na faixa
  useEffect(() => {
    faixa.current?.querySelector<HTMLElement>(`[data-dia="${dia}"]`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [dia]);

  function trocarBase(s: ServicoAtivo) {
    setBase(s);
    setDia(proximoDiaAberto(empresa.config, somarDias(dataNoSalao(a.inicio), s.dias_retorno ?? 0)));
    setHora(null);
  }

  function escolherDia(d: string) {
    setDia(d);
    setHora(null);
  }

  async function marcar() {
    if (!escolhida || !a.clientes) return;
    setSalvando(true);
    setErro("");
    const { error } = await supabase().from("agendamentos").insert({
      empresa_id: empresa.id,
      cliente_id: a.clientes.id,
      servico_id: volta.id,
      profissional_id: a.profissional_id,
      inicio: instanteNoSalao(dia, escolhida),
      status: "agendado",
      origem: "manual",
    });
    setSalvando(false);
    if (error) setErro(error.message);
    else aoFechar();
  }

  const manha = horas?.filter((h) => h < "12:00") ?? [];
  const tarde = horas?.filter((h) => h >= "12:00") ?? [];

  const salvo = (
    <p className="flex items-center gap-2 rounded-[16px] bg-salvia px-3.5 py-2.5 text-[15px] font-semibold text-salvia-texto">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m5 12 5 5L20 7" />
      </svg>
      Atendimento concluído
    </p>
  );

  if (futuro === undefined) {
    return (
      <div className="flex flex-col gap-4">
        {salvo}
        <p className="text-texto-2">Vendo a agenda de {nome}…</p>
      </div>
    );
  }

  // Já tem a volta marcada (quase sempre pela IA): mostra e pronto
  if (futuro && !marcarMesmoAssim) {
    const diaFuturo = dataNoSalao(futuro.inicio);
    return (
      <div className="flex flex-col gap-4">
        {salvo}
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-[26px] leading-tight font-semibold">A volta de {nome} já está marcada</h2>
          <p className="text-[15px] text-texto-2">{futuro.origem === "ia" ? `A IA já combinou com ${nome} pelo WhatsApp.` : "Já tem um horário na agenda."}</p>
        </div>
        <div className="flex items-center gap-3 rounded-[18px] bg-card px-4 py-3.5 borda-suave">
          <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-[14px] bg-grafite text-perola">
            <span className="text-[10px] font-semibold uppercase">{mesCurto(diaFuturo)}</span>
            <span className="font-serif text-xl leading-none font-semibold">{Number(diaFuturo.slice(8))}</span>
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[16px] font-semibold">
              {formatarDiaLongo(diaFuturo)} às {formatarHora(futuro.inicio)}
            </span>
            <span className="truncate text-[13px] text-texto-2">
              {futuro.servico ?? "Serviço não informado"} · {prazo(diaFuturo)}
            </span>
          </span>
        </div>
        <button onClick={aoFechar} className="h-14 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98]">
          Pronto
        </button>
        <button onClick={() => setMarcarMesmoAssim(true)} className="h-11 text-[15px] font-semibold text-texto-2">
          Marcar outro horário mesmo assim
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {salvo}

      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-[26px] leading-tight font-semibold">Quer já marcar a volta de {nome}?</h2>
        <p className="text-[15px] text-texto-2">
          {volta.nome} · o ideal é {prazo(sugerido)}
        </p>
      </div>

      {/* Fez mais de um serviço com retorno: escolhe de qual é a volta */}
      {feitos.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {feitos.map((s) => (
            <button
              key={s.id}
              onClick={() => trocarBase(s)}
              aria-pressed={s.id === base.id}
              className={`h-10 rounded-full px-4 text-sm font-semibold ${s.id === base.id ? "chip-ativo" : "bg-card text-texto borda-suave"}`}
            >
              Volta de {s.nome}
            </button>
          ))}
        </div>
      )}

      {/* Dia: uma faixa para tocar, como os dias da Agenda; o sugerido vem marcado */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="rotulo text-texto-2">Dia</span>
          <button
            onClick={() => {
              const el = outraData.current;
              if (!el) return;
              if (typeof el.showPicker === "function") el.showPicker();
              else el.focus();
            }}
            className="text-[13px] font-semibold text-bronze-escuro"
          >
            Outra data
          </button>
          <input
            ref={outraData}
            type="date"
            min={amanha}
            value={dia}
            onChange={(e) => e.target.value && escolherDia(e.target.value)}
            className="sr-only"
            tabIndex={-1}
            aria-label="Escolher outra data"
          />
        </div>
        <div ref={faixa} className="sem-barra -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1">
          {diasFaixa.map((d, i) => {
            const aberto = abreNoDia(empresa.config, d);
            const ativo = d === dia;
            const novoMes = i === 0 || d.slice(8) === "01";
            return (
              <button
                key={d}
                data-dia={d}
                disabled={!aberto}
                onClick={() => escolherDia(d)}
                aria-pressed={ativo}
                aria-label={`${formatarDiaLongo(d)}${aberto ? "" : " (fechado)"}`}
                className={`relative flex h-[70px] w-[50px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[16px] transition-colors duration-200 ${
                  ativo ? "bg-grafite text-perola shadow-[0_6px_14px_rgba(30,23,20,0.25)]" : aberto ? "bg-card text-texto borda-suave" : "text-inativo opacity-50"
                }`}
              >
                <span className="text-[10px] font-semibold uppercase">{novoMes ? mesCurto(d) : DIAS_CURTOS[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span>
                <span className="font-serif text-[22px] leading-none font-semibold">{Number(d.slice(8))}</span>
                {/* Pontinho no dia sugerido */}
                {d === sugerido && <span aria-hidden className={`absolute bottom-1.5 h-1 w-1 rounded-full ${ativo ? "bg-bronze" : "bg-bronze-escuro"}`} />}
              </button>
            );
          })}
        </div>
        {foraDaFaixa && <p className="text-[13px] text-texto-2">Escolhido: {formatarDiaLongo(dia)}</p>}
      </div>

      {/* Horário: livres em manhã e tarde; o melhor já vem marcado */}
      <div className="flex flex-col gap-2">
        <span className="rotulo text-texto-2">Horário</span>
        {!horas && <p className="text-[15px] text-texto-2">Vendo horários livres…</p>}
        {horas?.length === 0 && (
          <p className="rounded-[16px] bg-card px-3.5 py-3 text-[15px] text-texto-2 borda-suave">
            {abreNoDia(empresa.config, dia) ? "Esse dia está cheio para esse serviço." : "O salão não abre nesse dia."} Escolha outro dia.
          </p>
        )}
        {[
          { titulo: "Manhã", lista: manha },
          { titulo: "Tarde", lista: tarde },
        ]
          .filter((p) => p.lista.length > 0)
          .map((p) => (
            <div key={p.titulo} className="flex flex-col gap-1.5">
              <span className="text-[13px] text-texto-2">{p.titulo}</span>
              <div className="grid grid-cols-4 gap-1.5">
                {p.lista.map((h) => (
                  <button
                    key={h}
                    onClick={() => setHora(h)}
                    aria-pressed={escolhida === h}
                    className={`h-11 rounded-full text-[15px] font-semibold transition-colors duration-200 ${
                      escolhida === h ? "bg-grafite text-perola" : "bg-card text-texto borda-suave"
                    }`}
                  >
                    {h}
                  </button>
                ))}
              </div>
            </div>
          ))}
      </div>

      {erro && <p className="rounded-2xl bg-rose p-3 text-rose-texto">Não deu para marcar: {erro}</p>}
      <button
        onClick={marcar}
        disabled={!escolhida || salvando}
        className="h-14 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98] disabled:opacity-40"
      >
        {salvando ? "Marcando…" : escolhida ? `Marcar ${diaCurto(dia)} às ${escolhida}` : "Escolha um horário"}
      </button>
      <button onClick={aoFechar} className="h-11 text-[16px] font-semibold text-texto-2">
        Agora não
      </button>
    </div>
  );
}
