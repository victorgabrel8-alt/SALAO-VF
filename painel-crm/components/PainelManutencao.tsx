"use client";

import Link from "next/link";
import { useState } from "react";
import { Etiquetas } from "@/components/Etiquetas";
import { Aviso, Chip, botao, campoBase, cartao, type Tom } from "@/components/Pecas";
import { useEmpresa } from "@/lib/empresa";
import { formatarData, formatarHora, formatarTelefone, haQuantoTempo, prazo } from "@/lib/formato";
import { FAIXAS, useManutencoes, type Faixa, type Manutencao } from "@/lib/manutencao";
import { useTempoReal } from "@/lib/tempoReal";

// As faixas são uma escala de urgência, da mais urgente para a menos urgente. A posição, o rótulo e o número
// dizem a urgência; a cor só reforça as duas primeiras (rosé = passou, mel = esta semana) e o resto é neutro.
const TOM: Record<Faixa, Tom> = { passou: "atencao", semana: "aviso", quinzena: "neutro", mes: "neutro", depois: "neutro" };
const BARRA: Record<Faixa, string> = {
  passou: "bg-atencao",
  semana: "bg-status-chegando",
  quinzena: "bg-onix",
  mes: "bg-onix",
  depois: "bg-onix",
};
const TEXTO: Record<Faixa, string> = {
  passou: "text-rose-texto",
  semana: "text-mel-texto",
  quinzena: "text-texto-2",
  mes: "text-texto-2",
  depois: "text-texto-2",
};

function textoFaltam(m: Manutencao): string {
  return m.faltam < 0 ? `passou ${-m.faltam} ${m.faltam === -1 ? "dia" : "dias"}` : prazo(m.retorno);
}

