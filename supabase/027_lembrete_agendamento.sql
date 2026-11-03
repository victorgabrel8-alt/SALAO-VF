-- =====================================================================
-- 027_lembrete_agendamento.sql — lembrete do horário para a cliente (pedido do Victor, 03/11).
-- A Graciane marcou às 17h para as 9h do dia seguinte e ninguém lembrou. Agora a IA manda 1 lembrete
-- por horário, pelo número do salão (workflow "IA - Faltas e avisos", a cada 5 min, 8h–20h):
--   véspera: a partir das 18:00 (config.lembretes.vespera) do dia anterior
--   no dia:  se não saiu na véspera, entre 4 h e 45 min antes do horário
-- Não lembra: horário marcado há menos de 2 h (acabou de combinar), quem falou com o salão na última
-- hora (está na conversa), pedido de remarcação/aviso da Gleide em aberto, IA pausada, cliente excluída. Remarcou para outro horário: lembra de novo.
-- A resposta dela cai na IA com o "ALÔ DE LEMBRETE" na ficha (confirmar, remarcar ou cancelar).
-- Ligar: empresas.config.lembretes = {"ligado": true, "so_para": [], "vespera": "18:00"}
--   (so_para com números = só esses; vazio = todas)
-- =====================================================================

alter table contatos drop constraint contatos_tipo_check;
alter table contatos add constraint contatos_tipo_check
  check (tipo in ('retorno', 'reativacao', 'aniversario', 'outro', 'remarcacao', 'falta', 'vaga', 'atraso', 'aviso', 'lembrete'));

create or replace function n8n_lembretes_para_mandar(p_empresa_id uuid, p_agora timestamptz default now())
returns table (agendamento_id uuid, cliente_id uuid, nome text, telefone text, inicio timestamptz, servico text,
               online boolean, endereco text)
language sql stable set search_path = public as $$
  select a.id, c.id, c.nome, c.telefone, a.inicio, s.nome,
         coalesce(s.nome ilike '%online%', false), e.config->>'endereco'
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    join empresas e on e.id = a.empresa_id
    left join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id
     and a.status = 'agendado'
     and coalesce((e.config->'lembretes'->>'ligado')::boolean, false)
     and (jsonb_array_length(coalesce(e.config->'lembretes'->'so_para', '[]'::jsonb)) = 0
          or (e.config->'lembretes'->'so_para') ? c.telefone)
     and a.criado_em < p_agora - interval '2 hours'
     and (
           -- véspera, depois do horário configurado
           ((a.inicio at time zone 'America/Cuiaba')::date = (p_agora at time zone 'America/Cuiaba')::date + 1
            and (p_agora at time zone 'America/Cuiaba')::time >= coalesce(e.config->'lembretes'->>'vespera', '18:00')::time)
           -- no dia, se a véspera não saiu
        or (a.inicio > p_agora + interval '45 minutes' and a.inicio <= p_agora + interval '4 hours')
         )
     -- um lembrete por horário (remarcou: o horário novo ganha outro)
     and not exists (select 1 from contatos ct where ct.agendamento_id = a.id and ct.tipo = 'lembrete'
                      and ct.horario_original = a.inicio)
     -- a Gleide pediu para remarcar ou mandou aviso e ainda está em aberto: não pede confirmação por cima
     and not exists (select 1 from contatos ct where ct.cliente_id = c.id and ct.tipo in ('remarcacao', 'aviso')
                      and ct.resultado in ('pendente', 'respondeu') and ct.criado_em > p_agora - interval '14 days')
     and not exists (select 1 from mensagens m where m.cliente_id = c.id and m.autor in ('cliente', 'humano')
                      and m.criado_em > p_agora - interval '1 hour')
     and not ('sistema:excluida' = any (c.etiquetas))
     and (c.ia_pausada_ate is null or c.ia_pausada_ate < p_agora)
   order by a.inicio
$$;

-- Depois de enviar: grava o contato (a resposta dela cai na IA com o "ALÔ DE LEMBRETE") e a mensagem
create or replace function n8n_registrar_lembrete(p_empresa_id uuid, p_agendamento_id uuid, p_mensagem text, p_wa_message_id text default null)
returns jsonb language plpgsql set search_path = public as $$
declare ag agendamentos%rowtype; v_contato uuid;
begin
  select * into ag from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  if not found then raise exception 'agendamento % não encontrado', p_agendamento_id; end if;
  insert into contatos (empresa_id, cliente_id, tipo, canal, mensagem, agendamento_id, horario_original)
  values (p_empresa_id, ag.cliente_id, 'lembrete', 'ia', p_mensagem, ag.id, ag.inicio)
  returning id into v_contato;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo, wa_message_id)
  values (p_empresa_id, ag.cliente_id, 'saida', 'ia', 'texto', p_mensagem, p_wa_message_id)
  on conflict (wa_message_id) do nothing;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, ag.cliente_id, 'atendimento', 'n8n_registrar_lembrete', 'contatos', v_contato,
          jsonb_build_object('agendamento_id', ag.id, 'mensagem', p_mensagem));
  return jsonb_build_object('contato_id', v_contato);
end $$;

revoke all on function n8n_lembretes_para_mandar(uuid, timestamptz) from public, anon, authenticated;
revoke all on function n8n_registrar_lembrete(uuid, uuid, text, text) from public, anon, authenticated;

-- Gleide: começa só no número de teste do Victor
update empresas
   set config = config || '{"lembretes": {"ligado": true, "so_para": ["5566999270860"], "vespera": "18:00"}}'::jsonb
 where id = '00000000-0000-0000-0000-000000000001';
