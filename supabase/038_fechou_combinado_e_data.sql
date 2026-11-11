-- 038: avaliação que fechou guarda o que foi combinado e o dia em que a cliente volta, e a assistente cobra a Gleide
-- nesse dia (sem insistir).
--
-- Em 11/11/2026 as duas clientes que fecharam (Roseli e Monyse) estavam só com "fechou": sem o combinado e sem data.
-- A data muitas vezes depende do cabelo chegar pela transportadora e, às vezes, de confecção. A assistente pergunta
-- esses prazos, o fluxo calcula a data (chegada + confecção + 1 dia) e, nessa data, a Gleide recebe UMA pergunta
-- ("chegou? já tem dia?"). Sem resposta, pergunta de novo 3 dias depois. Para quando a aplicação entra na agenda.
--
-- Só soma: um tipo novo de pendência, e "fechou" pode ser completado depois (antes criava outra avaliação).

-- 1) Pendências: tudo igual ao 012, mais 'fechou_sem_data'.
--    pendencia_id muda a cada data nova (md5 de avaliação + data): cada data é uma pergunta nova.
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
  union all
  -- fechou, mas a aplicação/compra ainda não está na agenda e chegou o dia de perguntar
  -- (sem data: no dia seguinte ao "fechou"). Só nos últimos 120 dias.
  select 'fechou_sem_data', md5(av.id::text || '|' || coalesce(av.data_proximo_passo::text, '-'))::uuid,
         av.empresa_id, av.cliente_id, c.nome, c.telefone, av.id, null, null,
         av.tecnica_indicada, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join clientes c on c.id = av.cliente_id
    left join agendamentos aa on aa.id = av.agendamento_id
   where av.resultado = 'fechou'
     and av.resultado_em > now() - interval '120 days'
     and coalesce(av.data_proximo_passo, (av.resultado_em at time zone 'America/Cuiaba')::date + 1) <= hoje_cuiaba()
     and not exists (
       select 1 from agendamentos x
         left join servicos s on s.id = x.servico_id
        where x.cliente_id = av.cliente_id
          and x.id is distinct from av.agendamento_id
          and x.status in ('agendado', 'realizado')
          and x.inicio >= coalesce(aa.inicio, av.criado_em)
          and coalesce(s.nome, '') !~* 'avalia')
) p;

-- 2) Quando perguntar: as de sempre na hora, +1 h e +2 h (igual ao 011); 'fechou_sem_data' uma vez por data,
--    e de novo só 3 dias depois se ela não respondeu.
create or replace function n8n_assistente_pendencias_novas(p_empresa_id uuid)
returns setof pendencias_gleide language sql stable set search_path = public as $$
  select p.* from pendencias_gleide p
   where p.empresa_id = p_empresa_id
     and case when p.tipo = 'fechou_sem_data'
              then p.perguntado_em is null or p.perguntado_em < now() - interval '3 days'
              else (p.perguntado_em is null or p.perguntado_em < now() - interval '50 minutes')
                   and coalesce((select min(r.criado_em) from registros_ia r
                                  where r.acao = 'perguntou' and r.registro_id = p.pendencia_id), now())
                       > now() - interval '2 hours 10 minutes'
         end
   order by p.inicio nulls last
$$;

-- 3) "fechou" pode ser completado ou desfeito depois: sem avaliação pendente/pensando, a resposta atualiza a última
--    que fechou (120 dias) em vez de criar outra. Completar não muda a data em que fechou.
create or replace function n8n_assistente_resultado_avaliacao(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid, p_dados jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare v_id uuid; v_agend uuid; d jsonb := coalesce(p_dados, '{}'::jsonb);
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if coalesce(d->>'resultado', '') not in ('fechou', 'pensando', 'nao_fechou') then
    raise exception 'resultado deve ser fechou, pensando ou nao_fechou';
  end if;
  if not exists (select 1 from clientes where id = p_cliente_id and empresa_id = p_empresa_id) then
    raise exception 'cliente % não encontrada', p_cliente_id;
  end if;
  select id, agendamento_id into v_id, v_agend from avaliacoes
   where cliente_id = p_cliente_id and empresa_id = p_empresa_id and resultado in ('pendente', 'pensando');
  -- sem avaliação em aberto: a resposta (fechou de novo, desistiu, voltou a pensar) vale para o último "fechou"
  if v_id is null then
    select id, agendamento_id into v_id, v_agend from avaliacoes
     where cliente_id = p_cliente_id and empresa_id = p_empresa_id and resultado = 'fechou'
       and resultado_em > now() - interval '120 days'
     order by resultado_em desc limit 1;
  end if;
  if v_id is null then
    insert into avaliacoes (empresa_id, cliente_id) values (p_empresa_id, p_cliente_id) returning id into v_id;
  end if;
  update avaliacoes set
    tecnica_indicada       = coalesce(nullif(d->>'tecnica_indicada', ''),  tecnica_indicada),
    tipo_cabelo            = coalesce(nullif(d->>'tipo_cabelo', ''),       tipo_cabelo),
    comprimento_cm         = coalesce((nullif(d->>'comprimento_cm', ''))::int, comprimento_cm),
    gramas                 = coalesce((nullif(d->>'gramas', ''))::int,     gramas),
    valor_orcado           = coalesce((nullif(d->>'valor_orcado', ''))::numeric, valor_orcado),
    motivo_nao_fechou      = coalesce(nullif(d->>'motivo_nao_fechou', ''), motivo_nao_fechou),
    proximo_passo          = coalesce(nullif(d->>'proximo_passo', ''),     proximo_passo),
    -- resultado mudou e não veio data nova: a data antiga (ex.: do "pensando") não vale mais
    data_proximo_passo     = case when nullif(d->>'data_proximo_passo', '') is not null then (d->>'data_proximo_passo')::date
                                  when resultado is distinct from d->>'resultado' then null
                                  else data_proximo_passo end,
    agendamento_servico_id = coalesce((nullif(d->>'agendamento_servico_id', ''))::uuid, agendamento_servico_id),
    observacoes_gleide     = coalesce(nullif(d->>'observacoes', ''),       observacoes_gleide),
    resultado_em           = case when resultado = 'fechou' and d->>'resultado' = 'fechou' then resultado_em else now() end,
    resultado              = d->>'resultado'
  where id = v_id;
  if v_agend is not null then
    update agendamentos set status = 'realizado' where id = v_agend and status = 'agendado';
  end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, p_cliente_id, 'assistente', 'n8n_assistente_resultado_avaliacao', 'avaliacoes', v_id, d, p_pedido_por);
  -- devolve a data gravada: a assistente diz à Gleide em que dia vai perguntar de novo
  return jsonb_build_object('avaliacao_id', v_id,
    'data_proximo_passo', (select to_char(data_proximo_passo, 'DD/MM/YYYY') from avaliacoes where id = v_id));
end $$;
