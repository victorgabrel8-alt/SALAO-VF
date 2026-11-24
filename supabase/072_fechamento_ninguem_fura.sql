-- =====================================================================
-- 072 - Fechamento que ninguém fura, nem com forcar (pedido do Victor, 24/11/2026, Studio Caroline)
--
-- "Se a Caroline dá um fechamento de compromisso a IA não deve marcar de nenhuma forma." Dia ou hora fechados no app
-- (config.bloqueios e config.bloqueios_horario: casamento, prova, gravação...) não recebem horário pela assistente,
-- nem quando a dona dita a cliente e a hora (forcar = sim). 19/11: a assistente marcou a Katia no dia do casamento da
-- Caroline. Para marcar ali, primeiro tira o fechamento.
--
-- Troca as três funções da assistente com profissional (supabase/061 e 064), que só a assistente da Caroline usa
-- (segunda-profissional-whatsapp.js); a Gleide não chama nenhuma delas. Depende da 071 (agenda_fechada).
--   - marcar: horário novo num fechamento é recusado;
--   - reagendar: recusado se o horário MUDA de lugar e cai num fechamento, ou se a mudança faz ele ENTRAR num
--     fechamento. Horário que já estava num dia fechado (marcado antes do fechamento) continua podendo trocar o
--     serviço no mesmo dia e hora, para a dona acertar a ficha antes de remarcar;
--   - mudar a duração: recusado se o novo tempo faz o horário entrar num fechamento em que não estava.
-- O raise desfaz o que a função de dentro gravou (é tudo uma chamada só).
-- =====================================================================

create or replace function n8n_assistente_marcar_horario_prof(p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid, p_telefone text,
    p_nome text, p_servico text, p_inicio timestamp with time zone, p_observacoes text default null, p_forcar boolean default false,
    p_duracao_min integer default null, p_bloco_min integer default 150, p_profissional_id uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v           jsonb;
  v_id        uuid;
  v_principal uuid;
  v_motivo    text;
begin
  if p_profissional_id is not null and not exists (
    select 1 from profissionais where id = p_profissional_id and empresa_id = p_empresa_id and ativo) then
    raise exception 'profissional % não é desta loja', p_profissional_id;
  end if;
  v := n8n_assistente_marcar_horario_c(p_empresa_id, p_pedido_por, p_cliente_id, p_telefone, p_nome, p_servico,
                                       p_inicio, p_observacoes, true, p_duracao_min, p_bloco_min);
  v_id := nullif(v->>'agendamento_id', '')::uuid;
  if v_id is null then return v; end if;
  -- fechamento do app não é furado nem com forcar
  v_motivo := agenda_fechada(p_empresa_id, v_id);
  if v_motivo is not null then
    raise exception 'NÃO MARQUEI: % Nesse fechamento ninguém marca, nem com forcar. Diga isso a quem pediu; se for para atender mesmo assim, primeiro tire o fechamento (desbloquear) e depois marque.', v_motivo;
  end if;
  select p.id into v_principal from profissionais p
   where p.empresa_id = p_empresa_id and p.ativo order by p.criado_em limit 1;
  update agendamentos set profissional_id = coalesce(p_profissional_id, v_principal)
   where id = v_id and empresa_id = p_empresa_id;
  if not p_forcar then
    v_motivo := assistente_conferir_horario_prof(p_empresa_id, v_id);
    if v_motivo is not null then
      raise exception 'NÃO MARQUEI: % Conte a quem pediu; se quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;
  return v;
end $$;

create or replace function n8n_assistente_reagendar_prof(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
    p_inicio timestamp with time zone, p_servico text, p_forcar boolean, p_profissional_id uuid default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  v        jsonb;
  v_motivo text;
  v_antes  text;
  v_ini    timestamptz;
begin
  if p_profissional_id is not null and not exists (
    select 1 from profissionais where id = p_profissional_id and empresa_id = p_empresa_id and ativo) then
    raise exception 'profissional % não é desta loja', p_profissional_id;
  end if;
  -- como estava antes: horário marcado antes de existir o fechamento ainda pode acertar o serviço no mesmo lugar
  select a.inicio into v_ini from agendamentos a where a.id = p_agendamento_id and a.empresa_id = p_empresa_id;
  v_antes := agenda_fechada(p_empresa_id, p_agendamento_id);
  v := n8n_assistente_reagendar_confirma(p_empresa_id, p_pedido_por, p_agendamento_id, p_inicio, p_servico, true);
  -- fechamento do app não é furado nem com forcar: mudou de lugar e caiu nele, ou entrou nele agora
  v_motivo := agenda_fechada(p_empresa_id, p_agendamento_id);
  if v_motivo is not null and (v_antes is null or coalesce(p_inicio, v_ini) is distinct from v_ini) then
    raise exception 'NÃO REAGENDEI: % Nesse fechamento ninguém marca, nem com forcar. Diga isso a quem pediu; se for para atender mesmo assim, primeiro tire o fechamento (desbloquear) e depois reagende.', v_motivo;
  end if;
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

create or replace function n8n_assistente_ajustar_duracao_prof(p_empresa_id uuid, p_pedido_por text, p_agendamento_id uuid,
    p_minutos integer, p_forcar boolean default false)
returns jsonb language plpgsql set search_path = public as $$
declare
  v        jsonb;
  v_motivo text;
  v_antes  text;
begin
  v_antes := agenda_fechada(p_empresa_id, p_agendamento_id);
  v := n8n_assistente_ajustar_duracao(p_empresa_id, p_pedido_por, p_agendamento_id, p_minutos, true);
  -- fechamento do app não é furado nem com forcar: o novo tempo não pode fazer o horário entrar num fechamento
  v_motivo := agenda_fechada(p_empresa_id, p_agendamento_id);
  if v_motivo is not null and v_antes is null then
    raise exception 'NÃO MUDEI: com esse tempo o horário entra num fechamento: % Nesse fechamento ninguém marca, nem com forcar. Diga isso a quem pediu.', v_motivo;
  end if;
  if not p_forcar then
    v_motivo := assistente_conferir_horario_prof(p_empresa_id, p_agendamento_id);
    if v_motivo is not null then
      raise exception 'NÃO MUDEI: % Conte a quem pediu; se quiser assim mesmo, chame de novo com forcar = sim.', v_motivo;
    end if;
  end if;
  return v;
end $$;
