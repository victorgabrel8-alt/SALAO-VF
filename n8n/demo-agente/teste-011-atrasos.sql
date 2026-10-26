-- Testes automáticos do 011 (cliente atrasada) no banco local "salao_teste".
-- Roda dentro de uma transação e desfaz no final. O tempo é simulado puxando o horário e os
-- contatos para trás. Rode de dia (antes das 21h): a vaga de atraso só vale no mesmo dia.
-- O principal: silêncio da cliente E da Gleide nunca libera o horário.
\set ON_ERROR_STOP 1
begin;
set local app.gleide = :'gleide';

do $$
declare
  emp  uuid := '00000000-0000-0000-0000-000000000001';
  gle  text := current_setting('app.gleide');
  ana  uuid; bia uuid; ag_ana uuid; ag_bia uuid; v_vaga record;
  r    jsonb; n int; v text;
begin
  update empresas set config = config
    || '{"atrasos": {"chamar": true, "so_para": []}, "vagas": {"oferecer": true, "so_para": []}, "faltas": {"chamar": true, "so_para": []}}'
   where id = emp;
  insert into clientes (empresa_id, nome, telefone) values (emp, 'Ana Atrasada', '5566977770001') returning id into ana;
  insert into clientes (empresa_id, nome, telefone) values (emp, 'Bia Depois', '5566977770002') returning id into bia;
  insert into agendamentos (empresa_id, cliente_id, inicio, fim)
  values (emp, ana, now() - interval '6 minutes', now() + interval '2 hours 30 minutes') returning id into ag_ana;
  -- puxar o horário para trás (simular o relógio) não é remarcar: desliga o gatilho do 005 até o passo 4
  alter table agendamentos disable trigger trg_contato_remarcado;

  -- 1. +5 min: Ana entra na 1ª mensagem
  select count(*) into n from n8n_atrasos_para_chamar(emp) where agendamento_id = ag_ana and etapa = 1;
  if n <> 1 then raise exception '1: Ana não apareceu na etapa 1'; end if;
  perform n8n_registrar_chamada_atraso(emp, ag_ana, 'msg 1', 'teste-011-1');

  -- 2. logo depois: não manda de novo
  select count(*) into n from n8n_atrasos_para_chamar(emp) where agendamento_id = ag_ana;
  if n <> 0 then raise exception '2: mandaria outra mensagem logo em seguida'; end if;

  -- 3. +25 min: 2ª mensagem
  update agendamentos set inicio = now() - interval '26 minutes' where id = ag_ana;
  update contatos set criado_em = now() - interval '21 minutes' where agendamento_id = ag_ana and tipo = 'atraso';
  select count(*) into n from n8n_atrasos_para_chamar(emp) where agendamento_id = ag_ana and etapa = 2;
  if n <> 1 then raise exception '3: Ana não apareceu na etapa 2'; end if;
  perform n8n_registrar_chamada_atraso(emp, ag_ana, 'msg 2', 'teste-011-2');

  -- 4. +40 min sem resposta: vira pergunta à Gleide, e NADA é liberado sozinho
  update agendamentos set inicio = now() - interval '40 minutes' where id = ag_ana;
  update contatos set criado_em = now() - interval '35 minutes' where agendamento_id = ag_ana and mensagem = 'msg 1';
  update contatos set criado_em = now() - interval '12 minutes' where agendamento_id = ag_ana and mensagem = 'msg 2';
  select count(*) into n from n8n_atrasos_para_chamar(emp) where agendamento_id = ag_ana;
  if n <> 0 then raise exception '4a: mandaria uma 3ª mensagem'; end if;
  select count(*) into n from n8n_atrasos_para_confirmar(emp) where agendamento_id = ag_ana;
  if n <> 1 then raise exception '4b: não perguntou à Gleide'; end if;
  select status into v from agendamentos where id = ag_ana;
  if v <> 'agendado' then raise exception '4c: o horário mudou sozinho para %', v; end if;
  select count(*) into n from vagas where agendamento_id = ag_ana;
  if n <> 0 then raise exception '4d: abriu vaga sem a Gleide'; end if;
  alter table agendamentos enable trigger trg_contato_remarcado;

  -- 5. perguntou: não pergunta de novo na mesma rodada
  perform n8n_assistente_marcar_perguntado(emp, gle, array[ag_ana]);
  select count(*) into n from n8n_atrasos_para_confirmar(emp) where agendamento_id = ag_ana;
  if n <> 0 then raise exception '5: perguntaria de novo'; end if;

  -- 6. cobrança: depois de 1 h pergunta de novo; passadas 2 h do 1º, para
  begin
    update registros_ia set criado_em = now() - interval '61 minutes' where registro_id = ag_ana and acao = 'perguntou';
    select count(*) into n from n8n_assistente_pendencias_novas(emp) where pendencia_id = ag_ana;
    if n <> 1 then raise exception '6a: não cobrou depois de 1 h'; end if;
    update registros_ia set criado_em = now() - interval '2 hours 20 minutes' where registro_id = ag_ana and acao = 'perguntou';
    select count(*) into n from n8n_assistente_pendencias_novas(emp) where pendencia_id = ag_ana;
    if n <> 0 then raise exception '6b: cobrou depois de 2 h'; end if;
    raise exception 'desfaz';
  exception when others then if sqlerrm <> 'desfaz' then raise; end if;
  end;

  -- 7. "veio": realizado, sem vaga (desfeito no fim do bloco para testar o "libera")
  begin
    perform n8n_assistente_status_agendamento(emp, gle, ag_ana, 'realizado');
    select count(*) into n from pendencias_gleide where pendencia_id = ag_ana;
    if n <> 0 then raise exception '7a: continuou pendente depois do "veio"'; end if;
    select count(*) into n from vagas where agendamento_id = ag_ana;
    if n <> 0 then raise exception '7b: abriu vaga com a cliente no salão'; end if;
    raise exception 'desfaz';
  exception when others then if sqlerrm <> 'desfaz' then raise; end if;
  end;

  -- 8. número que não é da Gleide não libera
  begin
    perform n8n_assistente_liberar_horario(emp, '5566900000000', ag_ana);
    raise exception '8: número não autorizado liberou';
  exception when others then if sqlerrm not like '%não autorizado%' then raise; end if;
  end;

  -- 9. "libera": falta + vaga de atraso; a falta não manda "sentimos sua falta" (já foi chamada 2x)
  r := n8n_assistente_liberar_horario(emp, gle, ag_ana);
  select status into v from agendamentos where id = ag_ana;
  if v <> 'faltou' then raise exception '9a: status = %', v; end if;
  select * into v_vaga from vagas where agendamento_id = ag_ana and motivo = 'atraso' and status = 'aberta';
  if v_vaga.id is null then raise exception '9b: não abriu a vaga (%)', r; end if;
  if v_vaga.inicio < now() + interval '40 minutes' then raise exception '9c: vaga cedo demais (%)', v_vaga.inicio; end if;
  select count(*) into n from n8n_faltas_para_chamar(emp) where agendamento_id = ag_ana;
  if n <> 0 then raise exception '9d: mandaria também o "sentimos sua falta"'; end if;
  begin
    perform n8n_assistente_liberar_horario(emp, gle, ag_ana);
    raise exception '9e: liberou duas vezes';
  exception when others then if sqlerrm not like '%não está mais em aberto%' then raise; end if;
  end;

  -- 10. a vaga vai para a Bia, que tem horário logo depois, no mesmo dia
  insert into agendamentos (empresa_id, cliente_id, inicio, fim)
  values (emp, bia, v_vaga.fim, v_vaga.fim + interval '1 hour') returning id into ag_bia;
  select count(*) into n from n8n_vagas_para_oferecer(emp) where vaga_id = v_vaga.id and agendamento_id = ag_bia;
  if n <> 1 then raise exception '10: não ofereceu a vaga para a Bia'; end if;
  perform n8n_registrar_oferta_vaga(emp, v_vaga.id, ag_bia, 'oferta', 'teste-011-3');

  -- 11. Ana aparece ANTES da Bia topar: a vaga fecha e o conflito não acontece
  begin
    perform n8n_assistente_status_agendamento(emp, gle, ag_ana, 'realizado');
    perform n8n_vagas_para_oferecer(emp);
    select status into v from vagas where id = v_vaga.id;
    if v <> 'expirada' then raise exception '11: vaga continuou % com a Ana no salão', v; end if;
    raise exception 'desfaz';
  exception when others then if sqlerrm <> 'desfaz' then raise; end if;
  end;

  -- 12. Bia topa e adianta; depois a Ana aparece: a Gleide recebe o aviso de conflito, uma vez
  update agendamentos set inicio = v_vaga.inicio, fim = v_vaga.inicio + interval '1 hour' where id = ag_bia;
  select resultado into v from contatos where vaga_id = v_vaga.id and agendamento_id = ag_bia;
  if v <> 'agendou' then raise exception '12a: oferta da Bia = %', v; end if;
  select count(*) into n from n8n_conflitos_atraso(emp);
  if n <> 0 then raise exception '12b: conflito antes de a Ana aparecer'; end if;
  perform n8n_assistente_status_agendamento(emp, gle, ag_ana, 'realizado');
  select count(*) into n from n8n_conflitos_atraso(emp) where nome_atrasada = 'Ana Atrasada' and nome_adiantou = 'Bia Depois';
  if n <> 1 then raise exception '12c: não avisou o conflito'; end if;
  perform n8n_marcar_avisado(emp, (select jsonb_agg(jsonb_build_object('id', contato_id, 'situacao', 'conflito')) from n8n_conflitos_atraso(emp)));
  select count(*) into n from n8n_conflitos_atraso(emp);
  if n <> 0 then raise exception '12d: avisaria o conflito de novo'; end if;

  -- 13. quem falou com o salão perto do horário não é cobrada
  insert into agendamentos (empresa_id, cliente_id, inicio, fim)
  values (emp, bia, now() - interval '7 minutes', now() + interval '1 hour') returning id into ag_bia;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, conteudo)
  values (emp, bia, 'entrada', 'cliente', 'tô chegando, atrasei um pouquinho');
  select count(*) into n from n8n_atrasos_para_chamar(emp) where agendamento_id = ag_bia;
  if n <> 0 then raise exception '13: cobrou quem avisou que está chegando'; end if;

  raise notice 'teste-011: todos os testes passaram';
end $$;

rollback;
