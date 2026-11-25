-- =====================================================================
-- 079 - Conversa da assistente no app (pedido do Victor, 25/11/2026)
--
-- A conversa da assistente com a dona (e com a Duda, no Studio Caroline Ferreira) não fica no banco: fica no WhatsApp
-- do studio. O app passa a mostrar essa conversa em Conversas, lendo o histórico da Evolution pelo servidor do app
-- (crm/app/api/assistente/route.ts). Este arquivo só diz QUEM pode ler QUAL conversa.
--
-- agencia_usuarios: logins da agência (o Victor). Veem a conversa da assistente de todas as lojas, mesmo sem estar
--   ligados a elas em usuarios_empresa. É o começo do "Painel da agência" de docs/PLANO-VARIAS-LOJAS.md (fase 8),
--   só com o que esta tela precisa. Sem política de RLS: ninguém lê a tabela pelo app; só a função abaixo.
-- assistente_conversas(): as conversas que o login pode abrir: uma linha por número de assistente_numeros
--   (empresas.config), com a instância da Evolution e o nome para mostrar (config.assistente_nomes; sem ele, o primeiro
--   número é a dona, a primeira profissional do cadastro).
-- config.assistente_nomes do Studio Caroline Ferreira: o segundo número é a Duda.
--
-- Só soma: tabela nova, função nova e uma chave nova no config da Caroline. Nada muda para a Gleide nem para a
-- assistente (o n8n não lê nada disto). A dona e a Duda não veem nada novo.
-- =====================================================================

create table if not exists agencia_usuarios (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  criado_em timestamptz not null default now()
);

alter table agencia_usuarios enable row level security;

comment on table agencia_usuarios is 'Logins da agência: veem a conversa da assistente de todas as lojas no app (079)';

-- O Victor
insert into agencia_usuarios (user_id) values ('16e52f6d-49cf-449e-9cc1-a7f62718fae7') on conflict do nothing;

create or replace function assistente_conversas()
returns table (empresa_id uuid, loja text, instancia text, numero text, nome text)
language sql stable security definer set search_path = public as $$
  select e.id, e.nome, e.instancia_whatsapp, n.numero,
         coalesce(nullif(e.config->'assistente_nomes'->>n.numero, ''),
                  case when n.ordem = 1 then (select p.nome from profissionais p where p.id = profissional_dona(e.id)) end)
    from empresas e
   cross join lateral jsonb_array_elements_text(
           case when jsonb_typeof(e.config->'assistente_numeros') = 'array' then e.config->'assistente_numeros' else '[]'::jsonb end
         ) with ordinality as n(numero, ordem)
   where e.ativo
     and coalesce(e.instancia_whatsapp, '') <> ''
     and n.numero ~ '^55[0-9]{10,11}$'
     and exists (select 1 from agencia_usuarios a where a.user_id = auth.uid())
   order by e.criado_em, n.ordem
$$;

revoke all on function assistente_conversas() from public, anon;
grant execute on function assistente_conversas() to authenticated;

update empresas
   set config = jsonb_set(coalesce(config, '{}'::jsonb), '{assistente_nomes}', '{"5566992617636": "Duda"}'::jsonb)
 where id = '26a5d3eb-e8e4-4ed8-b206-095095292fdd'
   and not coalesce(config, '{}'::jsonb) ? 'assistente_nomes';
