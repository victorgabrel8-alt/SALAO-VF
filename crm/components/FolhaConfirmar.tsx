"use client";

import { useEffect, useState } from "react";
import { Folha } from "@/components/Folha";
import { Intencao } from "@/components/Intencao";
import type { Atendimento } from "@/lib/atendimentos";
import { RESULTADOS, ehAvaliacao, type Avaliacao, type ResultadoAvaliacao } from "@/lib/avaliacoes";
import { useEmpresa } from "@/lib/empresa";
import {
  dataNoSalao,
  formatarDiaLongo,
  formatarHora,
  formatarTelefone,
  hojeNoSalao,
  instanteNoSalao,
  primeiroNome,
  somarDias,
} from "@/lib/formato";
import { abreNoDia, horariosLivres, proximoDiaAberto } from "@/lib/horarios";
import type { ServicoAtivo } from "@/lib/tipos";

// O ✓ de um horário a atender, como uma pergunta direta: "Como foi o atendimento de Maria?".
// Quase sempre é "Fez o que estava marcado" (1 toque). Se a cliente fez outra coisa ou mais coisas
// (marcou hidratação e fez mega hair), a dona marca o que ela fez de verdade.
// A volta não é marcada aqui: quem chama a cliente na data certa é a IA, pelo retorno que o
// banco calcula de cada serviço feito.
// Se o horário é uma Avaliação, a pergunta é o resultado: Fechou / Ficou de pensar / Não fechou
// (vai para o funil e a IA lê na próxima conversa com a cliente).
// "Faltou / remarcou": faltou marca a falta (a IA chama a cliente para remarcar, supabase/007); remarcou leva o mesmo horário
// para outro dia.
type Tela = "pergunta" | "mudou" | "faltou" | "remarcar";

