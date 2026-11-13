-- 045: o app bater com o que aconteceu sem a dona tocar em botão.
--
-- Caso de 12/11/2026: a cliente escreveu "to aqui na frente", foi atendida, a avaliação ficou "fechou", e o app
-- mostrou "Não atendida". O ✓ tinha sido desfeito por um toque sem querer (o app não perguntava) e o horário
-- voltou para "agendado" com o resultado já gravado. Nesse estado ninguém perguntava mais nada à dona:
-- "atendimento_sem_status" pulava todo horário que tivesse avaliação, com ou sem resultado.
--
-- 1) n8n_cliente_chegou: a cliente avisou no WhatsApp que chegou -> grava o "Chegou" do horário dela de agora
--    (função nova; o fluxo principal chama quando a mensagem diz "cheguei", "tô aqui na frente"…).
-- 2) pendencias_gleide: "atendimento_sem_status" só pula o horário cuja avaliação ainda está sem resultado
--    (esse já é perguntado como "avaliacao_sem_resultado"). O resto da lista é igual ao 038.
-- 3) n8n_assistente_pendencias_fim_do_dia: os horários de hoje que ficaram sem confirmar, para a assistente
--    perguntar tudo de uma vez no fim do expediente, mesmo os que já foram perguntados (função nova).

-- 1) ------------------------------------------------------------------------------------------------------
-- Só marca o horário "agendado", ainda sem "Chegou", que está para começar (até 45 min antes) ou em andamento.
-- Fora disso não faz nada: "tô aqui" de quem não tem horário agora não vira chegada.
create or replace function n8n_cliente_chegou(p_empresa_id uuid, p_telefone text)
returns jsonb language plpgsql set search_path = public as $$
declare ag record;
begin
  select a.id, a.inicio, c.id as cliente_id, c.nome, s.nome as servico into ag
    from agendamentos a
    join clientes c on c.id = a.cliente_id
    left join servicos s on s.id = a.servico_id
   where a.empresa_id = p_empresa_id and c.telefone = p_telefone
     and a.status = 'agendado' and a.chegou_em is null
     and now() between a.inicio - interval '45 minutes' and coalesce(a.fim, a.inicio + interval '1 hour')
   order by a.inicio limit 1;
  if not found then return jsonb_build_object('marcou', false); end if;
  update agendamentos set chegou_em = now() where id = ag.id;
  insert into registros_ia (empresa_id, cliente_id, agente, acao, tabela, registro_id, dados)
  values (p_empresa_id, ag.cliente_id, 'atendimento', 'n8n_cliente_chegou', 'agendamentos', ag.id, '{}'::jsonb);
  return jsonb_build_object('marcou', true, 'agendamento_id', ag.id, 'nome', ag.nome,
    'hora', to_char(ag.inicio at time zone 'America/Cuiaba', 'HH24:MI'), 'servico', ag.servico);
end $$;

revoke all on function n8n_cliente_chegou(uuid, text) from public, anon, authenticated;
grant execute on function n8n_cliente_chegou(uuid, text) to service_role;

-- 2) ------------------------------------------------------------------------------------------------------
create or replace view pendencias_gleide with (security_invoker = true) as
select p.*,
       (select max(r.criado_em) from registros_ia r
         where r.acao = 'perguntou' and r.registro_id = p.pendencia_id) as perguntado_em
