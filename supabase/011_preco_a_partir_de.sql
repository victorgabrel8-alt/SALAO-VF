-- =====================================================================
-- 011_preco_a_partir_de.sql
-- Preço "a partir de": o valor cadastrado é o menor (cabelo curto, masculino...).
-- O final depende do comprimento, do volume e do tipo de cabelo, e a Gleide
-- confirma olhando. Ligado em todos por padrão; a Gleide desliga no app
-- (Configurações › Serviços e preços) só no serviço que tem preço fechado.
-- A IA lê o campo junto com a tabela de serviços.
-- =====================================================================
alter table public.servicos add column if not exists a_partir_de boolean not null default true;
