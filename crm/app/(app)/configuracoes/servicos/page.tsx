"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useDialogo } from "@/components/Dialogo";
import { Folha } from "@/components/Folha";
import { useEmpresa } from "@/lib/empresa";
import { categoriasDo, exemploServico, nichoDa, type Categoria } from "@/lib/nicho";
import { supabase } from "@/lib/supabase/client";

// Serviços e preços: a Gleide muda valor, duração e retorno sem depender da gente. A IA lê esta
// tabela a cada conversa (preço que ela fala e duração que ela reserva na agenda) e o retorno
// previsto de cada cliente sai de dias_retorno. Serviço que sai de linha é desativado, não apagado:
// os atendimentos antigos continuam apontando para ele. a_partir_de (ligado por padrão): o preço é o
// menor e o final depende do cabelo, a Gleide confirma olhando; a IA fala "a partir de".

type Servico = {
  id: string;
  nome: string;
  categoria: string;
  preco: number | null;
  duracao_min: number;
  dias_retorno: number | null;
  ativo: boolean;
  a_partir_de: boolean;
};

function preco(valor: number | null, aPartirDe = false): string {
  if (valor === null) return "sem preço";
  if (valor === 0) return "gratuito";
  const reais = `R$ ${valor.toLocaleString("pt-BR", { minimumFractionDigits: valor % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
  return aPartirDe ? `a partir de ${reais}` : reais;
}

function duracao(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

// Na lista, o título da seção já diz a categoria: "Manutenção – queratina" aparece como "Queratina"
function nomeCurto(nome: string, categoria: string, categorias: Categoria[]): string {
  const c = categorias.find((x) => x.id === categoria)?.nome ?? "";
  const resto = c && nome.toLowerCase().startsWith(c.toLowerCase()) ? nome.slice(c.length).replace(/^\s*[–—-]\s*/, "") : "";
  return resto ? resto[0].toUpperCase() + resto.slice(1) : nome;
}

// Durações de 30 em 30 min (até 8h); a atual entra na lista se for diferente
const DURACOES = Array.from({ length: 16 }, (_, i) => (i + 1) * 30);

async function buscarServicos(empresaId: string): Promise<{ servicos: Servico[] } | { erro: string }> {
  const { data, error } = await supabase()
    .from("servicos")
    .select("id, nome, categoria, preco, duracao_min, dias_retorno, ativo, a_partir_de")
    .eq("empresa_id", empresaId)
    .order("nome");
  if (error) return { erro: error.message };
  return { servicos: (data ?? []).map((s) => ({ ...s, preco: s.preco === null ? null : Number(s.preco) })) as Servico[] };
}

export default function ServicosPage() {
  const empresa = useEmpresa();
  const categorias = categoriasDo(nichoDa(empresa));
  const [servicos, setServicos] = useState<Servico[] | null>(null);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState<Servico | "novo" | null>(null);
  const [verDesativados, setVerDesativados] = useState(false);

  // versao muda depois de salvar: a lista é buscada de novo
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    let ativo = true;
    buscarServicos(empresa.id).then((r) => {
      if (!ativo) return;
      if ("erro" in r) setErro(r.erro);
      else setServicos(r.servicos);
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, versao]);
  const carregar = () => setVersao((v) => v + 1);

  const ativos = (servicos ?? []).filter((s) => s.ativo);
  const desativados = (servicos ?? []).filter((s) => !s.ativo);

  return (
    <>
      <header className="flex flex-col gap-3 px-4 pt-4">
        <Link href="/configuracoes" className="vidro flex h-10 w-fit items-center gap-0.5 rounded-full pr-4 pl-2.5 text-[15px] font-semibold active:scale-95">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="m15 18-6-6 6-6" />
          </svg>
          Configurações
        </Link>
        <div>
          <h1 className="font-serif text-[34px] leading-tight font-semibold">Serviços e preços</h1>
          <p className="text-sm text-texto-2">A IA usa estes preços nas conversas. Toque num serviço para mudar.</p>
        </div>
      </header>

      <div className="flex flex-col gap-4 px-4 pt-5">
        {erro && <p className="rounded-2xl bg-rose p-3 text-rose-texto">Não foi possível carregar: {erro}</p>}
        {!servicos && !erro && <p className="text-[15px] text-texto-2">Carregando…</p>}

        {categorias.map((c) => {
          const lista = ativos.filter((s) => (categorias.some((x) => x.id === s.categoria) ? s.categoria : "outro") === c.id);
          if (!lista.length) return null;
          return (
            <section key={c.id} className="flex flex-col gap-2">
              <span className="rotulo text-texto-2">{c.nome}</span>
              <Lista servicos={lista} categorias={categorias} aoTocar={setEditando} />
            </section>
          );
        })}

        {desativados.length > 0 && (
          <section className="flex flex-col gap-2">
            <button onClick={() => setVerDesativados(!verDesativados)} className="rotulo w-fit text-texto-2">
              {verDesativados ? "Esconder" : "Ver"} desativados · {desativados.length}
            </button>
            {verDesativados && <Lista servicos={desativados} categorias={categorias} aoTocar={setEditando} />}
          </section>
        )}

        {servicos && (
          <button
            onClick={() => setEditando("novo")}
            className="flex h-14 items-center justify-center gap-2 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98]"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Novo serviço
          </button>
        )}
      </div>

      {editando && (
        <EditarServico
          servico={editando === "novo" ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
    </>
  );
}

function Lista({ servicos, categorias, aoTocar }: { servicos: Servico[]; categorias: Categoria[]; aoTocar: (s: Servico) => void }) {
  return (
    <ul className="overflow-hidden rounded-[22px] bg-card borda-suave">
      {servicos.map((s, i) => (
        <li key={s.id} className={i > 0 ? "border-t border-borda" : ""}>
          <button onClick={() => aoTocar(s)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left active:bg-campo">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className={`text-[16px] leading-snug font-semibold ${s.ativo ? "" : "text-texto-2 line-through"}`}>{nomeCurto(s.nome, s.categoria, categorias)}</span>
              <span className="text-[13px] text-texto-2">{duracao(s.duracao_min)}</span>
            </span>
            <span className="flex shrink-0 flex-col items-end">
              {s.a_partir_de && !!s.preco && <span className="text-[11px] text-texto-2">a partir de</span>}
              <span className="text-[16px] font-semibold">{preco(s.preco)}</span>
            </span>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-texto-2" aria-hidden>
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}

// Folha para criar ou mudar um serviço
function EditarServico({ servico, aoFechar, aoSalvar }: { servico: Servico | null; aoFechar: () => void; aoSalvar: () => void }) {
  const empresa = useEmpresa();
  const nicho = nichoDa(empresa);
  const { dialogo, perguntar } = useDialogo();
  const [nome, setNome] = useState(servico?.nome ?? "");
  const [categoria, setCategoria] = useState(servico?.categoria ?? "outro");
  const [valor, setValor] = useState(servico?.preco === null || servico?.preco === undefined ? "" : String(servico.preco).replace(".", ","));
  const [minutos, setMinutos] = useState(String(servico?.duracao_min ?? 60));
  const [retorno, setRetorno] = useState(servico?.dias_retorno ? String(servico.dias_retorno) : "");
  const [aPartirDe, setAPartirDe] = useState(servico?.a_partir_de ?? true);
  // Tipo e retorno quase nunca mudam: ficam escondidos em "Mais opções" (no serviço novo, aparecem)
  const [maisOpcoes, setMaisOpcoes] = useState(!servico);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function gravar(mudanca: Partial<Servico>) {
    setSalvando(true);
    setErro("");
    const db = supabase().from("servicos");
    const { error } = servico ? await db.update(mudanca).eq("id", servico.id) : await db.insert({ ...mudanca, empresa_id: empresa.id, ativo: true });
    setSalvando(false);
    if (error) setErro(error.message);
    else aoSalvar();
  }

  function salvar() {
    const n = nome.trim();
    const p = valor.trim() === "" ? null : Number(valor.replace(/\./g, "").replace(",", "."));
    const d = Number(minutos);
    const r = retorno.trim() === "" ? null : Number(retorno);
    if (!n) return setErro("Escreva o nome do serviço.");
    if (p !== null && (!Number.isFinite(p) || p < 0)) return setErro("Preço inválido. Use só números, ex.: 150 ou 89,90.");
    if (!Number.isInteger(d) || d < 15 || d > 600) return setErro("Escolha a duração.");
    if (r !== null && (!Number.isInteger(r) || r < 1 || r > 365)) return setErro("O retorno precisa ser entre 1 e 365 dias (ou vazio).");
    gravar({ nome: n, categoria, preco: p, duracao_min: d, dias_retorno: r, a_partir_de: aPartirDe });
  }

  async function trocarAtivo() {
    if (!servico) return;
    if (servico.ativo) {
      const ok = await perguntar(`Desativar "${servico.nome}"? A IA para de oferecer e ele some da lista de serviços. Os atendimentos antigos continuam.`, {
        confirmar: "Desativar",
      });
      if (!ok) return;
    }
    gravar({ ativo: !servico.ativo });
  }

  const campo = "h-12 w-full rounded-full bg-card px-4 text-[16px] font-semibold outline-none borda-suave";

  return (
    <Folha rotulo={servico ? "Editar serviço" : "Novo serviço"} aoFechar={aoFechar} className="bg-[var(--background)] px-5">
      <div className="flex flex-col gap-4 pt-1 pb-5">
        <h2 className="font-serif text-[26px] leading-tight font-semibold">{servico ? "Editar serviço" : "Novo serviço"}</h2>

        <label className="flex flex-col gap-1.5">
          <span className="rotulo text-texto-2">Nome</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder={exemploServico(nicho)} className={campo} />
        </label>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="flex flex-col gap-1.5">
            <span className="rotulo text-texto-2">Preço (R$)</span>
            <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0 = grátis" className={campo} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="rotulo text-texto-2">Duração</span>
            <select value={minutos} onChange={(e) => setMinutos(e.target.value)} className={campo}>
              {[...new Set([...DURACOES, Number(minutos)])]
                .filter((m) => m >= 15)
                .sort((a, b) => a - b)
                .map((m) => (
                  <option key={m} value={String(m)}>
                    {duracao(m)}
                  </option>
                ))}
            </select>
          </label>
        </div>

        <button
          onClick={() => setAPartirDe(!aPartirDe)}
          role="switch"
          aria-checked={aPartirDe}
          className="flex items-center justify-between gap-3 rounded-full bg-card py-2.5 pr-2.5 pl-4 text-left borda-suave"
        >
          <span className="flex flex-col">
            <span className="text-[16px] font-semibold">Preço &quot;a partir de&quot;</span>
            <span className="text-[13px] text-texto-2">{aPartirDe ? "Use o menor valor que você cobra" : "Preço fixo, a IA fala o valor exato"}</span>
          </span>
          <span aria-hidden className={`relative h-8 w-14 shrink-0 rounded-full transition-colors ${aPartirDe ? "bg-grafite" : "bg-neutral-300"}`}>
            <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all ${aPartirDe ? "left-7" : "left-1"}`} />
          </span>
        </button>

        <p className="-mt-1 rounded-2xl bg-campo px-4 py-3 text-[14px] text-texto-2">
          A IA fala:{" "}
          <span className="font-semibold text-texto">
            {valor.trim() === "" ? "sem preço (não informa valor)" : preco(Number(valor.replace(/\./g, "").replace(",", ".")) || 0, aPartirDe)}
          </span>{" "}
          · reserva {duracao(Number(minutos))} na agenda
        </p>

        {!maisOpcoes && (
          <button onClick={() => setMaisOpcoes(true)} className="h-10 w-fit text-[15px] font-semibold text-texto-2 underline underline-offset-4">
            Mais opções
          </button>
        )}
        {maisOpcoes && (
          <>
            <div className="flex flex-col gap-2">
              <span className="rotulo text-texto-2">Tipo</span>
              <div className="flex flex-wrap gap-2">
                {categoriasDo(nicho).map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setCategoria(c.id)}
                    aria-pressed={categoria === c.id}
                    className={`h-10 rounded-full px-4 text-[14px] font-semibold transition-colors ${categoria === c.id ? "chip-ativo" : "bg-card text-texto borda-suave"}`}
                  >
                    {c.nome}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="rotulo text-texto-2">Cliente volta depois de quantos dias</span>
              <input inputMode="numeric" value={retorno} onChange={(e) => setRetorno(e.target.value.replace(/\D/g, ""))} placeholder="Vazio = não tem retorno" className={campo} />
            </label>
          </>
        )}

        {erro && <p className="rounded-2xl bg-rose p-3 text-rose-texto">{erro}</p>}
        <button
          onClick={salvar}
          disabled={salvando}
          className="h-14 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98] disabled:opacity-50"
        >
          {salvando ? "Salvando…" : servico ? "Salvar" : "Criar serviço"}
        </button>
        {servico && (
          <button onClick={trocarAtivo} disabled={salvando} className={`h-11 text-[15px] font-semibold disabled:opacity-50 ${servico.ativo ? "text-rose-texto" : "text-texto"}`}>
            {servico.ativo ? "Desativar serviço" : "Reativar serviço"}
          </button>
        )}
        <button onClick={aoFechar} className="h-11 text-[16px] font-semibold text-texto-2">
          Cancelar
        </button>
      </div>
      {dialogo}
    </Folha>
  );
}
