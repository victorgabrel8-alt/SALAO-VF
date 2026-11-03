-- =====================================================================
-- 028_retorno_combinado.sql — alô na data que a própria cliente combinou
-- "Semana que vem eu te chamo", "segunda ou terça te falo" (Rosângela e Lizete, 30–31/10): a retomada
-- pula essas clientes de propósito e ninguém guardava a data. Agora:
--   - retornos_combinados: a data que ela combinou (a IA grava pela ferramenta anotar_no_crm)
--   - n8n_combinar_retorno: grava a data (troca a anterior que ainda estava esperando)
--   - n8n_retornos_para_chamar: quem chamar agora (n8n "IA - Retorno combinado")
--   - n8n_registrar_retorno: grava o alô enviado (contatos tipo 'retorno', canal 'ia') ou a decisão de não mandar
-- Só soma: tabela e funções novas; nada do que existe muda.
-- Ligar: empresas.config.retorno = {"ligado": true, "so_para": [...], "hora": "09:00", "atraso_dias": 3}
--   so_para com números = só esses (teste); vazio = todas. Sem config, a IA anota mas ninguém é chamada.
--   hora: não chama antes disso (nem antes de o salão abrir); atraso_dias: dia fechado ou fora do horário,
--   ainda chama até N dias depois da data combinada; depois disso deixa para lá.
-- =====================================================================

create table if not exists retornos_combinados (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  cliente_id    uuid not null references clientes(id) on delete cascade,
  data          date not null,
  assunto       text,                      -- o que ficou de falar ("como ficou o cabelo com a amiga")
  situacao      text not null default 'aguardando' check (situacao in ('aguardando', 'enviado', 'pulado', 'cancelado')),
  motivo        text,
  mensagem      text,
  contato_id    uuid references contatos(id) on delete set null,
  wa_message_id text,
  criado_em     timestamptz not null default now(),
  resolvido_em  timestamptz
);
create index if not exists retornos_combinados_espera on retornos_combinados (empresa_id, situacao, data);
create index if not exists retornos_combinados_cliente on retornos_combinados (cliente_id, criado_em desc);
alter table retornos_combinados enable row level security;
create policy retornos_combinados_select on retornos_combinados for select to authenticated
  using (empresa_id in (select private.minhas_empresas()));
revoke all on retornos_combinados from anon;

-- A IA ouviu "semana que vem te falo": grava a data. Não dá erro (é chamada pela ferramenta da IA):
-- devolve ok=false com o motivo. vai_chamar diz se o alô está ligado para ela (só aí a IA pode prometer).
create or replace function n8n_combinar_retorno(p_empresa_id uuid, p_telefone text, p_data date, p_assunto text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v_cliente uuid; v_id uuid; v_cfg jsonb;
begin
  -- anotação comum, sem data: nada a fazer (e nada a avisar à IA)
  if p_data is null then return jsonb_build_object('ok', false, 'motivo', 'sem data'); end if;
  select id into v_cliente from clientes where empresa_id = p_empresa_id and telefone = p_telefone;
  if v_cliente is null then return jsonb_build_object('ok', false, 'motivo', 'cliente não encontrada'); end if;
  if p_data <= hoje_cuiaba() then return jsonb_build_object('ok', false, 'motivo', 'a data tem que ser depois de hoje'); end if;
  if p_data > hoje_cuiaba() + 60 then return jsonb_build_object('ok', false, 'motivo', 'data a mais de 60 dias'); end if;

  update retornos_combinados set situacao = 'cancelado', motivo = 'combinou outra data', resolvido_em = now()
   where cliente_id = v_cliente and situacao = 'aguardando';
  insert into retornos_combinados (empresa_id, cliente_id, data, assunto)
  values (p_empresa_id, v_cliente, p_data, nullif(trim(p_assunto), ''))
  returning id into v_id;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, v_cliente, 'atendimento', 'n8n_combinar_retorno', 'retornos_combinados', v_id,
          jsonb_build_object('data', p_data, 'assunto', p_assunto));

  select coalesce(config->'retorno', '{}'::jsonb) into v_cfg from empresas where id = p_empresa_id;
  return jsonb_build_object('ok', true, 'retorno_id', v_id, 'data', p_data,
    'vai_chamar', coalesce((v_cfg->>'ligado')::boolean, false)
                  and (jsonb_array_length(coalesce(v_cfg->'so_para', '[]'::jsonb)) = 0 or (v_cfg->'so_para') ? p_telefone));
end $$;