// Controle da manutenção: quem está chegando perto do retorno, em faixas de prazo,
// com o serviço que vence e se ela já marcou horário.
export function PainelManutencao({ busca }: { busca: string }) {
  const empresa = useEmpresa();
  const [versao, setVersao] = useState(0);
  const [faixa, setFaixa] = useState<Faixa | null>(null);
  const [servico, setServico] = useState("");
  const [soSemHorario, setSoSemHorario] = useState(true);
  // Atendimento marcado ou concluído na Agenda: a lista se atualiza sozinha
  useTempoReal(["agendamentos", "clientes"], empresa.id, () => setVersao((v) => v + 1));
  const dados = useManutencoes(empresa.id, versao);

  if (!dados) return <p className="py-8 text-texto-2">Carregando…</p>;
  if (dados.erro) return <Aviso tom="atencao">Erro ao ler as manutenções: {dados.erro}</Aviso>;

  const termo = busca.trim().toLowerCase();
  const digitos = busca.replace(/\D/g, "");
  const servicos = [...new Set(dados.itens.map((m) => m.servico))].sort();
  // Busca, serviço e "sem horário" valem para os contadores; a faixa escolhida só para a tabela
  const base = dados.itens.filter(
    (m) =>
      (!soSemHorario || !m.marcado) &&
      (!servico || m.servico === servico) &&
      (!termo || (m.nome ?? "").toLowerCase().includes(termo) || (digitos.length >= 3 && m.telefone.includes(digitos))),
  );
  const contagem = Object.fromEntries(FAIXAS.map((f) => [f.chave, base.filter((m) => m.faixa === f.chave).length]));
  const visiveis = FAIXAS.filter((f) => !faixa || f.chave === faixa);

  return (
    <>
      {/* A escala: cinco passos lado a lado, do mais urgente (esquerda) ao menos urgente (direita) */}
      <section aria-label="Manutenções por urgência" className={`${cartao} mb-4 overflow-hidden`}>
        <div className="flex items-center justify-between gap-4 border-b border-borda px-5 py-2.5 text-[13px] font-bold text-apoio">
          <span className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5M11 6l-6 6 6 6" />
            </svg>
            Mais urgente
          </span>
          <span className="hidden font-semibold md:inline">Clique numa faixa para ver só ela</span>
          <span className="flex items-center gap-1.5">
            Menos urgente
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </span>
        </div>
        <ol className="grid grid-cols-5 divide-x divide-borda">
          {FAIXAS.map((f, i) => {
            const ativa = faixa === f.chave;
            return (
              <li key={f.chave} className="min-w-0">
                <button
                  onClick={() => setFaixa(ativa ? null : f.chave)}
                  aria-pressed={ativa}
                  className={`flex h-full w-full flex-col items-start px-4 py-4 text-left -outline-offset-2 ${ativa ? "bg-onix text-porcelana" : "hover:bg-campo/40"}`}
                >
                  <span className={`text-[12px] font-bold tracking-[0.08em] uppercase ${ativa ? "text-campo" : "text-apoio"}`}>
                    {i + 1} de {FAIXAS.length}
                  </span>
                  <span className="mt-1 text-[15px] leading-snug font-bold">{f.titulo}</span>
                  <span className="mt-2 text-[34px] leading-none font-extrabold tracking-[-0.04em] tabular-nums">{contagem[f.chave]}</span>
                  <span className={`mt-2 text-[13px] leading-snug font-semibold ${ativa ? "text-campo" : contagem[f.chave] > 0 ? TEXTO[f.chave] : "text-apoio"}`}>
                    {contagem[f.chave] === 1 ? "cliente" : "clientes"} · {f.detalhe}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <label className="flex items-center gap-2.5 text-[14px] font-bold text-texto-2">
          Serviço
          <select value={servico} onChange={(e) => setServico(e.target.value)} className={campoBase + " max-w-72 font-semibold text-grafite"}>
            <option value="">Todos os serviços</option>
            {servicos.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-11 cursor-pointer items-center gap-2.5 text-[15px] font-semibold">
          <input type="checkbox" checked={soSemHorario} onChange={(e) => setSoSemHorario(e.target.checked)} className="h-5 w-5 accent-[var(--color-onix)]" />
          Só quem ainda não marcou
        </label>
        {faixa && (
          <button onClick={() => setFaixa(null)} className={botao}>
            Ver todas as faixas
          </button>
        )}
      </div>

      {visiveis.map((f) => {
        const linhas = base.filter((m) => m.faixa === f.chave);
        if (linhas.length === 0 && !faixa) return null;
        return (
          <section key={f.chave} className="mt-7">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-[19px] font-bold tracking-[-0.02em]">{f.titulo}</h2>
              <Chip tom={linhas.length > 0 ? TOM[f.chave] : "neutro"}>
                {linhas.length} {linhas.length === 1 ? "cliente" : "clientes"}
              </Chip>
              <span className="text-[14px] text-apoio">{f.detalhe}</span>
            </div>
            <div className={`${cartao} overflow-x-auto`}>
              <table className="w-full text-left text-[15px]">
                <thead className="border-b border-borda bg-campo/50 text-[13px] text-texto-2">
                  <tr>
                    <th className="px-5 py-3 font-bold">Cliente</th>
                    <th className="px-4 py-3 font-bold">Serviço que vence</th>
                    <th className="px-4 py-3 font-bold">Última vez</th>
                    <th className="px-4 py-3 font-bold">Retorno</th>
                    <th className="w-44 px-4 py-3 font-bold">Intervalo já passado</th>
                    <th className="px-4 py-3 font-bold">Horário</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda">
                  {linhas.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-8 text-center text-texto-2">
                        Nenhuma cliente nesta faixa.
                      </td>
                    </tr>
                  )}
                  {linhas.map((m) => (
                    <tr key={m.clienteId} className="align-top hover:bg-campo/40">
                      <td className="px-5 py-3">
                        <Link href={`/clientes/${m.clienteId}`} className="-my-2.5 inline-block py-2.5 font-bold underline-offset-4 hover:underline">
                          {m.nome?.trim() || "Sem nome"}
                        </Link>
                        <span className="block text-[14px] whitespace-nowrap text-apoio">{formatarTelefone(m.telefone)}</span>
                        <Etiquetas etiquetas={m.etiquetas} className="mt-1.5" />
                      </td>
                      <td className="px-4 py-3">{m.servico}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatarData(m.ultimaVez)}
                        <span className="block text-[14px] text-apoio">{haQuantoTempo(m.ultimaVez)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatarData(m.retorno)}
                        <span className={`block text-[14px] font-bold ${TEXTO[m.faixa]}`}>{textoFaltam(m)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="block font-bold tabular-nums">{Math.round(m.ciclo * 100)}%</span>
                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-campo" aria-hidden="true">
                          <div className={`h-full rounded-full ${BARRA[m.faixa]}`} style={{ width: `${m.ciclo * 100}%` }} />
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {m.marcado ? (
                          <Chip tom="ok">
                            marcado {formatarData(m.marcado).slice(0, 5)} {formatarHora(m.marcado)}
                          </Chip>
                        ) : (
                          <Chip tom={TOM[m.faixa]}>ainda não marcou</Chip>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      {base.length === 0 && !faixa && <p className={`${cartao} mt-5 px-5 py-8 text-center text-texto-2`}>Nenhuma manutenção para acompanhar com esses filtros.</p>}
    </>
  );
}
