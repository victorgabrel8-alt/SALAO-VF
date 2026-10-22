-- =====================================================================
-- 009_indices_e_rls.sql — aplicado no Supabase em 22/10/2026
-- Ajustes apontados pelo Supabase (Performance Advisor) no pente fino:
--   1) índice nas chaves estrangeiras que não tinham (a agenda filtra por serviço e
--      profissional, e o CRM por empresa)
--   2) usuarios_select: auth.uid() dentro de (select ...) para o banco avaliar uma vez
--      por consulta, não uma vez por linha
-- =====================================================================

create index if not exists idx_agend_profissional   on agendamentos (profissional_id);
create index if not exists idx_agend_servico        on agendamentos (servico_id);
create index if not exists idx_aval_agendamento     on avaliacoes (agendamento_id);
create index if not exists idx_aval_agend_servico   on avaliacoes (agendamento_servico_id);
create index if not exists idx_clientes_profissional on clientes (profissional_preferida_id);
create index if not exists idx_contatos_criado_por  on contatos (criado_por);
create index if not exists idx_contatos_empresa     on contatos (empresa_id, criado_em desc);
create index if not exists idx_profissionais_empresa on profissionais (empresa_id);
create index if not exists idx_servicos_empresa     on servicos (empresa_id);
create index if not exists idx_usuarios_empresa_emp on usuarios_empresa (empresa_id);

drop policy if exists usuarios_select on usuarios_empresa;
create policy usuarios_select on usuarios_empresa for select to authenticated
  using (user_id = (select auth.uid()));
