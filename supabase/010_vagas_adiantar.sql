-- =====================================================================
-- 010_vagas_adiantar.sql
-- Vaga que abriu: um horário futuro foi cancelado ou remarcado para outro dia
-- (pela IA ou pela Gleide no app). O horário antigo vira uma `vaga`, e a IA
-- oferece a vaga para a cliente com o próximo horário marcado depois dela
-- ("abriu um horário antes do seu, quer adiantar?"). Se ela topar, a IA
-- remarca o horário dela para a vaga (remarcar_agendamento, mesmo agendamento).
--   - vagas: o horário que ficou livre (aberta -> preenchida / expirada)
--   - contatos ganha o tipo 'vaga' (canal 'ia') e vaga_id; agendamento_id = o horário
--     da cliente que recebeu a oferta, horario_original = quando ele era
--   - n8n_vagas_para_oferecer: fecha vagas ocupadas/vencidas e devolve 1 cliente por vaga
--   - n8n_registrar_oferta_vaga: grava o contato e a mensagem enviada
--   - a Gleide recebe "adiantou" pelo mesmo aviso das faltas (n8n_avisos_para_gleide)
-- Não vira vaga: pedido de remarcação da Gleide (ela que não pode), dia bloqueado,
-- horário a menos de 3 h.
-- Ligar: empresas.config.vagas = {"oferecer": true, "so_para": []}
--   so_para com números = só oferece para esses (teste); vazio = todas.
--   Sem config.vagas, não oferece para ninguém.
-- =====================================================================

create table vagas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  inicio          timestamptz not null,
  fim             timestamptz not null,
  agendamento_id  uuid references agendamentos(id) on delete set null,  -- o horário que saiu daqui
  motivo          text not null check (motivo in ('cancelado', 'remarcado')),
  status          text not null default 'aberta' check (status in ('aberta', 'preenchida', 'expirada')),
  criado_em       timestamptz not null default now()
);
create index idx_vagas_abertas on vagas (empresa_id, inicio) where status = 'aberta';
create index idx_vagas_agendamento on vagas (agendamento_id);
alter table vagas enable row level security;  -- só o n8n (service_role) mexe

alter table contatos drop constraint contatos_tipo_check;
alter table contatos add constraint contatos_tipo_check
  check (tipo in ('retorno', 'reativacao', 'aniversario', 'outro', 'remarcacao', 'falta', 'vaga'));
alter table contatos add column vaga_id uuid references vagas(id) on delete set null;
create index idx_contatos_vaga on contatos (vaga_id) where vaga_id is not null;

-- O horário saiu de lá (cancelado, ou remarcado para outro horário): vira vaga
create or replace function agendamento_vira_vaga() returns trigger
language plpgsql set search_path = public as $$
declare v_motivo text;
begin
  if old.status <> 'agendado' or old.inicio < now() + interval '3 hours' then return new; end if;
  if new.status = 'cancelado' then v_motivo := 'cancelado';
  elsif new.status = 'agendado' and new.inicio is distinct from old.inicio then v_motivo := 'remarcado';
  else return new; end if;
  -- a Gleide pediu para remarcar (imprevisto dela): o horário não está livre
  if exists (select 1 from contatos ct where ct.agendamento_id = old.id and ct.tipo = 'remarcacao'
              and ct.criado_em > now() - interval '14 days') then return new; end if;
  insert into vagas (empresa_id, inicio, fim, agendamento_id, motivo)
  values (old.empresa_id, old.inicio, coalesce(old.fim, old.inicio + interval '1 hour'), old.id, v_motivo);
  return new;
end $$;
create trigger trg_agendamento_vira_vaga after update of status, inicio on agendamentos
  for each row execute function agendamento_vira_vaga();

-- Oferta de vaga se resolve quando o horário da cliente muda (igual ao pedido de remarcação),
-- não quando ela marca qualquer outra coisa
create or replace function contato_marca_remarcado() returns trigger
language plpgsql set search_path = public as $$
begin
  update contatos
     set resultado = 'agendou'
   where agendamento_id = new.id
     and tipo in ('remarcacao', 'vaga')
     and resultado in ('pendente', 'respondeu');
  return new;
end $$;

create or replace function contato_marca_agendou() returns trigger
language plpgsql set search_path = public as $$
begin
  update contatos
     set resultado = 'agendou'
   where cliente_id = new.cliente_id
     and resultado in ('pendente', 'respondeu')
     and criado_em >= now() - interval '14 days'
     and tipo not in ('remarcacao', 'vaga')
     and (tipo <> 'falta' or (new.status = 'agendado' and new.inicio > now()));
  return new;
end $$;

-- Fecha as vagas que alguém ocupou ou que estão perto demais, e devolve para quem oferecer:
-- 1 cliente por vaga, a do horário mais próximo DEPOIS da vaga (até 14 dias), cujo serviço cabe
-- na vaga. Uma oferta por vez: a próxima cliente só recebe se a anterior não respondeu em 2 h
-- ou respondeu e não adiantou em 30 min.
create or replace function n8n_vagas_para_oferecer(p_empresa_id uuid)
returns table (vaga_id uuid, vaga_inicio timestamptz, vaga_fim timestamptz, agendamento_id uuid,
               cliente_id uuid, nome text, telefone text, inicio_atual timestamptz, servico text)
