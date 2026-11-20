-- 057: voucher da esmaltação em gel (pedido do Victor, 20/11/2026; só a Caroline por enquanto).
-- Quem faz ESMALTAÇÃO EM GEL ganha, depois do atendimento, um voucher (código) de R$ 20 no PRÓXIMO SERVIÇO
-- (só serviço, não produto). Vale 30 dias a partir do dia do atendimento. O sistema gera o código e o n8n manda
-- sozinho pelo WhatsApp da loja (n8n/demo-agente/voucher-gel.js, workflow "IA - Faltas e avisos").
--
-- Como funciona:
--   - o horário vira 'realizado' (✓ da agenda, assistente da dona ou IA) e o serviço principal OU um serviço a mais
--     (atendimento_servicos, ver 010) é esmaltação em gel -> nasce 1 voucher para esse horário (nunca 2);
--     serviço a mais conta: ela fez a esmaltação em gel na visita, só que junto com outro serviço;
--   - só nas lojas com empresas.config.loja.voucher_gel.ativo = true (ligado abaixo só para a Caroline);
--   - o horário volta de 'realizado' (desfazer) ou a esmaltação em gel sai do horário: o voucher NÃO é apagado,
--     fica cancelado (cancelado_em), e só se ainda não foi mandado nem usado. Refez o ✓: o mesmo voucher volta;
--   - uso AUTOMÁTICO: o próximo horário da mesma cliente que vira 'realizado', num DIA DEPOIS do dia da esmaltação
--     e até a validade, gasta o voucher mais antigo que ainda vale (usado_em, usado_agendamento_id). A regra é
--     "desconto no próximo serviço": o próximo serviço feito é onde o desconto foi dado. Sem isso a IA continuaria
--     dizendo à cliente que ela tem voucher depois de ela já ter usado. Esse horário volta de 'realizado': o voucher
--     volta a valer.
-- Os gatilhos rodam como dono (security definer, como o agendamento_vira_vaga do 013): quem marca o ✓ pelo app não
-- pode gravar em vouchers (só lê). Qualquer erro aqui só vira aviso no log: o ✓ da agenda nunca deixa de gravar.
-- Só soma: tabela nova, funções novas, gatilhos novos e a chave config.loja.voucher_gel da Caroline.

create table if not exists vouchers (
  id                    uuid primary key default gen_random_uuid(),
  empresa_id            uuid not null references empresas(id) on delete cascade,
  cliente_id            uuid not null references clientes(id) on delete cascade,
  codigo                text not null unique,                 -- "GEL-4F7K": fácil de ditar (sem 0/O, 1/I/L, 2/Z, 5/S, 8/B)
  valor                 numeric(10,2) not null default 20,
  -- o horário da esmaltação em gel; apagado o horário, o voucher fica (sem origem não é mandado)
  agendamento_origem_id uuid unique references agendamentos(id) on delete set null,
  criado_em             timestamptz not null default now(),
  valido_ate            date not null,                        -- dia do atendimento (Cuiabá) + 30
  enviado_em            timestamptz,
  cancelado_em          timestamptz,                          -- desfez o ✓ antes de mandar
  usado_em              timestamptz,
  usado_agendamento_id  uuid references agendamentos(id) on delete set null
);
create index if not exists vouchers_cliente on vouchers (cliente_id, criado_em);
create index if not exists vouchers_empresa on vouchers (empresa_id, criado_em desc);
create index if not exists vouchers_usado_agendamento on vouchers (usado_agendamento_id);

alter table vouchers enable row level security;
-- o app só lê (quem é da loja); quem grava são os gatilhos e o n8n (chave de serviço)
drop policy if exists vouchers_select on vouchers;
create policy vouchers_select on vouchers for select to authenticated
  using (empresa_id in (select private.minhas_empresas()));

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on vouchers to authenticated;
    grant all on vouchers to service_role;
  end if;
end $$;

