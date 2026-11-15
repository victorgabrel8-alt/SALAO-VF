-- Função nova (só soma): lembrete em dois momentos, para as lojas que pedem (Caroline e Loja Teste;
-- ver n8n/demo-agente/lembrete-loja.js).
--   vespera     -> na véspera, a partir da hora de config.lembretes.vespera (padrão 18:00), se ainda não saiu nenhum lembrete deste horário;
--   horas_antes -> de config.lembretes.horas_antes (padrão 2) horas até 45 min antes, se ainda não saiu lembrete nas últimas horas
--                  (o da véspera não conta: a cliente recebe os dois).
-- Os outros filtros são os mesmos de n8n_lembretes_para_mandar, que continua igual para a Gleide.
create or replace function public.n8n_lembretes_para_mandar_c(p_empresa_id uuid, p_agora timestamptz default now())
returns table(agendamento_id uuid, cliente_id uuid, nome text, telefone text, inicio timestamptz, servico text, online boolean, endereco text, momento text)
language sql stable set search_path to 'public' as $$
  with base as (
    select a.id, c.id as cli, c.nome, c.telefone, a.inicio, s.nome as servico,
           coalesce(s.nome ilike '%online%', false) as online, e.config->>'endereco' as endereco,
           coalesce(nullif(e.config->'lembretes'->>'horas_antes', '')::numeric, 2) as horas,
           coalesce(e.config->'lembretes'->>'vespera', '18:00')::time as hora_vespera
      from agendamentos a
      join clientes c on c.id = a.cliente_id
      join empresas e on e.id = a.empresa_id
      left join servicos s on s.id = a.servico_id
     where a.empresa_id = p_empresa_id
       and a.status = 'agendado'
       and coalesce((e.config->'lembretes'->>'ligado')::boolean, false)
       and (jsonb_array_length(coalesce(e.config->'lembretes'->'so_para', '[]'::jsonb)) = 0
            or (e.config->'lembretes'->'so_para') ? c.telefone)
       and a.inicio > p_agora + interval '45 minutes'
       -- config.lembretes.desde: horário que começa antes desse instante não recebe lembrete (para ligar no meio do dia)
       and a.inicio >= coalesce(nullif(e.config->'lembretes'->>'desde', '')::timestamptz, '-infinity'::timestamptz)
       and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.tipo in ('remarcacao', 'aviso')
                        and ct.agendamento_id is not null
                        and ct.resultado in ('pendente', 'respondeu') and ct.criado_em > p_agora - interval '14 days')
       and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor in ('cliente', 'humano')
                        and m.criado_em > p_agora - interval '1 hour')
       and not ('sistema:excluida' = any (c.etiquetas))
       and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
  )
  select b.id, b.cli, b.nome, b.telefone, b.inicio, b.servico, b.online, b.endereco,
         case when b.inicio <= p_agora + make_interval(mins => (b.horas * 60)::int) then 'horas_antes' else 'vespera' end
    from base b
   where (
           -- 2 horas antes: vale mesmo que o da véspera já tenha saído; só não repete o de hoje
           (b.inicio <= p_agora + make_interval(mins => (b.horas * 60)::int)
            and not exists (select 1 from contatos ct where ct.agendamento_id = b.id and ct.tipo = 'lembrete'
                             and ct.horario_original = b.inicio and ct.criado_em > b.inicio - make_interval(mins => (b.horas * 60)::int + 60)))
        or -- véspera: um só
           ((b.inicio at time zone 'America/Cuiaba')::date = (p_agora at time zone 'America/Cuiaba')::date + 1
            and (p_agora at time zone 'America/Cuiaba')::time >= b.hora_vespera
            and exists (select 1 from agendamentos a2 where a2.id = b.id and a2.criado_em < p_agora - interval '2 hours')
            and not exists (select 1 from contatos ct where ct.agendamento_id = b.id and ct.tipo = 'lembrete'
                             and ct.horario_original = b.inicio))
         )
   order by b.inicio
$$;
revoke all on function public.n8n_lembretes_para_mandar_c(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.n8n_lembretes_para_mandar_c(uuid, timestamptz) to service_role;
