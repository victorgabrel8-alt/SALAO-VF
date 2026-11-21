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
  sA uuid; sM uuid; sAv uuid; cV uuid; cR uuid; cJ uuid; cR2 uuid;
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
  -- a avaliação não é venda
  j := pg_temp.conferir(L, tel, 'Vitoria', (now() at time zone 'America/Cuiaba')::date - 5, 'mega_novo', null, null);
  insert into r (caso, ok, veio) values ('avaliação nunca vira venda', coalesce(j->>'tipo', '') <> 'mega_novo' or (j->>'dia') = to_char(dia3, 'DD/MM'), j::text);
  -- 5. relatório: 2 manutenções confirmadas, Renata Souza sem resposta, Joana fora (não é da IA e ninguém conferiu)
  -- só as clientes cadastradas hoje (as deste teste)
  j := relatorio_vendas_confirmadas(L, (now() at time zone 'America/Cuiaba')::date - 30, (now() at time zone 'America/Cuiaba')::date, (now() at time zone 'America/Cuiaba')::date);
  insert into r (caso, ok, veio) values ('relatório', (j->>'mega_novo')::int = 0 and (j->>'manutencao')::int = 2 and (j->>'sem_conferir')::int = 1
    and (j->>'valor_confirmado')::numeric = 1500 + coalesce((select valor from agendamentos where id = aR), 0) and jsonb_array_length(j->'itens') = 3, j::text);
  insert into r (caso, ok, veio) values ('visão só confirmadas', (select count(*) from vendas_confirmadas where empresa_id = L and agendamento_id in (aV, aR, aR2, aJ)) = 2, '');
end $$;

select json_agg(r order by n) from r;
