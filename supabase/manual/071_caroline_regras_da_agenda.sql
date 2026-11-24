-- 071 (dados) - As regras de horário que a Caroline deu à assistente passam a valer para a IA de atendimento.
-- Aplicar DEPOIS do supabase/071_regras_da_agenda.sql e junto da publicação da branch regras-agenda-carol na Caroline.
-- Troca, não soma: as quatro saem da lista da assistente (config.assistente_regras) e entram na agenda
-- (config.ia_horas / config.ia_periodo). As outras regras da assistente ficam como estão.
--
--   "Não marcar agendamentos antes das 11:00 nas segundas-feiras." (20/11)           -> segunda: não começa antes das 11h
--   "Não marcar agendamentos às 09:00 no mês de dezembro." (17/11)                    -> 01 a 31/12/2026: não começa às 9h
--   "Nos dias de semana, priorizar atendimentos a partir das 13:00 ... mas atender
--    de manhã se a cliente não tiver outra disponibilidade." (23/11)                   -> seg a sex: primeiro a tarde
--   "Não disponibilizar horários à tarde ... até que a agenda da manhã esteja
--    preenchida, especialmente aos sábados." (23/11)                                   -> sábado: a tarde só quando a manhã lota

update empresas e
   set config = jsonb_set(jsonb_set(jsonb_set(e.config,
         '{ia_horas}', jsonb_build_array(
           jsonb_build_object('dias', jsonb_build_array('seg'), 'de', '00:00', 'ate', '11:00', 'de_dia', null, 'ate_dia', null,
                              'em', '20/11/2026', 'fala', 'Não marcar agendamentos antes das 11:00 nas segundas-feiras.'),
           jsonb_build_object('dias', '[]'::jsonb, 'de', '09:00', 'ate', '09:30', 'de_dia', '2026-12-01', 'ate_dia', '2026-12-31',
                              'em', '17/11/2026', 'fala', 'Não marcar agendamentos às 09:00 no mês de dezembro.'))),
         '{ia_periodo}', jsonb_build_object(
           'seg', jsonb_build_object('primeiro', 'tarde', 'estrito', false, 'em', '23/11/2026'),
           'ter', jsonb_build_object('primeiro', 'tarde', 'estrito', false, 'em', '23/11/2026'),
           'qua', jsonb_build_object('primeiro', 'tarde', 'estrito', false, 'em', '23/11/2026'),
           'qui', jsonb_build_object('primeiro', 'tarde', 'estrito', false, 'em', '23/11/2026'),
           'sex', jsonb_build_object('primeiro', 'tarde', 'estrito', false, 'em', '23/11/2026'),
           'sab', jsonb_build_object('primeiro', 'manha', 'estrito', true, 'em', '23/11/2026'))),
         '{assistente_regras}', coalesce((
           select jsonb_agg(r order by n) from jsonb_array_elements(e.config->'assistente_regras') with ordinality t(r, n)
            where r->>'texto' not in (
              'Não marcar agendamentos antes das 11:00 nas segundas-feiras.',
              'Não marcar agendamentos às 09:00 no mês de dezembro.',
              'Nos dias de semana, priorizar atendimentos a partir das 13:00 devido à distância do estúdio, mas atender de manhã se a cliente não tiver outra disponibilidade.',
              'Não disponibilizar horários à tarde para as clientes até que a agenda da manhã esteja preenchida, especialmente aos sábados.')),
           '[]'::jsonb))
 where e.id = '26a5d3eb-e8e4-4ed8-b206-095095292fdd';

-- conferir: 4 regras a menos na lista da assistente e o texto novo
select jsonb_array_length(config->'assistente_regras') as regras_da_assistente, ia_regras_agenda_texto(config) as regras_da_agenda
  from empresas where id = '26a5d3eb-e8e4-4ed8-b206-095095292fdd';
