-- =====================================================================
-- 081 - Assistente da Caroline: consertos da conversa de 25/11/2026
--
-- Só soma: três funções novas (as antigas continuam como estão; a Gleide segue usando as dela) e permissões fechadas.
--
-- n8n_assistente_avisar_cliente_v2: o aviso pronto (sem texto da assistente) sai formal e sem o motivo da Caroline.
--   remarcação: "a Caroline não poderá atender ... por um motivo pessoal. Podemos remarcar?"; horário mudado: "precisamos
--   ajustar o seu horário". Quem manda é a mesma função de antes (mesmas travas e o mesmo registro).
-- n8n_assistente_guardar_regra_v2: regra não se empilha. p_trocar = número da regra que a nova substitui (fica no lugar
--   dela). Sem p_trocar: recusa regra igual ou quase igual a uma que já existe (diz qual) e regra que só se entende na
--   conversa ("adote mais essa pergunta"), para a assistente escrever a regra inteira.
-- n8n_assistente_buscar_cliente_v4: a v3 com a conversa_recente das 3 primeiras clientes achadas: as últimas
--   mensagens dos últimos 7 dias, com dia e hora. Caso Gabriela (25/11): ela avisou às 9h37 que não vinha sábado e às
--   15h38 a assistente disse que estava agendada e que ela não tinha respondido (só lia as últimas 3 horas).
-- Permissões: funções do n8n que tinham ficado abertas para a chave pública do app (anon e logins) passam a ser só do
--   servidor (service_role), como as outras. O app não usa nenhuma delas; o n8n usa a chave do servidor.
-- =====================================================================

create or replace function n8n_assistente_avisar_cliente_v2(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
  p_tipo text default 'aviso', p_texto text default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare ag agendamentos%rowtype; v_nome text; v_texto text := nullif(trim(coalesce(p_texto, '')), ''); v_de text;
begin
  if v_texto is null then
    select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
    if found then
      select nullif(split_part(trim(coalesce(c.nome, '')), ' ', 1), '') into v_nome from clientes c where c.id = ag.cliente_id;
      if p_tipo = 'remarcacao' then
        v_texto := 'Olá' || coalesce(', ' || v_nome, '') || '! Tudo bem? A Caroline não poderá atender ' ||
          lower(assistente_dia_longo((ag.inicio at time zone 'America/Cuiaba')::date)) || ' às ' ||
          to_char(ag.inicio at time zone 'America/Cuiaba', 'HH24:MI') ||
          ' por um motivo pessoal. Podemos remarcar? Por gentileza, diga qual dia fica melhor para você.';
      else
        v_de := substring(ag.observacoes from '.*Reagendado de (\d\d/\d\d às \d\d:\d\d)');
        if v_de is not null and ag.status = 'agendado' then
          v_texto := 'Olá' || coalesce(', ' || v_nome, '') || '! Tudo bem? Precisamos ajustar o seu horário: em vez de ' ||
            case when left(v_de, 5) = to_char(ag.inicio at time zone 'America/Cuiaba', 'DD/MM') then substring(v_de from 10) else v_de end ||
            ', será ' || assistente_quando(ag.inicio) || '. Esse horário fica bom para você? Caso não possa, avise por aqui, por gentileza.';
        end if;
      end if;
    end if;
  end if;
  -- as travas (número autorizado, horário a atender) e o registro continuam os da função de sempre
  return n8n_assistente_avisar_cliente(p_empresa_id, p_pedido_por, p_agendamento_id, p_tipo, v_texto);
end $$;

-- palavras que dizem o assunto de uma regra (sem acento, sem as que toda regra tem)
create or replace function assistente_palavras_regra(p text)
returns text[] language sql immutable set search_path to 'public' as $$
  select coalesce(array_agg(distinct w), '{}') from regexp_split_to_table(assistente_normalizar(p), '[^a-z0-9]+') w
   where length(w) > 3 and w not in ('sempre', 'nunca', 'cliente', 'clientes', 'caroline', 'carol', 'quando', 'para', 'mais',
     'como', 'pela', 'pelo', 'dela', 'dele', 'isso', 'essa', 'esse', 'esta', 'este', 'antes', 'depois', 'todas', 'todos', 'qualquer')
$$;

create or replace function n8n_assistente_guardar_regra_v2(p_empresa_id uuid, p_pedido_por text, p_texto text, p_trocar text default null)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v_texto text := nullif(btrim(p_texto), ''); v_lista jsonb; v_n int; v_igual int; v_igual_txt text; v_pal text[];
        v_quando text := to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY');
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if v_texto is null then raise exception 'regra vazia'; end if;
  -- "adote mais essa pergunta", "faz isso sempre": fora da conversa ninguém sabe o que é
  if assistente_normalizar(v_texto) ~ '\m(essa|esse|essas|esses|isso|dessa|desse|disso|daquela|daquele|aquilo)\M' and length(v_texto) < 160 then
    raise exception 'REGRA INCOMPLETA: "%" só se entende na conversa. Escreva a regra inteira, dizendo o que é (ex.: "Ao perguntar a disponibilidade da cliente, pergunte de forma aberta e gentil, sem impor horário"), e guarde de novo.', v_texto;
  end if;
  select coalesce(config->'assistente_regras', '[]'::jsonb) into v_lista from empresas where id = p_empresa_id;
  if v_lista is null then raise exception 'empresa % não encontrada', p_empresa_id; end if;
  v_n := case when btrim(coalesce(p_trocar, '')) ~ '^\d+$' then btrim(p_trocar)::int end;

  if v_n is not null then
    if v_n < 1 or v_n > jsonb_array_length(v_lista) then raise exception 'não existe a regra %', v_n; end if;
    v_lista := jsonb_set(v_lista, array[(v_n - 1)::text], jsonb_build_object('texto', left(v_texto, 400), 'em', v_quando));
  else
    -- igual ou quase igual a uma que já existe (metade ou mais das palavras do assunto): não soma
    v_pal := assistente_palavras_regra(v_texto);
    select e.ord, e.x->>'texto' into v_igual, v_igual_txt
      from jsonb_array_elements(v_lista) with ordinality as e(x, ord)
     where cardinality(v_pal) > 0
       and 2.0 * (select count(*) from unnest(v_pal) w where w = any (assistente_palavras_regra(e.x->>'texto')))
           / (cardinality(v_pal) + cardinality(assistente_palavras_regra(e.x->>'texto'))) >= 0.6
     order by e.ord limit 1;
    if v_igual is not null then
      raise exception 'JÁ EXISTE A REGRA %: "%". Se é o mesmo assunto, guarde de novo com trocar = % (a nova fica no lugar dela); se é outra coisa, escreva de um jeito que não se confunda.', v_igual, v_igual_txt, v_igual;
    end if;
    if jsonb_array_length(v_lista) >= 30 then raise exception 'já são 30 regras: peça para tirar alguma antes'; end if;
    v_lista := v_lista || jsonb_build_array(jsonb_build_object('texto', left(v_texto, 400), 'em', v_quando));
  end if;

  update empresas set config = jsonb_set(config, '{assistente_regras}', v_lista) where id = p_empresa_id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_guardar_regra_v2', 'empresas', p_empresa_id,
          jsonb_build_object('texto', v_texto, 'trocou', v_n), p_pedido_por);
  return jsonb_build_object('regras', jsonb_array_length(v_lista)) || case when v_n is null then '{}'::jsonb else jsonb_build_object('trocou_a', v_n) end;
