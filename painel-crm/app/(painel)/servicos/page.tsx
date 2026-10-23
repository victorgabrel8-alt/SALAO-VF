"use client";

import { useEffect, useState } from "react";
import { useEmpresa } from "@/lib/empresa";
import { supabase } from "@/lib/supabase/client";

// Serviços do salão: a base de informação que a IA lê para marcar e que o banco usa para o
// retorno (data do atendimento + dias de retorno). Mudou aqui, a IA segue na próxima conversa.
// Categoria e regra para a IA vêm do supabase/004 e a linha do 007; sem eles no banco, essas
// colunas não aparecem.

type Servico = {
  id: string;
  nome: string;
  preco: number | null;
  duracao_min: number;
  dias_retorno: number | null;
  ativo: boolean;
  categoria?: string;
  regra_ia?: string | null;
  linha?: string | null;
};

const CATEGORIAS = [
  { chave: "avaliacao", rotulo: "Avaliação" },
  { chave: "aplicacao", rotulo: "Aplicação" },
  { chave: "manutencao", rotulo: "Manutenção" },
  { chave: "quimica", rotulo: "Química" },
  { chave: "tratamento", rotulo: "Tratamento" },
  { chave: "venda", rotulo: "Venda" },
  { chave: "outro", rotulo: "Outro" },
];

const BASE = "id, nome, preco, duracao_min, dias_retorno, ativo";

async function buscarServicos(empresaId: string) {
  const db = supabase();
  // Quais colunas novas já existem no banco
  const existe = async (colunas: string) => !(await db.from("servicos").select(colunas).eq("empresa_id", empresaId).limit(1)).error;
  const [com004, com007] = await Promise.all([existe("categoria, regra_ia"), existe("linha")]);
  const campos = [BASE, ...(com004 ? ["categoria, regra_ia"] : []), ...(com007 ? ["linha"] : [])].join(", ");
  const { data, error } = await db.from("servicos").select(campos).eq("empresa_id", empresaId).order("nome");
  return { servicos: (data ?? []) as unknown as Servico[], com004, com007, erro: error?.message };
}

// Número do campo: vazio = null
function numero(texto: string): number | null {
  const n = Number(texto.replace(",", "."));
  return texto.trim() === "" || !Number.isFinite(n) ? null : n;
}

