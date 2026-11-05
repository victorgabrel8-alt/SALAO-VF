-- =====================================================================
-- 032_assistente_primeiro_contato.sql — a assistente cadastra e chama cliente sem criar horário (pedido do Victor, 05/11).
-- Antes ela só falava com quem tinha horário e chegou a marcar avaliação que a cliente não pediu para conseguir mandar mensagem.
-- A resposta da cliente cai na IA de atendimento, que vê o recado na ficha ("AVISO DO SALÃO").
-- A agenda passa a mostrar também o que aconteceu com o lembrete de cada horário.
-- Só soma: duas funções novas e dois campos a mais na resposta da agenda.
-- =====================================================================

create or replace function n8n_assistente_cadastrar_cliente(p_empresa_id uuid, p_pedido_por text, p_telefone text, p_nome text default null, p_observacoes text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_tel text; v_sem9 text; c clientes%rowtype; v_nova boolean := false;
        v_nome text := nullif(trim(coalesce(p_nome, '')), ''); v_obs text := nullif(trim(coalesce(p_observacoes, '')), '');
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  v_tel := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if v_tel !~ '^55[0-9]{10,11}$' then raise exception 'telefone inválido: peça com DDD, ex.: 66 99999-8888'; end if;
  -- celular antigo pode estar sem o 9 no WhatsApp: guarda com o 9, como o resto do sistema, e acha as duas formas
  if v_tel ~ '^55[0-9]{2}[6-9][0-9]{7}$' then v_tel := left(v_tel, 4) || '9' || substr(v_tel, 5); end if;
  v_sem9 := regexp_replace(v_tel, '^(55[0-9]{2})9([0-9]{8})$', '\1\2');
  select * into c from clientes where empresa_id = p_empresa_id and telefone in (v_tel, v_sem9) order by telefone = v_tel desc limit 1;
  if found then
    if 'sistema:excluida' = any (c.etiquetas) then raise exception 'esse número é de uma cliente excluída no app'; end if;
    update clientes set
      nome = coalesce(nullif(trim(coalesce(nome, '')), ''), v_nome),
      observacoes = case when v_obs is null then observacoes else concat_ws(E'\n', nullif(observacoes, ''), to_char(now() at time zone 'America/Cuiaba', 'DD/MM') || ': ' || v_obs) end
     where id = c.id returning * into c;
  else
    v_nova := true;
    insert into clientes (empresa_id, telefone, nome, observacoes)
    values (p_empresa_id, v_tel, v_nome, case when v_obs is null then null else to_char(now() at time zone 'America/Cuiaba', 'DD/MM') || ': ' || v_obs end)
    returning * into c;
  end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, c.id, 'assistente', 'n8n_assistente_cadastrar_cliente', 'clientes', c.id, jsonb_build_object('nova', v_nova, 'observacoes', v_obs), p_pedido_por);
  return jsonb_build_object('cliente_id', c.id, 'nome', c.nome, 'tel_final', right(c.telefone, 4), 'nova', v_nova);
end $$;

create or replace function n8n_assistente_chamar_cliente(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid, p_texto text)
returns jsonb language plpgsql set search_path = public as $$
declare c clientes%rowtype; v_texto text := nullif(trim(coalesce(p_texto, '')), ''); v_contato uuid;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if v_texto is null then raise exception 'diga o texto da mensagem'; end if;
  select * into c from clientes where id = p_cliente_id and empresa_id = p_empresa_id;
  if not found then raise exception 'cliente % não encontrada', p_cliente_id; end if;
  if 'sistema:excluida' = any (c.etiquetas) then raise exception 'essa cliente foi excluída no app'; end if;
  if exists (select 1 from contatos where cliente_id = c.id and mensagem = v_texto and criado_em > now() - interval '30 minutes') then
    raise exception 'essa mesma mensagem já foi mandada para ela agora há pouco';
  end if;
  insert into contatos (empresa_id, cliente_id, tipo, canal, mensagem)
  values (p_empresa_id, c.id, 'aviso', 'ia', v_texto)
  returning id into v_contato;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, c.id, 'assistente', 'n8n_assistente_chamar_cliente', 'contatos', v_contato, jsonb_build_object('mensagem', v_texto), p_pedido_por);
  return jsonb_build_object('contato_id', v_contato, 'telefone', c.telefone, 'nome', c.nome, 'mensagem', v_texto);
end $$;

