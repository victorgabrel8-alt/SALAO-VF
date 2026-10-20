// Status da cliente (calculado pelo banco na view clientes_status).
// Cores com significado fixo: verde = tudo bem, amarelo = atenção, laranja = atrasado, vermelho = precisa dela.
export type StatusCliente = "em_dia" | "retorno_chegando" | "retorno_atrasado" | "inativa" | "sem_visita";

export const STATUS: Record<StatusCliente, { rotulo: string; cartao: string; ponto: string }> = {
  em_dia: { rotulo: "Em dia", cartao: "bg-green-100 text-green-900", ponto: "bg-green-500" },
  retorno_chegando: { rotulo: "Retorno chegando", cartao: "bg-yellow-100 text-yellow-900", ponto: "bg-yellow-400" },
  retorno_atrasado: { rotulo: "Atrasada", cartao: "bg-orange-100 text-orange-900", ponto: "bg-orange-500" },
  inativa: { rotulo: "Inativa", cartao: "bg-red-100 text-red-900", ponto: "bg-red-600" },
  sem_visita: { rotulo: "Sem visita", cartao: "bg-neutral-100 text-neutral-800", ponto: "bg-neutral-400" },
};

export function SeloStatus({ status }: { status: StatusCliente }) {
  const s = STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-sm font-semibold ${s.cartao}`}>
      <span className={`h-2.5 w-2.5 rounded-full ${s.ponto}`} />
      {s.rotulo}
    </span>
  );
}
