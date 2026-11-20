-- Conferente (orquestrador, fase A): o que ele barrou ou barraria numa resposta da IA de atendimento.
-- No modo "observar" a resposta sai igual para a cliente; aqui fica só o registro, para medir se ele acerta
-- antes de ligar de verdade. O Vigia da IA lê esta tabela.
-- Só soma: tabela nova, nada existente muda.

create table if not exists conferente_registros (
  id           bigint generated always as identity primary key,
  empresa_id   uuid not null references empresas(id) on delete cascade,
  telefone     text,
  modo         text not null default 'observar',          -- observar | ligado
  texto        text,                                       -- resposta do agente, como saiu do Gemini
  falhas       jsonb not null default '[]'::jsonb,         -- [{ tipo, detalhe }]
  ferramentas  jsonb not null default '[]'::jsonb,         -- [{ ferramenta, resultado (início) }]
  criado_em    timestamptz not null default now()
);

create index if not exists conferente_registros_empresa_data on conferente_registros (empresa_id, criado_em desc);

alter table conferente_registros enable row level security;   -- sem política: só o servidor (chave de serviço) lê e grava
