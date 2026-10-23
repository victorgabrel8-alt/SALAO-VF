"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/Avatar";
import { useDialogo } from "@/components/Dialogo";
import { LinhaDeslizante, type AcaoDeslizante } from "@/components/LinhaDeslizante";
import { SeloPedido, usePedidos } from "@/components/PedidoRemarcacao";
import { buscarProximos, type Atendimento } from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { dataNoSalao, formatarDiaLongo, formatarHora, formatarTelefone, hojeNoSalao, primeiroNome, somarDias } from "@/lib/formato";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

// Próximas: todas as clientes com horário daqui para frente, agrupadas por mês e dia, como a
// lista do Calendário do iPhone. Serve para a Gleide saber quem vem nos próximos meses e, num
// imprevisto (viagem, doença), falar com cada uma. Deslizar a linha mostra WhatsApp e Ficha.

type Periodo = "7" | "30" | "90" | "tudo";

// Faixas que não se repetem: quem aparece em "7 dias" não aparece de novo em "8 a 30".
// de/ate contam dias a partir de hoje (hoje = 0; `ate` fica de fora). Só "Tudo" junta todas.
const PERIODOS: { chave: Periodo; rotulo: string; frase: string; de: number | null; ate: number | null }[] = [
  { chave: "7", rotulo: "7 dias", frase: "nos próximos 7 dias", de: null, ate: 7 },
  { chave: "30", rotulo: "8 a 30", frase: "do 8º ao 30º dia", de: 7, ate: 30 },
  { chave: "90", rotulo: "31 a 90", frase: "do 31º ao 90º dia", de: 30, ate: 90 },
  { chave: "tudo", rotulo: "Tudo", frase: "daqui para frente", de: null, ate: null },
];

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function nomeDe(a: Atendimento): string {
  return a.clientes?.nome ?? (a.clientes ? formatarTelefone(a.clientes.telefone) : "Cliente");
}

// "Hoje", "Amanhã" ou "Sexta-feira, 24 de outubro"
function tituloDoDia(dia: string): string {
  const hoje = hojeNoSalao();
  if (dia === hoje) return "Hoje";
  if (dia === somarDias(hoje, 1)) return `Amanhã · ${formatarDiaLongo(dia).toLowerCase()}`;
  return formatarDiaLongo(dia);
}

// Mensagem pronta para a Gleide completar no WhatsApp, já falando do horário certo
function mensagemSobreHorario(a: Atendimento): string {
  const dia = dataNoSalao(a.inicio);
  const quando = dia === somarDias(hojeNoSalao(), 1) ? "amanhã" : `${formatarDiaLongo(dia).toLowerCase()}`;
  const nome = a.clientes?.nome ? `, ${primeiroNome(a.clientes.nome)}` : "";
  return `Oi${nome}! Tudo bem? Sobre o seu horário de ${quando} às ${formatarHora(a.inicio)}: `;
}

function acoesDe(a: Atendimento, abrirFicha: () => void, pedirRemarcacao: () => void): AcaoDeslizante[] {
  const cliente = a.clientes;
  if (!cliente) return [];
  return [
    // Imprevisto: grava o pedido e abre o WhatsApp com a mensagem; a resposta dela cai na IA
    {
      rotulo: "Remarcar",
      cor: "bg-grafite",
      aoTocar: pedirRemarcacao,
      icone: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
        </svg>
      ),
    },
    {
      rotulo: "Ficha",
      cor: "bg-bronze-escuro",
      aoTocar: abrirFicha,
      icone: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      ),
    },
    {
      rotulo: "WhatsApp",
      cor: "bg-salvia-texto",
      aoTocar: () => abrirWhatsApp(cliente.telefone, mensagemSobreHorario(a)),
      icone: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </svg>
      ),
    },
  ];
}

