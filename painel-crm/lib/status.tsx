// Status da cliente (calculado pelo banco na view clientes_status).
// Cores com significado fixo: sálvia = tudo bem, mel = atenção, argila = atrasado, tijolo = precisa dela.
// No CRM, "Atrasada" e "Retorno chegando" ganham selo forte (são as que pedem ação);
// os outros ficam discretos, com a cor só num pontinho.
export type StatusCliente = "em_dia" | "retorno_chegando" | "retorno_atrasado" | "inativa" | "sem_visita";

export const STATUS: Record<StatusCliente, { rotulo: string; ponto: string; forte?: string }> = {
  em_dia: { rotulo: "Em dia", ponto: "bg-status-em-dia" },
  retorno_chegando: {
    rotulo: "Retorno chegando",
    ponto: "bg-status-chegando",
    forte: "border-transparent bg-mel text-mel-texto font-semibold",
  },
  retorno_atrasado: {
    rotulo: "Atrasada",
    ponto: "bg-status-atrasada",
    forte: "border-transparent bg-rose text-rose-texto font-semibold",
  },
  inativa: { rotulo: "Inativa", ponto: "bg-status-inativa" },
  sem_visita: { rotulo: "Sem visita", ponto: "bg-status-sem-visita" },
};

export function PontoStatus({ cor, tamanho = "h-2.5 w-2.5" }: { cor: string; tamanho?: string }) {
  return <span className={`inline-block shrink-0 rounded-full ${tamanho} ${cor}`} />;
}

export function SeloStatus({ status }: { status: StatusCliente }) {
  const s = STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-sm ${
        s.forte ?? "border-borda font-medium text-texto-2"
      }`}
    >
      <PontoStatus cor={s.ponto} />
      {s.rotulo}
    </span>
  );
}
