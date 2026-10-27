-- 018: Catálogo de fotos de cabelo (pedido do Victor, 27/10).
-- A IA manda fotos do catálogo pelo WhatsApp (ferramenta enviar_catalogo, workflow "Catálogo - Enviar fotos").
-- As fotos ficam no Storage (bucket privado "catalogo"); esta tabela guarda a ficha de cada uma.
-- Quem cadastra: n8n/demo-agente/cadastrar-catalogo.js (mesma foto de novo = atualiza, não duplica).
-- Sem preço aqui de propósito: preço do cabelo continua só pela Gleide.
create table if not exists catalogo (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  arquivo        text not null,                -- caminho no bucket "catalogo"
  grupo          text not null default '',     -- fotos do mesmo cabelo (a IA manda no máximo 1 por grupo)
  tipo           text not null check (tipo in ('brasileiro do Sul', 'brasileiro regional', 'indiano', 'vietnamita')),
  cor            text not null default '',
  comprimento_cm integer,
  textura        text not null default '',
  legenda        text not null default '',
  ativo          boolean not null default true,
  ordem          integer not null default 0,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now(),
  unique (empresa_id, arquivo)
);
create index if not exists catalogo_empresa_ativo on catalogo (empresa_id, ativo);

alter table catalogo enable row level security;
-- usuários da empresa só leem; o n8n e o script de cadastro usam a service_role (passa por cima da RLS)
create policy catalogo_select on catalogo for select to authenticated
  using (empresa_id in (select minhas_empresas()));
revoke all on catalogo from anon;