-- Quem chamar agora. Só quando:
--   - a data combinada chegou (e não passou de atraso_dias) e o salão está aberto agora, depois da "hora"
--   - sem horário marcado no futuro e sem horário marcado depois de combinar (já resolveu)
--   - a Gleide não falou com ela depois de combinar, e ela não voltou a falar no dia combinado ou depois
--   - não excluída, IA não pausada para ela (a pausa do Redis o n8n confere)
-- p_agora: para testar sem esperar (padrão: agora).
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
  )
  select rc.id, c.id, c.nome, c.telefone, rc.data, rc.assunto, rc.criado_em, c.resumo_ia,
         (select jsonb_agg(jsonb_build_object('autor', h.autor, 'tipo', h.tipo, 'texto', left(h.conteudo, 600),
                                              'em', to_char(h.criado_em at time zone 'America/Cuiaba', 'DD/MM HH24:MI')) order by h.criado_em)
            from (select * from mensagens m where m.cliente_id = c.id order by m.criado_em desc limit 16) h)
    from retornos_combinados rc
    join clientes c on c.id = rc.cliente_id
    cross join cfg a
   where rc.empresa_id = p_empresa_id
     and rc.situacao = 'aguardando'
     and coalesce((a.r->>'ligado')::boolean, false)
     and (jsonb_array_length(coalesce(a.r->'so_para', '[]'::jsonb)) = 0 or (a.r->'so_para') ? c.telefone)
     and rc.data <= a.hoje
     and rc.data >= a.hoje - coalesce((a.r->>'atraso_dias')::int, 3)
     and a.expediente is not null
     and a.hora >= greatest(split_part(a.expediente, '-', 1)::time, coalesce(a.r->>'hora', '09:00')::time)
     and a.hora < split_part(a.expediente, '-', 2)::time - interval '1 hour'
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > p_agora)
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status in ('agendado', 'realizado')
                       and f.criado_em > rc.criado_em)
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor = 'humano' and m.criado_em > rc.criado_em)
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor = 'cliente'
                       and m.criado_em >= (rc.data::timestamp at time zone 'America/Cuiaba'))
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by rc.data, rc.criado_em
   limit 5
$$;

-- Depois de decidir. Enviado -> contato 'retorno' canal 'ia' (a resposta dela cai no agente com o
-- "ALÔ DE RETORNO" da ficha), a mensagem no histórico e uma retomada 'pulada' (a retomada de 30/180 min
-- não insiste nesse alô; volta a valer quando ela responder). Pulado -> não chama mais nessa data.
create or replace function n8n_registrar_retorno(p_empresa_id uuid, p_retorno_id uuid, p_situacao text,
                                                 p_mensagem text default null, p_motivo text default null, p_wa_message_id text default null)
returns jsonb language plpgsql set search_path = public as $$
declare rc retornos_combinados%rowtype; v_contato uuid;
begin
  if p_situacao is null or p_situacao not in ('enviado', 'pulado') then raise exception 'situação inválida: %', p_situacao; end if;
  select * into rc from retornos_combinados where id = p_retorno_id and empresa_id = p_empresa_id for update;
  if not found then raise exception 'retorno % não encontrado', p_retorno_id; end if;
  if rc.situacao <> 'aguardando' then return jsonb_build_object('ok', false, 'motivo', 'já estava ' || rc.situacao); end if;

  if p_situacao = 'enviado' then
    insert into contatos (empresa_id, cliente_id, tipo, canal, mensagem)
    values (p_empresa_id, rc.cliente_id, 'retorno', 'ia', p_mensagem)
    returning id into v_contato;
    insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
    values (p_empresa_id, rc.cliente_id, 'saida', 'ia', 'texto', p_mensagem, p_wa_message_id)
    on conflict (wa_message_id) do nothing;
    insert into retomadas (empresa_id, cliente_id, tentativa, situacao, mensagem, motivo, wa_message_id)
    values (p_empresa_id, rc.cliente_id, 0, 'pulada', p_mensagem, 'alô de retorno combinado', p_wa_message_id);
  end if;
  update retornos_combinados
     set situacao = p_situacao, mensagem = p_mensagem, motivo = p_motivo, contato_id = v_contato,
         wa_message_id = p_wa_message_id, resolvido_em = now()
   where id = rc.id;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, rc.cliente_id, 'atendimento', 'n8n_registrar_retorno', 'retornos_combinados', rc.id,
          jsonb_build_object('situacao', p_situacao, 'mensagem', p_mensagem, 'motivo', p_motivo, 'contato_id', v_contato));
  return jsonb_build_object('ok', true, 'contato_id', v_contato);
end $$;

-- as funções n8n_* só o n8n (service role) chama
revoke execute on function n8n_combinar_retorno(uuid, text, date, text) from public, anon, authenticated;
revoke execute on function n8n_retornos_para_chamar(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function n8n_registrar_retorno(uuid, uuid, text, text, text, text) from public, anon, authenticated;

-- Começa só no número de teste do Victor; para todas: so_para = []
update empresas set config = config || jsonb_build_object('retorno',
  jsonb_build_object('ligado', true, 'so_para', jsonb_build_array('5566999270860'), 'hora', '09:00', 'atraso_dias', 3))
 where id = '00000000-0000-0000-0000-000000000001' and not (config ? 'retorno');