export default function ServicosPage() {
  const empresa = useEmpresa();
  const [dados, setDados] = useState<{ servicos: Servico[]; com004: boolean; com007: boolean; erro?: string } | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let ativo = true;
    buscarServicos(empresa.id).then((r) => {
      if (ativo) setDados(r);
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, versao]);

  return (
    <>
      <div className="pt-8 pb-4">
        <h1 className="font-serif text-[40px] leading-tight font-semibold">Serviços</h1>
        <p className="text-texto-2">
          O que a IA oferece e marca, e em quantos dias cada serviço pede retorno · {empresa.nome}
        </p>
      </div>

      {!dados && <p className="py-8 text-texto-2">Carregando…</p>}
      {dados?.erro && <p className="rounded-xl bg-rose p-4 text-rose-texto">Erro ao ler os serviços: {dados.erro}</p>}
      {dados && !dados.com004 && (
        <p className="mb-4 rounded-xl bg-mel p-4 text-mel-texto">
          Categoria e regra para a IA aparecem quando o <b>004_avaliacoes_ia</b> for rodado no banco.
        </p>
      )}

      {dados && !dados.erro && (
        <div className="overflow-hidden rounded-2xl border border-grafite/10 bg-card shadow-[0_1px_2px_rgba(33,22,16,0.05),0_4px_14px_rgba(33,22,16,0.05)]">
          <table className="w-full text-left">
            <thead className="bg-campo/60 text-sm text-texto-2">
              <tr>
                <th className="px-4 py-3 font-medium">Serviço</th>
                {dados.com004 && <th className="px-4 py-3 font-medium">Categoria</th>}
                <th className="w-28 px-4 py-3 font-medium">Preço (R$)</th>
                <th className="w-28 px-4 py-3 font-medium">Duração (min)</th>
                <th className="w-28 px-4 py-3 font-medium">Retorno (dias)</th>
                {dados.com007 && (
                  <th className="px-4 py-3 font-medium" title="Serviços com a mesma linha cumprem a manutenção um do outro">
                    Linha
                  </th>
                )}
                {dados.com004 && <th className="px-4 py-3 font-medium">Regra para a IA</th>}
                <th className="w-20 px-4 py-3 font-medium">Ativo</th>
                <th className="w-28 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-borda/60">
              {dados.servicos.map((s) => (
                <LinhaServico key={s.id} servico={s} com004={dados.com004} com007={dados.com007} aoSalvar={() => setVersao((v) => v + 1)} />
              ))}
              <LinhaServico
                key={`novo-${versao}`}
                servico={null}
                com004={dados.com004}
                com007={dados.com007}
                empresaId={empresa.id}
                aoSalvar={() => setVersao((v) => v + 1)}
              />
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-sm text-texto-2">
        Retorno vazio = serviço sem retorno (ex.: avaliação). O retorno novo vale para os próximos atendimentos concluídos.
        {dados?.com007 &&
          " Linha: serviços com a mesma linha cumprem a manutenção um do outro (ex.: aplicação e manutenção de queratina). Vazio = o próprio serviço."}
      </p>
    </>
  );
}

// Uma linha editável; a última (servico = null) cadastra um serviço novo
function LinhaServico({
  servico,
  com004,
  com007,
  empresaId,
  aoSalvar,
}: {
  servico: Servico | null;
  com004: boolean;
  com007: boolean;
  empresaId?: string;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState(servico?.nome ?? "");
  const [categoria, setCategoria] = useState(servico?.categoria ?? "outro");
  const [preco, setPreco] = useState(servico?.preco?.toString() ?? "");
  const [duracao, setDuracao] = useState(servico?.duracao_min.toString() ?? "60");
  const [retorno, setRetorno] = useState(servico?.dias_retorno?.toString() ?? "");
  const [regra, setRegra] = useState(servico?.regra_ia ?? "");
  const [linha, setLinha] = useState(servico?.linha ?? "");
  const [ativo, setAtivo] = useState(servico?.ativo ?? true);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  const mudou =
    !servico ||
    nome !== servico.nome ||
    (com004 && (categoria !== (servico.categoria ?? "outro") || regra !== (servico.regra_ia ?? ""))) ||
    (com007 && linha !== (servico.linha ?? "")) ||
    numero(preco) !== servico.preco ||
    numero(duracao) !== servico.duracao_min ||
    numero(retorno) !== servico.dias_retorno ||
    ativo !== servico.ativo;

  async function salvar() {
    setAviso("");
    const dur = numero(duracao);
    const ret = numero(retorno);
    if (!nome.trim()) return setAviso("Dê um nome ao serviço.");
    if (!dur || dur <= 0 || !Number.isInteger(dur)) return setAviso("Duração em minutos inteiros.");
    if (ret !== null && (ret <= 0 || !Number.isInteger(ret))) return setAviso("Retorno em dias inteiros, ou vazio.");
    setSalvando(true);
    const campos = {
      nome: nome.trim(),
      preco: numero(preco),
      duracao_min: dur,
      dias_retorno: ret,
      ativo,
      ...(com004 ? { categoria, regra_ia: regra.trim() || null } : {}),
      ...(com007 ? { linha: linha.trim() || null } : {}),
    };
    const db = supabase();
    const { error } = servico
      ? await db.from("servicos").update(campos).eq("id", servico.id)
      : await db.from("servicos").insert({ ...campos, empresa_id: empresaId });
    setSalvando(false);
    if (error) return setAviso(`Não salvou: ${error.message}`);
    aoSalvar();
  }

  const campo = "h-10 w-full rounded-lg border border-borda bg-card px-2.5 outline-none focus:border-[var(--cor-principal)]";

  return (
    <tr className={`align-top ${servico && !servico.ativo ? "opacity-60" : ""}`}>
      <td className="px-4 py-3">
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={servico ? "" : "+ Novo serviço"}
          aria-label="Nome do serviço"
          className={`${campo} font-semibold`}
        />
        {aviso && <p className="mt-1 text-sm text-rose-texto">{aviso}</p>}
      </td>
      {com004 && (
        <td className="px-4 py-3">
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} aria-label="Categoria" className={campo}>
            {CATEGORIAS.map((c) => (
              <option key={c.chave} value={c.chave}>
                {c.rotulo}
              </option>
            ))}
          </select>
        </td>
      )}
      <td className="px-4 py-3">
        <input inputMode="decimal" value={preco} onChange={(e) => setPreco(e.target.value)} aria-label="Preço" className={campo} />
      </td>
      <td className="px-4 py-3">
        <input inputMode="numeric" value={duracao} onChange={(e) => setDuracao(e.target.value)} aria-label="Duração em minutos" className={campo} />
      </td>
      <td className="px-4 py-3">
        <input
          inputMode="numeric"
          value={retorno}
          onChange={(e) => setRetorno(e.target.value)}
          placeholder="—"
          aria-label="Dias de retorno"
          className={campo}
        />
      </td>
      {com007 && (
        <td className="px-4 py-3">
          <input
            value={linha}
            onChange={(e) => setLinha(e.target.value)}
            placeholder={nome || "—"}
            aria-label="Linha do serviço"
            className={`${campo} min-w-48`}
          />
        </td>
      )}
      {com004 && (
        <td className="px-4 py-3">
          <textarea
            value={regra}
            onChange={(e) => setRegra(e.target.value)}
            rows={2}
            aria-label="Regra para a IA"
            placeholder="Ex.: só marcar depois de uma avaliação"
            className="w-full min-w-64 rounded-lg border border-borda bg-card px-2.5 py-2 text-sm outline-none focus:border-[var(--cor-principal)]"
          />
        </td>
      )}
      <td className="px-4 py-3">
        <input
          type="checkbox"
          checked={ativo}
          onChange={(e) => setAtivo(e.target.checked)}
          aria-label="Serviço ativo"
          className="mt-2.5 h-5 w-5 accent-[var(--cor-principal)]"
        />
      </td>
      <td className="px-4 py-3 text-right">
        {mudou && (servico || nome.trim()) && (
          <button
            onClick={salvar}
            disabled={salvando}
            className="h-10 rounded-lg bg-grafite px-4 font-semibold text-perola disabled:opacity-60"
          >
            {salvando ? "…" : servico ? "Salvar" : "Adicionar"}
          </button>
        )}
      </td>
    </tr>
  );
}
