-- Função nova (só soma): igual a n8n_assistente_reagendar, e quando a dona informa o serviço tira das observações
-- a marca "serviço não confirmado". Só é chamada pelas lojas que usam a marca (Caroline e Loja Teste).
create or replace function public.n8n_assistente_reagendar_confirma(
  p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid, p_inicio timestamptz, p_servico text, p_forcar boolean)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v jsonb;
begin
  v := n8n_assistente_reagendar(p_empresa_id, p_pedido_por, p_agendamento_id, p_inicio, p_servico, p_forcar);
  if nullif(trim(coalesce(p_servico, '')), '') is not null then
    update agendamentos
       set observacoes = nullif(trim(regexp_replace(observacoes, '\s*servi[cç]o n[aã]o confirmado[^.\n]*\.?', '', 'gi')), '')
     where id = p_agendamento_id and empresa_id = p_empresa_id and observacoes ~* 'servi[cç]o n[aã]o confirmado';
  end if;
  return v;
end $$;
revoke all on function public.n8n_assistente_reagendar_confirma(uuid, text, uuid, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.n8n_assistente_reagendar_confirma(uuid, text, uuid, timestamptz, text, boolean) to service_role;
