-- =====================================================================
-- 007_ia_chama_faltas.sql — aplicado no Supabase em 22/10/2026
-- Situação 2: a cliente faltou (a Gleide contou à assistente ou tocou em
-- "Não veio" no app). A IA chama a cliente sozinha para remarcar, e avisa a
-- Gleide quando ela remarcou (ou quando não respondeu em 24 h).
--   - contatos ganha o tipo 'falta' (canal 'ia'), ligado ao horário em que ela faltou
--   - n8n_faltas_para_chamar: quem faltou hoje/ontem e ainda não foi chamada
--   - n8n_registrar_chamada_falta: grava o contato e a mensagem enviada
--   - n8n_avisos_para_gleide / n8n_marcar_avisado: o que contar à Gleide
-- Ligar: empresas.config.faltas = {"chamar": true, "so_para": []}
--   so_para com números = só chama esses (teste); vazio = chama todas.
--   Sem config.faltas, não chama ninguém.
-- =====================================================================

alter table contatos drop constraint contatos_tipo_check;
alter table contatos add constraint contatos_tipo_check
  check (tipo in ('retorno', 'reativacao', 'aniversario', 'outro', 'remarcacao', 'falta'));

-- Quem faltou hoje ou ontem e ainda não foi chamada. Não chama: quem já tem outro horário
-- marcado, cliente excluída, IA pausada para ela, ou se o salão não ligou a chamada.
create or replace function n8n_faltas_para_chamar(p_empresa_id uuid)
returns table (agendamento_id uuid, cliente_id uuid, nome text, telefone text, inicio timestamptz, servico text)
language sql stable set search_path = public as $$
  select a.id, c.id, c.nome, c.telefone, a.inicio, s.nome
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    join empresas e on e.id = a.empresa_id
    left join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id
     and a.status = 'faltou'
     and (a.inicio at time zone 'America/Cuiaba')::date >= hoje_cuiaba() - 1
     and coalesce((e.config->'faltas'->>'chamar')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'faltas'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'faltas'->'so_para') ? c.telefone)
     and not exists (select 1 from contatos ct where ct.agendamento_id = a.id and ct.tipo = 'falta')
     and not exists (select 1 from agendamentos f where f.cliente_id = c.id and f.status = 'agendado' and f.inicio > now())
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < now())
   order by a.inicio
$$;

-- Depois de enviar: grava o contato (a resposta dela cai na IA com o "ALÔ DE FALTA") e a mensagem
-- no histórico da conversa (a API não passa pelo webhook, então o n8n não a vê sozinho)
create or replace function n8n_registrar_chamada_falta(p_empresa_id uuid, p_agendamento_id uuid, p_mensagem text, p_wa_message_id text default null)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_contato uuid;
begin
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  insert into contatos (empresa_id, cliente_id, tipo, canal, mensagem, agendamento_id, horario_original)
  values (p_empresa_id, ag.cliente_id, 'falta', 'ia', p_mensagem, ag.id, ag.inicio)
  returning id into v_contato;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
  values (p_empresa_id, ag.cliente_id, 'saida', 'ia', 'texto', p_mensagem, p_wa_message_id)
  on conflict (wa_message_id) do nothing;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, ag.cliente_id, 'atendimento', 'n8n_registrar_chamada_falta', 'contatos', v_contato,
          jsonb_build_object('agendamento_id', ag.id, 'mensagem', p_mensagem));
  return jsonb_build_object('contato_id', v_contato);
end $$;

-- O que contar à Gleide (faltas chamadas pela IA e pedidos de remarcação do app):
--   remarcou     -> ela marcou outro horário (o contato virou 'agendou')
--   sem_resposta -> 24 h e nada
-- Cada um é avisado uma vez por situação (registros_ia acao 'avisou_<situacao>').
create or replace function n8n_avisos_para_gleide(p_empresa_id uuid)
returns table (contato_id uuid, tipo text, situacao text, nome text, telefone text,
               horario_original timestamptz, novo_horario timestamptz, servico text)
language sql stable set search_path = public as $$
  select x.* from (
    select ct.id, ct.tipo,
           case when ct.resultado = 'agendou' then 'remarcou' else 'sem_resposta' end as situacao,
           c.nome, c.telefone, ct.horario_original,
           case when ct.tipo = 'remarcacao' then a.inicio
                else (select min(f.inicio) from agendamentos f
                       where f.cliente_id = c.id and f.status = 'agendado' and f.criado_em >= ct.criado_em) end as novo_horario,
           s.nome as servico
      from contatos ct
      join clientes c on c.id = ct.cliente_id
      left join agendamentos a on a.id = ct.agendamento_id
      left join servicos s on s.id = a.servico_id
     where ct.empresa_id = p_empresa_id
       and ct.tipo in ('falta', 'remarcacao')
       and ct.criado_em > now() - interval '7 days'
       and (ct.resultado = 'agendou'
            or (ct.resultado = 'pendente' and ct.criado_em < now() - interval '24 hours'))
  ) x
  where not exists (select 1 from registros_ia r where r.registro_id = x.id and r.acao = 'avisou_' || x.situacao)
  order by x.horario_original
$$;

-- p_itens = [{"id": "<contato_id>", "situacao": "remarcou"}, ...]
create or replace function n8n_marcar_avisado(p_empresa_id uuid, p_itens jsonb)
returns void language sql set search_path = public as $$
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id)
  select ct.empresa_id, ct.cliente_id, 'assistente', 'avisou_' || (i->>'situacao'), 'contatos', ct.id
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
    join contatos ct on ct.id = (i->>'id')::uuid and ct.empresa_id = p_empresa_id
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'n8n_faltas_para_chamar(uuid)',
    'n8n_registrar_chamada_falta(uuid, uuid, text, text)',
    'n8n_avisos_para_gleide(uuid)',
    'n8n_marcar_avisado(uuid, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
