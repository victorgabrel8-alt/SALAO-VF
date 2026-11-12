-- 042: dúvidas que a dona já respondeu ficam guardadas por loja, e a IA de atendimento responde sozinha da
-- próxima vez (antes perguntava de novo a cada cliente). Vale para todas as lojas.
-- Só soma: uma tabela nova e funções novas.
--
-- Quem grava: o n8n, quando a dona responde uma pergunta da IA e a resposta serve para qualquer cliente
-- (n8n_resposta_aprender), ou a dona pelo WhatsApp da assistente (ensinar / tirar).
-- Quem lê: a IA de atendimento, no prompt (n8n_respostas_texto). Preço não entra aqui: preço é da tabela servicos.

create table if not exists ia_respostas (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  pergunta      text not null,
  resposta      text not null,
  origem        text not null default 'dona_respondeu' check (origem in ('dona_respondeu', 'dona_ensinou')),
  ativa         boolean not null default true,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists ia_respostas_empresa_ativas on ia_respostas (empresa_id, criado_em) where ativa;

alter table ia_respostas enable row level security;
drop policy if exists ia_respostas_all on ia_respostas;
create policy ia_respostas_all on ia_respostas for all to authenticated
  using (empresa_id in (select private.minhas_empresas()))
  with check (empresa_id in (select private.minhas_empresas()));

-- comparação de perguntas: minúsculas, sem acento e sem pontuação
create or replace function ia_resposta_chave(p text)
returns text language sql immutable set search_path = public as $$
  select btrim(regexp_replace(lower(translate(coalesce(p, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
    'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Guarda (ou atualiza, se a pergunta já existe) uma resposta da dona. Até 60 por loja.
create or replace function n8n_resposta_aprender(p_empresa_id uuid, p_pergunta text, p_resposta text, p_origem text default 'dona_respondeu')
returns jsonb language plpgsql set search_path = public as $$
declare
  v_p text := left(nullif(btrim(p_pergunta), ''), 300);
  v_r text := left(nullif(btrim(p_resposta), ''), 600);
  v_id uuid; v_total int;
begin
  if v_p is null or v_r is null then raise exception 'pergunta e resposta são obrigatórias'; end if;
  if not exists (select 1 from empresas where id = p_empresa_id) then raise exception 'empresa % não encontrada', p_empresa_id; end if;
  select id into v_id from ia_respostas
   where empresa_id = p_empresa_id and ativa and ia_resposta_chave(pergunta) = ia_resposta_chave(v_p) limit 1;
  if v_id is not null then
    update ia_respostas set resposta = v_r, origem = coalesce(p_origem, origem), atualizado_em = now() where id = v_id;
    return jsonb_build_object('id', v_id, 'atualizou', true, 'pergunta', v_p, 'resposta', v_r);
  end if;
  select count(*) into v_total from ia_respostas where empresa_id = p_empresa_id and ativa;
  if v_total >= 60 then raise exception 'já são 60 respostas guardadas: tire alguma antes'; end if;
  insert into ia_respostas (empresa_id, pergunta, resposta, origem)
  values (p_empresa_id, v_p, v_r, coalesce(p_origem, 'dona_respondeu')) returning id into v_id;
  return jsonb_build_object('id', v_id, 'atualizou', false, 'pergunta', v_p, 'resposta', v_r, 'total', v_total + 1);
end $$;

-- Texto para o prompt da IA de atendimento (vazio se a loja não tem nenhuma)
create or replace function n8n_respostas_texto(p_empresa_id uuid)
returns text language sql stable set search_path = public as $$
  select coalesce(string_agg(format('- Pergunta: %s | Resposta: %s', pergunta, resposta), E'\n' order by criado_em), '')
    from ia_respostas where empresa_id = p_empresa_id and ativa
$$;

-- Assistente da dona: ver, tirar e ensinar
create or replace function n8n_assistente_ver_respostas(p_empresa_id uuid, p_pedido_por text)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('n', n, 'pergunta', pergunta, 'resposta', resposta,
      'desde', to_char(criado_em at time zone 'America/Cuiaba', 'DD/MM/YYYY')) order by n)
    from (select row_number() over (order by criado_em) n, * from ia_respostas where empresa_id = p_empresa_id and ativa) t), '[]'::jsonb);
end $$;

-- p_qual: o número da lista (1, 2…) ou um pedaço da pergunta ou da resposta
create or replace function n8n_assistente_tirar_resposta(p_empresa_id uuid, p_pedido_por text, p_qual text)
returns jsonb language plpgsql set search_path = public as $$
declare v_qual text := btrim(coalesce(p_qual, '')); v record; v_restam int;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  if v_qual = '' then raise exception 'diga qual resposta tirar (número ou um pedaço do texto)'; end if;
  select * into v from (select row_number() over (order by criado_em) n, * from ia_respostas where empresa_id = p_empresa_id and ativa) t
   where case when v_qual ~ '^\d+$' then n = v_qual::int
              else position(ia_resposta_chave(v_qual) in ia_resposta_chave(pergunta || ' ' || resposta)) > 0 end
   order by n limit 1;
  if v.id is null then raise exception 'não achei a resposta "%"', v_qual; end if;
  update ia_respostas set ativa = false, atualizado_em = now() where id = v.id;
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_tirar_resposta', 'ia_respostas', v.id,
    jsonb_build_object('pergunta', v.pergunta, 'resposta', v.resposta), p_pedido_por);
  select count(*) into v_restam from ia_respostas where empresa_id = p_empresa_id and ativa;
  return jsonb_build_object('tirou', v.pergunta, 'restam', v_restam);
end $$;

create or replace function n8n_assistente_ensinar_resposta(p_empresa_id uuid, p_pedido_por text, p_pergunta text, p_resposta text)
returns jsonb language plpgsql set search_path = public as $$
declare v jsonb;
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  v := n8n_resposta_aprender(p_empresa_id, p_pergunta, p_resposta, 'dona_ensinou');
  insert into registros_ia (empresa_id, agente, acao, tabela, registro_id, dados, pedido_por)
  values (p_empresa_id, 'assistente', 'n8n_assistente_ensinar_resposta', 'ia_respostas', (v->>'id')::uuid, v, p_pedido_por);
  return v;
end $$;

revoke all on function n8n_resposta_aprender(uuid, text, text, text) from public, anon, authenticated;
revoke all on function n8n_respostas_texto(uuid) from public, anon, authenticated;
revoke all on function n8n_assistente_ver_respostas(uuid, text) from public, anon, authenticated;
revoke all on function n8n_assistente_tirar_resposta(uuid, text, text) from public, anon, authenticated;
revoke all on function n8n_assistente_ensinar_resposta(uuid, text, text, text) from public, anon, authenticated;
revoke all on function ia_resposta_chave(text) from public, anon;
