-- =====================================================================
-- 006_assistente_no_supabase.sql — aplicado no Supabase em 22/10/2026
-- A assistente da Gleide (n8n) saiu do banco de teste e passou a usar o
-- Supabase pela API (chave de serviço), como o agente de atendimento.
--   1) pendencias_gleide: horário sem desfecho de hoje e de ontem (antes só
--      o de hoje: o que passava da meia-noite nunca era cobrado)
--   2) funções que substituem as consultas diretas da assistente
--      (buscar cliente, agenda do dia, pendências em texto e as novas)
-- =====================================================================

create or replace view pendencias_gleide with (security_invoker = true) as
select p.*,
       (select max(r.criado_em) from registros_ia r
         where r.acao = 'perguntou' and r.registro_id = p.pendencia_id) as perguntado_em
from (
  select 'avaliacao_sem_resultado' as tipo, av.id as pendencia_id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id as avaliacao_id, ag.id as agendamento_id, ag.inicio,
         s.nome as servico, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join agendamentos ag on ag.id = av.agendamento_id
    join clientes c on c.id = av.cliente_id
    left join servicos s on s.id = ag.servico_id
   where av.resultado = 'pendente'
     and ag.status in ('agendado', 'realizado')
     and coalesce(ag.fim, ag.inicio) < now() - interval '30 minutes'
  union all
  select 'atendimento_sem_status', ag.id, ag.empresa_id, ag.cliente_id,
         c.nome, c.telefone, null, ag.id, ag.inicio,
         s.nome, null, null
    from agendamentos ag
    join clientes c on c.id = ag.cliente_id
    left join servicos s on s.id = ag.servico_id
   where ag.status = 'agendado'
     and coalesce(ag.fim, ag.inicio) < now()
     and (ag.inicio at time zone 'America/Cuiaba')::date >= hoje_cuiaba() - 1
     and not exists (select 1 from avaliacoes av where av.agendamento_id = ag.id)
  union all
  select 'pensando_vencido', av.id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id, null, null,
         av.tecnica_indicada, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join clientes c on c.id = av.cliente_id
   where av.resultado = 'pensando'
     and av.data_proximo_passo <= hoje_cuiaba()
) p;

-- buscar_cliente: nome (ou parte) ou telefone
create or replace function n8n_assistente_buscar_cliente(p_empresa_id uuid, p_pedido_por text, p_busca text)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  return (select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select c.id as cliente_id, c.nome, c.telefone, c.status, f.etapa, c.ultima_visita, c.proximo_agendamento,
           f.pre_resumo, f.pre_tecnica_interesse, f.valor_orcado, f.data_proximo_passo, c.observacoes
      from clientes_status c join funil_clientes f on f.cliente_id = c.id
     where c.empresa_id = p_empresa_id
       and (c.nome ilike '%' || p_busca || '%'
            or (regexp_replace(p_busca, '\D', '', 'g') <> '' and c.telefone like '%' || regexp_replace(p_busca, '\D', '', 'g') || '%'))
     order by c.ultima_mensagem desc nulls last limit 8) x);
end $$;

-- agenda_do_dia: horários de um dia (vazio = hoje)
create or replace function n8n_assistente_agenda_do_dia(p_empresa_id uuid, p_pedido_por text, p_data date default null)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  return (select coalesce(jsonb_agg(x order by x.inicio), '[]'::jsonb) from (
    select a.id as agendamento_id, a.cliente_id, c.nome, to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI') as hora,
           a.inicio, s.nome as servico, a.status, a.valor
      from agendamentos a join clientes c on c.id = a.cliente_id left join servicos s on s.id = a.servico_id
     where a.empresa_id = p_empresa_id
       and (a.inicio at time zone 'America/Cuiaba')::date = coalesce(p_data, hoje_cuiaba())) x);
end $$;

-- As pendências abertas em texto, com os ids, para o prompt da assistente
create or replace function n8n_assistente_pendencias_texto(p_empresa_id uuid)
returns text language sql stable set search_path = public as $$
  select coalesce(string_agg(format('- [%s] %s (…%s)%s%s — cliente_id=%s%s',
           tipo, nome, right(telefone, 4),
           case when inicio is not null then ' ' || to_char(inicio at time zone 'America/Cuiaba', 'DD/MM HH24:MI') else '' end,
           case when servico is not null then ', ' || servico else '' end ||
           case when valor_orcado is not null then ', orçado R$ ' || valor_orcado else '' end ||
           case when proximo_passo is not null then ', próximo passo: ' || proximo_passo else '' end,
           cliente_id, case when agendamento_id is not null then ', agendamento_id=' || agendamento_id else '' end),
           E'\n' order by inicio nulls last), '(nenhuma)')
    from pendencias_gleide where empresa_id = p_empresa_id
$$;

-- As que a assistente ainda não perguntou nas últimas 3 h (o disparo a cada 15 min)
create or replace function n8n_assistente_pendencias_novas(p_empresa_id uuid)
returns setof pendencias_gleide language sql stable set search_path = public as $$
  select * from pendencias_gleide
   where empresa_id = p_empresa_id
     and (perguntado_em is null or perguntado_em < now() - interval '3 hours')
   order by inicio nulls last
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'n8n_assistente_buscar_cliente(uuid, text, text)',
    'n8n_assistente_agenda_do_dia(uuid, text, date)',
    'n8n_assistente_pendencias_texto(uuid)',
    'n8n_assistente_pendencias_novas(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- registrar_atendimento pelo nome do serviço ("manutenção", "aplicação"): acha o serviço e
-- chama a função do 004
create or replace function n8n_assistente_registrar_atendimento_nome(p_empresa_id uuid, p_pedido_por text, p_telefone text, p_nome text,
  p_servico text, p_inicio timestamptz default null, p_valor numeric default null, p_observacoes text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_servico uuid;
begin
  select id into v_servico from servicos
   where empresa_id = p_empresa_id and ativo and nome ilike '%' || coalesce(p_servico, '') || '%'
   order by length(nome) limit 1;
  return n8n_assistente_registrar_atendimento(p_empresa_id, p_pedido_por, p_telefone, p_nome, v_servico,
                                              coalesce(p_inicio, now()), p_valor, p_observacoes, null);
end $$;
revoke execute on function n8n_assistente_registrar_atendimento_nome(uuid, text, text, text, text, timestamptz, numeric, text) from public, anon, authenticated;
grant execute on function n8n_assistente_registrar_atendimento_nome(uuid, text, text, text, text, timestamptz, numeric, text) to service_role;
