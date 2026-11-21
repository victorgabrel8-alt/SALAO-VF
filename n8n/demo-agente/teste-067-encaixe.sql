-- Teste do supabase/067 (encaixe na falta) na Loja Teste. Rodar DENTRO de uma transação desfeita, numa chamada só:
--   begin; <supabase/067_encaixe_na_falta.sql se ainda não aplicado> <este arquivo> rollback;
-- Devolve uma linha por caso: caso, ok (true/false) e o que veio. Nada fica gravado (rollback no fim).
-- Usa a hora de agora: rodar entre 03h e 20h de Cuiabá (precisa caber "2 horas atrás" e "daqui a 3 horas" no mesmo dia).
create temp table r (n serial, caso text, ok boolean, veio text) on commit drop;

create function pg_temp.ag(p_e uuid, p_cli uuid, p_prof uuid, p_min int, p_dur int, p_status text default 'agendado')
returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into agendamentos (empresa_id, cliente_id, profissional_id, inicio, fim, status, origem)
  values (p_e, p_cli, p_prof, now() + make_interval(mins => p_min), now() + make_interval(mins => p_min + p_dur), p_status, 'manual')
  returning id into v;
  return v;
end $f$;
-- zera o dia da loja para o próximo caso
create function pg_temp.limpa(p_e uuid) returns void language plpgsql as $f$
begin
  delete from encaixes where empresa_id = p_e;
  update agendamentos set status = 'cancelado', chegou_em = null
   where empresa_id = p_e and status <> 'cancelado' and inicio between now() - interval '1 day' and now() + interval '1 day';
  update clientes set ia_pausada_ate = null where empresa_id = p_e and telefone like '55000000670%';
end $f$;
-- erro do banco vira {"erro": "..."} (no n8n ele chega como "ERRO: ...")
create function pg_temp.liberar(p_e uuid, p_tel text, p_ag uuid) returns jsonb language plpgsql as $f$
begin return n8n_assistente_liberar_horario_encaixe(p_e, p_tel, p_ag);
exception when others then return jsonb_build_object('erro', sqlerrm); end $f$;
create function pg_temp.status(p_e uuid, p_tel text, p_ag uuid, p_status text) returns jsonb language plpgsql as $f$
begin return n8n_assistente_status_agendamento_encaixe(p_e, p_tel, p_ag, p_status, null);
exception when others then return jsonb_build_object('erro', sqlerrm); end $f$;
create function pg_temp.chamar(p_e uuid, p_tel text, p_ag uuid, p_nome text, p_recusou boolean default false) returns jsonb language plpgsql as $f$
begin return n8n_assistente_chamar_para_encaixe(p_e, p_tel, p_ag, p_nome, p_recusou);
exception when others then return jsonb_build_object('erro', sqlerrm); end $f$;

do $$
declare
  L uuid := 'ff4b7937-1abb-4803-83c8-e0896d94fc9f';
  tel text := '5500000000001';
  P uuid; P2 uuid; cM uuid; cA uuid; cB uuid; cO uuid; cD uuid;
  f uuid; f2 uuid; aA uuid; aB uuid; aD uuid; v uuid; ct uuid;
  j jsonb; t text; n int; h int := extract(hour from now() at time zone 'America/Cuiaba')::int;
  hA text; msg text;
  liga jsonb := '{"encaixe": {"ligado": true, "so_para": []}}';
