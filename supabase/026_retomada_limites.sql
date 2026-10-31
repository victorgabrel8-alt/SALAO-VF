-- 026: retomada (alô) com menos insistência — conversa da Grazi em 30–31/10 recebeu 6 alôs em 11 h.
-- Duas regras novas na escolha de quem recebe alô, ligadas por empresas.config.retomada (sem a chave, nada muda):
--   "rodada_horas": 24      -> se ela já recebeu alô numa rodada anterior nas últimas 24 h, não começa outra
--                              (rodada = os alôs depois de uma resposta dela)
--   "silencio": ["21:00","08:00"] -> não manda alô nesse horário (Cuiabá); o alô que cairia ali não sai
-- E a Gleide passa para minutos [30, 180] (antes [5, 30]).
-- O resto da função é igual ao de supabase/019, 020 e 025.

create or replace function public.n8n_retomadas_para_chamar(p_empresa_id uuid, p_agora timestamptz default now())
returns table(cliente_id uuid, nome text, telefone text, tentativa integer, total integer, resumo_ia text,
              ultima_ia_em timestamptz, historico jsonb)
language sql stable
set search_path to 'public'
as $function$
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
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora)
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by ult.criado_em
   limit 5
$function$;

update empresas
   set config = jsonb_set(config, '{retomada}',
         (config->'retomada') || '{"minutos": [30, 180], "rodada_horas": 24, "silencio": ["21:00", "08:00"]}'::jsonb)
 where id = '00000000-0000-0000-0000-000000000001';