export default function ProximasPage() {
  const empresa = useEmpresa();
  const router = useRouter();
  const [periodo, setPeriodo] = useState<Periodo>("7");
  const [resultado, setResultado] = useState<{ chave: Periodo; atendimentos: Atendimento[] } | { erro: string } | null>(null);
  const [versao, setVersao] = useState(0);
  const [aberta, setAberta] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    const { de, ate } = PERIODOS.find((p) => p.chave === periodo)!;
    const hoje = hojeNoSalao();
    buscarProximos(empresa.id, ate === null ? null : somarDias(hoje, ate), de === null ? null : somarDias(hoje, de)).then((r) => {
      if (!ativo) return;
      setResultado(r.erro ? { erro: r.erro } : { chave: periodo, atendimentos: r.atendimentos });
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, periodo, versao]);

  // A IA marca e remarca sozinha: a lista se atualiza na hora
  useTempoReal(["agendamentos"], empresa.id, () => setVersao((v) => v + 1));

  const lista = resultado && "atendimentos" in resultado ? resultado.atendimentos : null;
  const { pedidos, pedir } = usePedidos(lista ?? []);
  const { dialogo, avisar } = useDialogo();
  const carregando = !resultado || ("chave" in resultado && resultado.chave !== periodo);
  const frase = PERIODOS.find((p) => p.chave === periodo)!.frase;
  // Quantos horários cada cliente tem no período: mais de um costuma ser volta marcada em dobro
  const porCliente = new Map<string, number>();
  for (const a of lista ?? []) {
    const id = a.clientes?.id ?? a.id;
    porCliente.set(id, (porCliente.get(id) ?? 0) + 1);
  }
  const clientes = porCliente.size;

  // Agrupa por mês e, dentro dele, por dia
  const meses: { chave: string; titulo: string; dias: { dia: string; itens: Atendimento[] }[] }[] = [];
  for (const a of lista ?? []) {
    const dia = dataNoSalao(a.inicio);
    const chaveMes = dia.slice(0, 7);
    let mes = meses.at(-1);
    if (!mes || mes.chave !== chaveMes) {
      mes = { chave: chaveMes, titulo: `${MESES[Number(dia.slice(5, 7)) - 1]} ${dia.slice(0, 4)}`, dias: [] };
      meses.push(mes);
    }
    let grupo = mes.dias.at(-1);
    if (!grupo || grupo.dia !== dia) {
      grupo = { dia, itens: [] };
      mes.dias.push(grupo);
    }
    grupo.itens.push(a);
  }

  const indice = PERIODOS.findIndex((p) => p.chave === periodo);

  return (
    <>
      <header className="flex flex-col gap-3 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <Link href="/agenda" className="vidro flex h-10 w-fit items-center gap-0.5 rounded-full pr-4 pl-2.5 text-[15px] font-semibold active:scale-95">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1C1B1F" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="m15 18-6-6 6-6" />
            </svg>
            Agenda
          </Link>
          {/* Viagem, folga, imprevisto: bloquear dias e ver quem é afetado */}
          <Link href="/agenda/bloqueios" className="vidro flex h-10 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold active:scale-95">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#8A3B2B" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18M9 14l6 6M15 14l-6 6" />
            </svg>
            Dias sem atender
          </Link>
        </div>
        <div>
          <h1 className="font-serif text-[34px] leading-tight font-semibold">Próximas</h1>
          <p className="text-sm text-texto-2">
            {carregando
              ? "Vendo a agenda…"
              : lista && lista.length > 0
                ? `${lista.length} ${lista.length === 1 ? "horário" : "horários"} · ${clientes} ${clientes === 1 ? "cliente" : "clientes"} ${frase}`
                : `Ninguém marcado ${frase}`}
          </p>
        </div>

        {/* Período numa cápsula, com a bolha deslizando na mesma mola da barra de abas */}
        <div role="group" aria-label="Período" className="relative grid grid-cols-4 rounded-full bg-campo p-1">
          <span
            aria-hidden
            className="bolha-aba pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-full bg-card shadow-[0_1px_4px_rgba(30,23,20,0.15)]"
            style={{ transform: `translateX(${indice * 100}%)` }}
          />
          {PERIODOS.map((p) => (
            <button
              key={p.chave}
              onClick={() => setPeriodo(p.chave)}
              aria-pressed={periodo === p.chave}
              className={`relative h-10 rounded-full text-[13px] font-semibold transition-colors duration-300 active:scale-95 ${
                periodo === p.chave ? "text-grafite" : "text-rotulo"
              }`}
            >
              {p.rotulo}
            </button>
          ))}
        </div>
      </header>

      {resultado && "erro" in resultado && <p className="m-4 rounded-2xl bg-rose p-4 text-rose-texto">Erro ao ler a agenda: {resultado.erro}</p>}

      {!carregando && lista && lista.length === 0 && (
        <p className="mx-4 mt-6 rounded-[22px] bg-card p-5 text-center text-[15px] text-texto-2 borda-suave">Nenhuma cliente marcada {frase}.</p>
      )}

      <div className={`flex flex-col gap-6 px-4 pt-5 transition-opacity duration-200 ${carregando ? "opacity-50" : ""}`}>
        {meses.map((m) => (
          <section key={m.chave} className="flex flex-col gap-4">
            <h2 className="rotulo text-bronze-escuro">{m.titulo}</h2>
            {m.dias.map((g) => (
              <div key={g.dia} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between px-1">
                  <h3 className="text-[15px] font-semibold">{tituloDoDia(g.dia)}</h3>
                  <span className="text-[13px] text-texto-2">{g.itens.length === 1 ? "1 cliente" : `${g.itens.length} clientes`}</span>
                </div>
                <ul className="overflow-hidden rounded-[22px] bg-card borda-suave">
                  {g.itens.map((a, i) => (
                    <li key={a.id} className={i > 0 ? "border-t border-borda" : ""}>
                      <LinhaDeslizante
                        aberta={aberta === a.id}
                        aoAbrir={(sim) => setAberta(sim ? a.id : null)}
                        aoTocar={() => router.push(a.clientes ? `/clientes/${a.clientes.id}` : "/agenda")}
                        acoes={acoesDe(
                          a,
                          () => a.clientes && router.push(`/clientes/${a.clientes.id}`),
                          () => pedir(a, (erro) => avisar(`O WhatsApp abriu, mas o pedido não foi gravado: ${erro}. Envie mesmo assim; a IA pode pausar nessa conversa.`)),
                        )}
                        className="gap-3 bg-card px-3.5 py-3 active:bg-campo"
                      >
                        <span className="w-11 shrink-0 text-sm font-bold text-rotulo">{formatarHora(a.inicio)}</span>
                        <Avatar id={a.clientes?.id ?? a.id} nome={a.clientes?.nome ?? null} tamanho="h-10 w-10 text-base" />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate font-semibold">{nomeDe(a)}</span>
                          <span className="truncate text-[13px] text-texto-2">{a.servicos?.nome ?? "Serviço não informado"}</span>
                          {/* Mesma cliente com mais de um horário pela frente: vale conferir se não é volta em dobro */}
                          {(porCliente.get(a.clientes?.id ?? a.id) ?? 0) > 1 && (
                            <span className="mt-0.5 w-fit rounded-full bg-rose px-2 py-0.5 text-[11px] font-bold text-rose-texto">
                              {porCliente.get(a.clientes?.id ?? a.id)} horários marcados
                            </span>
                          )}
                          <SeloPedido pedido={pedidos.get(a.id)} atendimento={a} />
                        </span>
                        {/* Quem marcou: a IA (pelo WhatsApp) ou a Gleide */}
                        {a.origem === "ia" && <span className="shrink-0 rounded-full bg-areia px-2 py-1 text-[11px] font-bold text-taupe-texto">IA</span>}
                      </LinhaDeslizante>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
        {lista && lista.length > 0 && (
          <p className="text-center text-xs text-texto-2">Deslize uma cliente para o lado para Remarcar, ver a Ficha ou abrir o WhatsApp.</p>
        )}
        {dialogo}
      </div>
    </>
  );
}
