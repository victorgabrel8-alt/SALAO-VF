-- =====================================================================
-- 025_retomada_24h.sql — aplicado no Supabase em 28/10/2026
-- O atendimento pelo WhatsApp é 24 h (Victor). A retomada (5 e 30 min) passa a poder sair
-- a qualquer hora com config.retomada."24h" = true; sem isso continua só no horário do salão.
-- O horário de funcionamento do app não muda: é ele que limita os horários que a IA marca.
-- =====================================================================

create or replace function n8n_retomadas_para_chamar(p_empresa_id uuid, p_agora timestamptz default now())
returns table (cliente_id uuid, nome text, telefone text, tentativa integer, total integer,
               resumo_ia text, ultima_ia_em timestamptz, historico jsonb)
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
                                                              and split_part(cfg.expediente, '-', 2)::time, false) as agora_aberto
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
     and (jsonb_array_length(coalesce(a.r->'so_para', '[]'::jsonb)) = 0 or (a.r->'so_para') ? c.telefone)
     and cli.em > p_agora - make_interval(days => coalesce((a.r->>'janela_dias')::int, 3))
     and not coalesce(t.pulou, false)
     and coalesce(t.n, 0) < jsonb_array_length(a.esperas)
     and p_agora - ult.criado_em >= w.espera
     and p_agora - ult.criado_em <= w.espera + interval '2 hours'
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora)
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by ult.criado_em
   limit 5
$$;

update empresas set config = jsonb_set(config, '{retomada,24h}', 'true'::jsonb)
 where id = '00000000-0000-0000-0000-000000000001' and config ? 'retomada';
