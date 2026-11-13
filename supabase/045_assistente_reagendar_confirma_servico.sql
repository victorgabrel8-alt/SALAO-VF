-- Função nova (só soma): igual a n8n_assistente_reagendar, com duas diferenças para as lojas que reservam um bloco
-- por cliente (Caroline e Loja Teste):
--   1. trocar ou confirmar o serviço não encolhe o horário: vale o tempo que já estava reservado
--      (o bloco da loja ou a hora de terminar que a dona estipulou);
--   2. quando a dona informa o serviço, sai das observações a marca "serviço não confirmado".
create or replace function public.n8n_assistente_reagendar_confirma(
  p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid, p_inicio timestamptz, p_servico text, p_forcar boolean)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v jsonb; v_dur interval; v_fim timestamptz;
begin
  select fim - inicio into v_dur from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  v := n8n_assistente_reagendar(p_empresa_id, p_pedido_por, p_agendamento_id, p_inicio, p_servico, p_forcar);
  if v_dur is not null and v_dur > interval '0' then
    update agendamentos set fim = inicio + v_dur
     where id = p_agendamento_id and empresa_id = p_empresa_id and fim is distinct from inicio + v_dur
    returning fim into v_fim;
    if v_fim is not null and v ? 'ate' then
      v := jsonb_set(v, '{ate}', to_jsonb(to_char(v_fim at time zone 'America/Cuiaba', 'HH24:MI')));
    end if;
  end if;
  if nullif(trim(coalesce(p_servico, '')), '') is not null then
    update agendamentos
       set observacoes = nullif(trim(regexp_replace(observacoes, '\s*servi[cç]o n[aã]o confirmado[^.\n]*\.?', '', 'gi')), '')
     where id = p_agendamento_id and empresa_id = p_empresa_id and observacoes ~* 'servi[cç]o n[aã]o confirmado';
  end if;
  return v;
end $$;
revoke all on function public.n8n_assistente_reagendar_confirma(uuid, text, uuid, timestamptz, text, boolean) from public, anon, authenticated;
grant execute on function public.n8n_assistente_reagendar_confirma(uuid, text, uuid, timestamptz, text, boolean) to service_role;
