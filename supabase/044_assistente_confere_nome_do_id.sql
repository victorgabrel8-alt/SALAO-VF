-- 044: a assistente não grava nem manda mensagem para a cliente errada.
--
-- No teste de 12/11/2026 a IA gravou o resultado da avaliação da "Elisangela" com o cliente_id de outra cliente
-- (pegou um id que estava na conversa, sem procurar). As ferramentas agora recebem também o nome que a dona falou
-- (cliente_nome) e o fluxo chama esta função antes de gravar ou enviar: se o id é de outra pessoa, nada é feito
-- e a IA recebe o nome de quem é o id, para procurar a cliente certa.
--
-- Compara pelo som, como a busca do 043: basta UMA palavra do nome falado bater com uma palavra do cadastro.
-- Sem nome falado, id que não existe ou cliente sem nome no cadastro: devolve 'ok' (a função de verdade é quem reclama).
-- Função nova, só leitura. Só mudança que soma.

create or replace function n8n_assistente_conferir_nome(p_empresa_id uuid, p_cliente_id uuid, p_agendamento_id uuid, p_nome text)
returns text language plpgsql stable set search_path = public as $$
declare v_nome text; v_id uuid := p_cliente_id;
begin
  if coalesce(trim(p_nome), '') = '' then return 'ok'; end if;
  if v_id is null and p_agendamento_id is not null then
    select cliente_id into v_id from agendamentos where id = p_agendamento_id and empresa_id = p_empresa_id;
  end if;
  if v_id is null then return 'ok'; end if;
  select nome into v_nome from clientes where id = v_id and empresa_id = p_empresa_id;
  if coalesce(trim(v_nome), '') = '' then return 'ok'; end if;
  if exists (
    select 1
      from unnest(regexp_split_to_array(assistente_normalizar(p_nome), '[^a-z0-9]+')) t,
           unnest(regexp_split_to_array(assistente_normalizar(v_nome), '[^a-z0-9]+')) w
     where length(t) >= 2 and length(w) >= 2
       and t not in ('de', 'da', 'do', 'das', 'dos', 'dona', 'cliente')
       and (assistente_som(w) like assistente_som(t) || '%'
            or assistente_som(t) like assistente_som(w) || '%'
            or (length(assistente_som(t)) >= 5 and extensions.levenshtein(assistente_som(w), assistente_som(t)) <= 1))
  ) then return 'ok'; end if;
  return format('esse id é da cliente "%s", não de "%s". Nada foi feito. Use buscar_cliente com o nome certo e chame de novo com o id dela.', v_nome, p_nome);
end $$;

revoke all on function n8n_assistente_conferir_nome(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function n8n_assistente_conferir_nome(uuid, uuid, uuid, text) to service_role;
