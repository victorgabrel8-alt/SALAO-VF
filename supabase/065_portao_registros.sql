-- Portão de ações (fase 1, modo observar): cada vez que a IA de atendimento ou a assistente da dona GRAVA ou MANDA algo
-- (marcar, concluir, resultado da avaliação, valor, mensagem para cliente...), o portão confere se tem prova na fala de
-- quem pediu e registra aqui o que barraria. No modo observar nada é barrado: a ação já aconteceu do jeito de sempre.
-- Serve para medir os erros da IA (21/11/2026: recolocação do cabelo da cliente gravada como aplicação) antes de ligar.
-- Só soma: tabela nova, nada existente muda.

create table if not exists portao_registros (
  id           bigint generated always as identity primary key,
  empresa_id   uuid not null references empresas(id) on delete cascade,
  agente       text not null,                              -- atendimento | assistente
  telefone     text,                                       -- cliente (atendimento) ou número de quem falou com a assistente
  modo         text not null default 'observar',           -- observar | ligado
  fala         text,                                       -- o que a cliente / a dona escreveu nesta vez
  acoes        jsonb not null default '[]'::jsonb,         -- [{ ferramenta, entrada, resultado, falhas: [{ tipo, detalhe }] }]
  n_falhas     integer not null default 0,
  criado_em    timestamptz not null default now()
);

create index if not exists portao_registros_empresa_data on portao_registros (empresa_id, criado_em desc);
create index if not exists portao_registros_com_falha on portao_registros (empresa_id, criado_em desc) where n_falhas > 0;

alter table portao_registros enable row level security;   -- sem política: só o servidor (chave de serviço) lê e grava
