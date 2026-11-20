-- 060: Conferente ligado (orquestrador, fase B). Com "conferente": "ligado" no loja.json, a resposta barrada é
-- reescrita pelo Gemini (ou sai a versão segura, sem a parte errada) antes de ir para a cliente. Aqui ficam, junto do
-- registro de sempre (supabase/053: modo, texto original, falhas, ferramentas), a reescrita e o que saiu de fato.
-- Só soma: colunas novas com valor padrão; os registros do modo "observar" ficam como estão.
-- Aplicar ANTES de ligar: sem estas colunas o registro do modo ligado é recusado pelo banco (a resposta sai mesmo
-- assim, só não fica registrada).

alter table conferente_registros add column if not exists reescrita        text;                                 -- o que o Gemini devolveu (vazio se falhou)
alter table conferente_registros add column if not exists texto_final      text;                                 -- o que foi para a cliente
alter table conferente_registros add column if not exists usou_segura      boolean not null default false;       -- saiu a versão segura (sem a parte errada)
alter table conferente_registros add column if not exists motivo           text;                                 -- por que não usou a reescrita: gemini_falhou, reescrita_barrada...
alter table conferente_registros add column if not exists falhas_reescrita jsonb   not null default '[]'::jsonb; -- o que o Conferente achou na reescrita
alter table conferente_registros add column if not exists tempo_ms         integer;                              -- quanto o Conferente segurou a resposta
