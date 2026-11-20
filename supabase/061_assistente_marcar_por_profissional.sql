-- 061: a assistente da dona marca na agenda da profissional certa (Caroline ou Duda), conferindo conflito só com a
-- mesma profissional. Pedido do Victor (20/11/2026): a Duda usa a assistente pelo WhatsApp e tem agenda separada.
-- Antes: n8n_assistente_marcar_horario_c conferia a agenda do salão inteiro (assistente_conferir_horario, 030): um
-- horário da Caroline recusava a Duda no mesmo horário, e o "marca assim mesmo" (forcar) passava sem conferir nada,
-- nem a agenda da própria profissional.
-- Agora (só nas lojas cujo n8n chama esta função; a Gleide não chama):
--   1. marca pelo caminho de sempre (n8n_assistente_marcar_horario_c, com forcar = sim só para pular a conferência
--      do salão inteiro: "horário já passou", cliente, serviço e duração continuam iguais);
--   2. grava a profissional (a pedida; vazio = a dona, primeira profissional ativa cadastrada);
--   3. confere o horário com a duração já calculada: dia bloqueado, horário do salão, almoço e horas bloqueadas como
--      sempre (030), e "encavala" só com horário da MESMA profissional (horário sem profissional = da dona);
--   4. encavalou: desfaz tudo (a exceção desfaz a gravação) e devolve "NÃO MARQUEI", como antes.
--   Com forcar (a dona viu o motivo e quer assim mesmo): marca sem conferir, como antes.
-- Só soma: duas funções novas; nada existente muda.

create or replace function assistente_conferir_horario_prof(p_empresa_id uuid, p_agendamento_id uuid)
returns text language plpgsql stable set search_path = public as $$
declare
  ag          record;
  v_principal uuid;
  v_prof      uuid;
  v_fim       timestamptz;
  v_motivo    text;
  v_choques   text;
begin
  select a.id, a.inicio, a.fim, a.profissional_id into ag
    from agendamentos a where a.id = p_agendamento_id and a.empresa_id = p_empresa_id;
  if ag.id is null then return 'horário não encontrado.'; end if;
  v_fim := coalesce(ag.fim, ag.inicio + interval '1 hour');
  -- o resto da conferência é a de sempre; "Encavala" de lá olha o salão inteiro e é refeito abaixo por profissional
  v_motivo := assistente_conferir_horario(p_empresa_id, ag.inicio, greatest(1, (extract(epoch from (v_fim - ag.inicio)) / 60)::int), ag.id);
  if v_motivo is null or v_motivo not like 'Encavala com%' then return v_motivo; end if;
  select p.id into v_principal from profissionais p
   where p.empresa_id = p_empresa_id and p.ativo order by p.criado_em limit 1;
  v_prof := coalesce(ag.profissional_id, v_principal);
  select string_agg(format('%s (%s às %s)', coalesce(c.nome, 'outra cliente'),
                           to_char(a.inicio at time zone 'America/Cuiaba', 'HH24:MI'),
                           to_char(coalesce(a.fim, a.inicio + interval '1 hour') at time zone 'America/Cuiaba', 'HH24:MI')),
                    ', ' order by a.inicio)
    into v_choques
    from agendamentos a join clientes c on c.id = a.cliente_id
   where a.empresa_id = p_empresa_id and a.status in ('agendado', 'realizado')
     and a.id <> ag.id
     and coalesce(a.profissional_id, v_principal) is not distinct from v_prof
     and a.inicio < v_fim
     and coalesce(a.fim, a.inicio + interval '1 hour') > ag.inicio;
  if v_choques is not null then return 'Encavala com ' || v_choques || '.'; end if;
  return null;
end $$;

create or replace function n8n_assistente_marcar_horario_prof(
  p_empresa_id uuid, p_pedido_por text, p_cliente_id uuid, p_telefone text, p_nome text, p_servico text,
  p_inicio timestamptz, p_observacoes text default null, p_forcar boolean default false,
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

revoke all on function assistente_conferir_horario_prof(uuid, uuid) from public, anon, authenticated;
revoke all on function n8n_assistente_marcar_horario_prof(uuid, text, uuid, text, text, text, timestamptz, text, boolean, integer, integer, uuid) from public, anon, authenticated;
grant execute on function n8n_assistente_marcar_horario_prof(uuid, text, uuid, text, text, text, timestamptz, text, boolean, integer, integer, uuid) to service_role;