language plpgsql set search_path = public as $$
begin
  update vagas v set status = 'preenchida'
   where v.empresa_id = p_empresa_id and v.status = 'aberta'
     and exists (select 1 from agendamentos a
                  where a.empresa_id = v.empresa_id and a.status in ('agendado', 'realizado')
                    and a.inicio < v.fim and coalesce(a.fim, a.inicio + interval '1 hour') > v.inicio);
  update vagas v set status = 'expirada'
   where v.empresa_id = p_empresa_id and v.status = 'aberta' and v.inicio < now() + interval '3 hours';

  return query
  select distinct on (v.id)
         v.id, v.inicio, v.fim, a.id, c.id, c.nome, c.telefone, a.inicio, s.nome
    from vagas v
    join empresas e on e.id = v.empresa_id
    join agendamentos a on a.empresa_id = v.empresa_id and a.status = 'agendado'
                       and a.inicio >= v.fim and a.inicio <= v.inicio + interval '14 days'
                       and coalesce(a.fim, a.inicio + interval '1 hour') - a.inicio <= v.fim - v.inicio
    join clientes c on c.id = a.cliente_id
    left join servicos s on s.id = a.servico_id
   where v.empresa_id = p_empresa_id
     and v.status = 'aberta'
     and coalesce((e.config->'vagas'->>'oferecer')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'vagas'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'vagas'->'so_para') ? c.telefone)
     -- dia bloqueado pela Gleide (viagem, folga): não oferece
     and not exists (select 1 from jsonb_array_elements(coalesce(e.config->'bloqueios', '[]'::jsonb)) b
                      where (v.inicio at time zone 'America/Cuiaba')::date between (b->>'de')::date and (b->>'ate')::date)
     -- quem saiu da vaga não recebe a própria vaga
     and a.cliente_id is distinct from (select x.cliente_id from agendamentos x where x.id = v.agendamento_id)
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < now())
     -- já recebeu esta vaga, ou tem outro alô aberto (não mistura dois assuntos)
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.vaga_id = v.id)
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.resultado in ('pendente', 'respondeu')
                      and ct.criado_em > now() - interval '24 hours')
     -- uma oferta por vez para cada vaga
     and not exists (select 1 from contatos ct where ct.vaga_id = v.id
                      and (ct.resultado = 'agendou'
                           or (ct.resultado = 'pendente' and ct.criado_em > now() - interval '2 hours')
                           or (ct.resultado = 'respondeu' and ct.criado_em > now() - interval '30 minutes')))
   order by v.id, a.inicio;
end $$;

create or replace function n8n_registrar_oferta_vaga(p_empresa_id uuid, p_vaga_id uuid, p_agendamento_id uuid,
                                                     p_mensagem text, p_wa_message_id text default null)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_contato uuid;
begin
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  insert into contatos (empresa_id, cliente_id, tipo, canal, mensagem, agendamento_id, horario_original, vaga_id)
  values (p_empresa_id, ag.cliente_id, 'vaga', 'ia', p_mensagem, ag.id, ag.inicio, p_vaga_id)
  returning id into v_contato;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
  values (p_empresa_id, ag.cliente_id, 'saida', 'ia', 'texto', p_mensagem, p_wa_message_id)
  on conflict (wa_message_id) do nothing;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, ag.cliente_id, 'atendimento', 'n8n_registrar_oferta_vaga', 'contatos', v_contato,
          jsonb_build_object('vaga_id', p_vaga_id, 'agendamento_id', ag.id, 'mensagem', p_mensagem));
  return jsonb_build_object('contato_id', v_contato);
end $$;

-- Igual ao 008, mais a oferta de vaga aceita ("adiantou"); vaga sem resposta não avisa a Gleide
create or replace function n8n_avisos_para_gleide(p_empresa_id uuid)
returns table (contato_id uuid, tipo text, situacao text, nome text, telefone text,
               horario_original timestamptz, novo_horario timestamptz, servico text)
language sql stable set search_path = public as $$
  select y.contato_id, y.tipo, y.situacao, y.nome, y.telefone, y.horario_original, y.novo_horario, y.servico
  from (
    select distinct on (coalesce(ct.agendamento_id, ct.id))
           ct.id as contato_id, ct.tipo, ct.criado_em,
           case when ct.resultado = 'agendou' then 'remarcou' else 'sem_resposta' end as situacao,
           c.nome, c.telefone, ct.horario_original,
           case when ct.tipo in ('remarcacao', 'vaga') then a.inicio
                else (select min(f.inicio) from agendamentos f
                       where f.cliente_id = c.id and f.status = 'agendado' and f.criado_em >= ct.criado_em) end as novo_horario,
           s.nome as servico,
           ct.resultado, a.status as status_horario, a.inicio as inicio_horario
      from contatos ct
      join clientes c on c.id = ct.cliente_id
      left join agendamentos a on a.id = ct.agendamento_id
      left join servicos s on s.id = a.servico_id
     where ct.empresa_id = p_empresa_id
       and ct.tipo in ('falta', 'remarcacao', 'vaga')
       and ct.criado_em > now() - interval '7 days'
     order by coalesce(ct.agendamento_id, ct.id), ct.criado_em desc
  ) y
  where (
          (y.resultado = 'agendou'
            and (y.tipo not in ('remarcacao', 'vaga') or (y.status_horario = 'agendado' and y.inicio_horario is distinct from y.horario_original)))
          or (y.resultado = 'pendente' and y.tipo <> 'vaga' and y.criado_em < now() - interval '24 hours')
        )
    and not exists (select 1 from registros_ia r where r.registro_id = y.contato_id and r.acao = 'avisou_' || y.situacao)
  order by y.horario_original
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'n8n_vagas_para_oferecer(uuid)',
    'n8n_registrar_oferta_vaga(uuid, uuid, uuid, text, text)',
    'n8n_avisos_para_gleide(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
