-- =====================================================================
-- 033_mudar_modalidade.sql — a IA troca a avaliação entre presencial e online sozinha e só avisa a Gleide (pedido do Victor, 05/11).
-- Mesmo dia e hora, mesmo agendamento. O aviso sai por "IA - Faltas e avisos", como remarcação e cancelamento.
-- Só soma: um tipo novo em ia_mudancas_agenda e uma função nova.
-- =====================================================================

alter table ia_mudancas_agenda drop constraint if exists ia_mudancas_agenda_tipo_check;
alter table ia_mudancas_agenda add constraint ia_mudancas_agenda_tipo_check check (tipo in ('remarcou', 'cancelou', 'mudou_modalidade'));

create or replace function n8n_mudar_modalidade(p_empresa_id uuid, p_telefone text, p_para text, p_inicio timestamptz default null, p_avisar boolean default true)
returns jsonb language plpgsql set search_path = public as $$
declare v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'); v_com9 text; v_sem9 text;
        v_para text := lower(trim(coalesce(p_para, ''))); v_online boolean; v_qtd int; ag agendamentos%rowtype;
        v_atual text; v_novo uuid; v_dur int; v_de text;
begin
  if v_para not in ('online', 'presencial') then raise exception 'diga online ou presencial'; end if;
  v_online := v_para = 'online';
  v_com9 := regexp_replace(v_tel, '^(55[0-9]{2})([6-9][0-9]{7})$', '\19\2');
  v_sem9 := regexp_replace(v_com9, '^(55[0-9]{2})9([0-9]{8})$', '\1\2');

  select count(*), (array_agg(a.id order by a.inicio))[1] into v_qtd, ag.id
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id and c.telefone in (v_com9, v_sem9)
     and a.status = 'agendado' and a.inicio > now() and s.categoria = 'avaliacao'
     and (p_inicio is null or a.inicio = p_inicio);
  if v_qtd = 0 then raise exception 'ela não tem avaliação marcada para mudar'; end if;
  if v_qtd > 1 then raise exception 'ela tem mais de uma avaliação marcada: diga qual, com data_hora_inicio'; end if;

  select * into ag from agendamentos where id = ag.id;
  select s.nome into v_atual from servicos s where s.id = ag.servico_id;
  v_de := assistente_quando(ag.inicio);
  if (v_atual ilike '%online%') = v_online then
    return jsonb_build_object('ja', true, 'quando', v_de, 'para', v_para);
  end if;

  select s.id, coalesce(s.duracao_min, 30) into v_novo, v_dur
    from servicos s
   where s.empresa_id = p_empresa_id and s.ativo and s.categoria = 'avaliacao' and (s.nome ilike '%online%') = v_online
   order by s.nome limit 1;
  if v_novo is null then raise exception 'o salão não tem avaliação % ativa', v_para; end if;

  update agendamentos set servico_id = v_novo, fim = inicio + make_interval(mins => v_dur) where id = ag.id;
  if p_avisar then
    insert into ia_mudancas_agenda (empresa_id, agendamento_id, cliente_id, tipo, de_texto, para_texto)
    values (p_empresa_id, ag.id, ag.cliente_id, 'mudou_modalidade', v_de, v_para);
  end if;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, ag.cliente_id, 'atendimento', 'n8n_mudar_modalidade', 'agendamentos', ag.id, jsonb_build_object('de', v_atual, 'para', v_para));
  return jsonb_build_object('ja', false, 'quando', v_de, 'para', v_para);
end $$;

revoke all on function n8n_mudar_modalidade(uuid, text, text, timestamptz, boolean) from public, anon, authenticated;
