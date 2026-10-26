-- Testes automáticos do 013 (a Gleide faz pelo WhatsApp o que faz no app) no banco local "salao_teste".
-- Roda dentro de uma transação e desfaz no final. Usa uma terça daqui a 2 a 8 dias (salão 09–18, almoço 12–13).
\set ON_ERROR_STOP 1
begin;
set local app.gleide = :'gleide';

do $$
declare
  emp  uuid := '00000000-0000-0000-0000-000000000001';
  gle  text := current_setting('app.gleide');
  d    date := hoje_cuiaba() + 2 + ((9 - extract(dow from hoje_cuiaba() + 2)::int) % 7);  -- uma terça
  r    jsonb; n int; v text; ok boolean;
  ag_ana uuid; ag_bia uuid; ag_x uuid; ana uuid; bia uuid;
  em   constant text := 'America/Cuiaba';
begin
  update empresas set config = config
    || '{"horario_funcionamento": {"dom": null, "seg": null, "ter": "09:00-18:00", "qua": "09:00-18:00", "qui": "09:00-18:00", "sex": "09:00-18:00", "sab": "08:00-14:00"},
         "almoco": {"inicio": "12:00", "fim": "13:00"}, "bloqueios": []}'
   where id = emp;
  delete from agendamentos where empresa_id = emp and inicio > now();  -- os do 002 (seed) ocupariam a terça

  -- 1. horários livres: grade de 30 min, sem o almoço, até caber a duração
  r := n8n_assistente_horarios_livres(emp, gle, d, 'hidratação');
  if r->>'servico' <> 'Hidratação ou reconstrução' then raise exception '1a: serviço errado: %', r; end if;
  if not (r->'livres' ? '09:00') or (r->'livres' ? '11:30') or (r->'livres' ? '12:00') or not (r->'livres' ? '17:00') or (r->'livres' ? '17:30') then
    raise exception '1b: livres errados: %', r->'livres';
  end if;
  r := n8n_assistente_horarios_livres(emp, gle, d + 6, 'hidratação');  -- segunda: fechado
  if jsonb_array_length(r->'livres') <> 0 or r->>'obs' not like '%não abre%' then raise exception '1c: segunda deveria estar fechada: %', r; end if;

  -- 2. marcar para cliente nova (telefone sem 55)
  r := n8n_assistente_marcar_horario(emp, gle, null, '(66) 98888-0001', 'Ana Teste', 'hidratação', (d + time '14:00') at time zone em);
  ag_ana := (r->>'agendamento_id')::uuid; ana := (r->>'cliente_id')::uuid;
  select count(*) into n from clientes where id = ana and telefone = '5566988880001';
  if n <> 1 or r->>'ate' <> '15:00' then raise exception '2: marcar não criou certo: %', r; end if;

  -- 3. encavalar: não marca sem forcar
  r := n8n_assistente_marcar_horario(emp, gle, null, '66988880002', 'Bia Teste', 'Selagem', (d + time '15:00') at time zone em);
  ag_bia := (r->>'agendamento_id')::uuid; bia := (r->>'cliente_id')::uuid;
  ok := false;
  begin
    perform n8n_assistente_marcar_horario(emp, gle, null, '66988880003', 'Cris Teste', 'selagem', (d + time '14:30') at time zone em);
  exception when others then ok := sqlerrm like 'NÃO MARQUEI: Encavala com Ana Teste (14:00 às 15:00)%'; end;
  if not ok then raise exception '3a: deveria recusar o encavalado'; end if;
  r := n8n_assistente_marcar_horario(emp, gle, null, '66988880003', 'Cris Teste', 'selagem', (d + time '14:30') at time zone em, null, true);
  perform n8n_assistente_excluir_horario(emp, gle, (r->>'agendamento_id')::uuid);
  select count(*) into n from agendamentos where id = (r->>'agendamento_id')::uuid;
  if n <> 0 then raise exception '3b: excluir não apagou'; end if;

  -- 4. a cliente já tem horário: avisa (para reagendar em vez de marcar outro)
  ok := false;
  begin
    perform n8n_assistente_marcar_horario(emp, gle, ana, null, null, 'selagem', (d + 1 + time '09:00') at time zone em);
  exception when others then ok := sqlerrm like '%Ela já tem horário marcado%reagendar%'; end;
  if not ok then raise exception '4: deveria avisar que ela já tem horário'; end if;

  -- 5. "reagenda a das 14:00 para 14:40, atrasei": encavala com a Bia (15:00) -> só com forcar
  ok := false;
  begin
    perform n8n_assistente_reagendar(emp, gle, ag_ana, (d + time '14:40') at time zone em);
  exception when others then ok := sqlerrm like 'NÃO REAGENDEI: Encavala com Bia Teste%'; end;
  if not ok then raise exception '5a: deveria avisar do encavalamento'; end if;
  r := n8n_assistente_reagendar(emp, gle, ag_ana, (d + time '14:40') at time zone em, null, true);
  select observacoes into v from agendamentos where id = ag_ana;
  if r->>'ate' <> '15:40' or v not like '%Reagendado de ' || to_char(d, 'DD/MM') || ' às 14:00%' then raise exception '5b: reagendar errado: % / %', r, v; end if;
  -- mudou de horário com mais de 3 h de antecedência: abre vaga, como no app (010)
  select count(*) into n from vagas where agendamento_id = ag_ana;
  if n <> 1 then raise exception '5c: deveria abrir a vaga das 14:00 (% vagas)', n; end if;
  delete from vagas where agendamento_id = ag_ana;

  -- 6. atraso que se arrasta: empurra todo mundo de 14:40 em diante 30 min, sem abrir vaga
  r := n8n_assistente_atrasar_agenda(emp, gle, 30, '14:40', d);
  if jsonb_array_length(r->'movidos') <> 2 or r->'movidos'->0->>'para' <> '15:10' or r->'movidos'->1->>'para' <> '15:30' then
    raise exception '6a: atrasar errado: %', r;
  end if;
  select to_char(fim at time zone em, 'HH24:MI') into v from agendamentos where id = ag_bia;
  if v <> '17:30' then raise exception '6b: a Bia deveria ir até 17:30 (selagem 2 h), foi até %', v; end if;
  select count(*) into n from vagas where agendamento_id in (ag_ana, ag_bia);
  if n <> 0 then raise exception '6c: atrasar abriu vaga'; end if;
  r := n8n_assistente_atrasar_agenda(emp, gle, 60, '15:30', d);  -- Bia até 18:30: passa do expediente
  if coalesce(r->>'atencao', '') not like '%Bia Teste%Fora do horário%' then raise exception '6d: deveria avisar que passa das 18:00: %', r; end if;
  perform n8n_assistente_atrasar_agenda(emp, gle, -60, '16:30', d);

  -- 7. aviso para a cliente (sem texto: monta do último "Reagendado de")
  r := n8n_assistente_avisar_cliente(emp, gle, ag_ana);
  if r->>'telefone' <> '5566988880001' or r->>'mensagem' not like 'Oi, Ana! %em vez de 14:40, vai ser % às 15:10%' then
    raise exception '7a: aviso errado: %', r;
  end if;
  select count(*) into n from contatos where agendamento_id = ag_ana and tipo = 'aviso' and resultado = 'pendente';
  if n <> 1 then raise exception '7b: não gravou o contato do aviso'; end if;

  -- 8. pedido de remarcação (imprevisto da Gleide): o horário que sai não vira vaga
  r := n8n_assistente_avisar_cliente(emp, gle, ag_bia, 'remarcacao');
  if r->>'mensagem' not like '%imprevisto%terça-feira%às 15:30%' then raise exception '8a: pedido errado: %', r; end if;
  perform n8n_assistente_reagendar(emp, gle, ag_bia, (d + 1 + time '09:00') at time zone em);
  select count(*) into n from vagas where agendamento_id = ag_bia;
  if n <> 0 then raise exception '8b: pedido de remarcação abriu vaga'; end if;
  select resultado into v from contatos where agendamento_id = ag_bia and tipo = 'remarcacao';
  if v <> 'agendou' then raise exception '8c: o pedido deveria virar agendou (%), ', v; end if;

  -- 9. serviço com nome ambíguo: pergunta
  ok := false;
  begin
    perform n8n_assistente_horarios_livres(emp, gle, d, 'manutenção');
  exception when others then ok := sqlerrm like '%pode ser:%Manutenção – queratina%'; end;
  if not ok then raise exception '9: "manutenção" deveria ser ambíguo'; end if;

  -- 10. chegou, concluir com serviço a mais, agenda do dia
  perform n8n_assistente_chegou(emp, gle, ag_ana);
  select count(*) into n from agendamentos where id = ag_ana and chegou_em is not null;
  if n <> 1 then raise exception '10a: chegou não gravou'; end if;
  r := n8n_assistente_concluir(emp, gle, ag_ana, null, 'Selagem + hidratação', 150);
  if r->'servicos_a_mais' <> '["Selagem"]'::jsonb then raise exception '10b: extras errados: %', r; end if;
  select count(*) into n from agendamentos where id = ag_ana and status = 'realizado' and valor = 150 and retorno_previsto is not null;
  if n <> 1 then raise exception '10c: não concluiu'; end if;
  r := n8n_assistente_agenda_do_dia(emp, gle, d);
  if not exists (select 1 from jsonb_array_elements(r) x where x->>'nome' = 'Ana Teste' and x->'servicos_a_mais' = '["Selagem"]' and (x->>'chegou')::boolean) then
    raise exception '10d: agenda do dia sem os extras: %', r;
  end if;
  -- trocou o serviço: anota o que estava marcado
  r := n8n_assistente_concluir(emp, gle, ag_bia, 'escova progressiva');
  select observacoes into v from agendamentos where id = ag_bia;
  if v not like '%Marcado era: Selagem%' then raise exception '10e: não anotou o serviço marcado: %', v; end if;

  -- 11. bloquear dia: some dos livres, não marca; desbloquear volta
  r := n8n_assistente_bloquear_dias(emp, gle, d + 2, d + 3, 'Curso');
  r := n8n_assistente_horarios_livres(emp, gle, d + 3, 'selagem');
  if jsonb_array_length(r->'livres') <> 0 or r->>'obs' not like '%sem atender (Curso)%' then raise exception '11a: bloqueio não vale: %', r; end if;
  ok := false;
  begin
    perform n8n_assistente_marcar_horario(emp, gle, null, '66988880004', 'Dani Teste', 'selagem', (d + 2 + time '10:00') at time zone em);
  exception when others then ok := sqlerrm like '%sem atender (Curso)%'; end;
  if not ok then raise exception '11b: marcou em dia bloqueado'; end if;
  r := n8n_assistente_desbloquear_dias(emp, gle, d + 3);
  r := n8n_assistente_horarios_livres(emp, gle, d + 3, 'selagem');
  if jsonb_array_length(r->'livres') = 0 then raise exception '11c: desbloquear não voltou os horários'; end if;

  -- 12. ficha: pausar IA, editar, buscar com horários marcados
  perform n8n_assistente_pausar_ia(emp, gle, bia);
  select count(*) into n from clientes where id = bia and ia_pausada_ate > now() + interval '11 hours' and motivo_pausa = 'manual';
  if n <> 1 then raise exception '12a: não pausou'; end if;
  perform n8n_assistente_pausar_ia(emp, gle, bia, false);
  perform n8n_assistente_editar_cliente(emp, gle, ana, 'Ana Teste Souza', '1990-05-20');
  select count(*) into n from clientes where id = ana and nome = 'Ana Teste Souza' and aniversario = '1990-05-20';
  if n <> 1 then raise exception '12b: não editou'; end if;
  r := n8n_assistente_marcar_horario(emp, gle, ana, null, null, 'selagem', (d + 7 + time '10:00') at time zone em);
  r := n8n_assistente_buscar_cliente(emp, gle, 'ana teste');
  if jsonb_array_length(r->0->'horarios_marcados') <> 1 then raise exception '12c: buscar sem horários marcados: %', r; end if;

  -- 13. número que não é da Gleide não faz nada
  ok := false;
  begin
    perform n8n_assistente_reagendar(emp, '5566911110000', ag_ana, now() + interval '1 day');
  exception when others then ok := sqlerrm like '%não autorizado%'; end;
  if not ok then raise exception '13: número estranho conseguiu reagendar'; end if;

  raise notice 'teste-013: todos os testes passaram';
end $$;

rollback;
