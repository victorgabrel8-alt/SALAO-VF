-- Teste do supabase/066 (conferência semanal de vendas) na Loja Teste. Rodar DENTRO de uma transação desfeita:
--   begin; <supabase/066_vendas_conferidas.sql se ainda não aplicado> <este arquivo> rollback;
-- Devolve uma linha por caso: caso, ok (true/false) e o que veio. Nada fica gravado (rollback no fim).
create temp table r (n serial, caso text, ok boolean, veio text) on commit drop;
-- erro do banco vira {"erro": "..."} para o teste conferir (no n8n ele chega como "ERRO: ...")
create function pg_temp.conferir(p_e uuid, p_tel text, p_nome text, p_data date, p_tipo text, p_valor numeric, p_fala text)
returns jsonb language plpgsql as $f$
begin return n8n_assistente_conferir_venda(p_e, p_tel, p_nome, p_data, p_tipo, p_valor, p_fala);
exception when others then return jsonb_build_object('erro', sqlerrm); end $f$;

do $$
declare
  L uuid := 'ff4b7937-1abb-4803-83c8-e0896d94fc9f';
  tel text := '5500000000001';
  sA uuid; sM uuid; sAv uuid; cV uuid; cR uuid; cJ uuid; cR2 uuid; cB uuid; cAP uuid; cAC uuid; cO uuid; aAP uuid; cSN uuid; aSN uuid; cJQ uuid;
  aV uuid; aR uuid; aJ uuid; aAv uuid; aR2 uuid; dia3 date := (now() at time zone 'America/Cuiaba')::date - 3;
  j jsonb; n int;
