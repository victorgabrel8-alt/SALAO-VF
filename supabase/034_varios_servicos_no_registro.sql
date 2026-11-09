-- =====================================================================
-- 034_varios_servicos_no_registro.sql
-- "Registrar atendimento" com vários serviços e itens cobrados por unidade (cada unha, cada pé).
--
-- Só soma (a Gleide segue igual):
--   1) servicos.unidade         vazio = cobrado por serviço; 'unha' ou 'pé' = cobrado por unidade
--   2) atendimento_servicos.quantidade   quantas unidades do serviço a mais (padrão 1)
--   3) agendamentos.quantidade           quantas unidades do serviço principal (padrão 1)
--   4) gatilho novo: quando o fim do horário é apagado (remarcar pelo app, reagendar da IA) e o
--      horário tem serviços a mais ou quantidade > 1, o fim volta a ser a SOMA de todos os
--      serviços. Sem isso, o banco recalcula só pelo principal (agendamento_regras) e o horário
--      encolhe. Roda antes de trg_agend_regras (gatilhos BEFORE rodam em ordem de nome); quando
--      ele preenche o fim, a regra de hoje não mexe mais. Nenhuma função existente é trocada.
-- =====================================================================

alter table servicos add column if not exists unidade text;
comment on column servicos.unidade is
  'Vazio = cobrado por serviço. Preenchido (ex.: unha, pé) = cobrado por unidade: preço e tempo multiplicam pela quantidade.';

alter table atendimento_servicos add column if not exists quantidade int not null default 1;
alter table agendamentos         add column if not exists quantidade int not null default 1;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'atendimento_servicos_quantidade_positiva') then
    alter table atendimento_servicos add constraint atendimento_servicos_quantidade_positiva check (quantidade > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agendamentos_quantidade_positiva') then
    alter table agendamentos add constraint agendamentos_quantidade_positiva check (quantidade > 0);
  end if;
end $$;

-- Serviços que já dizem no nome que são por unidade
update servicos set unidade = 'unha' where unidade is null and nome ilike '%(cada unha)%';
update servicos set unidade = 'pé'   where unidade is null and nome ilike '%(cada pé)%';

-- ---------------------------------------------------------------------
-- Fim pela soma de todos os serviços do horário
-- ---------------------------------------------------------------------
create or replace function agendamento_fim_com_extras()
returns trigger language plpgsql set search_path = public as $$
declare
  v_min int;
begin
  -- Fim já informado, ou horário novo (os serviços a mais entram depois): nada a fazer
  if new.fim is not null or tg_op <> 'UPDATE' then
    return new;
  end if;
  if coalesce(new.quantidade, 1) <= 1
     and not exists (select 1 from atendimento_servicos x where x.agendamento_id = new.id) then
    return new;  -- um serviço só: a regra de sempre (agendamento_regras) calcula
  end if;

  select coalesce((select s.duracao_min from servicos s where s.id = new.servico_id), 0) * greatest(coalesce(new.quantidade, 1), 1)
       + coalesce((select sum(s.duracao_min * x.quantidade)
                     from atendimento_servicos x
                     join servicos s on s.id = x.servico_id
                    where x.agendamento_id = new.id), 0)
    into v_min;

  if v_min > 0 then
    new.fim := new.inicio + make_interval(mins => v_min);
  end if;
  return new;
end $$;

drop trigger if exists trg_agend_a_fim_extras on agendamentos;
create trigger trg_agend_a_fim_extras
  before update on agendamentos
  for each row execute function agendamento_fim_com_extras();

-- ---------------------------------------------------------------------
-- 5) De onde veio o serviço a mais. Antes, todo serviço a mais nascia no ✓ ("O que ela fez?") e o
--    desfazer do ✓ tirava todos. Agora o formulário também grava serviços a mais na hora de
--    registrar/marcar: esses (marcado_junto = true) ficam no desfazer. As linhas que já existem
--    ficam com false, e o desfazer segue igual para elas.
-- ---------------------------------------------------------------------
alter table atendimento_servicos add column if not exists marcado_junto boolean not null default false;
comment on column atendimento_servicos.marcado_junto is
  'true = serviço escolhido junto quando o horário foi registrado/marcado (formulário do app). false = acrescentado na confirmação ("O que ela fez?"): só estes saem no desfazer do ✓.';
