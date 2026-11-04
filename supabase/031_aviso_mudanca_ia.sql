-- =====================================================================
-- 031_aviso_mudanca_ia.sql — avisar a Gleide quando a IA remarca ou cancela (pedido do Victor, 04/11).
-- A agenda da IA grava aqui depois de mudar o horário; "IA - Faltas e avisos" (a cada 5 min, 8h–20h) manda o aviso.
-- Não avisa de novo o que já tem aviso próprio: remarcação de quem a Gleide pediu, de vaga ou de atraso.
-- =====================================================================

create table if not exists ia_mudancas_agenda (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references empresas(id),
  agendamento_id uuid references agendamentos(id) on delete set null,
  cliente_id uuid references clientes(id) on delete set null,
  tipo text not null check (tipo in ('remarcou', 'cancelou')),
  de_texto text,
  para_texto text,
  criado_em timestamptz not null default now(),
  avisado_em timestamptz
);
alter table ia_mudancas_agenda enable row level security;
create index if not exists ia_mudancas_agenda_pendentes on ia_mudancas_agenda (empresa_id, criado_em) where avisado_em is null;

create or replace function n8n_registrar_mudanca_ia(p_empresa_id uuid, p_agendamento_id uuid, p_tipo text, p_de text default null, p_para text default null)
returns uuid language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_id uuid;
begin
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  insert into ia_mudancas_agenda (empresa_id, agendamento_id, cliente_id, tipo, de_texto, para_texto)
  values (p_empresa_id, ag.id, ag.cliente_id, p_tipo, p_de, p_para)
  returning id into v_id;
  return v_id;
end $$;

create or replace function n8n_mudancas_para_avisar(p_empresa_id uuid)
returns table (mudanca_id uuid, tipo text, nome text, de_texto text, para_texto text, servico text)
language sql stable set search_path = public as $$
  select m.id, m.tipo, c.nome, m.de_texto, m.para_texto, s.nome
    from ia_mudancas_agenda m
    left join clientes c on c.id = m.cliente_id
    left join agendamentos a on a.id = m.agendamento_id
    left join servicos s on s.id = a.servico_id
   where m.empresa_id = p_empresa_id
     and m.avisado_em is null
     and m.criado_em > now() - interval '7 days'
     -- esse horário entra no aviso próprio de remarcação, vaga ou atraso, se esse aviso ainda não saiu antes desta mudança
     and not (m.tipo = 'remarcou' and exists (
           select 1 from contatos ct
            where ct.agendamento_id = m.agendamento_id
              and ct.tipo in ('remarcacao', 'vaga', 'atraso')
              and ct.resultado = 'agendou'
              and ct.criado_em > now() - interval '7 days'
              and a.inicio is distinct from ct.horario_original
              and not exists (select 1 from registros_ia r where r.registro_id = ct.id and r.acao = 'avisou_remarcou' and r.criado_em < m.criado_em)))
   order by m.criado_em
$$;

create or replace function n8n_marcar_mudancas_avisadas(p_empresa_id uuid, p_ids jsonb)
returns void language sql set search_path = public as $$
  update ia_mudancas_agenda set avisado_em = now()
   where empresa_id = p_empresa_id
     and id in (select (i #>> '{}')::uuid from jsonb_array_elements(coalesce(p_ids, '[]'::jsonb)) i)
$$;

revoke all on table ia_mudancas_agenda from public, anon, authenticated;
revoke all on function n8n_registrar_mudanca_ia(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function n8n_mudancas_para_avisar(uuid) from public, anon, authenticated;
revoke all on function n8n_marcar_mudancas_avisadas(uuid, jsonb) from public, anon, authenticated;
