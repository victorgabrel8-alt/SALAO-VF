-- 039: a dona pede para a assistente "dar um toque" na cliente numa data, e a IA de atendimento manda o alô nesse dia.
--
-- Em 11/11/2026 a Gleide disse à assistente: "elas disseram que voltam em janeiro, em janeiro dá um toque pra elas"
-- (Roseli e Monyse). A assistente não tinha como marcar isso: o retorno combinado (028) só era gravado pela IA de
-- atendimento. Ela respondeu "no dia 01/01 eu te pergunto das duas", a Gleide não entendeu, e ninguém foi chamada.
--
-- Só soma: função nova. Usa a mesma tabela e o mesmo envio do 028/036 ("IA - Retorno combinado").
-- Diferenças do n8n_combinar_retorno: cliente pelo id, número da dona conferido, até 120 dias (a dona combina mais longe
-- que a cliente), e erro com mensagem clara em vez de ok=false.
create or replace function n8n_assistente_combinar_retorno(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid,
                                                           p_data date, p_assunto text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_id uuid; v_cfg jsonb; v_tel text; v_nome text; v_vai boolean;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  select telefone, nome into v_tel, v_nome from clientes where id = p_cliente_id and empresa_id = p_empresa_id;
  if not found then raise exception 'cliente % não encontrada', p_cliente_id; end if;
  if p_data is null then raise exception 'qual dia?'; end if;
  if p_data <= hoje_cuiaba() then raise exception 'a data tem que ser depois de hoje (para hoje, use chamar_cliente)'; end if;
  if p_data > hoje_cuiaba() + 120 then raise exception 'data a mais de 120 dias: escolha uma data mais perto'; end if;

  update retornos_combinados set situacao = 'cancelado', motivo = 'combinou outra data', resolvido_em = now()
   where cliente_id = p_cliente_id and situacao = 'aguardando';
  insert into retornos_combinados (empresa_id, cliente_id, data, assunto)
  values (p_empresa_id, p_cliente_id, p_data, nullif(trim(p_assunto), ''))
  returning id into v_id;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, p_cliente_id, 'assistente', 'n8n_assistente_combinar_retorno', 'retornos_combinados', v_id,
          jsonb_build_object('data', p_data, 'assunto', p_assunto), p_pedido_por);

  select coalesce(config->'retorno', '{}'::jsonb) into v_cfg from empresas where id = p_empresa_id;
  v_vai := coalesce((v_cfg->>'ligado')::boolean, false)
           and (jsonb_array_length(coalesce(v_cfg->'so_para', '[]'::jsonb)) = 0 or (v_cfg->'so_para') ? v_tel);
  return jsonb_build_object('retorno_id', v_id, 'nome', v_nome,
    'data', to_char(p_data, 'DD/MM/YYYY'), 'dia_da_semana',
    (array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[extract(dow from p_data)::int + 1],
    'vai_mandar', v_vai,
    'aviso', case when v_vai then 'nesse dia a IA de atendimento manda uma mensagem para ela (de manhã, no horário do salão); se ela marcar horário antes, não manda'
                  else 'ANOTADO, MAS O ENVIO AUTOMÁTICO ESTÁ DESLIGADO NESTE SALÃO: não prometa que a mensagem vai sair' end);
end $$;

revoke all on function n8n_assistente_combinar_retorno(uuid, text, uuid, date, text) from public, anon, authenticated;
grant execute on function n8n_assistente_combinar_retorno(uuid, text, uuid, date, text) to service_role;
