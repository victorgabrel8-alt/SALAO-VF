-- =====================================================================
-- 019_retomar_conversa.sql — aplicado no Supabase em 27/10/2026
-- Retomar conversa (follow-up): a IA respondeu, a cliente sumiu. Depois de um
-- tempo a IA tenta retomar de onde parou (n8n "IA - Retomar conversa").
--   - retomadas: cada tentativa (enviada) ou decisão de não retomar (pulada)
--   - n8n_retomadas_para_chamar: quem está esperando retomada agora
--   - n8n_registrar_retomada: grava a tentativa e, se enviou, a mensagem no histórico
-- Tabela própria (não contatos): contatos alimenta o quadro do painel e o
-- "último alô" da ficha da IA, e uma retomada não é "chamar para voltar".
-- Ligar: empresas.config.retomada = {"ligado": true, "so_para": [], "horas": [3, 24], "janela_dias": 3}
--   horas: espera antes de cada tentativa, contada da última mensagem da IA
--          ([3, 24] = 1ª 3 h depois, 2ª 24 h depois da 1ª; o tamanho é o máximo de tentativas)
--   janela_dias: só retoma conversa em que a cliente falou nos últimos N dias
--   so_para com números = só esses (teste); vazio = todas. Sem config, ninguém.
-- =====================================================================

create table if not exists retomadas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  cliente_id    uuid not null references clientes(id) on delete cascade,
  tentativa     integer not null,
  situacao      text not null check (situacao in ('enviada', 'pulada')),
  mensagem      text,
  motivo        text,
  wa_message_id text,
  criado_em     timestamptz not null default now()
);
create index if not exists retomadas_cliente on retomadas (cliente_id, criado_em desc);
alter table retomadas enable row level security;
create policy retomadas_select on retomadas for select to authenticated
  using (empresa_id in (select private.minhas_empresas()));
revoke all on retomadas from anon;

-- Quem retomar agora. Só quando:
--   - a última mensagem da conversa é da IA (cliente não respondeu; se a Gleide escreveu, é dela)
--   - a cliente falou nos últimos janela_dias e ainda não esgotou as tentativas desde a última mensagem dela
--   - passou o tempo da tentativa (horas[n]) desde a última mensagem da IA
--   - nenhuma tentativa foi "pulada" (a IA achou que não cabia) desde a última mensagem dela
--   - sem horário marcado no futuro, não excluída, IA não pausada para ela
--   - o salão está aberto agora (config.horario_funcionamento, ex.: "seg": "09:00-18:00")
-- p_agora: para testar sem esperar (padrão: agora).
create or replace function n8n_retomadas_para_chamar(p_empresa_id uuid, p_agora timestamptz default now())
returns table (cliente_id uuid, nome text, telefone text, tentativa integer, total integer,
               resumo_ia text, ultima_ia_em timestamptz, historico jsonb)
language sql stable set search_path = public as $$
  with cfg as (
    select coalesce(e.config->'retomada', '{}'::jsonb) as r,
           coalesce(e.config->'retomada'->'horas', '[3, 24]'::jsonb) as horas,
           e.config->'horario_funcionamento'->>(array['dom','seg','ter','qua','qui','sex','sab'])
             [extract(dow from p_agora at time zone 'America/Cuiaba')::int + 1] as expediente
      from empresas e where e.id = p_empresa_id
  ), aberto as (
    select cfg.*, coalesce(
             (p_agora at time zone 'America/Cuiaba')::time between split_part(cfg.expediente, '-', 1)::time
                                                              and split_part(cfg.expediente, '-', 2)::time, false) as agora_aberto
      from cfg
  )
  select c.id, c.nome, c.telefone, coalesce(t.n, 0)::int + 1, jsonb_array_length(a.horas), c.resumo_ia, ult.criado_em,
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
   where c.empresa_id = p_empresa_id
     and coalesce((a.r->>'ligado')::boolean, false)
     and a.agora_aberto
     and (jsonb_array_length(coalesce(a.r->'so_para', '[]'::jsonb)) = 0 or (a.r->'so_para') ? c.telefone)
     and cli.em > p_agora - make_interval(days => coalesce((a.r->>'janela_dias')::int, 3))
     and not coalesce(t.pulou, false)
     and coalesce(t.n, 0) < jsonb_array_length(a.horas)
     and p_agora - ult.criado_em >= interval '1 hour' * (a.horas->>coalesce(t.n, 0)::int)::numeric
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora)
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by ult.criado_em
   limit 5
$$;

-- Depois de decidir: grava a tentativa. Enviada -> também a mensagem no histórico da conversa
-- (a API não passa pelo webhook, então o n8n não a vê sozinho). Pulada -> não tenta mais até ela falar.
create or replace function n8n_registrar_retomada(p_empresa_id uuid, p_cliente_id uuid, p_tentativa integer, p_situacao text,
                                                  p_mensagem text default null, p_motivo text default null, p_wa_message_id text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_id uuid;
begin
  if not exists (select 1 from clientes where id = p_cliente_id and empresa_id = p_empresa_id) then
    raise exception 'cliente % não encontrada', p_cliente_id;
  end if;
  insert into retomadas (empresa_id, cliente_id, tentativa, situacao, mensagem, motivo, wa_message_id)
  values (p_empresa_id, p_cliente_id, p_tentativa, p_situacao, p_mensagem, p_motivo, p_wa_message_id)
  returning id into v_id;
  if p_situacao = 'enviada' and p_mensagem is not null then
    insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
    values (p_empresa_id, p_cliente_id, 'saida', 'ia', 'texto', p_mensagem, p_wa_message_id)
    on conflict (wa_message_id) do nothing;
  end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, p_cliente_id, 'atendimento', 'n8n_registrar_retomada', 'retomadas', v_id,
          jsonb_build_object('tentativa', p_tentativa, 'situacao', p_situacao, 'mensagem', p_mensagem, 'motivo', p_motivo));
  return jsonb_build_object('retomada_id', v_id);
end $$;

-- Começa só no número de teste do Victor; para todas: so_para = []
update empresas set config = config || jsonb_build_object('retomada',
  jsonb_build_object('ligado', true, 'so_para', jsonb_build_array('5566999270860'), 'horas', jsonb_build_array(3, 24), 'janela_dias', 3))
 where id = '00000000-0000-0000-0000-000000000001' and not (config ? 'retomada');
