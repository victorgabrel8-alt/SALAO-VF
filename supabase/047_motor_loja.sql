-- Motor único (docs/PLANO-MOTOR-UNICO.md): a ficha da loja que o n8n lê a cada mensagem.
-- Só soma: três funções novas, só de leitura. Nada muda para as lojas com conjunto próprio (Gleide, Caroline).
--
-- Uma loja entra no motor quando empresas.config.ia.motor = true (e a loja está ativa). Enquanto isso não
-- for ligado, o motor não responde nem roda rotina para ela.
--
-- empresas.config.ia (tudo opcional):
--   motor       true            a loja é atendida pelo motor do ramo dela
--   dona        "Ana"           como a IA chama a dona (sem isso: primeiro nome da 1ª profissional ativa)
--   permitidos  ["5566…"]       trava de teste: só esses números (e a dona) recebem mensagem
--   liberada    true            a agência liberou a IA para todas as clientes (a lista permitidos deixa de valer).
--                               Sem liberada e sem permitidos, a IA não responde nenhuma cliente.
--   bloco_min   150             tempo mínimo que cada cliente ocupa na agenda, em minutos (30 a 480).
--                               Sem a chave, vale o tempo de cada serviço.
-- ATENÇÃO: só ligar motor = true numa loja SEM conjunto próprio ativo no n8n (senão as rotinas rodam em dobro).
-- O resto já existe: config.assistente_numeros (WhatsApp da dona), config.loja.cidade, config.loja.catalogo_link.

create or replace function motor_ficha(p_empresa_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'empresa_id', e.id,
    'nome', e.nome,
    'nicho', e.nicho,
    'instancia', e.instancia_whatsapp,
    'fuso', coalesce(e.fuso, 'America/Cuiaba'),
    'dona', coalesce(
      nullif(trim(e.config->'ia'->>'dona'), ''),
      (select split_part(trim(p.nome), ' ', 1) from profissionais p
        where p.empresa_id = e.id and p.ativo order by p.criado_em limit 1)),
    'cidade', coalesce(nullif(trim(e.config->'loja'->>'cidade'), ''), 'Sinop'),
    'assist', coalesce(e.config->'assistente_numeros', '[]'::jsonb),
    'permitidos', coalesce(e.config->'ia'->'permitidos', '[]'::jsonb),
    'liberada', coalesce(e.config->'ia'->>'liberada', '') = 'true',
    'bloco_min', case when e.config->'ia'->>'bloco_min' ~ '^[0-9]{1,3}
    'catalogo_link', coalesce(e.config->'loja'->>'catalogo_link', '')
  )
  from empresas e
  where e.id = p_empresa_id;
$$;

-- Mensagem que chegou: de qual loja é a instância do WhatsApp? Sem loja deste ramo no motor, devolve null.
create or replace function motor_loja(p_instancia text, p_nicho text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select motor_ficha(e.id)
  from empresas e
  where e.instancia_whatsapp = p_instancia
    and p_instancia <> ''
    and e.nicho = p_nicho
    and e.ativo
    and e.config->'ia'->>'motor' = 'true'
  limit 1;
$$;

-- Rotinas: as lojas do ramo que estão no motor (p_empresa_id: só aquela, para teste).
create or replace function motor_lojas(p_nicho text, p_empresa_id uuid default null)
returns setof jsonb
language sql
stable
set search_path = public
as $$
  select motor_ficha(e.id)
  from empresas e
  where e.nicho = p_nicho
    and e.ativo
    and e.config->'ia'->>'motor' = 'true'
    and coalesce(e.instancia_whatsapp, '') <> ''
    and (p_empresa_id is null or e.id = p_empresa_id)
  order by e.criado_em;
$$;

-- só o servidor (n8n, com a chave de serviço) chama
revoke all on function motor_ficha(uuid) from public, anon, authenticated;
revoke all on function motor_loja(text, text) from public, anon, authenticated;
revoke all on function motor_lojas(text, uuid) from public, anon, authenticated;
grant execute on function motor_ficha(uuid) to service_role;
grant execute on function motor_loja(text, text) to service_role;
grant execute on function motor_lojas(text, uuid) to service_role;
 then (e.config->'ia'->>'bloco_min')::int else 0 end,
    'catalogo_link', coalesce(e.config->'loja'->>'catalogo_link', '')
  )
  from empresas e
  where e.id = p_empresa_id;
$$;

-- Mensagem que chegou: de qual loja é a instância do WhatsApp? Sem loja deste ramo no motor, devolve null.
create or replace function motor_loja(p_instancia text, p_nicho text)
returns jsonb
language sql
stable
set search_path = public
as $$
  select motor_ficha(e.id)
  from empresas e
  where e.instancia_whatsapp = p_instancia
    and p_instancia <> ''
    and e.nicho = p_nicho
    and e.ativo
    and e.config->'ia'->>'motor' = 'true'
  limit 1;
$$;

-- Rotinas: as lojas do ramo que estão no motor (p_empresa_id: só aquela, para teste).
create or replace function motor_lojas(p_nicho text, p_empresa_id uuid default null)
returns setof jsonb
language sql
stable
set search_path = public
as $$
  select motor_ficha(e.id)
  from empresas e
  where e.nicho = p_nicho
    and e.ativo
    and e.config->'ia'->>'motor' = 'true'
    and coalesce(e.instancia_whatsapp, '') <> ''
    and (p_empresa_id is null or e.id = p_empresa_id)
  order by e.criado_em;
$$;

-- só o servidor (n8n, com a chave de serviço) chama
revoke all on function motor_ficha(uuid) from public, anon, authenticated;
revoke all on function motor_loja(text, text) from public, anon, authenticated;
revoke all on function motor_lojas(text, uuid) from public, anon, authenticated;
grant execute on function motor_ficha(uuid) to service_role;
grant execute on function motor_loja(text, text) to service_role;
grant execute on function motor_lojas(text, uuid) to service_role;
