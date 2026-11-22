-- Teste do supabase/068 (regra dos dias) na Loja Teste. Rodar DEPOIS de aplicar o 068, numa chamada só:
-- tudo acontece dentro de uma transação e o "raise exception" do fim desfaz o que o teste gravou
-- (a mensagem do erro é o resultado: "TESTE 068 OK ..." quer dizer que passou).
begin;
do $$
declare
  e uuid := 'ff4b7937-1abb-4803-83c8-e0896d94fc9f'; n text := '5500000000001';
  r jsonb; t text; antes jsonb; depois jsonb; c uuid; seg timestamptz; reg int; erros text := '';
begin
  select config - 'ia_dias' into antes from empresas where id = e;
  select count(*) into reg from registros_ia where empresa_id = e and acao = 'n8n_assistente_regra_dia';

  -- 1. domingo: nada (aceita "Domingo" por extenso)
  r := n8n_assistente_regra_dia(e, n, 'Domingo', 'nada', null, 'não marque mais nada no domingo');
  if (select config->'ia_dias'->'dom'->>'nao' from empresas where id = e) is distinct from 'tudo' then erros := erros || ' [1 dom não gravou]'; end if;
  if r->>'ficou' not like 'domingo: a IA não marca nada (desde %' then erros := erros || ' [1 ficou: ' || (r->>'ficou') || ']'; end if;

  -- 2. segunda: só online, manutenção e aplicação (aceita acento, maiúscula e espaço)
  r := n8n_assistente_regra_dia(e, n, 'seg', 'só', 'avaliacao_online, Manutenção , aplicação, manutencao', 'segunda só avaliação online');
  if (select config->'ia_dias'->'seg'->'so' from empresas where id = e) is distinct from '["avaliacao_online", "manutencao", "aplicacao"]'::jsonb then
    erros := erros || ' [2 seg: ' || coalesce((select (config->'ia_dias'->'seg')::text from empresas where id = e), 'nulo') || ']'; end if;
  if (select config->'ia_dias'->'seg'->>'fala' from empresas where id = e) is distinct from 'segunda só avaliação online' then erros := erros || ' [2 fala]'; end if;
  t := n8n_assistente_regra_dias_texto(e);
  if t not like 'domingo: a IA não marca nada (desde %' || E'\n' || 'segunda-feira: a IA só marca avaliação online, manutenção, aplicação (colocação) de mega hair (desde %' then erros := erros || ' [2 texto: ' || t || ']'; end if;
  if r->>'valendo_agora' is distinct from t then erros := erros || ' [2 valendo_agora diferente do texto]'; end if;

  -- 3. mandar de novo troca a regra do dia (não empilha, como acontecia com guardar_regra)
  r := n8n_assistente_regra_dia(e, n, 'segunda-feira', 'nao', 'avaliacao_presencial');
  if (select config->'ia_dias'->'seg' ? 'so' from empresas where id = e) or (select config->'ia_dias'->'seg'->'nao' from empresas where id = e) is distinct from '["avaliacao_presencial"]'::jsonb then erros := erros || ' [3 troca]'; end if;
  if (select count(*) from jsonb_object_keys((select config->'ia_dias' from empresas where id = e))) <> 2 then erros := erros || ' [3 chaves]'; end if;

  -- 4. sábado com acento; horário já marcado nesse dia da semana volta na resposta
  insert into clientes (empresa_id, nome, telefone) values (e, 'Cliente Teste 068', '5566900000068') returning id into c;
  seg := date_trunc('day', now() at time zone 'America/Cuiaba') + interval '10 hours';
  seg := (seg + ((6 - extract(dow from seg)::int + 7) % 7 + 7) * interval '1 day') at time zone 'America/Cuiaba';
  insert into agendamentos (empresa_id, cliente_id, inicio, fim, status, origem) values (e, c, seg, seg + interval '30 minutes', 'agendado', 'ia');
  r := n8n_assistente_regra_dia(e, n, 'sábado', 'nada');
  if (select config->'ia_dias'->'sab'->>'nao' from empresas where id = e) is distinct from 'tudo' then erros := erros || ' [4 sab]'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'horarios_ja_marcados_nesse_dia_da_semana') x where x->>'nome' = 'Cliente Teste 068') then
    erros := erros || ' [4 marcados: ' || (r->'horarios_ja_marcados_nesse_dia_da_semana')::text || ']'; end if;
  -- outro dia da semana não lista esse horário
  r := n8n_assistente_regra_dia(e, n, 'qua', 'nada');
  if exists (select 1 from jsonb_array_elements(r->'horarios_ja_marcados_nesse_dia_da_semana') x where x->>'nome' = 'Cliente Teste 068') then erros := erros || ' [4 marcados em dia errado]'; end if;

  -- 5. liberar tira só aquele dia; liberar o que não tem regra não quebra
  r := n8n_assistente_regra_dia(e, n, 'dom', 'liberar');
  if (select config->'ia_dias' ? 'dom' from empresas where id = e) then erros := erros || ' [5 liberar]'; end if;
  if r->>'ficou' <> 'domingo: sem regra, a IA volta a marcar normalmente' then erros := erros || ' [5 ficou]'; end if;
  r := n8n_assistente_regra_dia(e, n, 'ter', 'liberar');
  perform n8n_assistente_regra_dia(e, n, 'seg', 'liberar'); perform n8n_assistente_regra_dia(e, n, 'sab', 'liberar'); perform n8n_assistente_regra_dia(e, n, 'qua', 'liberar');
  if n8n_assistente_regra_dias_texto(e) not like '(nenhuma regra%' then erros := erros || ' [5 texto vazio: ' || n8n_assistente_regra_dias_texto(e) || ']'; end if;

  -- 6. recusas: número não autorizado, dia, regra e serviço que não existem, "so" sem serviço
  begin perform n8n_assistente_regra_dia(e, '5599999999999', 'dom', 'nada'); erros := erros || ' [6 aceitou número não autorizado]'; exception when others then null; end;
  begin perform n8n_assistente_regra_dia(e, n, 'feriado', 'nada'); erros := erros || ' [6 aceitou dia errado]'; exception when others then null; end;
  begin perform n8n_assistente_regra_dia(e, n, 'domingo e segunda', 'nada'); erros := erros || ' [6 aceitou dois dias numa chamada]'; exception when others then null; end;
  begin perform n8n_assistente_regra_dia(e, n, 'quinze', 'nada'); erros := erros || ' [6 aceitou quinze como quinta]'; exception when others then null; end;
  begin perform n8n_assistente_regra_dia(e, n, 'dom', 'talvez'); erros := erros || ' [6 aceitou regra errada]'; exception when others then null; end;
  begin perform n8n_assistente_regra_dia(e, n, 'seg', 'so', 'avaliacao_online, corte'); erros := erros || ' [6 aceitou serviço errado]'; exception when others then null; end;
  begin perform n8n_assistente_regra_dia(e, n, 'seg', 'so', ''); erros := erros || ' [6 aceitou so sem serviço]'; exception when others then null; end;
  if (select config->'ia_dias' from empresas where id = e) <> '{}'::jsonb then erros := erros || ' [6 recusa gravou algo]'; end if;

  -- 7. o resto do config da loja não muda; cada gravação fica no registro; a Gleide não é tocada
  select config - 'ia_dias' into depois from empresas where id = e;
  if antes is distinct from depois then erros := erros || ' [7 mexeu no resto do config]'; end if;
  if (select count(*) from registros_ia where empresa_id = e and acao = 'n8n_assistente_regra_dia') - reg <> 10 then
    erros := erros || ' [7 registros: ' || ((select count(*) from registros_ia where empresa_id = e and acao = 'n8n_assistente_regra_dia') - reg) || ']'; end if;

  -- 9. a conta do dia (a mesma da agenda) e a troca de avaliação online para presencial (n8n_mudar_modalidade)
  declare s_on uuid; s_pr uuid; d1 timestamptz; a1 uuid; msg text;
  begin
    insert into servicos (empresa_id, nome, duracao_min, ativo, categoria) values (e, 'Avaliação T068', 30, true, 'avaliacao') returning id into s_pr;
    insert into servicos (empresa_id, nome, duracao_min, ativo, categoria) values (e, 'Avaliação online T068', 30, true, 'avaliacao') returning id into s_on;
    d1 := date_trunc('day', now() at time zone 'America/Cuiaba') + interval '10 hours';
    d1 := (d1 + ((1 - extract(dow from d1)::int + 7) % 7 + 7) * interval '1 day') at time zone 'America/Cuiaba';  -- uma segunda-feira
    update agendamentos set status = 'cancelado' where cliente_id = c;
    insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem) values (e, c, s_on, d1, d1 + interval '30 minutes', 'agendado', 'ia') returning id into a1;
    if not ia_dia_permite(e, d1, 'avaliacao_presencial') then erros := erros || ' [9 sem regra devia permitir]'; end if;
    perform n8n_assistente_regra_dia(e, n, 'seg', 'so', 'avaliacao_online, manutencao, aplicacao');
    if ia_dia_permite(e, d1, 'avaliacao_presencial') or not ia_dia_permite(e, d1, 'avaliacao_online') or not ia_dia_permite(e, d1 + interval '1 day', 'avaliacao_presencial') then erros := erros || ' [9 permite]'; end if;
    begin perform n8n_mudar_modalidade(e, '5566900000068', 'presencial', d1); erros := erros || ' [9 trocou para presencial na segunda]';
    exception when others then msg := sqlerrm; if msg not like 'REGRA DA GLEIDE:%' then erros := erros || ' [9 erro: ' || msg || ']'; end if; end;
    if (select servico_id from agendamentos where id = a1) <> s_on then erros := erros || ' [9 serviço mudou]'; end if;
    perform n8n_assistente_regra_dia(e, n, 'seg', 'liberar');
    perform n8n_mudar_modalidade(e, '5566900000068', 'presencial', d1);
    if (select servico_id from agendamentos where id = a1) <> s_pr then erros := erros || ' [9 sem regra devia trocar]'; end if;
  end;

  -- 8. texto com config estranho não quebra
  if ia_dias_texto('[]'::jsonb) is not null or ia_dias_texto(null) is not null or ia_dias_texto('{"seg": 1, "x": {"nao": "tudo"}}'::jsonb) is not null then erros := erros || ' [8 texto estranho]'; end if;
  if ia_dias_texto('{"sex": {"nao": ["avaliacao_presencial", "visita"]}}'::jsonb) <> 'sexta-feira: a IA não marca avaliação presencial, visita para escolher cabelo' then
    erros := erros || ' [8 nao: ' || ia_dias_texto('{"sex": {"nao": ["avaliacao_presencial", "visita"]}}'::jsonb) || ']'; end if;

  raise exception '%', case when erros = '' then 'TESTE 068 OK (9 blocos), tudo desfeito' else 'TESTE 068 FALHOU:' || erros end;
end $$;
rollback;
