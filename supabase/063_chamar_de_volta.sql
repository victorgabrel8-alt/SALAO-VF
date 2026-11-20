-- =====================================================================
-- 063 - Lista "Chamar de volta" no app (semana 3 do plano do orquestrador, 20/11/2026)
--
-- Quem já passou do tempo de voltar e não tem horário marcado, para a dona chamar pelo WhatsApp
-- do celular dela. O app só lê esta view e abre o wa.me com o texto pronto: nada é enviado nem
-- gravado pelo sistema.
--
-- Reaproveita o que o app já calcula (supabase/010 e 052):
--   - clientes_status.status = 'retorno_atrasado' (o mesmo "Atrasada" da ficha): o retorno pendente
--     mais próximo (retornos_pendentes = dia do atendimento + servicos.dias_retorno, por linha de
--     serviço) já passou, ela não tem horário marcado pela frente e ainda não virou inativa
--     (config.dias_inativa, padrão 90 dias sem vir). Serviço sem dias_retorno não entra.
-- Fica de fora também:
--   - cliente excluída (etiqueta sistema:excluida);
--   - cliente com alô combinado esperando (retornos_combinados 'aguardando' com data de hoje em
--     diante, supabase/028 e 039): a IA vai chamar na data que ela pediu;
--   - cliente que o salão já chamou ou com quem falou nos últimos N dias (config.chamar_de_volta_dias,
--     padrão 7): alô de retorno/reativação em contatos (IA ou manual) ou mensagem da IA ou da dona
--     no WhatsApp. Assim, depois que a dona manda a mensagem pelo celular (fica gravada como mensagem
--     da dona), a cliente sai da lista sozinha.
--
-- Só soma: uma view nova, security_invoker (cada loja só vê as próprias clientes pelas regras de
-- acesso das tabelas). Nada do que existe muda. Para tirar: drop view chamar_de_volta.
-- =====================================================================

create or replace view chamar_de_volta with (security_invoker = true) as
select
  cs.id,
  cs.empresa_id,
  cs.nome,
  cs.telefone,
  rp.servico_nome,                                                           -- o serviço que venceu
  (rp.ultima_vez at time zone 'America/Cuiaba')::date       as feito_em,     -- quando ela fez
  rp.retorno_previsto,                                                       -- quando devia voltar
  hoje_cuiaba() - rp.retorno_previsto                       as dias_passados,
  pr.nome                                                   as profissional_nome,
  cs.ultima_visita
from clientes_status cs
join empresas e on e.id = cs.empresa_id
-- O mesmo retorno pendente que a clientes_status usa (o mais próximo), com o horário em que foi feito
join lateral (
  select p.retorno_previsto, p.servico_nome, p.ultima_vez, p.agendamento_id
    from retornos_pendentes p
   where p.cliente_id = cs.id
   order by p.retorno_previsto, p.servico_nome
   limit 1
) rp on true
left join agendamentos a on a.id = rp.agendamento_id
left join profissionais pr on pr.id = a.profissional_id
where cs.status = 'retorno_atrasado'
  and not ('sistema:excluida' = any (cs.etiquetas))
  and not exists (
    select 1 from retornos_combinados r
     where r.cliente_id = cs.id and r.situacao = 'aguardando' and r.data >= hoje_cuiaba())
  and not exists (
    select 1 from contatos ct
     where ct.cliente_id = cs.id and ct.tipo in ('retorno', 'reativacao')
       and ct.criado_em > now() - make_interval(days => coalesce((e.config->>'chamar_de_volta_dias')::int, 7)))
  and not exists (
    select 1 from mensagens m
     where m.cliente_id = cs.id and m.autor in ('ia', 'humano')
       and m.criado_em > now() - make_interval(days => coalesce((e.config->>'chamar_de_volta_dias')::int, 7)));

revoke all on chamar_de_volta from anon;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant select on chamar_de_volta to authenticated;
  end if;
end $$;
