-- 073: retomada que conta a partir da abertura do salão (24/11/2026).
-- Caso: a Grazi (final 3590) perguntou "Vc coloca outras técnicas?" à 00h02, a IA falhou (Gemini fora) e respondeu
-- "Desculpa, tive um probleminha...". A retomada só tenta entre a espera (5 e 30 min) e a espera + 2 h depois da última
-- mensagem da IA, e só com o salão aberto: toda essa janela caiu de madrugada e ninguém voltou a falar com ela.
-- Agora, se a última mensagem da IA saiu antes da volta de hoje (fim do silêncio da madrugada, ou a abertura do salão
-- quando não há silêncio), e depois da volta de ontem, a conta da espera começa na volta de hoje. O resto é igual à n8n_retomadas_para_chamar (que continua existindo).
-- Só soma: função nova; o fluxo "IA - Retomar conversa" passa a chamar esta.
create or replace function public.n8n_retomadas_para_chamar_v2(p_empresa_id uuid, p_agora timestamp with time zone default now())
 returns table(cliente_id uuid, nome text, telefone text, tentativa integer, total integer, resumo_ia text, ultima_ia_em timestamp with time zone, historico jsonb)
 language sql
 stable
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
           -- quando a IA volta a poder chamar hoje: o fim do silêncio (salão 24 h com silêncio de madrugada) ou a abertura
           case when jsonb_array_length(coalesce(cfg.r->'silencio', '[]'::jsonb)) = 2
                  then (((p_agora at time zone 'America/Cuiaba')::date + (cfg.r->'silencio'->>1)::time) at time zone 'America/Cuiaba')
                when cfg.expediente is null or cfg.expediente = '' then null
                else (((p_agora at time zone 'America/Cuiaba')::date + split_part(cfg.expediente, '-', 1)::time)
                      at time zone 'America/Cuiaba') end as abre_hoje,
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
    -- a base da espera: a última mensagem da IA ou, se ela saiu com o salão fechado desde ontem, a abertura de hoje
    cross join lateral (select case when a.abre_hoje is not null and ult.criado_em < a.abre_hoje
                                         and ult.criado_em > a.abre_hoje - interval '1 day'
                                    then a.abre_hoje else ult.criado_em end as base) b
   where c.empresa_id = p_empresa_id
     and coalesce((a.r->>'ligado')::boolean, false)
     and a.agora_aberto
     and not a.agora_silencio
     and (jsonb_array_length(coalesce(a.r->'so_para', '[]'::jsonb)) = 0 or (a.r->'so_para') ? c.telefone)
     and cli.em > p_agora - make_interval(days => coalesce((a.r->>'janela_dias')::int, 3))
     and not coalesce(t.pulou, false)
     and coalesce(t.n, 0) < jsonb_array_length(a.esperas)
     and p_agora - b.base >= w.espera
     and p_agora - b.base <= w.espera + interval '2 hours'
     and (a.r->>'rodada_horas' is null or not exists (
           select 1 from retomadas r2
            where r2.cliente_id = c.id and r2.situacao = 'enviada'
              and r2.criado_em <= cli.em
              and r2.criado_em > p_agora - make_interval(hours => (a.r->>'rodada_horas')::int)))
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.criado_em > cli.em)
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora)
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by ult.criado_em
   limit 5
$function$;

grant execute on function public.n8n_retomadas_para_chamar_v2(uuid, timestamp with time zone) to service_role;
