-- 074: conferência noturna das conversas (pedido do Victor, 24/11/2026).
-- Toda noite o fluxo "Conferência noturna" lê as conversas do dia de cada loja, o Gemini aponta os erros da IA
-- (resposta seca, pergunta dupla, convite repetido, dado inventado, cliente sem resposta...) e o resumo vai para o
-- WhatsApp do Victor. Esta tabela guarda o resultado de cada noite, para acompanhar os erros por 100 conversas.
-- Só soma: tabela nova, sem acesso pelo app (só service_role).
create table if not exists auditoria_noturna (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  dia date not null,
  conversas int not null default 0,
  respostas_ia int not null default 0,
  erros jsonb not null default '[]'::jsonb,
  sem_resposta jsonb not null default '[]'::jsonb,
  n_erros int not null default 0,
  erros_por_100 numeric(6, 1),
  modelo text,
  criado_em timestamptz not null default now()
);
create index if not exists auditoria_noturna_empresa_dia on auditoria_noturna (empresa_id, dia desc);
alter table auditoria_noturna enable row level security;
revoke all on auditoria_noturna from anon, authenticated;