begin
  insert into servicos (empresa_id, nome, preco, duracao_min) values (L, 'Aplicação de mega hair – teste 066', 150, 120) returning id into sA;
  insert into servicos (empresa_id, nome, preco, duracao_min) values (L, 'Manutenção – teste 066', 350, 120) returning id into sM;
  insert into servicos (empresa_id, nome, preco, duracao_min) values (L, 'Avaliação – teste 066', 0, 30) returning id into sAv;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Vitória Teste', '5500000066001') returning id into cV;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Renata Teste', '5500000066002') returning id into cR;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Joana Teste', '5500000066003') returning id into cJ;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Renata Souza', '5500000066004') returning id into cR2;
  -- Joana nunca escreveu no WhatsApp: não é cliente da IA
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo)
  select L, c, 'entrada', 'cliente', 'texto', 'oi' from unnest(array[cV, cR, cR2]) c;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cV, sA, (dia3 + time '09:00') at time zone 'America/Cuiaba', (dia3 + time '11:00') at time zone 'America/Cuiaba', 'realizado', 'ia') returning id into aV;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cR, sM, (dia3 + time '14:00') at time zone 'America/Cuiaba', (dia3 + time '16:00') at time zone 'America/Cuiaba', 'realizado', 'manual') returning id into aR;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cJ, sM, now() - interval '2 days', now() - interval '2 days' + interval '2 hours', 'realizado', 'manual') returning id into aJ;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cV, sAv, now() - interval '5 days', now() - interval '5 days' + interval '30 minutes', 'realizado', 'ia') returning id into aAv;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cR2, sM, now() - interval '10 days', now() - interval '10 days' + interval '2 hours', 'realizado', 'ia') returning id into aR2;

  -- 1. lista: Vitória (cabelo novo), Renata e Renata Souza (manutenção); Joana (sem conversa) e a avaliação ficam de fora
  j := n8n_conferencia_vendas_lista(L, 30, null, 12);
  -- a Loja Teste tem outros testes antigos: conta só os atendimentos deste teste
  insert into r (caso, ok, veio) values ('lista tem 3', (select count(*) from jsonb_array_elements(j) x where x->>'agendamento_id' in (aV::text, aR::text, aR2::text, aJ::text, aAv::text)) = 3, j::text);
  insert into r (caso, ok, veio) values ('vitória = mega_novo', exists (select 1 from jsonb_array_elements(j) x where x->>'agendamento_id' = aV::text and x->>'sugerido' = 'mega_novo'), '');
  insert into r (caso, ok, veio) values ('sem joana e sem avaliação', not exists (select 1 from jsonb_array_elements(j) x where x->>'agendamento_id' in (aJ::text, aAv::text)), '');
  -- clientes desde amanhã: ninguém (todas cadastradas hoje)
  j := n8n_conferencia_vendas_lista(L, 30, (now() at time zone 'America/Cuiaba')::date + 1, 12);
  insert into r (caso, ok, veio) values ('filtro de cliente nova', jsonb_array_length(j) = 0, j::text);
  -- 2. marcar como perguntado e a lista some
  n := n8n_conferencia_vendas_marcar(L, array[aV, aR, aR2]);
  insert into r (caso, ok, veio) values ('marcou 3', n = 3, n::text);
  n := n8n_conferencia_vendas_marcar(L, array[aV]);
  insert into r (caso, ok, veio) values ('marcar de novo não duplica', n = 0, n::text);
  j := n8n_conferencia_vendas_lista(L, 30, null, 12);
  insert into r (caso, ok, veio) values ('lista sem os já perguntados', not exists (select 1 from jsonb_array_elements(j) x where x->>'agendamento_id' in (aV::text, aR::text, aR2::text)), j::text);
  -- 3. a Gleide confirma
  j := pg_temp.conferir(L, tel, 'Vitoria', dia3, 'mega_novo', 1500, 'tá certinho, a vitoria pagou 1500');
  insert into r (caso, ok, veio) values ('vitória sem acento acha', (j->>'ok')::boolean is true and j->>'tipo' = 'mega_novo', j::text);
  j := pg_temp.conferir(L, tel, 'Renata', null, 'manutencao', null, 'isso');
  insert into r (caso, ok, veio) values ('duas renatas esperando: pergunta', j ? 'erro', j::text);
  j := pg_temp.conferir(L, tel, 'Renata', dia3, 'manutencao', 0, 'isso');
  insert into r (caso, ok, veio) values ('renata com o dia', (j->>'ok')::boolean is true and j->>'valor' is null and (select agendamento_id from vendas_conferidas where tipo = 'manutencao' and cliente_id = cR) = aR, j::text);
  j := pg_temp.conferir(L, tel, 'Xuxa', null, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('nome que não existe', j ? 'erro', j::text);
  j := pg_temp.conferir(L, tel, 'Vitoria', null, 'banana', null, null);
  insert into r (caso, ok, veio) values ('tipo inválido', j ? 'erro', j::text);
  j := pg_temp.conferir(L, tel, 'Vitoria', dia3 + 20, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('dia errado não grava em outro', j ? 'erro', j::text);
  j := pg_temp.conferir(L, '5599999999999', 'Vitoria', dia3, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('número não autorizado', coalesce(j->>'erro', '') like '%não autorizado%', j::text);
  -- 4. corrigir: a Vitória foi manutenção; o valor que ela disse antes fica
  j := pg_temp.conferir(L, tel, 'vitória', dia3, 'manutenção', null, 'na verdade a vitoria foi o cabelo dela');
  insert into r (caso, ok, veio) values ('correção mantém valor', (select tipo = 'manutencao' and valor = 1500 from vendas_conferidas where agendamento_id = aV) and (j->>'valor')::numeric = 1500, j::text);
  -- a avaliação não é venda: a Bruna só fez avaliação (sem dia, para o erro vir do filtro e não da janela de dias)
  insert into clientes (empresa_id, nome, telefone) values (L, 'Bruna Avaliação', '5500000066005') returning id into cB;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo) values (L, cB, 'entrada', 'cliente', 'texto', 'oi');
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cB, sAv, now() - interval '4 days', now() - interval '4 days' + interval '30 minutes', 'realizado', 'ia');
  j := pg_temp.conferir(L, tel, 'Bruna', null, 'mega_novo', null, null);
  insert into r (caso, ok, veio) values ('avaliação nunca vira venda', coalesce(j->>'erro', '') like 'não achei%', j::text);
  -- 5. relatório: 2 manutenções confirmadas, Renata Souza sem resposta, Joana fora (não é da IA e ninguém conferiu)
  -- só as clientes cadastradas hoje (as deste teste)
  j := relatorio_vendas_confirmadas(L, (now() at time zone 'America/Cuiaba')::date - 30, (now() at time zone 'America/Cuiaba')::date, (now() at time zone 'America/Cuiaba')::date);
  insert into r (caso, ok, veio) values ('relatório', (j->>'mega_novo')::int = 0 and (j->>'manutencao')::int = 2 and (j->>'sem_conferir')::int = 1
    and (j->>'valor_confirmado')::numeric = 1500 + coalesce((select valor from agendamentos where id = aR), 0) and jsonb_array_length(j->'itens') = 3, j::text);
  insert into r (caso, ok, veio) values ('visão só confirmadas', (select count(*) from vendas_confirmadas where empresa_id = L and agendamento_id in (aV, aR, aR2, aJ)) = 2, '');

  -- 6. revisão de 21/11 (testador + /code-review)
  -- o que espera resposta vai para o prompt da assistente: a Renata Souza (perguntada e sem resposta)
  insert into r (caso, ok, veio) values ('lista esperando resposta', position('Renata Souza' in n8n_conferencia_vendas_pendente_texto(L)) > 0
    and position('Vitória Teste' in n8n_conferencia_vendas_pendente_texto(L)) = 0, n8n_conferencia_vendas_pendente_texto(L));
  -- nome com artigo e vírgula
  j := pg_temp.conferir(L, tel, 'a Renata Souza,', null, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('"a Renata Souza," acha a certa', (j->>'ok')::boolean is true and (select tipo from vendas_conferidas where agendamento_id = aR2) = 'manutencao', j::text);
  j := pg_temp.conferir(L, tel, 'Jo', null, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('nome de 2 letras pede o nome', coalesce(j->>'erro', '') like '%nome%', j::text);
  -- Ana Paula e Ana Clara no mesmo dia: o nome completo resolve
  insert into clientes (empresa_id, nome, telefone) values (L, 'Ana Paula Teste', '5500000066006') returning id into cAP;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Ana Clara Teste', '5500000066007') returning id into cAC;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo) select L, c, 'entrada', 'cliente', 'texto', 'oi' from unnest(array[cAP, cAC]) c;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cAP, sM, (dia3 + time '10:00') at time zone 'America/Cuiaba', (dia3 + time '12:00') at time zone 'America/Cuiaba', 'realizado', 'ia') returning id into aAP;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cAC, sM, (dia3 + time '15:00') at time zone 'America/Cuiaba', (dia3 + time '17:00') at time zone 'America/Cuiaba', 'realizado', 'ia');
  j := pg_temp.conferir(L, tel, 'Ana Paula', dia3, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('Ana Paula x Ana Clara no mesmo dia', (j->>'ok')::boolean is true and (select tipo from vendas_conferidas where agendamento_id = aAP) = 'manutencao', j::text);
  -- "aplicação" sozinha não vira cabelo novo
  j := pg_temp.conferir(L, tel, 'Vitoria', dia3, 'aplicação', null, null);
  insert into r (caso, ok, veio) values ('"aplicação" é recusada', coalesce(j->>'erro', '') like '%Aplicação%', j::text);
  -- apagar o valor e "não fez" sem valor
  j := n8n_assistente_conferir_venda(L, tel, 'Vitoria', dia3, 'manutencao', null, null, true);
  insert into r (caso, ok, veio) values ('apagar valor', (select valor from vendas_conferidas where agendamento_id = aV) is null and j->>'valor' is null, j::text);
  perform n8n_assistente_conferir_venda(L, tel, 'Vitoria', dia3, 'manutencao', 900, null);
  j := pg_temp.conferir(L, tel, 'Vitoria', dia3, 'nao fez', null, null);
  insert into r (caso, ok, veio) values ('não fez fica sem valor', (select tipo = 'nao_fez' and valor is null from vendas_conferidas where agendamento_id = aV), j::text);
  -- cliente antiga (sem conversa com a IA) que a Gleide conferiu não entra no relatório da IA
  insert into clientes (empresa_id, nome, telefone, criado_em) values (L, 'Odete Antiga', '5500000066008', '2025-01-01') returning id into cO;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cO, sA, now() - interval '1 day', now() - interval '1 day' + interval '2 hours', 'realizado', 'manual');
  j := pg_temp.conferir(L, tel, 'Odete', null, 'mega_novo', 2000, null);
  insert into r (caso, ok, veio) values ('Odete conferida', (j->>'ok')::boolean is true, j::text);
  j := relatorio_vendas_confirmadas(L, (now() at time zone 'America/Cuiaba')::date - 30, (now() at time zone 'America/Cuiaba')::date, null);
  insert into r (caso, ok, veio) values ('cliente antiga fora do relatório da IA', not exists (select 1 from jsonb_array_elements(j->'itens') x where x->>'nome' = 'Odete Antiga'), j::text);
  insert into r (caso, ok, veio) values ('visão marca da_ia', (select not da_ia from vendas_confirmadas where cliente_id = cO), '');
  -- 7. segunda rodada do testador: nome copiado do prompt com "(final 1234)", sobrenome que não está no cadastro, sem nome
  j := pg_temp.conferir(L, tel, 'Renata Souza (final 6004)', null, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('nome com "(final 6004)"', (j->>'ok')::boolean is true and j->>'nome' = 'Renata Souza', j::text);
  j := pg_temp.conferir(L, tel, 'Renata (final 9999)', null, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('final errado não grava em outra', coalesce(j->>'erro', '') like 'não achei%', j::text);
  -- sobrenome que contradiz o cadastro ("Joana Silva" x "Joana Teste") não grava; cadastro de um nome só ("Joaquina") acha
  j := pg_temp.conferir(L, tel, 'Joana Silva', null, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('sobrenome diferente do cadastro não grava', coalesce(j->>'erro', '') like 'não achei%', j::text);
  insert into clientes (empresa_id, nome, telefone) values (L, 'Joaquina', '5500000066010') returning id into cJQ;
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cJQ, sM, now() - interval '1 day', now() - interval '1 day' + interval '2 hours', 'realizado', 'manual');
  j := pg_temp.conferir(L, tel, 'Joaquina Silva', null, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('sobrenome fora de cadastro de um nome só acha', (j->>'ok')::boolean is true and j->>'nome' = 'Joaquina', j::text);
  -- "Ana Paula" sem atendimento nunca cai na "Ana Clara", nem com o final dela
  insert into clientes (empresa_id, nome, telefone) values (L, 'Ana Paula Xteste', '5500000066011');
  j := pg_temp.conferir(L, tel, 'Ana Paula', null, 'mega_novo', null, null);
  insert into r (caso, ok, veio) values ('Ana Paula não cai na Ana Clara', coalesce(j->>'nome', '') <> 'Ana Clara Teste', j::text);
  j := pg_temp.conferir(L, tel, 'Ana Paula (final 6007)', null, 'mega_novo', null, null);
  insert into r (caso, ok, veio) values ('Ana Paula com o final da Ana Clara não grava', coalesce(j->>'erro', '') like 'não achei%', j::text);
  insert into clientes (empresa_id, nome, telefone) values (L, null, '5500000066009') returning id into cSN;
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo) values (L, cSN, 'entrada', 'cliente', 'texto', 'oi');
  insert into agendamentos (empresa_id, cliente_id, servico_id, inicio, fim, status, origem)
  values (L, cSN, sM, now() - interval '1 day', now() - interval '1 day' + interval '2 hours', 'realizado', 'ia') returning id into aSN;
  perform n8n_conferencia_vendas_marcar(L, array[aSN]);
  insert into r (caso, ok, veio) values ('cliente sem nome aparece no prompt', position('cliente sem nome (final 6009)' in n8n_conferencia_vendas_pendente_texto(L)) > 0, n8n_conferencia_vendas_pendente_texto(L));
  j := pg_temp.conferir(L, tel, 'cliente sem nome (final 6009)', null, 'manutencao', null, null);
  insert into r (caso, ok, veio) values ('cliente sem nome pelo final', (j->>'ok')::boolean is true and (select tipo from vendas_conferidas where agendamento_id = aSN) = 'manutencao', j::text);
  j := pg_temp.conferir(L, tel, 'Renata Souza', null, 'nao-fez', null, null);
  insert into r (caso, ok, veio) values ('tipo com hífen', (j->>'tipo') = 'nao_fez', j::text);
  -- ninguém de fora (anon, authenticated) chega nas funções, na tabela e na visão
  insert into r (caso, ok, veio) values ('permissões', not has_function_privilege('anon', 'venda_sugerido(text)', 'execute')
    and not has_function_privilege('authenticated', 'n8n_assistente_conferir_venda(uuid,text,text,date,text,numeric,text,boolean)', 'execute')
    and not has_function_privilege('anon', 'n8n_conferencia_vendas_pendente_texto(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'relatorio_vendas_confirmadas(uuid,date,date,date)', 'execute')
    and not has_table_privilege('anon', 'vendas_conferidas', 'select') and not has_table_privilege('authenticated', 'vendas_conferidas', 'insert')
    and not has_table_privilege('anon', 'vendas_confirmadas', 'select'), '');
end $$;

select json_agg(r order by n) from r;
