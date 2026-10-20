-- =====================================================================
-- 003_minhas_empresas_privado.sql — já aplicado no Supabase em 20/10/2026
-- Tira a função minhas_empresas() da API pública (alerta de segurança do
-- Supabase). As regras de RLS continuam funcionando normalmente.
-- =====================================================================
create schema if not exists private;
alter function public.minhas_empresas() set schema private;
alter function private.minhas_empresas() set search_path = public;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
revoke execute on function private.minhas_empresas() from public, anon;
grant execute on function private.minhas_empresas() to authenticated, service_role;
