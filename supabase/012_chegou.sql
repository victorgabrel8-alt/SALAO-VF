-- =====================================================================
-- 012_chegou.sql — precisa do 011 aplicado antes
-- "Chegou": a Gleide toca no Início quando a cliente entra no salão (antes de concluir).
--   - agendamentos.chegou_em: quando ela chegou (vazio = ainda não chegou)
--   - quem chegou não recebe as mensagens de atraso, não vira pergunta "veio ou libera?"
--     para a Gleide e não pode ter o horário liberado
-- Rodar ANTES de publicar o app com o botão (o app lê essa coluna).
-- =====================================================================

alter table agendamentos add column chegou_em timestamptz;

-- Igual ao 011, mais "não chegou"
create or replace function n8n_atrasos_para_chamar(p_empresa_id uuid)
returns table (agendamento_id uuid, cliente_id uuid, nome text, telefone text, inicio timestamptz, servico text, etapa int)
language sql stable set search_path = public as $$
  select a.id, c.id, c.nome, c.telefone, a.inicio, s.nome, x.feitas + 1
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    join empresas e on e.id = a.empresa_id
    left join servicos s on s.id = a.servico_id
    cross join lateral (select count(*)::int as feitas, max(ct.criado_em) as ultima
                          from contatos ct where ct.agendamento_id = a.id and ct.tipo = 'atraso') x
   where a.empresa_id = p_empresa_id
     and a.status = 'agendado'
     and a.chegou_em is null
     and coalesce((e.config->'atrasos'->>'chamar')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'atrasos'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'atrasos'->'so_para') ? c.telefone)
     and ((x.feitas = 0 and a.inicio <= now() - interval '5 minutes' and a.inicio > now() - interval '20 minutes')
          or (x.feitas = 1 and a.inicio <= now() - interval '25 minutes' and a.inicio > now() - interval '45 minutes'
              and x.ultima <= now() - interval '15 minutes'))
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor in ('cliente', 'humano')
                      and m.criado_em > a.inicio - interval '1 hour')
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < now())
   order by a.inicio
$$;

-- Igual ao 011, e 'atraso_confirmar' só para quem não chegou
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
  select 'atraso_confirmar', ag.id, ag.empresa_id, ag.cliente_id,
         c.nome, c.telefone, null, ag.id, ag.inicio,
         s.nome, null, null
    from agendamentos ag
    join clientes c on c.id = ag.cliente_id
    left join servicos s on s.id = ag.servico_id
   where ag.status = 'agendado'
     and ag.chegou_em is null
     and coalesce(ag.fim, ag.inicio) >= now()
     and ag.inicio < now()
     and (select count(*) from contatos ct where ct.agendamento_id = ag.id and ct.tipo = 'atraso') >= 2
     and not exists (select 1 from contatos ct where ct.agendamento_id = ag.id and ct.tipo = 'atraso'
                      and (ct.resultado <> 'pendente' or ct.criado_em > now() - interval '10 minutes'))
     and not exists (select 1 from mensagens m where m.cliente_id = ag.cliente_id and m.autor in ('cliente', 'humano')
                      and m.criado_em > ag.inicio - interval '1 hour')
  union all
  select 'pensando_vencido', av.id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id, null, null,
         av.tecnica_indicada, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join clientes c on c.id = av.cliente_id
   where av.resultado = 'pensando'
     and av.data_proximo_passo <= hoje_cuiaba()
) p;

-- Quem chegou não tem o horário liberado, nem se a Gleide disser "libera" por engano
create or replace function n8n_assistente_liberar_horario(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_ini timestamptz; v_fim timestamptz; v_vaga uuid; v_oferece boolean;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then
    raise exception 'número % não autorizado', p_pedido_por;
  end if;
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  if ag.status <> 'agendado' then
    raise exception 'esse horário não está mais em aberto (está como %)', ag.status;
  end if;
  if ag.chegou_em is not null then
    raise exception 'ela já chegou (marcado às %): o horário não foi liberado',
      to_char(ag.chegou_em at time zone 'America/Cuiaba', 'HH24:MI');
  end if;

  update agendamentos set status = 'faltou' where id = ag.id;
  v_ini := to_timestamp(ceil(extract(epoch from now() + interval '40 minutes') / 1800) * 1800);
  v_fim := coalesce(ag.fim, ag.inicio + interval '1 hour');
  if v_fim - v_ini >= interval '30 minutes' then
    insert into vagas (empresa_id, inicio, fim, agendamento_id, motivo)
    values (ag.empresa_id, v_ini, v_fim, ag.id, 'atraso')
    returning id into v_vaga;
  end if;
  select coalesce((config->'vagas'->>'oferecer')::boolean, false) into v_oferece from empresas where id = p_empresa_id;

  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, ag.cliente_id, 'assistente', 'n8n_assistente_liberar_horario', 'agendamentos', ag.id,
          jsonb_build_object('vaga_id', v_vaga, 'vaga_inicio', case when v_vaga is not null then v_ini end), p_pedido_por);

  return jsonb_build_object('status', 'faltou',
    'vaga', case when v_vaga is null then 'não sobrou tempo para oferecer o horário'
                 when not v_oferece then 'vaga aberta, mas a oferta de vagas está desligada no salão'
                 else 'vou oferecer a partir das ' || to_char(v_ini at time zone 'America/Cuiaba', 'HH24:MI') ||
                      ' para quem tem horário mais tarde hoje' end);
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'n8n_atrasos_para_chamar(uuid)',
    'n8n_assistente_liberar_horario(uuid, text, uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
