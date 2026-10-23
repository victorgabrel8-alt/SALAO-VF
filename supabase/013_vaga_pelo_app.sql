-- =====================================================================
-- 013_vaga_pelo_app.sql — precisa do 010_vagas_adiantar aplicado antes
-- Conserta: "Remarcou para outro dia" e "Desmarcou" no app davam
--   "new row violates row-level security policy for table vagas".
-- O gatilho agendamento_vira_vaga (010) grava a vaga em `vagas`, tabela que só o n8n
-- (service_role) pode mexer. Quando quem remarca/cancela é a Gleide pelo app, o gatilho
-- rodava com a permissão dela e o banco recusava a mudança inteira (o horário não mudava).
-- Pela IA funcionava porque o n8n usa a chave de serviço.
-- Agora o gatilho roda com a permissão do dono da função (security definer), como os
-- gatilhos de sistema devem rodar. O search_path já é fixo (public), então é seguro.
-- Rodar ANTES de publicar o app com o botão "Desmarcou (cancelar horário)".
-- =====================================================================

alter function agendamento_vira_vaga() security definer;
