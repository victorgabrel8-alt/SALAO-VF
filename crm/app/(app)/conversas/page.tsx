"use client";

import Link from "next/link";
import { TelaDaAba } from "@/components/TelaDaAba";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useEmpresa } from "@/lib/empresa";
import { buscarExcluidas } from "@/lib/excluidas";
import { dataNoSalao, formatarData, formatarHora, formatarTelefone, hojeNoSalao } from "@/lib/formato";
import { situacaoIa } from "@/lib/ia";
import { supabase } from "@/lib/supabase/client";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

// Lista no estilo do WhatsApp no iPhone: título grande, busca, abas Todas / Esperando você e as
// conversas em linhas (quem espera a dona vem primeiro, com bolinha vermelha). Deslizar uma linha
// para o lado mostra Ficha e WhatsApp.

// Linha da view conversas: a última mensagem de cada cliente
type Conversa = {
  cliente_id: string;
  nome: string | null;
  telefone: string;
  ia_pausada: boolean;
  motivo_pausa: string | null;
  ultimo_autor: "cliente" | "ia" | "humano";
  ultima_mensagem: string | null;
  ultima_mensagem_em: string;
};

const CAMPOS = "cliente_id, nome, telefone, ia_pausada, motivo_pausa, ultimo_autor, ultima_mensagem, ultima_mensagem_em";

// A lista traz só as conversas mais recentes (com o salão crescendo, trazer todas pesaria no
// celular a cada mensagem nova). As pausadas e as que precisam de você vêm sempre, mesmo
// antigas; as outras a Gleide acha pela busca, que procura no banco.
const LIMITE = 100;
const LIMITE_BUSCA = 50;

type Resultado = { conversas: Conversa[]; total: number; cortada: boolean } | { erro: string };

const maisRecente = (a: Conversa, b: Conversa) => Date.parse(b.ultima_mensagem_em) - Date.parse(a.ultima_mensagem_em);

// Conversas do salão sem as clientes excluídas (o filtro vai para o banco, para não gastar o limite)
async function consultaConversas(empresaId: string) {
  const { excluidas } = await buscarExcluidas(empresaId);
  const ids = excluidas.map((c) => c.id);
  return (select: string, opcoes?: { count: "exact"; head: true }) => {
    const q = supabase().from("conversas").select(select, opcoes).eq("empresa_id", empresaId);
    return ids.length ? q.not("cliente_id", "in", `(${ids.join(",")})`) : q;
  };
}

async function buscarConversas(empresaId: string): Promise<Resultado> {
  const conversas = await consultaConversas(empresaId);
  const [recentes, pausadas, contagem] = await Promise.all([
    conversas(CAMPOS).order("ultima_mensagem_em", { ascending: false }).limit(LIMITE),
    conversas(CAMPOS).eq("ia_pausada", true),
    conversas("cliente_id", { count: "exact", head: true }),
  ]);
  const erro = recentes.error ?? pausadas.error;
  if (erro) return { erro: erro.message };
  const maisNovas = (recentes.data ?? []) as unknown as Conversa[];
  const porCliente = new Map<string, Conversa>();
  for (const c of [...maisNovas, ...((pausadas.data ?? []) as unknown as Conversa[])]) porCliente.set(c.cliente_id, c);
  const lista = [...porCliente.values()].sort(maisRecente);
  return { conversas: lista, total: Math.max(contagem.count ?? 0, lista.length), cortada: maisNovas.length === LIMITE };
}

// Busca no banco pelo nome ou pelo telefone (com 3 dígitos ou mais), em todas as conversas
async function procurarConversas(empresaId: string, texto: string): Promise<Conversa[] | { erro: string }> {
  // vírgula, parênteses e curingas quebram o filtro "or" do Supabase
  const termo = texto.replace(/[,()*%\\]/g, " ").trim();
  const digitos = texto.replace(/\D/g, "");
  const ou = [termo && `nome.ilike.*${termo}*`, digitos.length >= 3 && `telefone.like.*${digitos}*`].filter(Boolean).join(",");
  if (!ou) return [];
  const conversas = await consultaConversas(empresaId);
  const { data, error } = await conversas(CAMPOS).or(ou).order("ultima_mensagem_em", { ascending: false }).limit(LIMITE_BUSCA);
  return error ? { erro: error.message } : (data as unknown as Conversa[]);
}

