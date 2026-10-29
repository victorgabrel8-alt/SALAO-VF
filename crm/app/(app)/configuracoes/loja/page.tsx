"use client";

import Link from "next/link";
import { useState } from "react";
import { useEmpresa, useTrocarConfig } from "@/lib/empresa";
import { supabase } from "@/lib/supabase/client";

// Dados da loja: a própria dona preenche (manicure, estúdio de beleza ou mega hair) sem depender da gente.
// Fica em empresas.config, com as chaves que a agenda e a IA já conhecem:
//   horario_funcionamento = { "seg": "09:00-18:00", "dom": null, ... } (lib/horarios.ts e n8n/agenda-calculo.js)
//   endereco (texto), formas_pagamento (lista)
//   loja = { referencia, instagram, parcelamento, tolerancia_atraso, cancelamento, sinal, sobre }
// A IA de cada loja nova lê daqui (docs/PLANO-VARIAS-LOJAS.md, fase 5). Enquanto config.ia_usa_dados_loja
// não estiver ligado, a IA da loja ainda usa o texto combinado na implantação, e a tela avisa isso.

// curto: nome na linha do horário (precisa caber em celular de 320px)
const DIAS: { id: string; nome: string; curto: string }[] = [
  { id: "seg", nome: "Segunda", curto: "Seg" },
  { id: "ter", nome: "Terça", curto: "Ter" },
  { id: "qua", nome: "Quarta", curto: "Qua" },
  { id: "qui", nome: "Quinta", curto: "Qui" },
  { id: "sex", nome: "Sexta", curto: "Sex" },
  { id: "sab", nome: "Sábado", curto: "Sáb" },
  { id: "dom", nome: "Domingo", curto: "Dom" },
];

const PAGAMENTOS = ["Pix", "Cartão de crédito", "Cartão de débito", "Dinheiro"];

type Faixa = { aberto: boolean; abre: string; fecha: string };

type DadosLoja = {
  referencia?: string;
  instagram?: string;
  parcelamento?: string;
  tolerancia_atraso?: number | null;
  cancelamento?: string;
  sinal?: string;
  sobre?: string;
};

function lerHorarios(config: Record<string, unknown>): Record<string, Faixa> {
  const tabela = (config.horario_funcionamento ?? {}) as Record<string, string | null>;
  const temTabela = !!config.horario_funcionamento;
  return Object.fromEntries(
    DIAS.map((d) => {
      const faixa = tabela[d.id];
      if (faixa) {
        const [abre, fecha] = faixa.split("-");
        return [d.id, { aberto: true, abre, fecha }];
      }
      // Sem tabela salva, a agenda considera 09:00-18:00 todo dia (lib/horarios.ts)
      return [d.id, { aberto: !temTabela, abre: "09:00", fecha: "18:00" }];
    }),
  );
}

