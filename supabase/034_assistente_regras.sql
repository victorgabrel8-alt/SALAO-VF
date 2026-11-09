-- 034: regras que a Gleide passa para a assistente ("a partir de agora, sempre…") ficam guardadas.
-- Antes ficavam só na memória da conversa (3 dias no Redis) e sumiam.
-- Só soma: três funções novas; a lista fica em empresas.config.assistente_regras = [{ texto, em }].

create or replace function n8n_assistente_guardar_regra(p_empresa_id uuid, p_pedido_por text, p_texto text)
returns jsonb language plpgsql set search_path = public as $$
declare v_texto text := nullif(btrim(p_texto), ''); v_lista jsonb;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if v_texto is null then raise exception 'regra vazia'; end if;
  select coalesce(config->'assistente_regras', '[]'::jsonb) into v_lista from empresas where id = p_empresa_id;
  if v_lista is null then raise exception 'empresa % não encontrada', p_empresa_id; end if;
  if jsonb_array_length(v_lista) >= 30 then raise exception 'já são 30 regras: peça para tirar alguma antes'; end if;
  v_lista := v_lista || jsonb_build_array(jsonb_build_object('texto', left(v_texto, 400),
    'em', to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY')));
  update empresas set config = jsonb_set(config, '{assistente_regras}', v_lista) where id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_guardar_regra', 'empresas', p_empresa_id, jsonb_build_object('texto', v_texto), p_pedido_por);
  return jsonb_build_object('regras', jsonb_array_length(v_lista));
end $$;

-- p_qual: o número da regra (1, 2…) ou um pedaço do texto dela
create or replace function n8n_assistente_tirar_regra(p_empresa_id uuid, p_pedido_por text, p_qual text)
returns jsonb language plpgsql set search_path = public as $$
declare v_lista jsonb; v_nova jsonb := '[]'::jsonb; v_tirou text; i int := 0; r jsonb; v_qual text := btrim(coalesce(p_qual, ''));
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  select coalesce(config->'assistente_regras', '[]'::jsonb) into v_lista from empresas where id = p_empresa_id;
  for r in select * from jsonb_array_elements(v_lista) loop
    i := i + 1;
    -- número = só a posição (senão "2" tirava a primeira regra que tivesse um 2 no texto); texto = pedaço da regra
    if v_tirou is null and v_qual <> '' and (case when v_qual ~ '^\d+$' then v_qual = i::text
                                                   else position(lower(v_qual) in lower(r->>'texto')) > 0 end) then
      v_tirou := r->>'texto';
    else
      v_nova := v_nova || jsonb_build_array(r);
    end if;
  end loop;
  if v_tirou is null then raise exception 'não achei a regra "%"', v_qual; end if;
  update empresas set config = jsonb_set(config, '{assistente_regras}', v_nova) where id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_tirar_regra', 'empresas', p_empresa_id, jsonb_build_object('texto', v_tirou), p_pedido_por);
  return jsonb_build_object('tirou', v_tirou, 'restam', jsonb_array_length(v_nova));
end $$;

-- Texto para o prompt da assistente: "1. … (desde 08/11/2026)"
create or replace function n8n_assistente_regras_texto(p_empresa_id uuid)
returns text language sql stable set search_path = public as $$
  select coalesce(string_agg(format('%s. %s (desde %s)', n, r->>'texto', r->>'em'), E'\n' order by n), '(nenhuma)')
    from empresas e, jsonb_array_elements(coalesce(e.config->'assistente_regras', '[]'::jsonb)) with ordinality as t(r, n)
   where e.id = p_empresa_id
$$;

revoke all on function n8n_assistente_guardar_regra(uuid, text, text) from public, anon, authenticated;
revoke all on function n8n_assistente_tirar_regra(uuid, text, text) from public, anon, authenticated;
revoke all on function n8n_assistente_regras_texto(uuid) from public, anon, authenticated;
