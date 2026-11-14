-- Motor único: teto de conversas por loja (docs/PLANO-MOTOR-UNICO.md, "Custo do Gemini").
-- Só soma: uma tabela nova, funções novas e a ficha com três campos a mais.
--
-- Conversa = uma cliente num dia em que a IA mandou pelo menos uma mensagem para ela (resposta, lembrete,
-- retomada ou retorno). A conta é do mês corrente, no fuso da loja.
--
-- empresas.config.ia.limite_mes  200   conversas incluídas no plano por mês. Sem a chave, a loja não tem teto.
--
-- No teto (uso >= limite):
--   - cliente que JÁ falou com a IA hoje continua sendo atendida (a conversa dela já foi contada);
--   - conversa nova fica sem resposta automática;
--   - retomada e retorno param; lembretes de horário e avisos para a dona continuam.
-- Avisos (uma vez por mês cada): 80% e 100%, para a dona e para a agência (motor_avisos_teto).
-- Para liberar: aumentar config.ia.limite_mes.

create table if not exists motor_avisos (
  empresa_id uuid not null references empresas(id) on delete cascade,
  mes text not null,           -- 'AAAA-MM' no fuso da loja
  nivel int not null,          -- 80 ou 100
  criado_em timestamptz not null default now(),
  primary key (empresa_id, mes, nivel)
);
alter table motor_avisos enable row level security;  -- sem política: só o servidor (chave de serviço) lê e grava
revoke all on motor_avisos from anon, authenticated;

create or replace function motor_uso_mes(p_empresa_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select count(distinct (m.cliente_id, (m.criado_em at time zone coalesce(e.fuso, 'America/Cuiaba'))::date))::int
  from empresas e
  join mensagens m on m.empresa_id = e.id
  where e.id = p_empresa_id
    and m.autor = 'ia'
    and m.criado_em >= date_trunc('month', now() at time zone coalesce(e.fuso, 'America/Cuiaba')) at time zone coalesce(e.fuso, 'America/Cuiaba');
$$;

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
    'bloco_min', case when e.config->'ia'->>'bloco_min' ~ '^[0-9]{1,3}$' then (e.config->'ia'->>'bloco_min')::int else 0 end,
    'catalogo_link', coalesce(e.config->'loja'->>'catalogo_link', ''),
    'limite_mes', l.limite,
    'uso_mes', case when l.limite is null then null else u.uso end,
    'no_limite', l.limite is not null and u.uso >= l.limite
  )
  from empresas e
  cross join lateral (select case when e.config->'ia'->>'limite_mes' ~ '^[0-9]{1,6}$' then (e.config->'ia'->>'limite_mes')::int end as limite) l
  cross join lateral (select case when l.limite is null then 0 else motor_uso_mes(e.id) end as uso) u
  where e.id = p_empresa_id;
$$;

-- Mensagem que chegou: de qual loja é a instância? p_telefone (de quem mandou) serve para o teto:
-- "conversa_barrada" = a loja está no teto e esta cliente ainda não falou com a IA hoje.
drop function if exists motor_loja(text, text);
create or replace function motor_loja(p_instancia text, p_nicho text, p_telefone text default null)
returns jsonb
language sql
stable
set search_path = public
as $$
  select f.ficha || jsonb_build_object('conversa_barrada',
    coalesce((f.ficha->>'no_limite')::boolean, false) and not exists (
      select 1
      from clientes c
      join mensagens m on m.cliente_id = c.id and m.empresa_id = c.empresa_id
      where c.empresa_id = e.id
        and regexp_replace(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), '^(55\d\d)9(\d{8})$', '\1\2')
          = regexp_replace(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '^(55\d\d)9(\d{8})$', '\1\2')
        and m.autor = 'ia'
        and m.criado_em >= date_trunc('day', now() at time zone coalesce(e.fuso, 'America/Cuiaba')) at time zone coalesce(e.fuso, 'America/Cuiaba')
    ))
  from empresas e
  cross join lateral (select motor_ficha(e.id) as ficha) f
  where e.instancia_whatsapp = p_instancia
    and p_instancia <> ''
    and e.nicho = p_nicho
    and e.ativo
    and e.config->'ia'->>'motor' = 'true'
  limit 1;
$$;

-- Avisos do teto: devolve as lojas do ramo que passaram de 80% ou chegaram a 100% e ainda não foram
-- avisadas neste mês, e já marca como avisadas (cada nível, uma vez por mês).
create or replace function motor_avisos_teto(p_nicho text)
returns setof jsonb
language plpgsql
volatile
set search_path = public
as $$
declare
  r record;
  v_nivel int;
  v_mes text;
begin
  for r in
    select e.id, coalesce(e.fuso, 'America/Cuiaba') as fuso, motor_ficha(e.id) as ficha
    from empresas e
    where e.nicho = p_nicho and e.ativo and e.config->'ia'->>'motor' = 'true'
      and coalesce(e.instancia_whatsapp, '') <> ''
      and e.config->'ia'->>'limite_mes' ~ '^[0-9]{1,6}$'
  loop
    if (r.ficha->>'limite_mes')::int <= 0 then continue; end if;
    v_nivel := case
      when (r.ficha->>'uso_mes')::int >= (r.ficha->>'limite_mes')::int then 100
      when (r.ficha->>'uso_mes')::int * 100 >= (r.ficha->>'limite_mes')::int * 80 then 80
      else null end;
    if v_nivel is null then continue; end if;
    v_mes := to_char(now() at time zone r.fuso, 'YYYY-MM');
    insert into motor_avisos (empresa_id, mes, nivel) values (r.id, v_mes, v_nivel) on conflict do nothing;
    if not found then continue; end if;  -- já avisada neste mês neste nível
    -- quem pula direto para 100% não recebe depois o aviso de 80%
    if v_nivel = 100 then
      insert into motor_avisos (empresa_id, mes, nivel) values (r.id, v_mes, 80) on conflict do nothing;
    end if;
    return next r.ficha || jsonb_build_object('nivel', v_nivel);
  end loop;
end;
$$;

revoke all on function motor_uso_mes(uuid) from public, anon, authenticated;
revoke all on function motor_ficha(uuid) from public, anon, authenticated;
revoke all on function motor_loja(text, text, text) from public, anon, authenticated;
revoke all on function motor_avisos_teto(text) from public, anon, authenticated;
grant execute on function motor_uso_mes(uuid) to service_role;
grant execute on function motor_ficha(uuid) to service_role;
grant execute on function motor_loja(text, text, text) to service_role;
grant execute on function motor_avisos_teto(text) to service_role;
