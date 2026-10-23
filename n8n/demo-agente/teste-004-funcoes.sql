-- Testes automáticos das funções do 004 (banco local "salao_teste").
-- Roda tudo dentro de uma transação e desfaz no final: o cenário de teste fica intacto.
-- Cada bloco levanta erro se algo não sair como esperado.
\set ON_ERROR_STOP 1
begin;
set local app.gleide = :'gleide';

do $$
declare
  emp  uuid := '00000000-0000-0000-0000-000000000001';
  gle  text := current_setting('app.gleide');
  jul  uuid; carla uuid; ana uuid;
  r    jsonb; n int; v text; ok boolean;
  ag13 uuid; sv uuid; jpr uuid;
begin
  select id into jul   from clientes where telefone = '5566911112222';
  select id into carla from clientes where telefone = '5566933334444';
  select id into ana   from clientes where telefone = '5566955556666';

  -- 1. funil: Juliana com avaliação passada sem resultado
  select etapa into v from funil_clientes where cliente_id = jul;
  if v <> 'aguardando_gleide' then raise exception '1: etapa da Juliana = %', v; end if;

  -- 1b. "já perguntei" vale para avaliação e atendimento
  perform n8n_assistente_marcar_perguntado(emp, gle,
          array(select pendencia_id from pendencias_gleide where tipo <> 'pensando_vencido'));
  select count(*) into n from pendencias_gleide where perguntado_em is null and tipo <> 'pensando_vencido';
  if n <> 0 then raise exception '1b: % pendências sem marca', n; end if;
  select count(*) into n from pendencias_gleide where perguntado_em is null and tipo = 'pensando_vencido';
  if n <> 1 then raise exception '1b: marcou a Carla sem querer'; end if;

  -- 2. pré-avaliação: campo vazio não apaga o que já estava salvo
  perform n8n_salvar_pre_avaliacao(emp, '5566911112222', '{"cor": "", "gramas_extra": "x", "orcamento": "até 3.500"}');
  select pre_cor || ' | ' || pre_orcamento into v from avaliacoes where cliente_id = jul and resultado = 'pendente';
  if v <> 'castanho escuro | até 3.500' then raise exception '2: %', v; end if;

  -- 3. número não autorizado não grava nada
  begin
    perform n8n_assistente_resultado_avaliacao(emp, '5566900000000', jul, '{"resultado": "fechou"}');
    raise exception '3: número não autorizado conseguiu gravar';
  exception when others then
    if sqlerrm not like '%não autorizado%' then raise; end if;
  end;

  -- 4. resultado inválido é recusado
  begin
    perform n8n_assistente_resultado_avaliacao(emp, gle, jul, '{"resultado": "talvez"}');
    raise exception '4: resultado inválido aceito';
  exception when others then
    if sqlerrm not like '%resultado deve ser%' then raise; end if;
  end;

  -- 5. Gleide: Juliana fechou → avaliação fecha, agendamento da avaliação vira realizado, sai das pendências
  r := n8n_assistente_resultado_avaliacao(emp, gle, jul,
       '{"resultado": "fechou", "tecnica_indicada": "queratina", "tipo_cabelo": "vietnamita",
         "comprimento_cm": "70", "gramas": "150", "valor_orcado": "2800", "observacoes": "fio fino"}');
  select etapa into v from funil_clientes where cliente_id = jul;
  if v <> 'fechou' then raise exception '5a: etapa = %', v; end if;
  select count(*) into n from agendamentos a join avaliacoes av on av.agendamento_id = a.id
   where av.cliente_id = jul and a.status = 'realizado';
  if n <> 1 then raise exception '5b: avaliação não virou realizado'; end if;
  select count(*) into n from pendencias_gleide where cliente_id = jul;
  if n <> 0 then raise exception '5c: Juliana ainda em pendências (%)', n; end if;

  -- 6. depois de fechada, nova pré-avaliação abre uma avaliação NOVA (não mexe na fechada)
  perform n8n_salvar_pre_avaliacao(emp, '5566911112222', '{"resumo": "quer comprar mais cabelo"}');
  select count(*) into n from avaliacoes where cliente_id = jul;
  if n <> 2 then raise exception '6: % avaliações', n; end if;

  -- 7. Carla "pensando" → nao_fechou continua na mesma avaliação
  perform n8n_assistente_resultado_avaliacao(emp, gle, carla,
          '{"resultado": "nao_fechou", "motivo_nao_fechou": "achou caro"}');
  select count(*) into n from avaliacoes where cliente_id = carla;
  if n <> 1 then raise exception '7a: % avaliações da Carla', n; end if;
  select valor_orcado::text || ' | ' || motivo_nao_fechou into v from avaliacoes where cliente_id = carla;
  if v <> '2400.00 | achou caro' then raise exception '7b: %', v; end if;

  -- 8. status do atendimento da Ana → realizado calcula retorno
  perform n8n_assistente_status_agendamento(emp, gle,
          (select id from agendamentos where cliente_id = ana), 'realizado', 250);
  select retorno_previsto is not null into ok from agendamentos where cliente_id = ana;
  if not ok then raise exception '8: retorno não calculado'; end if;

  -- 9. atendimento sem agendar, cliente nova
  r := n8n_assistente_registrar_atendimento(emp, gle, '5566988887777', 'Bruna Teste',
       (select id from servicos where empresa_id = emp and nome = 'Manutenção – tela adesiva'), now(), 250, 'veio sem marcar');
  select status into v from clientes_status where telefone = '5566988887777';
  if v <> 'em_dia' then raise exception '9: status = %', v; end if;

  -- 10. anotação acumula, não substitui
  perform n8n_assistente_anotar_cliente(emp, gle, ana, 'alérgica a cola');
  perform n8n_assistente_anotar_cliente(emp, gle, ana, 'prefere sábado');
  select observacoes into v from clientes where id = ana;
  if v not like '%alérgica a cola%' or v not like '%prefere sábado%' then raise exception '10: %', v; end if;

  -- 11. cliente de outra empresa não é aceita
  begin
    perform n8n_assistente_anotar_cliente('00000000-0000-0000-0000-0000000000ff', gle, ana, 'x');
    raise exception '11: aceitou empresa errada';
  exception when others then
    if sqlerrm not like '%não autorizado%' and sqlerrm not like '%não encontrada%' then raise; end if;
  end;

  -- 12. tudo ficou no log
  select count(*) into n from registros_ia where pedido_por = gle;
  if n < 6 then raise exception '12: só % registros da assistente', n; end if;

  -- ===== ✓ do CRM (crm_confirmar_atendimento) =====
  -- 13. "Foi isso": Joana (seed, hoje 13h) vira realizado e mantém o serviço
  select a.id, a.servico_id into ag13, sv from agendamentos a join clientes c on c.id = a.cliente_id
   where c.nome = 'Joana Silva' and a.status = 'agendado' and (a.inicio at time zone 'America/Cuiaba')::date = hoje_cuiaba();
  perform crm_confirmar_atendimento(ag13);
  select count(*) into n from agendamentos where id = ag13 and status = 'realizado' and servico_id = sv;
  if n <> 1 then raise exception '13: Foi isso não marcou realizado'; end if;

  -- 14. "Mudou algo": marcou manutenção, fez manutenção + selagem → 2 atendimentos, 2 retornos diferentes
  select id into jpr from clientes where telefone = '5566977778888';
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, status, origem)
  values (emp, jpr, (select id from servicos where empresa_id = emp and nome = 'Manutenção – queratina'),
          now() - interval '4 hours', 'agendado', 'ia') returning id into ag13;
  r := crm_confirmar_atendimento(ag13, array[
         (select id from servicos where empresa_id = emp and nome = 'Manutenção – queratina'),
         (select id from servicos where empresa_id = emp and nome = 'Selagem')]);
  -- um horário só (007): a selagem entra como serviço a mais do mesmo horário
  select count(*) into n from agendamentos where cliente_id = jpr and status = 'realizado';
  if n <> 1 then raise exception '14a: % horários realizados (esperado 1)', n; end if;
  select count(*) into n from servicos_feitos where cliente_id = jpr;
  if n <> 2 then raise exception '14a: % serviços feitos (esperado 2)', n; end if;
  select count(distinct retorno_previsto) into n from retornos_por_servico where cliente_id = jpr;
  if n <> 2 then raise exception '14b: % retornos distintos (esperado 2: 75 e 25 dias)', n; end if;
  select status into v from clientes_status where id = jpr;
  if v <> 'em_dia' then raise exception '14c: status = %', v; end if;

  -- 15. Avaliação pelo ✓: Pensando → funil "pensando"
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, status, origem)
  values (emp, jpr, (select id from servicos where empresa_id = emp and nome = 'Avaliação'),
          now() - interval '2 hours', 'agendado', 'ia') returning id into ag13;
  perform crm_confirmar_atendimento(ag13, null, 'pensando');
  select etapa into v from funil_clientes where cliente_id = jpr;
  if v <> 'pensando' then raise exception '15: etapa = %', v; end if;

  -- 16. resultado inválido é recusado
  begin
    perform crm_confirmar_atendimento(ag13, null, 'talvez');
    raise exception '16: aceitou resultado inválido';
  exception when others then
    if sqlerrm not like '%resultado deve ser%' then raise; end if;
  end;

  raise notice 'OK: 16 testes passaram';
end $$;

rollback;
