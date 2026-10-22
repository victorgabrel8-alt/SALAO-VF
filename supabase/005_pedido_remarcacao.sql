-- =====================================================================
-- 005_pedido_remarcacao.sql — aplicado no Supabase em 22/10/2026
-- Pedido de remarcação: num imprevisto (viagem, folga), a Gleide toca em
-- "Pedir para remarcar" no app. O app grava um contato tipo 'remarcacao'
-- ligado ao horário e abre o WhatsApp do salão com a mensagem pronta; ela
-- envia. Quando a cliente responde, a IA lê o "ALÔ DE REMARCAÇÃO" na ficha,
-- oferece horários e usa remarcar_agendamento (mesmo agendamento, novo horário).
-- Andamento no app: pendente -> respondeu (gatilho que já existe, mensagem da
-- cliente) -> agendou (gatilho abaixo, o horário mudou).
-- =====================================================================

alter table contatos drop constraint contatos_tipo_check;
alter table contatos add constraint contatos_tipo_check
  check (tipo in ('retorno', 'reativacao', 'aniversario', 'outro', 'remarcacao'));

-- Qual horário é para remarcar, e quando ele era na hora do pedido (para o app
-- saber se já mudou e a IA dizer "o horário de sexta às 9h")
alter table contatos
  add column agendamento_id   uuid references agendamentos(id) on delete set null,
  add column horario_original timestamptz;
create index idx_contatos_agendamento on contatos (agendamento_id) where agendamento_id is not null;

-- O horário mudou (a IA remarcou, ou a Gleide pelo app): o pedido está resolvido
create or replace function contato_marca_remarcado() returns trigger
language plpgsql set search_path = public as $$
begin
  update contatos
     set resultado = 'agendou'
   where agendamento_id = new.id
     and tipo = 'remarcacao'
     and resultado in ('pendente', 'respondeu');
  return new;
end $$;
create trigger trg_contato_remarcado after update of inicio on agendamentos
  for each row when (new.inicio is distinct from old.inicio)
  execute function contato_marca_remarcado();
