-- =====================================================================
-- 036_retomada_e_retorno_mais_calmos.sql — ajustes depois de analisar as conversas de 07 a 09/11 (pedido do Victor, 09/11).
-- 1. Retomada: não manda alô de "ficou dúvida?" quando o último contato foi um recado automático (falta, lembrete,
--    retorno, aviso da assistente): a cliente já recebeu mensagem do salão. (Francilene: 3 mensagens em 4 h depois da falta.)
-- 2. Retorno combinado: não sai para quem marcou horário depois de combinar, mesmo que tenha marcado antes de a IA
--    gravar o retorno. (Roseli: horário e retorno no mesmo minuto.)
-- 3. Config da Gleide: uma retomada só, aos 30 min (antes: 30 min e 3 h).
-- Mesmas assinaturas; só acrescenta condições.
-- =====================================================================

create or replace function n8n_retomadas_para_chamar(p_empresa_id uuid, p_agora timestamptz default now())
returns table(cliente_id uuid, nome text, telefone text, tentativa integer, total integer, resumo_ia text, ultima_ia_em timestamptz, historico jsonb)
language sql stable set search_path = public as $$
  with cfg as (
    select coalesce(e.config->'retomada', '{}'::jsonb) as r,
           coalesce(e.config->'retomada'->'minutos',
                    (select jsonb_agg((h::numeric) * 60) from jsonb_array_elements_text(e.config->'retomada'->'horas') h),
                    '[5, 30]'::jsonb) as esperas,
           e.config->'horario_funcionamento'->>(array['dom','seg','ter','qua','qui','sex','sab'])
             [extract(dow from p_agora at time zone 'America/Cuiaba')::int + 1] as expediente
      from empresas e where e.id = p_empresa_id
  ), aberto as (
    select cfg.*, coalesce((cfg.r->>'24h')::boolean, false) or coalesce(
             (p_agora at time zone 'America/Cuiaba')::time between split_part(cfg.expediente, '-', 1)::time
                                                              and split_part(cfg.expediente, '-', 2)::time, false) as agora_aberto,
           -- horário de silêncio (pode virar a meia-noite: 21:00 -> 08:00)
           case when jsonb_array_length(coalesce(cfg.r->'silencio', '[]'::jsonb)) = 2 then
             case when (cfg.r->'silencio'->>0)::time > (cfg.r->'silencio'->>1)::time
                  then (p_agora at time zone 'America/Cuiaba')::time >= (cfg.r->'silencio'->>0)::time
                    or (p_agora at time zone 'America/Cuiaba')::time < (cfg.r->'silencio'->>1)::time
                  else (p_agora at time zone 'America/Cuiaba')::time >= (cfg.r->'silencio'->>0)::time
                   and (p_agora at time zone 'America/Cuiaba')::time < (cfg.r->'silencio'->>1)::time
             end
           else false end as agora_silencio
      from cfg
  )
  select c.id, c.nome, c.telefone, coalesce(t.n, 0)::int + 1, jsonb_array_length(a.esperas), c.resumo_ia, ult.criado_em,
         (select jsonb_agg(jsonb_build_object('autor', h.autor, 'tipo', h.tipo, 'texto', left(h.conteudo, 600),
                                              'em', to_char(h.criado_em at time zone 'America/Cuiaba', 'DD/MM HH24:MI')) order by h.criado_em)
            from (select * from mensagens m where m.cliente_id = c.id order by m.criado_em desc limit 16) h)
    from clientes c
    cross join aberto a
    join lateral (select m.autor, m.criado_em from mensagens m where m.cliente_id = c.id
                   order by m.criado_em desc limit 1) ult on ult.autor = 'ia'
    join lateral (select max(m.criado_em) as em from mensagens m where m.cliente_id = c.id and m.autor = 'cliente') cli on cli.em is not null
    left join lateral (select count(*) as n, bool_or(r.situacao = 'pulada') as pulou from retomadas r
                        where r.cliente_id = c.id and r.criado_em > cli.em) t on true
    cross join lateral (select interval '1 minute' * (a.esperas->>coalesce(t.n, 0)::int)::numeric as espera) w
   where c.empresa_id = p_empresa_id
     and coalesce((a.r->>'ligado')::boolean, false)
     and a.agora_aberto
     and not a.agora_silencio
     and (jsonb_array_length(coalesce(a.r->'so_para', '[]'::jsonb)) = 0 or (a.r->'so_para') ? c.telefone)
     and cli.em > p_agora - make_interval(days => coalesce((a.r->>'janela_dias')::int, 3))
     and not coalesce(t.pulou, false)
     and coalesce(t.n, 0) < jsonb_array_length(a.esperas)
     and p_agora - ult.criado_em >= w.espera
     and p_agora - ult.criado_em <= w.espera + interval '2 hours'
     -- uma rodada de alô a cada rodada_horas: alô enviado ANTES da última resposta dela, dentro da janela, bloqueia nova rodada
     and (a.r->>'rodada_horas' is null or not exists (
           select 1 from retomadas r2
            where r2.cliente_id = c.id and r2.situacao = 'enviada'
              and r2.criado_em <= cli.em
              and r2.criado_em > p_agora - make_interval(hours => (a.r->>'rodada_horas')::int)))
     -- 036: depois da última mensagem dela o salão já mandou um recado automático (falta, lembrete, retorno, aviso): sem alô em cima
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.criado_em > cli.em)
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora)
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by ult.criado_em
   limit 5
