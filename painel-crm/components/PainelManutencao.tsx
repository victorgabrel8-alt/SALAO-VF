"use client";

import Link from "next/link";
import { useState } from "react";
import { Etiquetas } from "@/components/Etiquetas";
import { useEmpresa } from "@/lib/empresa";
import { formatarData, formatarHora, formatarTelefone, haQuantoTempo, prazo } from "@/lib/formato";
import { FAIXAS, useManutencoes, type Faixa, type Manutencao } from "@/lib/manutencao";
import { useTempoReal } from "@/lib/tempoReal";

// Cor de cada faixa: argila = passou, mel = esta semana, cobre = 15 dias, sálvia = depois
const COR: Record<Faixa, { barra: string; texto: string; card: string }> = {
  passou: { barra: "bg-status-atrasada", texto: "text-rose-texto", card: "bg-rose" },
  semana: { barra: "bg-status-chegando", texto: "text-mel-texto", card: "bg-mel" },
  quinzena: { barra: "bg-cobre", texto: "text-cobre-escuro", card: "bg-cobre-claro" },
  mes: { barra: "bg-status-em-dia", texto: "text-salvia-texto", card: "bg-salvia" },
  depois: { barra: "bg-status-sem-visita", texto: "text-texto-2", card: "bg-campo" },
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
  if (dados.erro) return <p className="rounded-xl bg-rose p-4 text-rose-texto">Erro ao ler as manutenções: {dados.erro}</p>;

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
      <div className="mb-4 grid grid-cols-5 gap-3">
        {FAIXAS.map((f) => {
          const ativa = faixa === f.chave;
          return (
            <button
              key={f.chave}
              onClick={() => setFaixa(ativa ? null : f.chave)}
              aria-pressed={ativa}
              className={`rounded-2xl border p-4 text-left transition ${
                ativa ? "border-grafite bg-card shadow-md" : "border-grafite/10 bg-card hover:bg-campo/60"
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-texto-2">
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${COR[f.chave].barra}`} />
                {f.titulo}
              </span>
              <span className="mt-1 block font-serif text-[40px] leading-none font-semibold">{contagem[f.chave]}</span>
              <span className="mt-1 block text-sm text-texto-2">{f.detalhe}</span>
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={servico}
          onChange={(e) => setServico(e.target.value)}
          aria-label="Filtrar por serviço"
          className="h-11 rounded-xl border border-borda bg-card px-3"
        >
          <option value="">Todos os serviços</option>
          {servicos.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="flex h-11 cursor-pointer items-center gap-2 rounded-xl border border-borda bg-card px-4 font-semibold">
          <input
            type="checkbox"
            checked={soSemHorario}
            onChange={(e) => setSoSemHorario(e.target.checked)}
            className="h-5 w-5 accent-[var(--cor-principal)]"
          />
          Só quem ainda não marcou
        </label>
        {faixa && (
          <button onClick={() => setFaixa(null)} className="h-11 rounded-xl px-3 font-semibold text-cobre-escuro hover:underline">
            Ver todas as faixas
          </button>
        )}
      </div>

      {visiveis.map((f) => {
        const linhas = base.filter((m) => m.faixa === f.chave);
        if (linhas.length === 0 && !faixa) return null;
        return (
          <section key={f.chave} className="mb-6">
            <h2 className="mb-2 flex items-baseline gap-2">
              <span className="font-serif text-2xl font-semibold">{f.titulo}</span>
              <span className="text-texto-2">
                {linhas.length} {linhas.length === 1 ? "cliente" : "clientes"} · {f.detalhe}
              </span>
            </h2>
            <div className="overflow-hidden rounded-2xl border border-grafite/10 bg-card shadow-[0_1px_2px_rgba(33,22,16,0.05),0_4px_14px_rgba(33,22,16,0.05)]">
              <table className="w-full text-left">
                <thead className="bg-campo/60 text-sm text-texto-2">
                  <tr>
                    <th className="px-4 py-3 font-medium">Cliente</th>
                    <th className="px-4 py-3 font-medium">Telefone</th>
                    <th className="px-4 py-3 font-medium">Serviço que vence</th>
                    <th className="px-4 py-3 font-medium">Última vez</th>
                    <th className="px-4 py-3 font-medium">Retorno</th>
                    <th className="w-48 px-4 py-3 font-medium">Ciclo</th>
                    <th className="px-4 py-3 font-medium">Horário</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda/60">
                  {linhas.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-texto-2">
                        Nenhuma cliente nesta faixa.
                      </td>
                    </tr>
                  )}
                  {linhas.map((m) => (
                    <tr key={m.clienteId} className="align-top hover:bg-campo/60">
                      <td className="px-4 py-3">
                        <Link href={`/clientes/${m.clienteId}`} className="font-semibold hover:underline">
                          {m.nome ?? "Sem nome"}
                        </Link>
                        <Etiquetas etiquetas={m.etiquetas} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-texto-2">{formatarTelefone(m.telefone)}</td>
                      <td className="px-4 py-3">{m.servico}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatarData(m.ultimaVez)}
                        <span className="block text-sm text-texto-2">{haQuantoTempo(m.ultimaVez)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatarData(m.retorno)}
                        <span className={`block text-sm font-semibold ${COR[m.faixa].texto}`}>{textoFaltam(m)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="mt-2 h-2 overflow-hidden rounded-full bg-campo"
                          role="img"
                          aria-label={`${Math.round(m.ciclo * 100)}% do intervalo de retorno já passou`}
                        >
                          <div className={`h-full rounded-full ${COR[m.faixa].barra}`} style={{ width: `${m.ciclo * 100}%` }} />
                        </div>
                        <span className="mt-1 block text-sm text-texto-2">{Math.round(m.ciclo * 100)}% do intervalo</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {m.marcado ? (
                          <span className="inline-flex rounded-full bg-salvia px-2.5 py-0.5 text-sm font-semibold text-salvia-texto">
                            marcado {formatarData(m.marcado).slice(0, 5)} {formatarHora(m.marcado)}
                          </span>
                        ) : (
                          <span className={`inline-flex rounded-full px-2.5 py-0.5 text-sm font-semibold ${COR[m.faixa].card} ${COR[m.faixa].texto}`}>
                            ainda não marcou
                          </span>
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
      {base.length === 0 && !faixa && (
        <p className="rounded-2xl border border-grafite/10 bg-card px-4 py-8 text-center text-texto-2">
          Nenhuma manutenção para acompanhar com esses filtros.
        </p>
      )}
    </>
  );
}