export function FolhaConfirmar({
  atendimento: a,
  servicos,
  intencao,
  aoConfirmar,
  aoResultado,
  aoFaltou,
  aoRemarcar,
  aoFechar,
}: {
  atendimento: Atendimento;
  servicos: ServicoAtivo[];
  intencao?: Avaliacao;
  aoConfirmar: (servicoIds: string[]) => Promise<string | undefined>;
  aoResultado?: (resultado: ResultadoAvaliacao) => Promise<string | undefined>;
  aoFaltou?: () => Promise<string | undefined>;
  aoRemarcar?: (novoInicio: string) => Promise<string | undefined>;
  aoFechar: () => void;
}) {
  const [tela, setTela] = useState<Tela>("pergunta");
  const [escolhidos, setEscolhidos] = useState<string[]>(a.servico_id ? [a.servico_id] : []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  // Salvou: mostra o selo por um instante e fecha
  const [feito, setFeito] = useState<{ titulo: string; texto: string; cor: string } | null>(null);

  function alternar(id: string) {
    setEscolhidos((atual) => (atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id]));
  }

  // Roda a gravação; se der certo, mostra o selo e depois segue
  async function gravar(acao: () => Promise<string | undefined>, selo: NonNullable<typeof feito>, depois: () => void) {
    setSalvando(true);
    setErro("");
    const falhou = await acao();
    setSalvando(false);
    if (falhou) {
      setErro(falhou);
      return;
    }
    setFeito(selo);
    navigator.vibrate?.(35);
    setTimeout(depois, 1400);
  }

  const nome = a.clientes?.nome ? primeiroNome(a.clientes.nome) : a.clientes ? formatarTelefone(a.clientes.telefone) : "A cliente";
  const servico = a.servicos?.nome ?? "Serviço não informado";
  const avaliacao = Boolean(aoResultado) && ehAvaliacao(a.servicos?.nome);
  const concluido = { titulo: "Atendimento concluído", texto: `${nome} · ${formatarHora(a.inicio)} foi para os concluídos`, cor: "bg-[#5E7A50]" };

  function salvar(escolha: string[]) {
    // Vários serviços: o de retorno mais curto fica como o principal do horário. É dele o retorno
    // da cliente (mega hair + pintura -> volta pela pintura), já antes do 007 rodar no banco.
    const retorno = (id: string) => servicos.find((s) => s.id === id)?.dias_retorno ?? Infinity;
    const ids = escolha.length > 1 ? [...escolha].sort((x, y) => retorno(x) - retorno(y)) : escolha;
    gravar(() => aoConfirmar(ids), concluido, aoFechar);
  }

  const voltar = (para: Tela) => (
    <button onClick={() => setTela(para)} className="-ml-1 flex w-fit items-center gap-0.5 py-1 text-[15px] font-semibold text-bronze-escuro">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m15 18-6-6 6-6" />
      </svg>
      Voltar
    </button>
  );

  const botaoFaltou = (aoFaltou || aoRemarcar) && (
    <button
      onClick={() => setTela("faltou")}
      disabled={salvando}
      className="h-13 min-h-[52px] rounded-full bg-card text-[16px] font-semibold text-rose-texto borda-suave active:bg-campo"
    >
      Faltou ou remarcou
    </button>
  );

  return (
    <Folha rotulo="Concluir atendimento" aoFechar={aoFechar} className="bg-[var(--background)] px-5">
      <div className="flex flex-col gap-4 pt-1 pb-5">
        {feito ? (
          <div role="status" className="flex flex-col items-center gap-4 py-8 text-center">
            <span className="relative flex h-[84px] w-[84px] items-center justify-center">
              <span aria-hidden className={`onda-confirmar absolute inset-0 rounded-full ${feito.cor}`} />
              <span className={`selo-pop relative flex h-full w-full items-center justify-center rounded-full shadow-[0_12px_28px_rgba(30,23,20,0.25)] ${feito.cor}`}>
                <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path className="check-desenhar" d="m5 12 5 5L20 7" />
                </svg>
              </span>
            </span>
            <div className="subir-suave flex flex-col gap-1">
              <h2 className="font-serif text-[26px] leading-tight font-semibold">{feito.titulo}</h2>
              <p className="text-[15px] text-texto-2">{feito.texto}</p>
            </div>
          </div>
        ) : tela === "pergunta" ? (
          <>
            {/* A pergunta, com o que estava marcado logo abaixo */}
            <div className="flex flex-col gap-1">
              <span className="rotulo text-texto-2">Atendimento das {formatarHora(a.inicio)}</span>
              <h2 className="font-serif text-[26px] leading-tight font-semibold">
                {avaliacao ? `Como foi a avaliação de ${nome}?` : `Como foi o atendimento de ${nome}?`}
              </h2>
            </div>
            <div className="flex items-center gap-3 rounded-[18px] bg-card px-4 py-3.5 borda-suave">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-areia">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6E5539" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12" />
                </svg>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[13px] text-texto-2">Estava marcado</span>
                <span className="text-[16px] font-semibold">{servico}</span>
                <Intencao avaliacao={intencao} />
              </span>
            </div>

            {avaliacao ? (
              <div className="flex flex-col gap-2.5">
                {RESULTADOS.map((r, i) => (
                  <button
                    key={r.chave}
                    onClick={() => gravar(() => aoResultado!(r.chave), concluido, aoFechar)}
                    disabled={salvando}
                    className={`h-14 rounded-full text-[17px] font-bold active:scale-[0.98] disabled:opacity-60 ${
                      i === 0 ? "bg-grafite text-perola" : "bg-card text-texto borda-suave"
                    }`}
                  >
                    {salvando ? "Salvando…" : r.rotulo}
                  </button>
                ))}
                {botaoFaltou}
                <button onClick={() => setTela("mudou")} disabled={salvando} className="h-11 text-[15px] font-semibold text-bronze-escuro">
                  Fez um serviço em vez da avaliação
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <button
                  onClick={() => salvar([])}
                  disabled={salvando}
                  className="flex h-14 items-center justify-center gap-2 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98] disabled:opacity-60"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="m5 12 5 5L20 7" />
                  </svg>
                  {salvando ? "Salvando…" : "Fez o que estava marcado"}
                </button>
                <button
                  onClick={() => setTela("mudou")}
                  disabled={salvando}
                  className="h-13 min-h-[52px] rounded-full bg-card text-[16px] font-semibold borda-suave active:bg-campo"
                >
                  Fez outro serviço
                </button>
                {botaoFaltou}
              </div>
            )}
          </>
        ) : tela === "mudou" ? (
          <>
            <div className="flex flex-col gap-1">
              {voltar("pergunta")}
              <h2 className="font-serif text-[26px] leading-tight font-semibold">O que {nome} fez?</h2>
              <p className="text-[15px] text-texto-2">Toque em tudo que foi feito. Pode ser mais de um.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {servicos.map((s) => {
                const ativo = escolhidos.includes(s.id);
                return (
                  <button
                    key={s.id}
                    onClick={() => alternar(s.id)}
                    aria-pressed={ativo}
                    className={`flex h-11 items-center gap-1.5 rounded-full px-4 text-[15px] font-semibold transition-colors ${
                      ativo ? "chip-ativo" : "bg-card text-texto borda-suave"
                    }`}
                  >
                    {ativo && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <path d="m5 12 5 5L20 7" />
                      </svg>
                    )}
                    {s.nome}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => salvar(escolhidos)}
              disabled={salvando || escolhidos.length === 0}
              className="h-14 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98] disabled:opacity-50"
            >
              {salvando
                ? "Salvando…"
                : escolhidos.length === 0
                  ? "Escolha pelo menos um serviço"
                  : `Concluir com ${escolhidos.length === 1 ? "1 serviço" : `${escolhidos.length} serviços`}`}
            </button>
          </>
        ) : tela === "faltou" ? (
          <>
            <div className="flex flex-col gap-1">
              {voltar("pergunta")}
              <h2 className="font-serif text-[26px] leading-tight font-semibold">O que aconteceu com {nome}?</h2>
              <p className="text-[15px] text-texto-2">
                {servico} · {formatarHora(a.inicio)}
              </p>
            </div>
            <div className="flex flex-col gap-2.5">
              {aoFaltou && (
                <button
                  onClick={() =>
                    // A IA chama a cliente sozinha para remarcar (supabase/007) e avisa a Gleide
                    gravar(aoFaltou, { titulo: "Falta anotada", texto: `A IA vai chamar ${nome} para remarcar e te avisa quando ela marcar.`, cor: "bg-rose-texto" }, aoFechar)
                  }
                  disabled={salvando}
                  className="h-14 rounded-full bg-rose-texto text-[17px] font-bold text-white active:scale-[0.98] disabled:opacity-60"
                >
                  {salvando ? "Salvando…" : "Faltou"}
                </button>
              )}
              {aoRemarcar && (
                <button
                  onClick={() => setTela("remarcar")}
                  disabled={salvando}
                  className="h-14 rounded-full bg-card text-[17px] font-bold borda-suave active:bg-campo"
                >
                  Remarcou para outro dia
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              {voltar("faltou")}
              <h2 className="font-serif text-[26px] leading-tight font-semibold">Para quando {nome} remarcou?</h2>
            </div>
            <EscolherNovoHorario
              atendimento={a}
              duracao={servicos.find((s) => s.id === a.servico_id)?.duracao_min ?? 60}
              salvando={salvando}
              aoEscolher={(inicio) =>
                gravar(
                  () => aoRemarcar!(inicio),
                  { titulo: "Remarcado", texto: `${nome} · ${formatarDiaLongo(dataNoSalao(inicio))} às ${formatarHora(inicio)}`, cor: "bg-grafite" },
                  aoFechar,
                )
              }
            />
          </>
        )}

        {erro && <p className="rounded-2xl bg-rose p-3 text-rose-texto">Não deu para salvar: {erro}</p>}
        {!feito && (
          <button onClick={aoFechar} className="h-11 text-[16px] font-semibold text-texto-2">
            Cancelar
          </button>
        )}
      </div>
    </Folha>
  );
}

const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

// Novo dia e horário para o mesmo atendimento: os próximos 21 dias numa faixa e os horários
// livres do dia escolhido (as mesmas regras da IA: funcionamento, almoço, sem encavalar)
function EscolherNovoHorario({
  atendimento: a,
  duracao,
  salvando,
  aoEscolher,
}: {
  atendimento: Atendimento;
  duracao: number;
  salvando: boolean;
  aoEscolher: (inicio: string) => void;
}) {
  const empresa = useEmpresa();
  const amanha = somarDias(hojeNoSalao(), 1);
  const [dia, setDia] = useState(() => proximoDiaAberto(empresa.config, amanha));
  const [livres, setLivres] = useState<{ dia: string; horas: string[] } | null>(null);

  useEffect(() => {
    let ativo = true;
    horariosLivres(empresa.id, empresa.config, dia, duracao, a.id).then((horas) => {
      if (ativo) setLivres({ dia, horas });
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, empresa.config, dia, duracao, a.id]);
  const horas = livres?.dia === dia ? livres.horas : null;
  const dias = Array.from({ length: 21 }, (_, i) => somarDias(amanha, i));

  return (
    <>
      <div className="sem-barra -mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1">
        {dias.map((d) => {
          const aberto = abreNoDia(empresa.config, d);
          const ativo = d === dia;
          return (
            <button
              key={d}
              disabled={!aberto}
              onClick={() => setDia(d)}
              aria-pressed={ativo}
              aria-label={`${formatarDiaLongo(d)}${aberto ? "" : " (fechado)"}`}
              className={`flex h-[70px] w-[50px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[16px] ${
                ativo ? "bg-grafite text-perola" : aberto ? "bg-card text-texto borda-suave" : "text-inativo opacity-50"
              }`}
            >
              <span className="text-[10px] font-semibold uppercase">{DIAS_CURTOS[new Date(`${d}T12:00:00Z`).getUTCDay()]}</span>
              <span className="font-serif text-[22px] leading-none font-semibold">{Number(d.slice(8))}</span>
            </button>
          );
        })}
      </div>
      <p className="text-[15px] font-semibold">{formatarDiaLongo(dia)}</p>
      {!horas && <p className="text-[15px] text-texto-2">Vendo horários livres…</p>}
      {horas?.length === 0 && (
        <p className="rounded-[16px] bg-card px-3.5 py-3 text-[15px] text-texto-2 borda-suave">Esse dia está cheio. Escolha outro.</p>
      )}
      {horas && horas.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {horas.map((h) => (
            <button
              key={h}
              onClick={() => aoEscolher(instanteNoSalao(dia, h))}
              disabled={salvando}
              className="h-11 rounded-[14px] bg-card text-[15px] font-semibold borda-suave active:bg-grafite active:text-perola disabled:opacity-50"
            >
              {h}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