-- O serviço é esmaltação em gel? (sem acento e sem maiúscula: "Esmaltação em gel", "esmaltacao gel mão e pé",
-- "Esmalte em gel"). Não conta: alongamento em gel, banho de gel, e remoção/retirada/manutenção da esmaltação.
create or replace function voucher_gel_servico(p_servico_id uuid) returns boolean
language sql stable set search_path = public as $$
  select coalesce((
    select n ~ '(^|[^a-z])esmalt(e|acao|ado)s?\s+(em\s+|de\s+|com\s+)?gel' and n !~ '^\s*(remoc|retirad|retirar|tirar|manutenc)'
      from (select lower(translate(s.nome, 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç',
                                            'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc')) as n
              from servicos s where s.id = p_servico_id) x), false)
$$;

-- Código novo: GEL- + 4 sinais de um alfabeto sem letras e números que se confundem ao ditar.
create or replace function voucher_gel_codigo() returns text
language plpgsql volatile set search_path = public as $$
declare
  v_alfa constant text := 'AFHJKMRUWXY34679';
  v_cod  text;
begin
  for tentativa in 1..50 loop
    v_cod := 'GEL-';
    for i in 1..4 loop
      v_cod := v_cod || substr(v_alfa, 1 + floor(random() * length(v_alfa))::int, 1);
    end loop;
    if not exists (select 1 from vouchers where codigo = v_cod) then return v_cod; end if;
  end loop;
  raise exception 'voucher: não achei código livre';
end $$;

