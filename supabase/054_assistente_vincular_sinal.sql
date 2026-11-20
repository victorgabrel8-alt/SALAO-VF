-- 054: sinal pago que sumia quando a DONA marcava o horário (PDF "IA da Carol · Erros", erro 4: 6 de 11 comprovantes).
-- Quando a IA de atendimento marca, o criar_agendamento já grava o sinal (supabase/037). Quando a assistente da dona
-- marca (n8n_assistente_marcar_horario_v2), ninguém olhava o comprovante que a cliente tinha mandado: no dia a
-- Caroline podia cobrar o valor cheio.
-- Esta função é chamada pelo n8n logo depois da marcação feita pela assistente: usa a MESMA conferência do
-- atendimento (n8n_sinal_conferir: comprovante das últimas 48 h, ainda não usado, valor, recebedor, data, situação)
-- e, se bater, grava o sinal no horário recém-marcado. Não bate: não grava nada.
-- Diferenças para o atendimento (achadas no teste de 20/11): procura também no cadastro com/sem o 9, e um Pix
-- maior que 1,5 vez o sinal não é ligado (aqui o comprovante pode ter vindo de outra conversa, de outro serviço).
-- Só soma: função nova; nada existente muda.

create or replace function n8n_assistente_vincular_sinal(p_empresa_id uuid, p_agendamento_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_ag   record;
  v_tel  text;
  v_r    jsonb;
begin
  select a.id, a.sinal_codigo, a.status, c.telefone into v_ag
  from agendamentos a join clientes c on c.id = a.cliente_id
  where a.id = p_agendamento_id and a.empresa_id = p_empresa_id;
  if v_ag.id is null then return jsonb_build_object('vinculado', false, 'motivo', 'sem_agendamento'); end if;
  if v_ag.sinal_codigo is not null then return jsonb_build_object('vinculado', false, 'motivo', 'ja_tem_sinal'); end if;
  if v_ag.status <> 'agendado' then return jsonb_build_object('vinculado', false, 'motivo', 'nao_agendado'); end if;

  v_r := n8n_sinal_conferir(p_empresa_id, v_ag.telefone);
  if not coalesce((v_r->>'exige')::boolean, false) then return jsonb_build_object('vinculado', false, 'motivo', 'loja_sem_sinal'); end if;
  -- cliente com dois cadastros (com e sem o 9, ver 049): o comprovante pode estar na conversa do outro número
  if not coalesce((v_r->>'ok')::boolean, false) and coalesce(v_r->>'motivo', '') = 'sem_comprovante' then
    v_tel := case
      when v_ag.telefone ~ '^55\d\d9\d{8}$' then substr(v_ag.telefone, 1, 4) || substr(v_ag.telefone, 6)
      when v_ag.telefone ~ '^55\d\d\d{8}$' then substr(v_ag.telefone, 1, 4) || '9' || substr(v_ag.telefone, 5)
      else null end;
    if v_tel is not null and exists (select 1 from clientes where empresa_id = p_empresa_id and telefone = v_tel) then
      v_r := n8n_sinal_conferir(p_empresa_id, v_tel);
    end if;
  end if;
  if not coalesce((v_r->>'ok')::boolean, false) then return jsonb_build_object('vinculado', false, 'motivo', coalesce(v_r->>'motivo', 'nao_confere')); end if;
  -- Pix muito acima do sinal provavelmente pagou outra coisa (ex.: o serviço de ontem, R$ 90): não vira sinal
  -- deste horário. A Caroline continua podendo registrar à mão.
  if (v_r->>'valor_sinal') is not null and (v_r->>'valor_pago')::numeric > 1.5 * (v_r->>'valor_sinal')::numeric then
    return jsonb_build_object('vinculado', false, 'motivo', 'valor_acima_do_sinal', 'valor_pago', (v_r->>'valor_pago')::numeric);
  end if;

  begin
    update agendamentos
       set sinal_valor = (v_r->>'valor_pago')::numeric, sinal_codigo = v_r->>'codigo', sinal_pago_em = now(),
           sinal_comprovante = v_r->'comprovante'
     where id = p_agendamento_id and sinal_codigo is null;
  exception when unique_violation then
    return jsonb_build_object('vinculado', false, 'motivo', 'ja_usado');
  end;
  return jsonb_build_object('vinculado', true, 'valor', (v_r->>'valor_pago')::numeric);
end $$;

revoke all on function n8n_assistente_vincular_sinal(uuid, uuid) from public, anon, authenticated;
grant execute on function n8n_assistente_vincular_sinal(uuid, uuid) to service_role;