-- agenda: mesma resposta de antes, com o lembrete de cada horário
create or replace function n8n_assistente_agenda_do_dia(p_empresa_id uuid, p_pedido_por text, p_data date default null)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  return (select coalesce(jsonb_agg(x order by x.inicio), '[]'::jsonb) from (
    select a.id as agendamento_id, a.cliente_id, c.nome, right(c.telefone, 4) as tel_final,
           to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI') as hora,
           to_char(coalesce(a.fim, a.inicio + interval '1 hour') at time zone 'America/Cuiaba', 'HH24:MI') as fim,
           a.inicio, s.nome as servico, a.status, a.valor, a.chegou_em is not null as chegou,
           (select jsonb_agg(s2.nome) from atendimento_servicos x join servicos s2 on s2.id = x.servico_id
             where x.agendamento_id = a.id) as servicos_a_mais,
           case when l.id is null then 'não enviado'
                when l.resultado in ('respondeu', 'agendou') then 'respondeu'
                else 'enviado, sem resposta' end as lembrete,
           case when l.id is not null then (select left(m.conteudo, 120) from mensagens m
             where m.cliente_id = a.cliente_id and m.direcao = 'entrada' and m.criado_em > l.criado_em
             order by m.criado_em limit 1) end as resposta_ao_lembrete
      from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
      left join lateral (select ct.id, ct.resultado, ct.criado_em from contatos ct
        where ct.agendamento_id = a.id and ct.tipo = 'lembrete' order by ct.criado_em desc limit 1) l on true
     where a.empresa_id = p_empresa_id
       and (a.inicio at time zone 'America/Cuiaba')::date = coalesce(p_data, hoje_cuiaba())
       and not ('sistema:excluida' = any (c.etiquetas))) x);
end $$;

revoke all on function n8n_assistente_cadastrar_cliente(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function n8n_assistente_chamar_cliente(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function n8n_assistente_agenda_do_dia(uuid, text, date) from public, anon, authenticated;

-- Depois do teste: recado sem horário não corta o lembrete, e a agenda só mostra "respondeu" quando há resposta
-- ao lembrete deste horário (o lembrete de um horário remarcado não vale mais).
create or replace function n8n_lembretes_para_mandar(p_empresa_id uuid, p_agora timestamptz default now())
returns table(agendamento_id uuid, cliente_id uuid, nome text, telefone text, inicio timestamptz, servico text, online boolean, endereco text)
language sql stable set search_path = public as $$
  select a.id, c.id, c.nome, c.telefone, a.inicio, s.nome,
         coalesce(s.nome ilike '%online%', false), e.config->>'endereco'
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    join empresas e on e.id = a.empresa_id
    left join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id
     and a.status = 'agendado'
     and coalesce((e.config->'lembretes'->>'ligado')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'lembretes'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'lembretes'->'so_para') ? c.telefone)
     and a.criado_em < p_agora - interval '2 hours'
     and (
           ((a.inicio at time zone 'America/Cuiaba')::date = (p_agora at time zone 'America/Cuiaba')::date + 1
            and (p_agora at time zone 'America/Cuiaba')::time >= coalesce(e.config->'lembretes'->>'vespera', '18:00')::time)
        or (a.inicio > p_agora + interval '45 minutes' and a.inicio <= p_agora + interval '4 hours')
         )
     and not exists (select 1 from contatos ct where ct.agendamento_id = a.id and ct.tipo = 'lembrete'
                      and ct.horario_original = a.inicio)
     -- recado sem horário (chamar_cliente) não conta: só aviso ou remarcação ligados a um horário seguram o lembrete
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.tipo in ('remarcacao', 'aviso')
                      and ct.agendamento_id is not null
                      and ct.resultado in ('pendente', 'respondeu') and ct.criado_em > p_agora - interval '14 days')
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor in ('cliente', 'humano')
                      and m.criado_em > p_agora - interval '1 hour')
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by a.inicio
$$;

create or replace function n8n_assistente_agenda_do_dia(p_empresa_id uuid, p_pedido_por text, p_data date default null)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  return (select coalesce(jsonb_agg(x order by x.inicio), '[]'::jsonb) from (
    select a.id as agendamento_id, a.cliente_id, c.nome, right(c.telefone, 4) as tel_final,
           to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI') as hora,
           to_char(coalesce(a.fim, a.inicio + interval '1 hour') at time zone 'America/Cuiaba', 'HH24:MI') as fim,
           a.inicio, s.nome as servico, a.status, a.valor, a.chegou_em is not null as chegou,
           (select jsonb_agg(s2.nome) from atendimento_servicos x join servicos s2 on s2.id = x.servico_id
             where x.agendamento_id = a.id) as servicos_a_mais,
           case when l.id is null then 'não enviado'
                when r.criado_em is not null then 'respondeu'
                else 'enviado, sem resposta' end as lembrete,
           coalesce(left(r.conteudo, 120), case when r.criado_em is not null then '[' || r.tipo || ']' end) as resposta_ao_lembrete
      from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
      left join lateral (select ct.id, ct.criado_em from contatos ct
        where ct.agendamento_id = a.id and ct.tipo = 'lembrete' and ct.horario_original = a.inicio
        order by ct.criado_em desc limit 1) l on true
      left join lateral (select m.conteudo, m.tipo, m.criado_em from mensagens m
        where l.id is not null and m.cliente_id = a.cliente_id and m.direcao = 'entrada' and m.criado_em > l.criado_em
        order by m.criado_em limit 1) r on true
     where a.empresa_id = p_empresa_id
       and (a.inicio at time zone 'America/Cuiaba')::date = coalesce(p_data, hoje_cuiaba())
       and not ('sistema:excluida' = any (c.etiquetas))) x);
end $$;

revoke all on function n8n_lembretes_para_mandar(uuid, timestamptz) from public, anon, authenticated;
revoke all on function n8n_assistente_agenda_do_dia(uuid, text, date) from public, anon, authenticated;