end $$;

create or replace function n8n_assistente_buscar_cliente_v4(p_empresa_id uuid, p_pedido_por text, p_busca text)
returns jsonb language plpgsql set search_path to 'public' as $$
declare v jsonb := n8n_assistente_buscar_cliente_v3(p_empresa_id, p_pedido_por, p_busca);
begin
  if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) = 0 then return v; end if;
  return (
    select jsonb_agg(case when e.ord > 3 then c else c || jsonb_build_object('conversa_recente', coalesce((
      select jsonb_agg(m.linha order by m.criado_em)
        from (select x.criado_em,
                     to_char(x.criado_em at time zone 'America/Cuiaba', 'DD/MM HH24:MI') || ' ' ||
                     case x.autor when 'cliente' then 'ela' when 'ia' then 'IA' else 'studio' end || ': ' ||
                     left(regexp_replace(coalesce(nullif(x.conteudo, ''), '[' || coalesce(x.tipo, 'mensagem') || ']'), '\s+', ' ', 'g'), 200) as linha
                from mensagens x
               where x.empresa_id = p_empresa_id and x.cliente_id = (c->>'cliente_id')::uuid and x.criado_em > now() - interval '7 days'
               order by x.criado_em desc limit 6) m), '[]'::jsonb)) end order by e.ord)
      from jsonb_array_elements(v) with ordinality as e(c, ord));
end $$;

-- só o servidor chama
revoke all on function n8n_assistente_avisar_cliente_v2(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function n8n_assistente_guardar_regra_v2(uuid, text, text, text) from public, anon, authenticated;
revoke all on function n8n_assistente_buscar_cliente_v4(uuid, text, text) from public, anon, authenticated;
grant execute on function n8n_assistente_avisar_cliente_v2(uuid, text, uuid, text, text) to service_role;
grant execute on function n8n_assistente_guardar_regra_v2(uuid, text, text, text) to service_role;
grant execute on function n8n_assistente_buscar_cliente_v4(uuid, text, text) to service_role;

-- funções do n8n que estavam abertas para a chave pública do app
revoke all on function n8n_assistente_buscar_cliente_v3(uuid, text, text) from public, anon, authenticated;
revoke all on function n8n_assistente_regra_agenda(uuid, text, text, text, text, text, date, date, text, boolean, text, text) from public, anon, authenticated;
revoke all on function n8n_assistente_regras_texto_agenda(uuid) from public, anon, authenticated;
revoke all on function n8n_registrar_retomada(uuid, uuid, integer, text, text, text, text) from public, anon, authenticated;
revoke all on function n8n_retomadas_para_chamar_v2(uuid, timestamptz) from public, anon, authenticated;
grant execute on function n8n_assistente_buscar_cliente_v3(uuid, text, text) to service_role;
grant execute on function n8n_assistente_regra_agenda(uuid, text, text, text, text, text, date, date, text, boolean, text, text) to service_role;
grant execute on function n8n_assistente_regras_texto_agenda(uuid) to service_role;
grant execute on function n8n_registrar_retomada(uuid, uuid, integer, text, text, text, text) to service_role;
grant execute on function n8n_retomadas_para_chamar_v2(uuid, timestamptz) to service_role;
