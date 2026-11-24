"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Cabecalho } from "@/components/Cabecalho";
import { useDialogo } from "@/components/Dialogo";
import { Voltar } from "@/components/Voltar";
import { buscarRepetidos, juntarCadastros, type LadoDoPar, type ParRepetido } from "@/lib/cadastrosRepetidos";
import { useEmpresa, SoDaDona } from "@/lib/empresa";
import { formatarData, formatarTelefone, haQuantoTempo } from "@/lib/formato";

// Cadastros repetidos: a mesma cliente com o número com e sem o 9. A IA acha um cadastro e o horário
// ou a conversa estão no outro. A dona confere cada par, escolhe qual fica (padrão: o com o 9, que é o
// que chega do WhatsApp) e toca em "Juntar". Nada é juntado sozinho (supabase/062).
// login de profissional que não é a dona não mexe aqui (supabase/070)
export default function CadastrosRepetidosPage() {
  return (
    <SoDaDona>
      <CadastrosRepetidosPageConteudo />
    </SoDaDona>
  );
}

function CadastrosRepetidosPageConteudo() {
  const empresa = useEmpresa();
  const [pares, setPares] = useState<ParRepetido[] | null>(null);
  const [erro, setErro] = useState("");
  const [juntados, setJuntados] = useState(0);

  useEffect(() => {
    let ativo = true;
    buscarRepetidos(empresa.id).then((r) => {
      if (!ativo) return;
      setPares(r.pares);
      setErro(r.erro ? `Não foi possível carregar: ${r.erro}` : "");
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id]);

  return (
    <>
      <Cabecalho
        titulo="Cadastros repetidos"
        acao={
          <Voltar para="/configuracoes" className="flex h-11 items-center px-2 text-lg font-semibold text-[var(--cor-principal)]">
            Voltar
          </Voltar>
        }
      />
      <div className="space-y-4 px-4 pb-6">
        <p className="text-texto-2">
          A mesma cliente com dois cadastros: o número com e sem o 9. Confira se é a mesma pessoa, escolha qual cadastro
          fica e toque em Juntar. Os horários, as conversas e os avisos passam para o cadastro que fica, e a IA passa a
          achar tudo num lugar só.
        </p>
        {empresa.papel !== "dona" && (
          <p className="rounded-2xl bg-areia p-4 font-medium text-bronze-escuro">Só a dona do salão pode juntar cadastros.</p>
        )}
        {erro && <p className="rounded-2xl bg-rose p-4 text-rose-texto">{erro}</p>}
        {juntados > 0 && (
          <p className="text-center font-medium">
            {juntados === 1 ? "1 cadastro juntado ✓" : `${juntados} cadastros juntados ✓`}
          </p>
        )}
        {pares === null && !erro && <p className="carregando-calmo text-lg text-rotulo">Carregando…</p>}
        {pares?.length === 0 && !erro && (
          <p className="rounded-2xl border border-borda bg-white p-4 text-center text-texto-2">Nenhum cadastro repetido.</p>
        )}
        {pares?.map((par) => (
          <CartaoPar
            key={`${par.com9.id}-${par.sem9.id}`}
            par={par}
            podeJuntar={empresa.papel === "dona"}
            empresaId={empresa.id}
            aoJuntar={() => {
              setPares((atual) => atual?.filter((p) => p !== par) ?? null);
              setJuntados((n) => n + 1);
            }}
          />
        ))}
      </div>
    </>
  );
}

function nomeDe(l: LadoDoPar): string {
  return l.nome?.trim() || "Sem nome";
}

function CartaoPar({
  par,
  podeJuntar,
  empresaId,
  aoJuntar,
}: {
  par: ParRepetido;
  podeJuntar: boolean;
  empresaId: string;
  aoJuntar: () => void;
}) {
  const { dialogo, perguntar, avisar } = useDialogo();
  // Padrão: fica o com o 9 (é o número que chega do WhatsApp)
  const [ficaCom9, setFicaCom9] = useState(true);
  const [juntando, setJuntando] = useState(false);
  const fica = ficaCom9 ? par.com9 : par.sem9;
  const sai = ficaCom9 ? par.sem9 : par.com9;

  async function juntar() {
    const sim = await perguntar(
      `Juntar os dois cadastros?\n\nFica: ${nomeDe(fica)}, com o número ${formatarTelefone(par.com9.telefone)}.\n` +
        `Os horários, conversas e anotações de ${nomeDe(sai)} (${formatarTelefone(sai.telefone)}) passam para ela, ` +
        `e o cadastro de ${nomeDe(sai)} deixa de existir.\n\nNão dá para desfazer.`,
      { confirmar: "Juntar", perigo: true },
    );
    if (!sim) return;
    setJuntando(true);
    const erro = await juntarCadastros(empresaId, fica.id, sai.id);
    setJuntando(false);
    if (erro) {
      await avisar(`Não foi possível juntar: ${erro}`);
      return;
    }
    aoJuntar();
  }

  return (
    <section className="space-y-3 rounded-2xl border border-borda bg-white p-4">
      <h2 className="text-lg font-semibold">Qual cadastro fica?</h2>
      <div className="grid gap-2" role="radiogroup" aria-label="Qual cadastro fica">
        <Lado lado={par.com9} com9 marcado={ficaCom9} aoEscolher={() => setFicaCom9(true)} />
        <Lado lado={par.sem9} com9={false} marcado={!ficaCom9} aoEscolher={() => setFicaCom9(false)} />
      </div>
      <p className="text-[14px] text-texto-2">
        O cadastro que fica termina com o número com o 9. O nome dele é mantido e as observações das duas são somadas.
      </p>
      {podeJuntar && (
        <button
          onClick={juntar}
          disabled={juntando}
          className="h-12 w-full rounded-xl bg-[var(--cor-principal)] text-lg font-bold text-white disabled:opacity-50"
        >
          {juntando ? "Juntando…" : "Juntar"}
        </button>
      )}
      {dialogo}
    </section>
  );
}

function Lado({ lado, com9, marcado, aoEscolher }: { lado: LadoDoPar; com9: boolean; marcado: boolean; aoEscolher: () => void }) {
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border-2 p-3 ${marcado ? "border-[var(--cor-principal)] bg-campo" : "border-borda"}`}
    >
      <button
        onClick={aoEscolher}
        role="radio"
        aria-checked={marcado}
        aria-label={`Fica ${nomeDe(lado)}, ${com9 ? "com o 9" : "sem o 9"}`}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <span
          aria-hidden
          className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${marcado ? "border-[var(--cor-principal)]" : "border-claro"}`}
        >
          {marcado && <span className="h-2.5 w-2.5 rounded-full bg-[var(--cor-principal)]" />}
        </span>
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate font-semibold">{nomeDe(lado)}</span>
            {marcado && <span className="rounded-full bg-grafite px-2 py-0.5 text-xs font-bold text-white">Fica</span>}
            {lado.excluida && <span className="rounded-full bg-areia px-2 py-0.5 text-xs font-bold text-bronze-escuro">Excluída</span>}
          </span>
          <span className="block text-texto-2">
            {formatarTelefone(lado.telefone)} · {com9 ? "com o 9" : "sem o 9"}
          </span>
          <span className="block text-[14px] text-texto-2">
            {lado.horarios === 1 ? "1 horário" : `${lado.horarios} horários`} ·{" "}
            {lado.mensagens === 1 ? "1 mensagem" : `${lado.mensagens} mensagens`}
          </span>
          <span className="block text-[14px] text-texto-2">
            Última mensagem: {lado.ultimaMensagem ? haQuantoTempo(lado.ultimaMensagem) : "nenhuma"}
            {lado.ultimoHorario && ` · último horário: ${formatarData(lado.ultimoHorario)}`}
          </span>
        </span>
      </button>
      <Link href={`/clientes/${lado.id}`} className="shrink-0 py-1 text-[14px] font-semibold text-[var(--cor-principal)]">
        Ver ficha
      </Link>
    </div>
  );
}