-- Acerta o voucher de UM horário com o que ele é agora: cria, volta a valer ou cancela.
create or replace function voucher_gel_conferir(p_agendamento_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  a      record;
  v      vouchers%rowtype;
  v_deve boolean;
  v_ate  date;
begin
  select ag.id, ag.empresa_id, ag.cliente_id, ag.status, ag.inicio, ag.servico_id,
         coalesce(e.config->'loja'->'voucher_gel'->>'ativo', '') = 'true' as ativo
    into a
    from agendamentos ag join empresas e on e.id = ag.empresa_id
   where ag.id = p_agendamento_id;
  if a.id is null then return; end if;
  select * into v from vouchers where agendamento_origem_id = a.id;
  -- loja sem voucher e nenhum voucher deste horário: nada a fazer (é o caminho da Gleide)
  if not a.ativo and v.id is null then return; end if;

  v_deve := a.status = 'realizado'
    and (voucher_gel_servico(a.servico_id)
         or exists (select 1 from atendimento_servicos x where x.agendamento_id = a.id and voucher_gel_servico(x.servico_id)));
  v_ate := (a.inicio at time zone 'America/Cuiaba')::date + 30;

  if v_deve and v.id is null then
    -- loja ligada; o ✓ dado depois de passada a validade não gera nada
    if a.ativo and v_ate >= (now() at time zone 'America/Cuiaba')::date then
      insert into vouchers (empresa_id, cliente_id, codigo, agendamento_origem_id, valido_ate)
      values (a.empresa_id, a.cliente_id, voucher_gel_codigo(), a.id, v_ate)
      on conflict (agendamento_origem_id) do nothing;
    end if;
  elsif v_deve and v.cancelado_em is not null and v.enviado_em is null and v.usado_em is null then
    update vouchers set cancelado_em = null, valido_ate = v_ate where id = v.id;
  elsif not v_deve and v.id is not null and v.cancelado_em is null and v.enviado_em is null and v.usado_em is null then
    update vouchers set cancelado_em = now() where id = v.id;
  end if;
end $$;

-- Gasta (ou devolve) o voucher quando um horário vira (ou deixa de ser) 'realizado'.
create or replace function voucher_gel_uso(p_agendamento_id uuid, p_realizado boolean) returns void
language plpgsql security definer set search_path = public as $$
declare
  a    record;
  v_id uuid;
begin
  if not p_realizado then
    update vouchers set usado_em = null, usado_agendamento_id = null where usado_agendamento_id = p_agendamento_id;
    return;
  end if;
  select ag.id, ag.cliente_id, ag.inicio into a from agendamentos ag where ag.id = p_agendamento_id;
  if a.id is null then return; end if;
  -- já gastou um voucher (gatilho rodou de novo): não gasta outro
  if exists (select 1 from vouchers where usado_agendamento_id = a.id) then return; end if;
  select v.id into v_id
    from vouchers v
    left join agendamentos o on o.id = v.agendamento_origem_id
   where v.cliente_id = a.cliente_id
     and v.usado_em is null and v.cancelado_em is null
     and v.agendamento_origem_id is distinct from a.id
     -- o próximo serviço é num dia depois do dia da esmaltação (pé e mão marcados em dois horários no mesmo dia
     -- não gastam o voucher que acabou de nascer) e até a validade
     and (a.inicio at time zone 'America/Cuiaba')::date > (coalesce(o.inicio, v.criado_em) at time zone 'America/Cuiaba')::date
     and (a.inicio at time zone 'America/Cuiaba')::date <= v.valido_ate
   order by v.criado_em
   limit 1
   for update of v;
  if v_id is not null then
    update vouchers set usado_em = now(), usado_agendamento_id = a.id where id = v_id;
  end if;
end $$;

create or replace function vouchers_gatilho_agendamento() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_op = 'INSERT' then
      if new.status = 'realizado' then perform voucher_gel_uso(new.id, true); end if;
    elsif new.status is distinct from old.status then
      if new.status = 'realizado' then perform voucher_gel_uso(new.id, true);
      elsif old.status = 'realizado' then perform voucher_gel_uso(new.id, false); end if;
    end if;
    -- o uso vem antes: a esmaltação de hoje gasta o voucher antigo e ganha um novo, nunca o próprio
    perform voucher_gel_conferir(new.id);
  exception when others then
    raise warning 'voucher_gel (agendamento %): %', new.id, sqlerrm;
  end;
  return null;
end $$;

create or replace function vouchers_gatilho_servicos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform voucher_gel_conferir(case when tg_op = 'DELETE' then old.agendamento_id else new.agendamento_id end);
  exception when others then
    raise warning 'voucher_gel (serviço a mais): %', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists vouchers_gel_agendamento on agendamentos;
create trigger vouchers_gel_agendamento after insert or update of status, servico_id on agendamentos
  for each row execute function vouchers_gatilho_agendamento();
drop trigger if exists vouchers_gel_servicos on atendimento_servicos;
create trigger vouchers_gel_servicos after insert or delete on atendimento_servicos
  for each row execute function vouchers_gatilho_servicos();

-- ---------------------------------------------------------------------------------------------------------------
-- Funções do n8n
-- ---------------------------------------------------------------------------------------------------------------

-- (a) Vouchers para mandar: não mandados, valendo, nascidos nas últimas 48 h e há mais de 30 min (dá tempo de a
-- dona desfazer um ✓ errado). Mesmos cuidados do lembrete (027): IA pausada, cliente excluída ou conversando com o
-- salão na última hora ficam para a próxima rodada (a cada 5 min, 8h às 20h). Desligou a loja: para de mandar.
create or replace function n8n_vouchers_para_mandar(p_empresa_id uuid, p_agora timestamptz default now())
returns table (voucher_id uuid, cliente_id uuid, nome text, telefone text, codigo text, valor numeric, valido_ate date)
language sql stable set search_path = public as $$
  select v.id, c.id, c.nome, c.telefone, v.codigo, v.valor, v.valido_ate
    from vouchers v
    join clientes c on c.id = v.cliente_id
    join empresas e on e.id = v.empresa_id
    join agendamentos o on o.id = v.agendamento_origem_id and o.status = 'realizado'
   where v.empresa_id = p_empresa_id
     and coalesce(e.config->'loja'->'voucher_gel'->>'ativo', '') = 'true'
     and v.enviado_em is null and v.cancelado_em is null and v.usado_em is null
     and v.criado_em > p_agora - interval '48 hours'
     and v.criado_em <= p_agora - interval '30 minutes'
     and v.valido_ate >= (p_agora at time zone 'America/Cuiaba')::date
     and coalesce(c.telefone, '') <> ''
     and not ('sistema:excluida' = any (coalesce(c.etiquetas, '{}')))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor in ('cliente', 'humano')
                      and m.criado_em > p_agora - interval '1 hour')
   order by v.criado_em
   limit 20
