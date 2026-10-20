import type { StatusCliente } from "@/lib/status";

// Linha da view clientes_status (ver supabase/001_schema.sql)
export type ClienteStatus = {
  id: string;
  empresa_id: string;
  nome: string | null;
  telefone: string;
  aniversario: string | null;
  observacoes: string | null;
  profissional_preferida_id: string | null;
  etiquetas: string[];
  ia_pausada_ate: string | null;
  motivo_pausa: string | null;
  ia_pausada: boolean;
  criado_em: string;
  ultima_visita: string | null;
  total_visitas: number;
  dias_sem_visita: number | null;
  proximo_agendamento: string | null;
  retorno_previsto: string | null;
  ultimo_contato: string | null;
  ultima_mensagem: string | null;
  status: StatusCliente;
};

// Linha da view retornos_por_servico: último atendimento de cada procedimento
export type RetornoServico = {
  servico_id: string;
  servico_nome: string;
  ultima_vez: string;
  retorno_previsto: string | null;
};

export type Profissional = { id: string; nome: string };