from (
  select 'avaliacao_sem_resultado' as tipo, av.id as pendencia_id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id as avaliacao_id, ag.id as agendamento_id, ag.inicio,
         s.nome as servico, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join agendamentos ag on ag.id = av.agendamento_id
    join clientes c on c.id = av.cliente_id
    left join servicos s on s.id = ag.servico_id
   where av.resultado = 'pendente'
     and ag.status in ('agendado', 'realizado')
     and coalesce(ag.fim, ag.inicio) < now() - interval '30 minutes'
  union all
  select 'atendimento_sem_status', ag.id, ag.empresa_id, ag.cliente_id,
         c.nome, c.telefone, null, ag.id, ag.inicio,
         s.nome, null, null
    from agendamentos ag
    join clientes c on c.id = ag.cliente_id
    left join servicos s on s.id = ag.servico_id
   where ag.status = 'agendado'
     and coalesce(ag.fim, ag.inicio) < now()
     and (ag.inicio at time zone 'America/Cuiaba')::date >= hoje_cuiaba() - 1
     -- 045: antes pulava qualquer horário com avaliação; agora só o que ainda está sem resultado
     and not exists (select 1 from avaliacoes av where av.agendamento_id = ag.id and av.resultado = 'pendente')
  union all
  select 'atraso_confirmar', ag.id, ag.empresa_id, ag.cliente_id,
         c.nome, c.telefone, null, ag.id, ag.inicio,
         s.nome, null, null
    from agendamentos ag
    join clientes c on c.id = ag.cliente_id
    left join servicos s on s.id = ag.servico_id
   where ag.status = 'agendado'
     and ag.chegou_em is null
     and coalesce(ag.fim, ag.inicio) >= now()
     and ag.inicio < now()
     and (select count(*) from contatos ct where ct.agendamento_id = ag.id and ct.tipo = 'atraso') >= 2
     and not exists (select 1 from contatos ct where ct.agendamento_id = ag.id and ct.tipo = 'atraso'
                      and (ct.resultado <> 'pendente' or ct.criado_em > now() - interval '10 minutes'))
     and not exists (select 1 from mensagens m where m.cliente_id = ag.cliente_id and m.autor in ('cliente', 'humano')
                      and m.criado_em > ag.inicio - interval '1 hour')
  union all
  select 'pensando_vencido', av.id, av.empresa_id, av.cliente_id,
         c.nome, c.telefone, av.id, null, null,
         av.tecnica_indicada, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join clientes c on c.id = av.cliente_id
   where av.resultado = 'pensando'
     and av.data_proximo_passo <= hoje_cuiaba()
  union all
  select 'fechou_sem_data', md5(av.id::text || '|' || coalesce(av.data_proximo_passo::text, '-'))::uuid,
         av.empresa_id, av.cliente_id, c.nome, c.telefone, av.id, null, null,
         av.tecnica_indicada, av.valor_orcado, av.proximo_passo
    from avaliacoes av
    join clientes c on c.id = av.cliente_id
    left join agendamentos aa on aa.id = av.agendamento_id
   where av.resultado = 'fechou'
     and av.resultado_em > now() - interval '120 days'
     and coalesce(av.data_proximo_passo, (av.resultado_em at time zone 'America/Cuiaba')::date + 1) <= hoje_cuiaba()
     and not exists (
       select 1 from agendamentos x
         left join servicos s on s.id = x.servico_id
        where x.cliente_id = av.cliente_id
          and x.id is distinct from av.agendamento_id
          and x.status in ('agendado', 'realizado')
          and x.inicio >= coalesce(aa.inicio, av.criado_em)
          and coalesce(s.nome, '') !~* 'avalia')
) p;

-- 3) ------------------------------------------------------------------------------------------------------
-- Os horários DE HOJE que já acabaram e ninguém confirmou, já perguntados ou não.
create or replace function n8n_assistente_pendencias_fim_do_dia(p_empresa_id uuid)
returns setof pendencias_gleide language sql stable set search_path = public as $$
  select p.* from pendencias_gleide p
   where p.empresa_id = p_empresa_id
     and p.tipo in ('atendimento_sem_status', 'avaliacao_sem_resultado')
     and (p.inicio at time zone 'America/Cuiaba')::date = hoje_cuiaba()
   order by p.inicio
$$;

revoke all on function n8n_assistente_pendencias_fim_do_dia(uuid) from public, anon, authenticated;
grant execute on function n8n_assistente_pendencias_fim_do_dia(uuid) to service_role;
