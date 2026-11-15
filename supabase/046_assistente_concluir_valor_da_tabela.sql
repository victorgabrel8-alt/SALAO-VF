-- Função nova (só soma): igual a n8n_assistente_concluir e, quando a dona não diz o valor, grava a soma dos preços
-- da tabela (serviço feito + serviços a mais). Valor que a dona disse nunca é trocado. Usada só pelas lojas que pedem
-- (Caroline e Loja Teste; ver n8n/demo-agente/assistente-marcar.js); a Gleide continua na função de sempre.
create or replace function public.n8n_assistente_concluir_c(
  p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
  p_servico text default null, p_extras text default null, p_valor numeric default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v jsonb; v_dito boolean; v_soma numeric;
begin
  -- a dona já tinha dito um valor para este atendimento? (olha antes de registrar a chamada de agora)
  select exists (select 1 from registros_ia r where r.empresa_id = p_empresa_id and r.registro_id = p_agendamento_id
                   and r.acao = 'n8n_assistente_concluir' and nullif(r.dados->>'valor', '') is not null) into v_dito;
  v := n8n_assistente_concluir(p_empresa_id, p_pedido_por, p_agendamento_id, p_servico, p_extras, p_valor);
  if p_valor is not null then return v || jsonb_build_object('valor', p_valor, 'valor_origem', 'dito_pela_dona'); end if;
  if v_dito then
    return v || jsonb_build_object('valor', (select valor from agendamentos where id = p_agendamento_id), 'valor_origem', 'dito_pela_dona');
  end if;
  select coalesce(s.preco, 0) * coalesce(a.quantidade, 1)
         + coalesce((select sum(coalesce(sx.preco, 0)) from atendimento_servicos x join servicos sx on sx.id = x.servico_id where x.agendamento_id = a.id), 0)
    into v_soma
    from agendamentos a left join servicos s on s.id = a.servico_id
   where a.id = p_agendamento_id and a.empresa_id = p_empresa_id;
  if coalesce(v_soma, 0) > 0 then
    update agendamentos set valor = v_soma where id = p_agendamento_id and empresa_id = p_empresa_id;
    return v || jsonb_build_object('valor', v_soma, 'valor_origem', 'tabela');
  end if;
  return v;
end $$;
revoke all on function public.n8n_assistente_concluir_c(uuid, text, uuid, text, text, numeric) from public, anon, authenticated;
grant execute on function public.n8n_assistente_concluir_c(uuid, text, uuid, text, text, numeric) to service_role;