$$;

create or replace function n8n_retornos_para_chamar(p_empresa_id uuid, p_agora timestamptz default now())
returns table(retorno_id uuid, cliente_id uuid, nome text, telefone text, data date, assunto text, combinado_em timestamptz, resumo_ia text, historico jsonb)
language sql stable set search_path = public as $$
  with cfg as (
    select coalesce(e.config->'retorno', '{}'::jsonb) as r,
           (p_agora at time zone 'America/Cuiaba')::date as hoje,
           (p_agora at time zone 'America/Cuiaba')::time as hora,
           e.config->'horario_funcionamento'->>(array['dom','seg','ter','qua','qui','sex','sab'])
             [extract(dow from p_agora at time zone 'America/Cuiaba')::int + 1] as expediente
      from empresas e where e.id = p_empresa_id
  ), dia as (
    select cfg.*,
           greatest(split_part(cfg.expediente, '-', 1)::time, coalesce(cfg.r->>'hora', '09:00')::time) as comeco,
           split_part(cfg.expediente, '-', 2)::time - interval '1 hour' as fim
      from cfg where cfg.expediente is not null
  ), enviados as (
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
     and a.hora >= a.comeco + interval '1 minute' * (abs(hashtext(rc.id::text || a.hoje::text))
                    % greatest(1, (extract(epoch from (a.fim - a.comeco)) / 60)::int - 30))
     and (en.ultimo_em is null or p_agora >= en.ultimo_em + interval '1 minute' * (
            coalesce((a.r->'intervalo_min'->>0)::int, 25)
            + abs(hashtext(en.ultimo_id::text)) % greatest(1, coalesce((a.r->'intervalo_min'->>1)::int, 60)
                                                              - coalesce((a.r->'intervalo_min'->>0)::int, 25) + 1)))
     and en.hoje_n < coalesce((a.r->>'max_dia')::int, 8)
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora)
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status in ('agendado', 'realizado')
                       and f.criado_em > rc.criado_em)
     -- 036: horário marcado pouco antes de combinar (no mesmo atendimento) e que acontece depois disso também conta
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status in ('agendado', 'realizado')
                       and f.inicio >= rc.criado_em - interval '12 hours')
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor = 'humano' and m.criado_em > rc.criado_em)
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor = 'cliente'
                       and m.criado_em >= (rc.data::timestamp at time zone 'America/Cuiaba'))
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by rc.data, rc.criado_em
   limit 1
$$;

revoke all on function n8n_retomadas_para_chamar(uuid, timestamptz) from public, anon, authenticated;
revoke all on function n8n_retornos_para_chamar(uuid, timestamptz) from public, anon, authenticated;

-- 3. Gleide: uma retomada só, aos 30 min (aplicado à parte, é configuração da loja)
-- update empresas set config = jsonb_set(config, '{retomada,minutos}', '[30]') where id = '00000000-0000-0000-0000-000000000001';
