-- 064: remarcar e mudar a duração pela assistente conferem conflito só com a MESMA profissional (Caroline ou Duda),
-- e remarcar pode trocar de profissional quando a dona pede ("passa a Ana para a Duda"). Mesmo jeito da 061:
--   1. faz pelo caminho de sempre (n8n_assistente_reagendar_confirma / n8n_assistente_ajustar_duracao) com forcar = sim
--      só para pular a conferência do salão inteiro (o resto das regras continua igual);
--   2. grava a profissional pedida (remarcar; vazio = fica com a de antes);
--   3. confere com assistente_conferir_horario_prof (061): dia, horário do salão, almoço, horas bloqueadas e encavalar só
--      com a mesma profissional; encavalou: desfaz tudo (exceção) e devolve "NÃO REAGENDEI" / "NÃO MUDEI", como antes.
--   Com forcar (a dona viu o motivo e quer assim mesmo): como antes, sem conferir.
-- Só nas lojas cujo n8n chama estas funções (a Gleide não chama). Só soma: duas funções novas.

create or replace function n8n_assistente_reagendar_prof(
  p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid, p_inicio timestamptz, p_servico text, p_forcar boolean,
  p_profissional_id uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v        jsonb;
  v_motivo text;
begin
  if p_profissional_id is not null and not exists (
    select 1 from profissionais where id = p_profissional_id and empresa_id = p_empresa_id and ativo) then
    raise exception 'profissional % não é desta loja', p_profissional_id;
  end if;
  v := n8n_assistente_reagendar_confirma(p_empresa_id, p_pedido_por, p_agendamento_id, p_inicio, p_servico, true);
  if p_profissional_id is not null then
    update agendamentos set profissional_id = p_profissional_id
     where id = p_agendamento_id and empresa_id = p_empresa_id;
  end if;
  if not p_forcar then
    v_motivo := assistente_conferir_horario_prof(p_empresa_id, p_agendamento_id);
    if v_motivo is not null then
      raise exception 'NÃO REAGENDEI: % Conte a quem pediu; se quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;
  return v;
end $$;

create or replace function n8n_assistente_ajustar_duracao_prof(
  p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid, p_minutos int, p_forcar boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  v        jsonb;
  v_motivo text;
begin
  v := n8n_assistente_ajustar_duracao(p_empresa_id, p_pedido_por, p_agendamento_id, p_minutos, true);
  if not p_forcar then
    v_motivo := assistente_conferir_horario_prof(p_empresa_id, p_agendamento_id);
    if v_motivo is not null then
      raise exception 'NÃO MUDEI: % Conte a quem pediu; se quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;
  return v;
end $$;

-- Agenda do dia da assistente com "com": quem atende cada horário (horário sem profissional = a dona). O resto igual.
create or replace function n8n_assistente_agenda_do_dia_prof(p_empresa_id uuid, p_pedido_por text, p_data date default null)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v           jsonb;
  v_principal uuid;
begin
  v := n8n_assistente_agenda_do_dia(p_empresa_id, p_pedido_por, p_data);
  if jsonb_typeof(v) <> 'array' then return v; end if;
  select p.id into v_principal from profissionais p
   where p.empresa_id = p_empresa_id and p.ativo order by p.criado_em limit 1;
  return (select coalesce(jsonb_agg(
            case when jsonb_typeof(x.e) = 'object' and x.e ? 'agendamento_id'
                 then x.e || jsonb_build_object('com', (select p.nome from agendamentos a join profissionais p
                                                         on p.id = coalesce(a.profissional_id, v_principal)
                                                       where a.id = (x.e->>'agendamento_id')::uuid))
                 else x.e end order by x.n), '[]'::jsonb)
            from jsonb_array_elements(v) with ordinality as x(e, n));
end $$;

revoke all on function n8n_assistente_agenda_do_dia_prof(uuid, text, date) from public, anon, authenticated;
grant execute on function n8n_assistente_agenda_do_dia_prof(uuid, text, date) to service_role;
revoke all on function n8n_assistente_reagendar_prof(uuid, text, uuid, timestamptz, text, boolean, uuid) from public, anon, authenticated;
revoke all on function n8n_assistente_ajustar_duracao_prof(uuid, text, uuid, int, boolean) from public, anon, authenticated;
grant execute on function n8n_assistente_reagendar_prof(uuid, text, uuid, timestamptz, text, boolean, uuid) to service_role;
grant execute on function n8n_assistente_ajustar_duracao_prof(uuid, text, uuid, int, boolean) to service_role;