function texto(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export default function DadosLojaPage() {
  const empresa = useEmpresa();
  const trocarConfig = useTrocarConfig();
  const loja = (empresa.config.loja ?? {}) as DadosLoja;
  const salvos = Array.isArray(empresa.config.formas_pagamento) ? (empresa.config.formas_pagamento as string[]) : [];

  const [nome, setNome] = useState(empresa.nome);
  const [endereco, setEndereco] = useState(texto(empresa.config.endereco));
  const [referencia, setReferencia] = useState(texto(loja.referencia));
  const [instagram, setInstagram] = useState(loja.instagram ? `@${loja.instagram}` : "");
  const [horarios, setHorarios] = useState(() => lerHorarios(empresa.config));
  const [pagamentos, setPagamentos] = useState<string[]>(salvos);
  const [parcelamento, setParcelamento] = useState(texto(loja.parcelamento));
  const [tolerancia, setTolerancia] = useState(typeof loja.tolerancia_atraso === "number" ? String(loja.tolerancia_atraso) : "");
  const [cancelamento, setCancelamento] = useState(texto(loja.cancelamento));
  const [sinal, setSinal] = useState(texto(loja.sinal));
  const [sobre, setSobre] = useState(texto(loja.sobre));
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState("");

  // Opções fixas + o que já estava salvo com outro nome (ex.: "Cartão")
  const opcoesPagamento = [...PAGAMENTOS, ...salvos.filter((p) => !PAGAMENTOS.includes(p))];

  function mudarDia(id: string, mudanca: Partial<Faixa>) {
    setHorarios((h) => ({ ...h, [id]: { ...h[id], ...mudanca } }));
  }

  async function salvar() {
    setAviso("");
    const n = nome.trim();
    if (!n) return setAviso("Escreva o nome do salão.");
    for (const d of DIAS) {
      const f = horarios[d.id];
      if (f.aberto && f.abre >= f.fecha) return setAviso(`${d.nome}: o horário de fechar precisa ser depois do de abrir.`);
    }
    const t = tolerancia.trim() === "" ? null : Number(tolerancia);
    if (t !== null && (!Number.isInteger(t) || t < 0 || t > 120)) return setAviso("Tolerância de atraso: use minutos, de 0 a 120.");

    setSalvando(true);
    const db = supabase();
    // Lê o config atual do banco para não apagar outras configurações
    const atual = await db.from("empresas").select("config").eq("id", empresa.id).single();
    if (atual.error) {
      setSalvando(false);
      return setAviso(`Não foi possível salvar: ${atual.error.message}`);
    }
    const anterior = atual.data.config as Record<string, unknown>;
    const config = {
      ...anterior,
      endereco: endereco.trim() || null,
      formas_pagamento: pagamentos,
      horario_funcionamento: Object.fromEntries(DIAS.map((d) => [d.id, horarios[d.id].aberto ? `${horarios[d.id].abre}-${horarios[d.id].fecha}` : null])),
      loja: {
        ...((anterior.loja ?? {}) as DadosLoja),
        referencia: referencia.trim(),
        instagram: instagram.trim().replace(/^@/, ""),
        parcelamento: parcelamento.trim(),
        tolerancia_atraso: t,
        cancelamento: cancelamento.trim(),
        sinal: sinal.trim(),
        sobre: sobre.trim(),
      },
    };
    const { error } = await db.from("empresas").update({ nome: n, config }).eq("id", empresa.id);
    setSalvando(false);
    if (error) return setAviso(`Não foi possível salvar: ${error.message}`);
    trocarConfig(config, n);
    setAviso("Salvo ✓");
  }

  const campo = "h-12 w-full rounded-full bg-card px-4 text-[16px] font-semibold outline-none borda-suave";
  const caixa = "w-full rounded-[22px] bg-card px-4 py-3 text-[16px] outline-none borda-suave";

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
          <h1 className="font-serif text-[34px] leading-tight font-semibold">Dados do salão</h1>
          <p className="text-sm text-texto-2">
            {empresa.config.ia_usa_dados_loja === true
              ? "A IA usa estas informações para responder as clientes."
              : "Guarde aqui os dados do salão. Se mudar algo, avise a equipe para atualizar a IA."}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-5 px-4 pt-5 pb-8">
        <section className="flex flex-col gap-2.5">
          <span className="rotulo text-texto-2">Onde fica</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do salão" aria-label="Nome do salão" className={campo} />
          <input value={endereco} onChange={(e) => setEndereco(e.target.value)} placeholder="Rua, número, bairro e cidade" aria-label="Endereço" className={campo} />
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} placeholder="Ponto de referência (opcional)" aria-label="Ponto de referência" className={campo} />
          <input value={instagram} onChange={(e) => setInstagram(e.target.value)} placeholder="@instagram (opcional)" aria-label="Instagram" className={campo} />
        </section>

        <section className="flex flex-col gap-2">
          <span className="rotulo text-texto-2">Horário de funcionamento</span>
          <ul className="overflow-hidden rounded-[22px] bg-card borda-suave">
            {DIAS.map((d, i) => {
              const f = horarios[d.id];
              return (
                <li key={d.id} className={`flex items-center gap-2 px-3 py-2.5 ${i > 0 ? "border-t border-borda" : ""}`}>
                  <button
                    onClick={() => mudarDia(d.id, { aberto: !f.aberto })}
                    role="switch"
                    aria-checked={f.aberto}
                    aria-label={`Abre ${d.nome.toLowerCase()}`}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${f.aberto ? "bg-grafite" : "bg-neutral-300"}`}
                  >
                    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${f.aberto ? "left-6" : "left-1"}`} />
                  </button>
                  <span className="w-9 shrink-0 text-[15px] font-semibold">{d.curto}</span>
                  {f.aberto ? (
                    <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
                      <input type="time" value={f.abre} onChange={(e) => mudarDia(d.id, { abre: e.target.value })} aria-label={`${d.nome}: abre`} className="h-10 min-w-0 flex-1 basis-0 rounded-full bg-campo px-0.5 text-center text-[13px] font-semibold min-[360px]:px-1 min-[360px]:text-[15px] sm:max-w-[110px]" />
                      <span className="shrink-0 text-[13px] text-texto-2">às</span>
                      <input type="time" value={f.fecha} onChange={(e) => mudarDia(d.id, { fecha: e.target.value })} aria-label={`${d.nome}: fecha`} className="h-10 min-w-0 flex-1 basis-0 rounded-full bg-campo px-0.5 text-center text-[13px] font-semibold min-[360px]:px-1 min-[360px]:text-[15px] sm:max-w-[110px]" />
                    </span>
                  ) : (
                    <span className="flex-1 text-right text-[15px] text-texto-2">Fechado</span>
                  )}
                </li>
              );
            })}
          </ul>
          {!empresa.config.horario_funcionamento && (
            <p className="rounded-2xl bg-campo px-4 py-3 text-[14px] font-semibold">Confira os dias: o horário ainda não foi salvo, por isso todos aparecem abertos.</p>
          )}
          <p className="text-[13px] text-texto-2">A agenda só deixa marcar dentro desses horários. O almoço fica em Configurações.</p>
        </section>

        <section className="flex flex-col gap-2.5">
          <span className="rotulo text-texto-2">Formas de pagamento</span>
          <div className="flex flex-wrap gap-2">
            {opcoesPagamento.map((p) => {
              const marcado = pagamentos.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => setPagamentos(marcado ? pagamentos.filter((x) => x !== p) : [...pagamentos, p])}
                  aria-pressed={marcado}
                  className={`h-10 rounded-full px-4 text-[14px] font-semibold transition-colors ${marcado ? "chip-ativo" : "bg-card text-texto borda-suave"}`}
                >
                  {p}
                </button>
              );
            })}
          </div>
          <input value={parcelamento} onChange={(e) => setParcelamento(e.target.value)} placeholder="Parcelamento (ex.: até 3x com juros)" aria-label="Parcelamento" className={campo} />
        </section>

        <section className="flex flex-col gap-2.5">
          <span className="rotulo text-texto-2">Regras do salão</span>
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-semibold">Tolerância de atraso (minutos)</span>
            <input inputMode="numeric" value={tolerancia} onChange={(e) => setTolerancia(e.target.value.replace(/\D/g, ""))} placeholder="Ex.: 15" className={campo} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-semibold">Cancelamento e remarcação</span>
            <textarea value={cancelamento} onChange={(e) => setCancelamento(e.target.value)} rows={2} placeholder="Ex.: avisar com 24 horas de antecedência" className={caixa} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[14px] font-semibold">Sinal para agendar</span>
            <textarea value={sinal} onChange={(e) => setSinal(e.target.value)} rows={2} placeholder="Ex.: não cobro sinal / sinal de R$ 30 no Pix" className={caixa} />
          </label>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className="rotulo text-texto-2">Recado para a IA</span>
          <textarea
            value={sobre}
            onChange={(e) => setSobre(e.target.value)}
            rows={4}
            placeholder="O que a IA precisa saber para atender bem: diferenciais, produtos que você usa, se atende a domicílio, cuidados depois do serviço…"
            className={caixa}
          />
        </section>

        {aviso && <p className={`rounded-2xl p-3 text-center font-semibold ${aviso.startsWith("Salvo") ? "bg-campo" : "bg-rose text-rose-texto"}`}>{aviso}</p>}
        <button
          onClick={salvar}
          disabled={salvando}
          className="h-14 rounded-full bg-grafite text-[17px] font-bold text-perola active:scale-[0.98] disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar dados"}
        </button>
      </div>
    </>
  );
}