begin
  if h < 3 or h >= 20 then
    insert into r (caso, ok, veio) values ('FORA DE HORA: rode entre 03h e 20h de Cuiabá', false, h::text);
    return;
  end if;
  -- loja aberta o dia todo, sem almoço e sem bloqueio, só nesta transação
  update empresas set config = (config - 'encaixe') || jsonb_build_object('almoco', null, 'bloqueios', '[]'::jsonb, 'bloqueios_horario', '[]'::jsonb,
    'horario_funcionamento', '{"dom":"00:00-23:59","seg":"00:00-23:59","ter":"00:00-23:59","qua":"00:00-23:59","qui":"00:00-23:59","sex":"00:00-23:59","sab":"00:00-23:59"}'::jsonb,
    'vagas', '{"oferecer": true, "so_para": []}'::jsonb) where id = L;
  insert into profissionais (empresa_id, nome) values (L, 'Teste 067') returning id into P;
  insert into profissionais (empresa_id, nome) values (L, 'Teste 067 B') returning id into P2;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Maria Faltou', '5500000067001') returning id into cM;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Ana Paula Teste', '5500000067002') returning id into cA;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Bia Teste', '5500000067003') returning id into cB;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Olga Teste', '5500000067004') returning id into cO;
  insert into clientes (empresa_id, nome, telefone) values (L, 'Dora Teste', '5500000067005') returning id into cD;
  perform pg_temp.limpa(L);

  -- ===== A. encaixe desligado: tudo igual ao que era =====
  f := pg_temp.ag(L, cM, P, -20, 120); aA := pg_temp.ag(L, cA, P, 120, 30);
  j := pg_temp.liberar(L, tel, f);
  insert into r (caso, ok, veio) values ('A1 desligado: liberar responde como antes (com "vaga", sem "encaixe")', j ? 'vaga' and not j ? 'encaixe' and j->>'status' = 'faltou', j::text);
  select id into v from vagas where agendamento_id = f and motivo = 'atraso';
  insert into r (caso, ok, veio) values ('A2 desligado: a vaga fica aberta', (select status from vagas where id = v) = 'aberta', coalesce(v::text, 'sem vaga'));
  insert into r (caso, ok, veio) values ('A3 desligado: nenhum encaixe gravado', not exists (select 1 from encaixes where empresa_id = L), '');
  -- a rotina antiga ofereceria essa vaga sozinha; a v2 não
  select count(*) into n from n8n_vagas_para_oferecer(L) x where x.vaga_id = v;
  insert into r (caso, ok, veio) values ('A4 rotina antiga oferece a vaga de falta sozinha', n = 1, n::text);
  update vagas set status = 'aberta' where id = v;
  select count(*) into n from n8n_vagas_para_oferecer_v2(L) x where x.vaga_id = v;
  insert into r (caso, ok, veio) values ('A5 rotina v2 NÃO oferece a vaga de falta', n = 0, n::text);
  j := pg_temp.status(L, tel, aA, 'faltou');
  insert into r (caso, ok, veio) values ('A6 desligado: status faltou sem "encaixe"', not j ? 'encaixe' and j->>'status' = 'faltou', j::text);

  -- ===== B. ligado: o caminho inteiro =====
  update empresas set config = config || liga where id = L;
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120); aA := pg_temp.ag(L, cA, P, 60, 60); aB := pg_temp.ag(L, cB, P, 180, 60);
  hA := encaixe_hora(now() + interval '60 minutes');
  j := pg_temp.liberar(L, tel, f);
  insert into r (caso, ok, veio) values ('B1 liberar: falta gravada, sem o texto antigo da vaga, com a pergunta',
    j->>'status' = 'faltou' and not j ? 'vaga' and (j->'encaixe'->>'perguntar')::boolean and (j->'encaixe'->>'agendamento_id')::uuid = aA, j::text);
  insert into r (caso, ok, veio) values ('B2 pergunta natural, com o nome e a hora',
    j->'encaixe'->>'pergunta' = 'Quer que eu veja com a Ana (das ' || hA || ') se ela consegue vir antes?', j->'encaixe'->>'pergunta');
  insert into r (caso, ok, veio) values ('B3 a vaga da falta sai da rotina automática (expirada)',
    not exists (select 1 from vagas where agendamento_id = f and status = 'aberta'), (select string_agg(status, ',') from vagas where agendamento_id = f));
  insert into r (caso, ok, veio) values ('B4 encaixe gravado como perguntado, para a Ana',
    (select count(*) from encaixes where empresa_id = L and status = 'perguntado' and agendamento_id = aA and falta_agendamento_id = f) = 1, '');
  t := n8n_encaixe_pendente_texto(L);
  insert into r (caso, ok, veio) values ('B5 a pergunta pendente entra no prompt (nome, id, falta de quem)', t like '%Ana%' and t like '%' || aA || '%' and t like '%falta de Maria%', t);
  j := pg_temp.status(L, tel, f, 'faltou');
  insert into r (caso, ok, veio) values ('B6 gravar a mesma falta de novo repete a MESMA pergunta, sem duplicar',
    (j->'encaixe'->>'perguntar')::boolean and (select count(*) from encaixes where empresa_id = L) = 1, j::text);
  insert into r (caso, ok, veio) values ('B7 antes da Gleide autorizar, a cliente não tem oferta', n8n_encaixe_da_cliente(L, cA) is null, '');
  -- só com a autorização certa
  j := pg_temp.chamar(L, '5599999999999', aA, 'Ana');
  insert into r (caso, ok, veio) values ('B8 número não autorizado', coalesce(j->>'erro', '') like '%não autorizado%', j::text);
  j := pg_temp.chamar(L, tel, aA, 'Bia');
  insert into r (caso, ok, veio) values ('B9 nome de outra cliente: recusa', coalesce(j->>'erro', '') like '%é sobre Ana%', j::text);
  j := pg_temp.chamar(L, tel, aB, 'Ana');
  insert into r (caso, ok, veio) values ('B10 horário de outra cliente: recusa', coalesce(j->>'erro', '') like '%não sobre esse horário%', j::text);
  j := pg_temp.chamar(L, tel, aA, '');
  insert into r (caso, ok, veio) values ('B11 sem nome: recusa', j ? 'erro', j::text);
  insert into r (caso, ok, veio) values ('B12 nenhuma mensagem gerada até aqui', not exists (select 1 from contatos where cliente_id in (cA, cB)), '');
  j := pg_temp.chamar(L, tel, aA, 'ana');
  msg := 'Oi, Ana! Abriu um horário hoje mais cedo aqui no salão. Se for bom pra você vir antes das ' || hA ||
    ', me fala que horas você consegue chegar. Se não der, tudo certo: seu horário das ' || hA || ' continua garantido 💛';
  insert into r (caso, ok, veio) values ('B13 autorizou: devolve telefone e a mensagem pronta', j->>'telefone' = '5500000067002' and j->>'mensagem' = msg, j::text);
  ct := (j->>'contato_id')::uuid;
  insert into r (caso, ok, veio) values ('B14 contato tipo vaga, pendente, no horário dela',
    exists (select 1 from contatos where id = ct and tipo = 'vaga' and canal = 'ia' and resultado = 'pendente' and agendamento_id = aA and cliente_id = cA), '');
  insert into r (caso, ok, veio) values ('B15 encaixe autorizado', (select status from encaixes where falta_agendamento_id = f) = 'autorizado', '');
  j := pg_temp.chamar(L, tel, aA, 'Ana');
  insert into r (caso, ok, veio) values ('B16 chamar de novo: recusa (uma mensagem só)',
    j ? 'erro' and (select count(*) from contatos where cliente_id = cA and tipo = 'vaga') = 1, j::text);
  j := n8n_encaixe_registrar_saida(L, '5500000067002', msg, 'ia', 'texto', 'wa-teste-067-1');
  insert into r (caso, ok, veio) values ('B17 mensagem saiu: grava na conversa e marca oferecido',
    (select status from encaixes where falta_agendamento_id = f) = 'oferecido' and exists (select 1 from mensagens where wa_message_id = 'wa-teste-067-1' and cliente_id = cA), j::text);
  j := n8n_encaixe_da_cliente(L, cA);
  insert into r (caso, ok, veio) values ('B18 a ficha da Ana enxerga a oferta', (j->>'agendamento_id')::uuid = aA and j->>'mensagem' = msg and (j->>'janela_inicio')::timestamptz = now() - interval '20 minutes', j::text);
  insert into r (caso, ok, veio) values ('B19 a Bia (a seguinte) não tem oferta nenhuma', n8n_encaixe_da_cliente(L, cB) is null and not exists (select 1 from contatos where cliente_id = cB), '');
  insert into r (caso, ok, veio) values ('B20 nada mais esperando a Gleide', n8n_encaixe_pendente_texto(L) = '(nenhuma)', n8n_encaixe_pendente_texto(L));
  j := pg_temp.status(L, tel, f, 'faltou');
  insert into r (caso, ok, veio) values ('B21 mesma falta de novo: não pergunta outra vez nem passa para a Bia',
    not (j->'encaixe'->>'perguntar')::boolean and (select count(*) from encaixes where empresa_id = L) = 1, j::text);
  -- outra falta no mesmo dia: a mais próxima é a Ana, que já recebeu oferta hoje
  f2 := pg_temp.ag(L, cO, P, -10, 60);
  j := pg_temp.liberar(L, tel, f2);
  insert into r (caso, ok, veio) values ('B22 1 oferta por cliente por dia (e não pula para a Bia)',
    not (j->'encaixe'->>'perguntar')::boolean and j->'encaixe'->>'motivo' like '%já recebeu%' and (select count(*) from encaixes where empresa_id = L) = 1, j::text);
  -- a cliente aceitou: a IA remarca o horário dela para mais cedo
  update agendamentos set inicio = now() + interval '20 minutes', fim = now() + interval '80 minutes' where id = aA;
  perform encaixe_fechar_vencidos(L);
  insert into r (caso, ok, veio) values ('B23 aceitou: encaixe aceito com o horário novo',
    (select status = 'aceito' and novo_horario = now() + interval '20 minutes' from encaixes where falta_agendamento_id = f), (select status from encaixes where falta_agendamento_id = f));
  insert into r (caso, ok, veio) values ('B24 a Gleide recebe o aviso "adiantou" que já existia',
    exists (select 1 from n8n_avisos_para_gleide(L) x where x.contato_id = ct and x.tipo = 'vaga' and x.situacao = 'remarcou'),
    (select resultado from contatos where id = ct));
  insert into r (caso, ok, veio) values ('B25 depois de aceitar, a ficha não mostra mais a oferta', n8n_encaixe_da_cliente(L, cA) is null, '');

  -- ===== C. a Gleide disse que não =====
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120); aA := pg_temp.ag(L, cA, P, 60, 60); aB := pg_temp.ag(L, cB, P, 180, 60);
  j := pg_temp.status(L, tel, f, 'faltou');
  insert into r (caso, ok, veio) values ('C1 falta pelo status_atendimento também traz a pergunta', (j->'encaixe'->>'perguntar')::boolean and j->>'status' = 'faltou', j::text);
  select count(*) into n from contatos where cliente_id in (cA, cB);
  j := pg_temp.chamar(L, tel, aA, 'Ana', true);
  insert into r (caso, ok, veio) values ('C2 "não": ninguém é chamado',
    (j->>'chamou')::boolean is false and (select status from encaixes where falta_agendamento_id = f) = 'nao_autorizado'
    and (select count(*) from contatos where cliente_id in (cA, cB)) = n, j::text);
  j := pg_temp.chamar(L, tel, aA, 'Ana');
  insert into r (caso, ok, veio) values ('C3 depois do "não", um "pode" solto não chama ninguém', j ? 'erro', j::text);
  j := pg_temp.status(L, tel, f, 'faltou');
  insert into r (caso, ok, veio) values ('C4 depois do "não", não pergunta de novo', not (j->'encaixe'->>'perguntar')::boolean, j::text);

  -- ===== D. quem pode ser chamada =====
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120, 'faltou'); aA := pg_temp.ag(L, cA, P, 20, 60);
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D1 folga mínima: horário dela a menos de 30 min', not (j->>'ok')::boolean and j->>'motivo' like '%perto demais%', j::text);
  update empresas set config = jsonb_set(config, '{encaixe,folga_min}', '15') where id = L;
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D2 folga configurável (15 min): aí pode', (j->>'ok')::boolean, j::text);
  update empresas set config = config || liga where id = L;

  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120, 'faltou'); aA := pg_temp.ag(L, cA, P, 60, 60); aB := pg_temp.ag(L, cB, P, 180, 60);
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D3 a mais próxima depois da vaga (Ana, não a Bia)', (j->>'ok')::boolean and (j->>'agendamento_id')::uuid = aA, j::text);
  update clientes set ia_pausada_ate = now() + interval '1 hour' where id = cA;
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D4 IA pausada para a mais próxima: ninguém (não pula para a Bia)', not (j->>'ok')::boolean and j->>'motivo' like '%pausada%', j::text);
  update clientes set ia_pausada_ate = null where id = cA;
  update agendamentos set chegou_em = now() where id = aA;
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D5 a mais próxima já chegou: ninguém', not (j->>'ok')::boolean and j->>'motivo' like '%já chegou%', j::text);
  update agendamentos set chegou_em = null where id = aA;
  update empresas set config = jsonb_set(config, '{encaixe,so_para}', '["5500000067003"]') where id = L;
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D6 so_para (teste): a mais próxima fora da lista não é chamada', not (j->>'ok')::boolean and j->>'motivo' like '%teste%', j::text);
  update empresas set config = jsonb_set(config, '{encaixe,so_para}', '["5500000067002"]') where id = L;
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D7 so_para com o número dela: pode', (j->>'ok')::boolean, j::text);
  update empresas set config = config || liga where id = L;
  -- não cabe: almoço cobrindo de agora até depois do horário dela
  update empresas set config = config || jsonb_build_object('almoco', jsonb_build_object(
    'inicio', to_char((now() - interval '30 minutes') at time zone 'America/Cuiaba', 'HH24:MI'),
    'fim', to_char((now() + interval '170 minutes') at time zone 'America/Cuiaba', 'HH24:MI'))) where id = L;
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D8 não cabe antes do horário dela (almoço): ninguém', not (j->>'ok')::boolean and j->>'motivo' like '%não cabe%', j::text);
  update empresas set config = config || jsonb_build_object('almoco', null) where id = L;
  -- outra profissional: o horário mais próximo é de outra agenda
  update agendamentos set profissional_id = P2 where id in (aA, aB);
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D9 horário de outra profissional não conta', not (j->>'ok')::boolean and j->>'motivo' like '%não tem outra cliente%', j::text);

  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -120, 60, 'faltou'); aA := pg_temp.ag(L, cA, P, 60, 60);
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D10 o horário de quem faltou já terminou: ninguém', not (j->>'ok')::boolean and j->>'motivo' like '%já terminou%', j::text);
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -24 * 60 - 20, 24 * 60 + 100, 'faltou'); aA := pg_temp.ag(L, cA, P, 60, 60);
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D11 falta de outro dia: ninguém', not (j->>'ok')::boolean and j->>'motivo' like '%não é de hoje%', j::text);
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120); aA := pg_temp.ag(L, cA, P, 60, 60);
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D12 horário que não é falta: ninguém', not (j->>'ok')::boolean and j->>'motivo' like '%não está como falta%', j::text);
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120, 'faltou'); aA := pg_temp.ag(L, cM, P, 60, 60);
  j := encaixe_candidata(L, f);
  insert into r (caso, ok, veio) values ('D13 o próximo horário é da mesma cliente que faltou: ninguém', not (j->>'ok')::boolean and j->>'motivo' like '%mesma cliente%', j::text);

  -- ===== E. uma pergunta pendente por vez =====
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 60); aA := pg_temp.ag(L, cA, P, 60, 30);
  f2 := pg_temp.ag(L, cO, P, 90, 30); aD := pg_temp.ag(L, cD, P, 150, 30);
  j := pg_temp.liberar(L, tel, f);
  insert into r (caso, ok, veio) values ('E1 primeira falta: pergunta sobre a Ana', (j->'encaixe'->>'agendamento_id')::uuid = aA, j::text);
  j := pg_temp.status(L, tel, f2, 'faltou');
  insert into r (caso, ok, veio) values ('E2 segunda falta com a primeira pergunta sem resposta: não faz outra pergunta',
    not (j->'encaixe'->>'perguntar')::boolean and j->'encaixe'->>'motivo' like 'já tem uma pergunta%' and (select count(*) from encaixes where empresa_id = L) = 1, j::text);

  -- ===== F. o que vence sozinho =====
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120); aA := pg_temp.ag(L, cA, P, 60, 60);
  j := pg_temp.liberar(L, tel, f);
  update agendamentos set chegou_em = now() where id = aA;
  t := n8n_encaixe_pendente_texto(L);
  insert into r (caso, ok, veio) values ('F1 a cliente chegou antes da Gleide responder: a pergunta vence',
    t = '(nenhuma)' and (select status from encaixes where falta_agendamento_id = f) = 'expirado', t);
  j := pg_temp.chamar(L, tel, aA, 'Ana');
  insert into r (caso, ok, veio) values ('F2 "pode" depois de vencer: ninguém é chamado', j ? 'erro' and not exists (select 1 from contatos where agendamento_id = aA), j::text);

  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120); aA := pg_temp.ag(L, cA, P, 60, 60); aB := pg_temp.ag(L, cB, P, 180, 60);
  j := pg_temp.liberar(L, tel, f);
  j := pg_temp.chamar(L, tel, aA, 'Ana');
  perform n8n_encaixe_registrar_saida(L, '5500000067002', j->>'mensagem', 'ia', 'texto', 'wa-teste-067-2');
  update agendamentos set status = 'realizado' where id = aA;   -- ela veio no horário dela, sem responder
  perform encaixe_fechar_vencidos(L);
  insert into r (caso, ok, veio) values ('F3 não respondeu e veio no horário dela: sem_resposta, e a Bia nunca foi chamada',
    (select status from encaixes where falta_agendamento_id = f) = 'sem_resposta' and not exists (select 1 from contatos where cliente_id = cB)
    and n8n_encaixe_pendente_texto(L) = '(nenhuma)', (select status from encaixes where falta_agendamento_id = f));

  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120); aD := pg_temp.ag(L, cD, P, 60, 60);
  j := pg_temp.liberar(L, tel, f);
  j := pg_temp.chamar(L, tel, aD, 'Dora');
  perform n8n_encaixe_registrar_saida(L, '5500000067005', j->>'mensagem', 'ia', 'texto', 'wa-teste-067-3');
  insert into mensagens (empresa_id, cliente_id, direcao, autor, tipo, conteudo) values (L, cD, 'entrada', 'cliente', 'texto', 'não consigo, obrigada');
  insert into r (caso, ok, veio) values ('F4 ela disse não: o horário dela não mudou e a oferta continua só na ficha dela',
    (select inicio = now() + interval '60 minutes' and status = 'agendado' from agendamentos where id = aD) and n8n_encaixe_da_cliente(L, cD) is not null, '');
  update agendamentos set status = 'realizado' where id = aD;
  perform encaixe_fechar_vencidos(L);
  insert into r (caso, ok, veio) values ('F5 respondeu e não adiantou: recusado', (select status from encaixes where falta_agendamento_id = f) = 'recusado', (select status from encaixes where falta_agendamento_id = f));

  -- o WhatsApp não enviou: o n8n apaga o contato e a Gleide pode pedir de novo
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120); aB := pg_temp.ag(L, cB, P, 60, 60);
  j := pg_temp.liberar(L, tel, f);
  j := pg_temp.chamar(L, tel, aB, 'Bia');
  delete from contatos where id = (j->>'contato_id')::uuid;
  insert into r (caso, ok, veio) values ('F6 envio falhou: a cliente não tem oferta na ficha', n8n_encaixe_da_cliente(L, cB) is null, '');
  t := n8n_encaixe_pendente_texto(L);
  insert into r (caso, ok, veio) values ('F7 envio falhou: o prompt da assistente sabe', t like '%não enviou%', t);
  j := pg_temp.chamar(L, tel, aB, 'Bia');
  insert into r (caso, ok, veio) values ('F8 envio falhou: tentar de novo funciona, sem duplicar o encaixe',
    j ? 'mensagem' and (select count(*) from encaixes where empresa_id = L) = 1 and (select count(*) from contatos where cliente_id = cB and tipo = 'vaga') = 1, j::text);

  -- ===== G. o resto não muda =====
  perform pg_temp.limpa(L);
  f := pg_temp.ag(L, cM, P, -20, 120); aA := pg_temp.ag(L, cA, P, 60, 60);
  j := pg_temp.status(L, tel, f, 'realizado');
  insert into r (caso, ok, veio) values ('G1 status realizado não fala de encaixe', not j ? 'encaixe' and j->>'status' = 'realizado', j::text);
  j := pg_temp.liberar(L, tel, f);
  insert into r (caso, ok, veio) values ('G2 liberar horário que não está em aberto continua dando o erro de sempre', coalesce(j->>'erro', '') like '%não está mais em aberto%', j::text);
  j := pg_temp.liberar(L, tel, gen_random_uuid());
  insert into r (caso, ok, veio) values ('G3 horário que não existe: erro de sempre', coalesce(j->>'erro', '') like '%não encontrado%', j::text);
  insert into r (caso, ok, veio) values ('G4 hora como se fala', encaixe_hora('2026-11-21 15:00-04') = '15h' and encaixe_hora('2026-11-21 09:30-04') = '9h30', encaixe_hora('2026-11-21 09:30-04'));
  -- ninguém de fora (anon, authenticated) chega nas funções nem na tabela
  insert into r (caso, ok, veio) values ('G5 permissões',
    not has_function_privilege('anon', 'n8n_assistente_chamar_para_encaixe(uuid,text,uuid,text,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'n8n_assistente_liberar_horario_encaixe(uuid,text,uuid)', 'execute')
    and not has_function_privilege('anon', 'n8n_encaixe_da_cliente(uuid,uuid)', 'execute')
    and not has_function_privilege('authenticated', 'encaixe_candidata(uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'n8n_vagas_para_oferecer_v2(uuid)', 'execute')
    and has_function_privilege('service_role', 'n8n_assistente_chamar_para_encaixe(uuid,text,uuid,text,boolean)', 'execute')
    and not has_table_privilege('anon', 'encaixes', 'select') and not has_table_privilege('authenticated', 'encaixes', 'insert'), '');
end $$;

select json_agg(r order by n) from r;
