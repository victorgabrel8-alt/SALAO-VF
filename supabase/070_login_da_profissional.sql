-- =====================================================================
-- 070 - Login ligado a uma profissional (pedido do Victor, 23/11/2026)
--
-- Caso: Studio Caroline Ferreira. A Duda (funcionária) vai ter login próprio no app e precisa abrir na agenda DELA,
-- com as clientes dela; a Caroline continua vendo tudo, mas abre na agenda dela.
--
-- usuarios_empresa.profissional_id: a profissional desse login (vazio = como sempre, vê o salão inteiro).
--   - login com profissional e papel 'dona': abre na agenda da profissional, pode trocar para "Todas";
--   - login com profissional e outro papel (recepcao): vê só o que é dela (agenda, horários do Início e conversas das
--     clientes dela) e não mexe nos dados do salão nem nos serviços.
-- Só soma: uma coluna nova, vazia em todos os logins de hoje (nada muda para a Gleide nem para quem não for ligado).
-- Observação: é separação de TELA. A permissão do banco (RLS) continua por salão: quem entra no salão consegue ler o
-- salão inteiro se souber pedir. Bloquear no banco é um passo à parte.
-- =====================================================================

alter table usuarios_empresa add column if not exists profissional_id uuid references profissionais(id) on delete set null;

comment on column usuarios_empresa.profissional_id is 'Profissional deste login: o app abre na agenda dela; sem papel dona, vê só o que é dela';
