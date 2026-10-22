-- =====================================================================
-- 008_avisos_sem_falso_remarcou.sql — aplicado no Supabase em 22/10/2026
-- Corrige um aviso falso para a Gleide ("remarcou de 12/11 09:00 para 12/11 09:00", e
-- em dobro) visto no teste da situação 2:
--   1) contato_marca_agendou (001) marcava TODO contato aberto da cliente como 'agendou'
--      quando entrava qualquer horário novo dela. Agora:
--        - pedido de remarcação só se resolve quando o próprio horário muda (gatilho do 005)
--        - falta só se resolve com um horário novo de verdade (agendado, daqui para frente)
--        - retorno/reativação seguem como antes
--   2) n8n_avisos_para_gleide: "remarcou" de um pedido de remarcação só se o horário mudou e
--      continua marcado; e um aviso por horário (o pedido mais recente), não um por toque
-- =====================================================================

create or replace function contato_marca_agendou() returns trigger
language plpgsql set search_path = public as $$
begin
  update contatos
     set resultado = 'agendou'
   where cliente_id = new.cliente_id
     and resultado in ('pendente', 'respondeu')
     and criado_em >= now() - interval '14 days'
     and tipo <> 'remarcacao'
     and (tipo <> 'falta' or (new.status = 'agendado' and new.inicio > now()));
  return new;
end $$;

create or replace function n8n_avisos_para_gleide(p_empresa_id uuid)
returns table (contato_id uuid, tipo text, situacao text, nome text, telefone text,
               horario_original timestamptz, novo_horario timestamptz, servico text)
language sql stable set search_path = public as $$
  select y.contato_id, y.tipo, y.situacao, y.nome, y.telefone, y.horario_original, y.novo_horario, y.servico
  from (
    -- o pedido mais recente de cada horário (tocou "Pedir de novo" = um aviso só)
    select distinct on (coalesce(ct.agendamento_id, ct.id))
           ct.id as contato_id, ct.tipo, ct.criado_em,
           case when ct.resultado = 'agendou' then 'remarcou' else 'sem_resposta' end as situacao,
           c.nome, c.telefone, ct.horario_original,
           case when ct.tipo = 'remarcacao' then a.inicio
                else (select min(f.inicio) from agendamentos f
                       where f.cliente_id = c.id and f.status = 'agendado' and f.criado_em >= ct.criado_em) end as novo_horario,
           s.nome as servico,
           ct.resultado, a.status as status_horario, a.inicio as inicio_horario
      from contatos ct
      join clientes c on c.id = ct.cliente_id
      left join agendamentos a on a.id = ct.agendamento_id
      left join servicos s on s.id = a.servico_id
     where ct.empresa_id = p_empresa_id
       and ct.tipo in ('falta', 'remarcacao')
       and ct.criado_em > now() - interval '7 days'
     order by coalesce(ct.agendamento_id, ct.id), ct.criado_em desc
  ) y
  where (
          (y.resultado = 'agendou'
            and (y.tipo <> 'remarcacao' or (y.status_horario = 'agendado' and y.inicio_horario is distinct from y.horario_original)))
          or (y.resultado = 'pendente' and y.criado_em < now() - interval '24 hours')
        )
    and not exists (select 1 from registros_ia r where r.registro_id = y.contato_id and r.acao = 'avisou_' || y.situacao)
  order by y.horario_original
$$;