// "14:35" se foi hoje, "Ontem", ou "18/10"
function quando(instante: string): string {
  const dia = dataNoSalao(instante);
  const hoje = hojeNoSalao();
  if (dia === hoje) return formatarHora(instante);
  const ontem = new Date(Date.parse(`${hoje}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (dia === ontem) return "Ontem";
  return formatarData(instante).slice(0, 5);
}

// O app não guarda "lida" nem "favorita": a dona só precisa separar quem está esperando por ela
type Filtro = "todas" | "precisa";

// Prévia da última mensagem em português de gente: "[áudio] Oi..." vira "Áudio: Oi...",
// "[imagem]" vira "Foto" e um joinha sozinho vira "Mandou um joinha"
function Previa({ texto }: { texto: string | null }) {
  if (!texto) return <>Mensagem sem texto</>;
  const audio = texto.match(/^\[(?:á|a)udio\]\s*/i);
  if (audio) return <>{texto.slice(audio[0].length) ? `Áudio: ${texto.slice(audio[0].length)}` : "Mandou um áudio"}</>;
  const imagem = texto.match(/^\[imagem\]\s*/i);
  if (imagem) return <>{texto.slice(imagem[0].length) ? `Foto: ${texto.slice(imagem[0].length)}` : "Mandou uma foto"}</>;
  if (/^👍[🏻-🏿]?$/u.test(texto.trim())) return <>Mandou um joinha</>;
  if (/^❤️?$/u.test(texto.trim())) return <>Mandou um coração</>;
  return <>{texto}</>;
}

// "Cleris Fernanda Gonçalves da Silva" -> "Cleris Fernanda" (telefone fica como está)
function primeiroESegundo(nome: string): string {
  if (/^\(?\d/.test(nome)) return nome;
  const [p, s] = nome.trim().split(/\s+/);
  return s && !["da", "de", "do", "das", "dos", "e"].includes(s.toLowerCase()) ? `${p} ${s}` : p;
}

const LARGURA_ACOES = 156;

// Linha que desliza para a esquerda (como no iPhone) e mostra Ficha e WhatsApp.
// Toque simples abre a conversa; com a linha aberta, um toque só fecha.
function LinhaDeslizante({ conversa: c, aberta, aoAbrir }: { conversa: Conversa; aberta: boolean; aoAbrir: (aberta: boolean) => void }) {
  const router = useRouter();
  const inicio = useRef<{ x: number; y: number } | null>(null);
  const [arrasto, setArrasto] = useState<number | null>(null);
  const situacao = situacaoIa(c.ia_pausada, c.motivo_pausa);
  const precisa = situacao === "precisa";
  const deslocamento = arrasto ?? (aberta ? -LARGURA_ACOES : 0);

  function tocar() {
    if (aberta) aoAbrir(false);
    else router.push(`/conversas/${c.cliente_id}`);
  }

  return (
    <li className="group relative overflow-hidden">
      {/* Atalhos atrás da linha; invisíveis com ela parada, para a cor não vazar pelos cantos do cartão */}
      <div className={`absolute inset-y-0 right-0 flex ${deslocamento === 0 ? "invisible" : ""}`} aria-hidden={!aberta}>
        <Link
          href={`/clientes/${c.cliente_id}`}
          tabIndex={aberta ? 0 : -1}
          className="flex w-[78px] flex-col items-center justify-center gap-1 bg-bronze-escuro text-xs font-semibold text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="8" r="4" />
            <path d="M4 21a8 8 0 0 1 16 0" />
          </svg>
          Ficha
        </Link>
        <button
          onClick={() => abrirWhatsApp(c.telefone)}
          tabIndex={aberta ? 0 : -1}
          className="flex w-[78px] flex-col items-center justify-center gap-1 bg-salvia-texto text-xs font-semibold text-white"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
          </svg>
          WhatsApp
        </button>
      </div>

      <button
        onClick={tocar}
        aria-label={precisa ? `${c.nome ?? formatarTelefone(c.telefone)}, esperando você` : undefined}
        onTouchStart={(e) => {
          inicio.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }}
        onTouchMove={(e) => {
          if (!inicio.current) return;
          const dx = e.touches[0].clientX - inicio.current.x;
          const dy = e.touches[0].clientY - inicio.current.y;
          // Só arrasta quando o gesto é mais para o lado do que para baixo (senão é rolagem)
          if (arrasto === null && Math.abs(dx) < 8) return;
          if (arrasto === null && Math.abs(dy) > Math.abs(dx)) {
            inicio.current = null;
            return;
          }
          const base = aberta ? -LARGURA_ACOES : 0;
          setArrasto(Math.max(-LARGURA_ACOES - 20, Math.min(0, base + dx)));
        }}
        onTouchEnd={() => {
          if (arrasto !== null) aoAbrir(arrasto < -LARGURA_ACOES / 2);
          setArrasto(null);
          inicio.current = null;
        }}
        style={{ transform: `translateX(${deslocamento}px)` }}
        className={`relative flex w-full items-center gap-3 bg-perola text-left active:bg-campo ${arrasto === null ? "transition-transform duration-200" : ""}`}
      >
        <Avatar id={c.cliente_id} nome={c.nome} tamanho="h-11 w-11 text-[16px]" />
        {/* O nome manda; a prévia fica numa linha só. Esperando você: prévia em negrito e bolinha
            vermelha no lugar da data. Bolinha dourada = a última resposta foi da IA */}
        <span className="flex min-w-0 flex-1 items-center gap-3 border-t border-campo py-3.5 group-first:border-t-0">
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[16px] font-bold text-texto">{primeiroESegundo(c.nome ?? formatarTelefone(c.telefone))}</span>
            <span className={`flex min-w-0 items-center gap-1.5 text-[15px] ${precisa ? "font-semibold text-texto" : "text-texto-2"}`}>
              {c.ultimo_autor === "ia" && !precisa && <span role="img" aria-label="Respondido pela IA" className="h-2 w-2 shrink-0 rounded-full bg-ouro-antigo" />}
              <span className="truncate">
                {situacao === "pausada" && <span className="text-rotulo">IA pausada · </span>}
                {c.ultimo_autor === "humano" && "Você: "}
                <Previa texto={c.ultima_mensagem} />
              </span>
            </span>
          </span>
          {precisa ? (
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full bg-atencao" />
          ) : (
            <span className="shrink-0 self-start pt-0.5 text-[13px] text-rotulo">{quando(c.ultima_mensagem_em)}</span>
          )}
        </span>
      </button>
    </li>
  );
}

export default function ConversasPage() {
  return (
    <TelaDaAba>
      <ConversasPageConteudo />
    </TelaDaAba>
  );
}

function ConversasPageConteudo() {
  const empresa = useEmpresa();
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [versao, setVersao] = useState(0);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  // Resultado da busca no banco, com o texto que foi procurado
  const [achadas, setAchadas] = useState<{ texto: string; conversas: Conversa[] } | null>(null);
  // Só uma linha aberta (deslizada) por vez, como no iPhone
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    buscarConversas(empresa.id).then((r) => {
      if (ativo) setResultado(r);
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, versao]);

  // Mensagem nova ou IA pausada/reativada: a lista se atualiza sozinha
  useTempoReal(["mensagens", "clientes"], empresa.id, () => setVersao((v) => v + 1));

  // Busca no banco depois de uma pausa na digitação (não a cada letra)
  const texto = busca.trim();
  useEffect(() => {
    if (!texto) return;
    let ativo = true;
    const espera = setTimeout(() => {
      procurarConversas(empresa.id, texto).then((r) => {
        if (ativo && !("erro" in r)) setAchadas({ texto, conversas: r });
      });
    }, 300);
    return () => {
      ativo = false;
      clearTimeout(espera);
    };
  }, [empresa.id, texto, versao]);

  const conversas = useMemo(() => (resultado && "conversas" in resultado ? resultado.conversas : []), [resultado]);
  const precisam = conversas.filter((c) => situacaoIa(c.ia_pausada, c.motivo_pausa) === "precisa");
  const respondeuIa = conversas.some((c) => c.ultimo_autor === "ia");
  const cortada = Boolean(resultado && "cortada" in resultado && resultado.cortada);

  const lista = useMemo(() => {
    // Com busca: o que o banco achou; enquanto ele não responde, filtra o que já está na tela
    let base = conversas;
    if (texto && achadas?.texto === texto) base = achadas.conversas;
    else if (texto) {
      const termo = texto.toLowerCase();
      const digitos = texto.replace(/\D/g, "");
      base = conversas.filter((c) => (c.nome ?? "").toLowerCase().includes(termo) || (digitos.length >= 3 && c.telefone.includes(digitos)));
    }
    const filtradas = base.filter((c) => filtro === "todas" || situacaoIa(c.ia_pausada, c.motivo_pausa) === "precisa");
    // Quem está esperando a dona vem primeiro (sem busca); o resto segue da mais recente
    if (texto) return filtradas;
    const espera = (c: Conversa) => (situacaoIa(c.ia_pausada, c.motivo_pausa) === "precisa" ? 0 : 1);
    return [...filtradas].sort((x, y) => espera(x) - espera(y));
  }, [conversas, achadas, texto, filtro]);

  return (
    <>
      {/* Título grande no fundo claro, como no iPhone */}
      <header className="flex flex-col gap-3 px-5 pt-6">
        <h1 className="text-[30px] leading-tight font-bold tracking-[-0.035em]">Conversas</h1>
        <label className="flex h-12 items-center gap-2.5 rounded-[14px] bg-campo px-3.5">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7A5870" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <span className="sr-only">Pesquisar conversa</span>
          <input
            type="search"
            placeholder="Pesquisar"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="h-full min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[#7A5870]"
          />
        </label>
        {/* Duas abas de texto: todas ou só quem está esperando a dona */}
        <div role="group" aria-label="Filtrar conversas" className="flex gap-6">
          {(
            [
              { chave: "todas", rotulo: "Todas" },
              { chave: "precisa", rotulo: precisam.length ? `Esperando você · ${precisam.length}` : "Esperando você" },
            ] as { chave: Filtro; rotulo: string }[]
          ).map((f) => {
            const ativo = filtro === f.chave;
            return (
              <button
                key={f.chave}
                onClick={() => setFiltro(f.chave)}
                aria-pressed={ativo}
                className={`h-11 border-b-2 text-[15px] transition-colors duration-200 ${
                  ativo ? "border-grafite font-extrabold text-texto" : "border-transparent font-semibold text-rotulo"
                }`}
              >
                {f.rotulo}
              </button>
            );
          })}
        </div>
      </header>

      {!resultado && <p className="carregando-calmo px-5 pt-5 text-texto-2">Carregando…</p>}
      {resultado && "erro" in resultado && <p className="m-4 rounded-2xl bg-rose p-4 text-rose-texto">Erro ao ler as conversas: {resultado.erro}</p>}

      {resultado && "conversas" in resultado && (
        <section className="chegar-suave">
          {lista.length === 0 ? (
            <p className="mx-5 mt-8 text-center text-[15px] text-texto-2">
              {busca.trim() ? "Nenhuma conversa encontrada." : filtro === "precisa" ? "Ninguém esperando você agora." : "Nenhuma conversa ainda."}
            </p>
          ) : (
            <ul className="mx-5 mt-1 overflow-hidden border-t border-borda">
              {lista.map((c) => (
                <LinhaDeslizante
                  key={c.cliente_id}
                  conversa={c}
                  aberta={aberta === c.cliente_id}
                  aoAbrir={(abrir) => setAberta(abrir ? c.cliente_id : null)}
                />
              ))}
            </ul>
          )}
          {respondeuIa && lista.length > 0 && (
            <p className="mx-5 mt-4 flex items-center gap-2 text-[13px] text-rotulo">
              <span aria-hidden className="h-2 w-2 rounded-full bg-ouro-antigo" />
              Respondido pela IA · deslize uma conversa para ver Ficha e WhatsApp
            </p>
          )}
          {cortada && !texto && filtro === "todas" && (
            <p className="px-5 pt-2 pb-2 text-center text-xs text-texto-2">
              Mostrando as {LIMITE} conversas mais recentes. Para achar uma mais antiga, use a busca.
            </p>
          )}
        </section>
      )}
    </>
  );
}
