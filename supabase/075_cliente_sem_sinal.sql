-- 075: cliente que não paga sinal (permuta, cliente da casa). Pedido do Victor (24/11/2026, Caroline e a Stela).
-- A Caroline disse à assistente "é minha cliente de permuta, não precisa pedir sinal". Isso virou regra da própria
-- assistente (guardar_regra), que a IA de atendimento não lê, e a agenda recusa marcar sem comprovante.
-- Agora a marca fica na ficha da cliente:
--   - clientes.sem_sinal (padrão false: ninguém muda);
--   - n8n_assistente_sem_sinal: a assistente liga ou desliga e anota o motivo na ficha (a IA lê as observações);
--   - n8n_sinal_conferir_v2: igual à n8n_sinal_conferir, mas cliente com sem_sinal passa sem comprovante.
--     Só a loja que liga isso no código (assistente-oferecer.js) usa a v2; a Gleide continua na de sempre.
-- Só soma: coluna nova com padrão, funções novas.
alter table clientes add column if not exists sem_sinal boolean not null default false;

create or replace function n8n_sinal_conferir_v2(p_empresa_id uuid, p_telefone text, p_agora timestamptz default now())
returns jsonb language plpgsql set search_path = public as $$
begin
  if exists (select 1 from clientes where empresa_id = p_empresa_id and telefone = p_telefone and sem_sinal) then
    return jsonb_build_object('exige', false, 'ok', true, 'motivo', 'cliente_sem_sinal');
  end if;
  return n8n_sinal_conferir(p_empresa_id, p_telefone, p_agora);
end $$;

create or replace function n8n_assistente_sem_sinal(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid,
  p_sem_sinal boolean default true, p_motivo text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_nome text;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  update clientes set sem_sinal = coalesce(p_sem_sinal, true),
         observacoes = concat_ws(E'\n', nullif(observacoes, ''), to_char(now() at time zone 'America/Cuiaba', 'DD/MM') || ': ' ||
           case when coalesce(p_sem_sinal, true) then 'Não cobrar sinal' else 'Volta a pagar sinal' end ||
           coalesce(' (' || nullif(trim(p_motivo), '') || ')', '') || '.')
   where id = p_cliente_id and empresa_id = p_empresa_id
  returning nome into v_nome;
  if not found then raise exception 'cliente % não encontrada', p_cliente_id; end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, p_cliente_id, 'assistente', 'n8n_assistente_sem_sinal', 'clientes', p_cliente_id,
          jsonb_build_object('sem_sinal', coalesce(p_sem_sinal, true), 'motivo', p_motivo), p_pedido_por);
  return jsonb_build_object('cliente_id', p_cliente_id, 'nome', v_nome, 'sem_sinal', coalesce(p_sem_sinal, true));
end $$;

revoke all on function n8n_sinal_conferir_v2(uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function n8n_assistente_sem_sinal(uuid, text, uuid, boolean, text) from public, anon, authenticated;
grant execute on function n8n_sinal_conferir_v2(uuid, text, timestamptz) to service_role;
grant execute on function n8n_assistente_sem_sinal(uuid, text, uuid, boolean, text) to service_role;