$$;

-- (b) Depois que o WhatsApp aceitou: marca mandado e grava a mensagem na conversa (como o lembrete, 027)
create or replace function n8n_voucher_enviado(p_empresa_id uuid, p_voucher_id uuid, p_mensagem text, p_wa_message_id text default null)
returns jsonb language plpgsql set search_path = public as $$
declare v vouchers%rowtype;
begin
  update vouchers set enviado_em = now()
   where id = p_voucher_id and empresa_id = p_empresa_id and enviado_em is null
  returning * into v;
  if v.id is null then return jsonb_build_object('ok', false, 'motivo', 'sem_voucher_ou_ja_enviado'); end if;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
  values (p_empresa_id, v.cliente_id, 'saida', 'ia', 'texto', p_mensagem, p_wa_message_id)
  on conflict (wa_message_id) do nothing;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, v.cliente_id, 'atendimento', 'n8n_voucher_enviado', 'vouchers', v.id,
          jsonb_build_object('codigo', v.codigo, 'mensagem', p_mensagem));
  return jsonb_build_object('ok', true, 'codigo', v.codigo);
end $$;

-- (c) Vouchers que ainda valem para a cliente (a IA de atendimento mostra na ficha). Acha o cadastro com e sem o 9.
-- Devolve UM objeto { vouchers: [...] } (e não uma lista): no n8n vira 1 item só, e a ficha não muda de forma.
create or replace function n8n_vouchers_da_cliente(p_empresa_id uuid, p_telefone text, p_agora timestamptz default now())
returns jsonb
language sql stable set search_path = public as $$
  with t as (select regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') as d)
  select jsonb_build_object('vouchers', coalesce(jsonb_agg(jsonb_build_object(
           'codigo', v.codigo, 'valor', v.valor, 'valido_ate', v.valido_ate, 'enviado', v.enviado_em is not null)
           order by v.valido_ate), '[]'::jsonb))
    from vouchers v
    join clientes c on c.id = v.cliente_id, t
   where v.empresa_id = p_empresa_id
     and t.d <> ''
     and c.telefone in (t.d,
                        case when t.d ~ '^55\d\d9\d{8}$' then substr(t.d, 1, 4) || substr(t.d, 6) end,
                        case when t.d ~ '^55\d\d\d{8}$' then substr(t.d, 1, 4) || '9' || substr(t.d, 5) end)
     and v.usado_em is null and v.cancelado_em is null
     and v.valido_ate >= (p_agora at time zone 'America/Cuiaba')::date
$$;

revoke all on function voucher_gel_servico(uuid) from public, anon, authenticated;
revoke all on function voucher_gel_codigo() from public, anon, authenticated;
revoke all on function voucher_gel_conferir(uuid) from public, anon, authenticated;
revoke all on function voucher_gel_uso(uuid, boolean) from public, anon, authenticated;
revoke all on function vouchers_gatilho_agendamento() from public, anon, authenticated;
revoke all on function vouchers_gatilho_servicos() from public, anon, authenticated;
revoke all on function n8n_vouchers_para_mandar(uuid, timestamptz) from public, anon, authenticated;
revoke all on function n8n_voucher_enviado(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function n8n_vouchers_da_cliente(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function n8n_vouchers_para_mandar(uuid, timestamptz) to service_role;
grant execute on function n8n_voucher_enviado(uuid, uuid, text, text) to service_role;
grant execute on function n8n_vouchers_da_cliente(uuid, text, timestamptz) to service_role;

-- Liga para a Caroline (só acrescenta a chave; o resto de config.loja fica como está)
update empresas
   set config = coalesce(config, '{}'::jsonb)
                || jsonb_build_object('loja', coalesce(config->'loja', '{}'::jsonb) || '{"voucher_gel": {"ativo": true}}'::jsonb)
 where id = '26a5d3eb-e8e4-4ed8-b206-095095292fdd';
