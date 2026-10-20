-- CRM da demo (banco "crm" no Postgres do docker-compose)
-- Criar:  docker exec demo-salao-postgres-1 psql -U evolution -d evolution -c "CREATE DATABASE crm"
--         docker exec -i demo-salao-postgres-1 psql -U evolution -d crm < crm-schema.sql
CREATE TABLE IF NOT EXISTS clientes (
  telefone         text PRIMARY KEY,
  nome             text,
  etapa            text NOT NULL DEFAULT 'novo',   -- novo | conversa | agendado | humano | atendido | perdido
  interesse        text,                            -- o que a cliente quer (resumo curto, preenchido pela IA)
  resumo           text,                            -- resumo da conversa (IA)
  agendamento      timestamptz,                     -- próximo horário marcado
  servico_agendado text,
  observacoes      text,                            -- anotações da Gleide no painel
  origem           text DEFAULT 'WhatsApp',
  total_mensagens  int  NOT NULL DEFAULT 0,
  primeiro_contato timestamptz NOT NULL DEFAULT now(),
  ultimo_contato   timestamptz NOT NULL DEFAULT now(),
  atualizado_em    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clientes_etapa_idx ON clientes (etapa);
