-- =====================================================================
-- 029_retorno_espacado.sql — alô de retorno espaçado, em horário sorteado (Victor, 03/11/2026: "precisa ser
-- espaçado, pois irei tomar block, em diferentes horários e dias, aleatórios").
-- Só a função n8n_retornos_para_chamar (de supabase/028) muda; o resto é igual. Novas chaves em config.retorno:
--   "intervalo_min": [25, 60] -> entre um alô de retorno e o próximo, um intervalo sorteado nessa faixa (minutos)
--   "max_dia": 8              -> no máximo N alôs de retorno por dia; o que sobrar vai para o dia seguinte
-- E, sempre:
--   - cada cliente tem um horário sorteado no dia (entre a hora de começar e 1 h antes de fechar), outro a cada dia;
--     antes dele ela não sai. Sem sair no dia, fica para o dia seguinte (até atraso_dias), com outro sorteio
--   - no máximo 1 alô por rodada (o n8n roda a cada 10 min)
-- =====================================================================

create or replace function n8n_retornos_para_chamar(p_empresa_id uuid, p_agora timestamptz default now())
returns table (retorno_id uuid, cliente_id uuid, nome text, telefone text, data date, assunto text,
               combinado_em timestamptz, resumo_ia text, historico jsonb)
language sql stable set search_path = public as $$
  with cfg as (
    select coalesce(e.config->'retorno', '{}'::jsonb) as r,
           (p_agora at time zone 'America/Cuiaba')::date as hoje,
           (p_agora at time zone 'America/Cuiaba')::time as hora,
           e.config->'horario_funcionamento'->>(array['dom','seg','ter','qua','qui','sex','sab'])
             [extract(dow from p_agora at time zone 'America/Cuiaba')::int + 1] as expediente
      from empresas e where e.id = p_empresa_id
  ), dia as (
    -- janela do dia: de max(abertura, hora) até 1 h antes de fechar
    select cfg.*,
           greatest(split_part(cfg.expediente, '-', 1)::time, coalesce(cfg.r->>'hora', '09:00')::time) as comeco,
           split_part(cfg.expediente, '-', 2)::time - interval '1 hour' as fim
      from cfg where cfg.expediente is not null
  ), enviados as (
    -- alôs de retorno da IA: o último (para o intervalo) e quantos hoje (para o máximo do dia)
    select (select ct.criado_em from contatos ct where ct.empresa_id = p_empresa_id and ct.tipo = 'retorno' and ct.canal = 'ia'
             order by ct.criado_em desc limit 1) as ultimo_em,
           (select ct.id from contatos ct where ct.empresa_id = p_empresa_id and ct.tipo = 'retorno' and ct.canal = 'ia'
             order by ct.criado_em desc limit 1) as ultimo_id,
           (select count(*) from contatos ct where ct.empresa_id = p_empresa_id and ct.tipo = 'retorno' and ct.canal = 'ia'
             and (ct.criado_em at time zone 'America/Cuiaba')::date = (p_agora at time zone 'America/Cuiaba')::date) as hoje_n
  )
  select rc.id, c.id, c.nome, c.telefone, rc.data, rc.assunto, rc.criado_em, c.resumo_ia,
         (select jsonb_agg(jsonb_build_object('autor', h.autor, 'tipo', h.tipo, 'texto', left(h.conteudo, 600),
                                              'em', to_char(h.criado_em at time zone 'America/Cuiaba', 'DD/MM HH24:MI')) order by h.criado_em)
            from (select * from mensagens m where m.cliente_id = c.id order by m.criado_em desc limit 16) h)
    from retornos_combinados rc
    join clientes c on c.id = rc.cliente_id
    cross join dia a
    cross join enviados en
   where rc.empresa_id = p_empresa_id
     and rc.situacao = 'aguardando'
     and coalesce((a.r->>'ligado')::boolean, false)
     and (jsonb_array_length(coalesce(a.r->'so_para', '[]'::jsonb)) = 0 or (a.r->'so_para') ? c.telefone)
     and rc.data <= a.hoje
     and rc.data >= a.hoje - coalesce((a.r->>'atraso_dias')::int, 3)
     and a.hora < a.fim
     -- horário sorteado dela hoje (muda a cada dia), até 30 min antes do fim: sobra rodada para sair no mesmo dia
     and a.hora >= a.comeco + interval '1 minute' * (abs(hashtext(rc.id::text || a.hoje::text))
                    % greatest(1, (extract(epoch from (a.fim - a.comeco)) / 60)::int - 30))
     -- intervalo sorteado desde o último alô de retorno
     and (en.ultimo_em is null or p_agora >= en.ultimo_em + interval '1 minute' * (
            coalesce((a.r->'intervalo_min'->>0)::int, 25)
            + abs(hashtext(en.ultimo_id::text)) % greatest(1, coalesce((a.r->'intervalo_min'->>1)::int, 60)
                                                              - coalesce((a.r->'intervalo_min'->>0)::int, 25) + 1)))
     and en.hoje_n < coalesce((a.r->>'max_dia')::int, 8)
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora)
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status in ('agendado', 'realizado')
                       and f.criado_em > rc.criado_em)
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor = 'humano' and m.criado_em > rc.criado_em)
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor = 'cliente'
                       and m.criado_em >= (rc.data::timestamp at time zone 'America/Cuiaba'))
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by rc.data, rc.criado_em
   limit 1
$$;

revoke execute on function n8n_retornos_para_chamar(uuid, timestamptz) from public, anon, authenticated;

update empresas
   set config = jsonb_set(config, '{retorno}', (config->'retorno') || '{"intervalo_min": [25, 60], "max_dia": 8}'::jsonb)
 where id = '00000000-0000-0000-0000-000000000001' and config ? 'retorno';
