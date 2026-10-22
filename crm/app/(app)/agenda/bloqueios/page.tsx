"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useDialogo } from "@/components/Dialogo";
import { Folha } from "@/components/Folha";
import { buscarProximos, type Atendimento } from "@/lib/atendimentos";
import { bloqueiosFuturos, salvarBloqueios, type Bloqueio } from "@/lib/bloqueios";
import { useEmpresa, useTrocarConfig } from "@/lib/empresa";
import { dataNoSalao, diasEntre, formatarDiaLongo, formatarHora, formatarTelefone, hojeNoSalao, primeiroNome, somarDias } from "@/lib/formato";
import { abrirWhatsApp } from "@/lib/whatsapp";

// Dias sem atender: viagem, folga, curso, imprevisto. Bloqueado, o app e a IA deixam de oferecer
// horário nesses dias. Ao bloquear, a tela mostra quem já tem horário marcado no período, para a
// Gleide avisar cada uma (o "pedir para a IA remarcar" é a próxima etapa).

const MOTIVOS = ["Viagem", "Folga", "Curso", "Imprevisto"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// "12 nov" / "10 a 15 nov" / "28 nov a 3 dez"
function periodo(b: { de: string; ate: string }): string {
  const d = (s: string) => `${Number(s.slice(8))} ${MESES[Number(s.slice(5, 7)) - 1]}`;
  if (b.de === b.ate) return d(b.de);
  if (b.de.slice(0, 7) === b.ate.slice(0, 7)) return `${Number(b.de.slice(8))} a ${d(b.ate)}`;
  return `${d(b.de)} a ${d(b.ate)}`;
}

function quantosDias(b: { de: string; ate: string }): string {
  const n = diasEntre(b.de, b.ate) + 1;
  return n === 1 ? "1 dia" : `${n} dias`;
}

function avisoDoImprevisto(a: Atendimento): string {
  const nome = a.clientes?.nome ? `, ${primeiroNome(a.clientes.nome)}` : "";
  const dia = formatarDiaLongo(dataNoSalao(a.inicio)).toLowerCase();
  return `Oi${nome}! Tudo bem? Tive um imprevisto e não vou conseguir atender ${dia} às ${formatarHora(a.inicio)}. Vamos remarcar? Qual dia fica bom pra você?`;
}

export default function BloqueiosPage() {
  const empresa = useEmpresa();
  const trocarConfig = useTrocarConfig();
  const { dialogo, perguntar, avisar } = useDialogo();
  const [novo, setNovo] = useState(false);
  const lista = bloqueiosFuturos(empresa.config);

  async function remover(b: Bloqueio) {
    if (!(await perguntar(`Voltar a atender em ${periodo(b)}? A IA volta a oferecer horários nesses dias.`, { confirmar: "Voltar a atender" }))) return;
    const r = await salvarBloqueios(empresa.id, (atuais) => atuais.filter((x) => !(x.de === b.de && x.ate === b.ate)));
    if ("erro" in r) await avisar(`Não deu certo: ${r.erro}`);
    else trocarConfig(r.config);
  }

  return (
    <>
      <header className="flex flex-col gap-3 px-4 pt-4">
        <Link href="/agenda/proximas" className="vidro flex h-10 w-fit items-center gap-0.5 rounded-full pr-4 pl-2.5 text-[15px] font-semibold active:scale-95">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          Próximas
        </Link>
        <div>
          <h1 className="font-serif text-[34px] leading-tight font-semibold">Dias sem atender</h1>
          <p className="text-sm text-texto-2">Viagem, folga ou imprevisto: nesses dias a IA não marca ninguém.</p>
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-5">
        {lista.length === 0 ? (
          <p className="rounded-[22px] bg-card p-5 text-center text-[15px] text-texto-2 borda-suave">Nenhum dia bloqueado. O salão atende normalmente.</p>
        ) : (
          <ul className="overflow-hidden rounded-[22px] bg-card borda-suave">
            {lista.map((b, i) => (
              <li key={`${b.de}-${b.ate}`} className={`flex items-center gap-3 px-3.5 py-3 ${i > 0 ? "border-t border-borda" : ""}`}>
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-rose">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#8A3B2B" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18M9 14l6 6M15 14l-6 6" />
                  </svg>
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[16px] font-semibold">{periodo(b)}</span>
                  <span className="truncate text-[13px] text-texto-2">
                    {b.motivo ?? "Sem atender"} · {quantosDias(b)}
                  </span>
                </span>
                <button onClick={() => remover(b)} className="h-9 shrink-0 rounded-full bg-campo px-3.5 text-[13px] font-semibold text-texto active:scale-95">
                  Remover
                </button>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={() => setNovo(true)}
          className="flex h-14 items-center justify-center gap-2 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98]"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
            <path d="M12 5v14M5 12h14" />
          </svg>
          Bloquear dias
        </button>
      </div>

      {novo && (
        <NovoBloqueio
          aoFechar={() => setNovo(false)}
          aoSalvar={(config) => {
            trocarConfig(config);
            setNovo(false);
          }}
        />
      )}
      {dialogo}
    </>
  );
}

// Folha para bloquear: motivo, de / até e, logo abaixo, quem já tem horário nesses dias
function NovoBloqueio({ aoFechar, aoSalvar }: { aoFechar: () => void; aoSalvar: (config: Record<string, unknown>) => void }) {
  const empresa = useEmpresa();
  const amanha = somarDias(hojeNoSalao(), 1);
  const [motivo, setMotivo] = useState<string | null>(null);
  const [de, setDe] = useState(amanha);
  const [ate, setAte] = useState(amanha);
  const [afetadas, setAfetadas] = useState<{ chave: string; lista: Atendimento[] } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const fim = ate < de ? de : ate;

  // Quem tem horário de "de" até "fim"
  const chave = `${de}|${fim}`;
  useEffect(() => {
    let ativo = true;
    buscarProximos(empresa.id, somarDias(fim, 1)).then((r) => {
      if (ativo) setAfetadas({ chave: `${de}|${fim}`, lista: r.atendimentos.filter((a) => dataNoSalao(a.inicio) >= de) });
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, de, fim]);
  const lista = afetadas?.chave === chave ? afetadas.lista : null;

  async function salvar() {
    setSalvando(true);
    setErro("");
    const r = await salvarBloqueios(empresa.id, (atuais) => [...atuais, { de, ate: fim, motivo }]);
    setSalvando(false);
    if ("erro" in r) setErro(r.erro);
    else aoSalvar(r.config);
  }

  const campoData = "h-12 w-full rounded-full bg-card px-4 text-[16px] font-semibold outline-none borda-suave";

  return (
    <Folha rotulo="Bloquear dias" aoFechar={aoFechar} className="bg-[var(--background)] px-5">
      <div className="flex flex-col gap-4 pt-1 pb-5">
        <h2 className="font-serif text-[26px] leading-tight font-semibold">Quais dias você não vai atender?</h2>

        <div className="flex flex-col gap-2">
          <span className="rotulo text-texto-2">Motivo</span>
          <div className="flex flex-wrap gap-2">
            {MOTIVOS.map((m) => (
              <button
                key={m}
                onClick={() => setMotivo((atual) => (atual === m ? null : m))}
                aria-pressed={motivo === m}
                className={`h-10 rounded-full px-4 text-[15px] font-semibold transition-colors ${motivo === m ? "chip-ativo" : "bg-card text-texto borda-suave"}`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1.5">
            <span className="rotulo text-texto-2">De</span>
            <input
              type="date"
              min={amanha}
              value={de}
              onChange={(e) => {
                if (!e.target.value) return;
                setDe(e.target.value);
                if (ate < e.target.value) setAte(e.target.value);
              }}
              className={campoData}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="rotulo text-texto-2">Até</span>
            <input type="date" min={de} value={fim} onChange={(e) => e.target.value && setAte(e.target.value)} className={campoData} />
          </label>
        </div>
        <p className="-mt-1 text-[13px] text-texto-2">
          {periodo({ de, ate: fim })} · {quantosDias({ de, ate: fim })} sem atender
        </p>

        {/* Quem já está marcado nesses dias: avisar antes de bloquear */}
        <div className="flex flex-col gap-2">
          <span className="rotulo text-texto-2">Clientes nesses dias</span>
          {!lista && <p className="text-[15px] text-texto-2">Vendo a agenda…</p>}
          {lista?.length === 0 && <p className="rounded-[16px] bg-salvia px-3.5 py-3 text-[15px] text-salvia-texto">Ninguém marcado nesses dias. Pode bloquear tranquila.</p>}
          {lista && lista.length > 0 && (
            <>
              <p className="rounded-[16px] bg-ouro px-3.5 py-3 text-[15px] text-ouro-texto">
                <b>{lista.length === 1 ? "1 cliente tem" : `${lista.length} clientes têm`} horário</b> nesses dias. O bloqueio não desmarca ninguém: avise cada uma
                para remarcar.
              </p>
              <ul className="overflow-hidden rounded-[18px] bg-card borda-suave">
                {lista.map((a, i) => (
                  <li key={a.id} className={`flex items-center gap-3 px-3.5 py-2.5 ${i > 0 ? "border-t border-borda" : ""}`}>
                    <Avatar id={a.clientes?.id ?? a.id} nome={a.clientes?.nome ?? null} tamanho="h-9 w-9 text-sm" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] font-semibold">{a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente")}</span>
                      <span className="truncate text-[13px] text-texto-2">
                        {formatarDiaLongo(dataNoSalao(a.inicio))} · {formatarHora(a.inicio)}
                      </span>
                    </span>
                    {a.clientes && (
                      <button
                        onClick={() => abrirWhatsApp(a.clientes!.telefone, avisoDoImprevisto(a))}
                        aria-label={`Avisar ${a.clientes.nome ?? "a cliente"} pelo WhatsApp`}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-salvia-texto text-white active:scale-95"
                      >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                        </svg>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {erro && <p className="rounded-2xl bg-rose p-3 text-rose-texto">Não deu para salvar: {erro}</p>}
        <button
          onClick={salvar}
          disabled={salvando}
          className="h-14 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98] disabled:opacity-50"
        >
          {salvando ? "Salvando…" : `Bloquear ${periodo({ de, ate: fim })}`}
        </button>
        <button onClick={aoFechar} className="h-11 text-[16px] font-semibold text-texto-2">
          Cancelar
        </button>
      </div>
    </Folha>
  );
}
