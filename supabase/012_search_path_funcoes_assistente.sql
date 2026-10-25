-- =====================================================================
-- 012_search_path_funcoes_assistente.sql
-- Aviso de segurança do Supabase (function_search_path_mutable): fixa o
-- search_path das duas funções auxiliares da assistente. Elas só usam
-- funções nativas do Postgres, então search_path vazio não muda nada.
-- =====================================================================
alter function public.assistente_normalizar(text) set search_path = '';
alter function public.assistente_dia_longo(date) set search_path = '';
