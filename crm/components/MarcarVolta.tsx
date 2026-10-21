"use client";

import { useEffect, useState } from "react";
import type { Atendimento } from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { dataNoSalao, formatarDiaLongo, instanteNoSalao, prazo, somarDias } from "@/lib/formato";
import { horariosLivres, proximoDiaAberto } from "@/lib/horarios";
import { supabase } from "@/lib/supabase/client";

export type ServicoAtivo = { id: string; nome: string; dias_retorno: number | null; duracao_min: number };

const semAcento = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// A volta de uma aplicação é a manutenção da mesma técnica
// ("Aplicação de mega hair – queratina" -> "Manutenção – queratina"); dos outros, o próprio serviço.
function servicoDaVolta(feito: ServicoAtivo, todos: ServicoAtivo[]): ServicoAtivo {
  const nome = semAcento(feito.nome);
  if (!nome.startsWith("aplicacao")) return feito;
  const tecnica = nome.split(/[–-]/).pop()!.trim();
  return todos.find((s) => semAcento(s.nome).startsWith("manutencao") && semAcento(s.nome).includes(tecnica)) ?? feito;
}

// Depois do ✓: "Já combinou a volta com ela?". Serviço, dia e horários livres já vêm sugeridos
// (dia = data do atendimento + dias de retorno do serviço); a dona só confirma ou troca.
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
  const [base, setBase] = useState(feitos[0]);
  const volta = servicoDaVolta(base, servicos);
  const sugerido = proximoDiaAberto(empresa.config, somarDias(dataNoSalao(a.inicio), base.dias_retorno ?? 0));
  const [dia, setDia] = useState(sugerido);
  const [livres, setLivres] = useState<{ chave: string; horas: string[] } | null>(null);
  const [hora, setHora] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

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

  function trocarBase(s: ServicoAtivo) {
    setBase(s);
    setDia(proximoDiaAberto(empresa.config, somarDias(dataNoSalao(a.inicio), s.dias_retorno ?? 0)));
    setHora(null);
  }

  async function marcar() {
    if (!hora || !a.clientes) return;
    setSalvando(true);
    setErro("");
    const { error } = await supabase().from("agendamentos").insert({
      empresa_id: empresa.id,
      cliente_id: a.clientes.id,
      servico_id: volta.id,
      profissional_id: a.profissional_id,
      inicio: instanteNoSalao(dia, hora),
      status: "agendado",
      origem: "manual",
    });
    setSalvando(false);
    if (error) setErro(error.message);
    else aoFechar();
  }

  const chip = (ativo: boolean) =>
    `h-11 rounded-full px-4 font-semibold ${ativo ? "chip-ativo" : "bg-neutral-100 text-neutral-800"}`;

  return (
    <div className="my-4 space-y-4">
      <p className="rounded-xl bg-emerald-50 p-3 font-semibold text-emerald-800">✓ Atendimento salvo</p>

      <div>
        <p className="text-lg font-bold">Já combinou a volta com ela?</p>
        <p className="text-neutral-600">
          {volta.nome} · sugerido {formatarDiaLongo(sugerido).toLowerCase()} ({prazo(sugerido)})
        </p>
      </div>

      {/* Fez mais de um serviço com retorno: escolhe de qual é a volta */}
      {feitos.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {feitos.map((s) => (
            <button key={s.id} onClick={() => trocarBase(s)} aria-pressed={s.id === base.id} className={chip(s.id === base.id)}>
              Volta de {s.nome}
            </button>
          ))}
        </div>
      )}

      <label className="block space-y-1">
        <span className="font-semibold">Dia</span>
        <input
          type="date"
          value={dia}
          onChange={(e) => {
            if (e.target.value) setDia(e.target.value);
            setHora(null);
          }}
          className="h-12 w-full rounded-xl border border-neutral-300 bg-white px-4 text-lg outline-none focus:border-[var(--cor-principal)]"
        />
      </label>

      <div>
        <p className="mb-2 font-semibold">Horário</p>
        {!horas && <p className="text-neutral-500">Vendo horários livres…</p>}
        {horas?.length === 0 && <p className="text-neutral-600">Sem horário livre nesse dia (fechado ou lotado). Escolha outro dia.</p>}
        <div className="flex flex-wrap gap-2">
          {horas?.map((h) => (
            <button key={h} onClick={() => setHora(h)} aria-pressed={hora === h} className={chip(hora === h)}>
              {h}
            </button>
          ))}
        </div>
      </div>

      {erro && <p className="rounded-xl bg-red-100 p-3 text-red-900">Não marcou: {erro}</p>}
      <button
        onClick={marcar}
        disabled={!hora || salvando}
        className="h-14 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-50"
      >
        {salvando ? "Marcando…" : hora ? `Marcar a volta às ${hora}` : "Marcar a volta"}
      </button>
      <button
        onClick={aoFechar}
        className="h-12 w-full rounded-xl border border-neutral-300 bg-white font-semibold active:bg-neutral-100"
      >
        Ainda não
      </button>
    </div>
  );
}
