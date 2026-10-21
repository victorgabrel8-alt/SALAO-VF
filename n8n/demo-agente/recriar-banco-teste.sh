#!/usr/bin/env bash
# Recria o banco local "salao_teste" (Postgres do docker-compose) com 001 + 003 + 002 + 004,
# carrega o cenário da assistente e roda os testes das funções do 004.
# Uso (Git Bash, nesta pasta, com o docker compose no ar):  ./recriar-banco-teste.sh  [pasta do supabase/]
set -euo pipefail
cd "$(dirname "$0")"
set -a; . ./.env; set +a
# pasta supabase/ do repositório: no repo fica em ../../supabase
SUPA="${1:-$( [ -d ../../supabase ] && echo ../../supabase || echo ../salao-ia/salao-ia/supabase )}"
P="docker exec -i demo-salao-postgres-1 psql -U $POSTGRES_USER -v ON_ERROR_STOP=1 -q"

$P -d evolution -c "DROP DATABASE IF EXISTS salao_teste" -c "CREATE DATABASE salao_teste" 2>&1 | grep -v NOTICE || true
# o mínimo do Supabase que o 001 usa (auth.users, auth.uid() e os papéis)
$P -d salao_teste <<'SQL'
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as 'select null::uuid';
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;
SQL
for f in 001_schema.sql 003_minhas_empresas_privado.sql 002_seed_dev.sql 004_avaliacoes_ia_RASCUNHO.sql; do
  echo "== $f"; $P -d salao_teste < "$SUPA/$f" 2>&1 | grep -v NOTICE || true
done
GLEIDE="${ASSISTENTE_NUMEROS%%,*}"; GLEIDE="${GLEIDE:-5566900000000}"
$P -v empresa_id=00000000-0000-0000-0000-000000000001 -d salao_teste < "$SUPA/manual/servicos_toda_bonita_RASCUNHO.sql"
echo "== cenário"; $P -v gleide="$GLEIDE" -d salao_teste < teste-assistente.sql
echo "== testes";  $P -v gleide="$GLEIDE" -d salao_teste < teste-004-funcoes.sql 2>&1
