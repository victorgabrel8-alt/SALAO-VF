// Status da cliente (calculado pelo banco na view clientes_status).
// Cores com significado fixo: verde = tudo bem, amarelo = atenção, laranja = atrasado, vermelho = precisa dela.
// Visual discreto: fundo neutro e a cor só num pontinho.
export type StatusCliente = "em_dia" | "retorno_chegando" | "retorno_atrasado" | "inativa" | "sem_visita";

export const STATUS: Record<StatusCliente, { rotulo: string; ponto: string }> = {
  em_dia: { rotulo: "Em dia", ponto: "bg-green-500" },
  retorno_chegando: { rotulo: "Retorno chegando", ponto: "bg-yellow-400" },
  retorno_atrasado: { rotulo: "Atrasada", ponto: "bg-orange-500" },
  inativa: { rotulo: "Inativa", ponto: "bg-red-500" },
  sem_visita: { rotulo: "Sem visita", ponto: "bg-neutral-300" },
};

export function PontoStatus({ cor, tamanho = "h-2.5 w-2.5" }: { cor: string; tamanho?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${tamanho} ${cor}`} />;
}

export function SeloStatus({ status }: { status: StatusCliente }) {
  const s = STATUS[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-0.5 text-sm font-medium text-neutral-700">
      <PontoStatus cor={s.ponto} />
      {s.rotulo}
    </span>
  );
}
