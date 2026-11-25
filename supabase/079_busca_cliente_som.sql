-- 079: busca de cliente da assistente tolerante a nome falado no áudio (24/11/2026: a Caroline disse "Jaque" e a
-- assistente achou só a Jaqueline Venson; a cliente atendida era a Jackelined Ana).
-- Só soma: uma função de som nova e a v3 da busca. A v2 (usada pela Gleide) não muda; a Caroline e a Loja Teste passam
-- a chamar a v3 (n8n/demo-agente/assistente-oferecer.js).
-- O que muda na v3:
--   1. o som junta "qu" e "c" antes de e/i ("jaque" = "jace", "jackelined" = "jacelinet"), como a trava de nome do n8n;
--   2. a busca de um nome só devolve também as clientes de som parecido (mesma primeira letra), marcadas com
--      nome_aproximado, em vez de só o melhor nível. Assim a assistente vê as duas e pergunta "Qual Jaque?".

create or replace function public.assistente_som_v2(p text)
returns text
language sql
stable
set search_path to 'public'
as $$
  select regexp_replace(assistente_som(p), 'cu([ei])', 'c\1', 'g')
$$;

create or replace function public.n8n_assistente_buscar_cliente_v3(p_empresa_id uuid, p_pedido_por text, p_busca text)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_norm text := assistente_normalizar(p_busca);
  v_dig text := regexp_replace(coalesce(p_busca, ''), '\D', '', 'g');
  v_palavras text[];
begin
  if not assistente_autorizado(p_empresa_id, p_pedido_por) then raise exception 'número % não autorizado', p_pedido_por; end if;
  select coalesce(array_agg(t), '{}') into v_palavras
    from unnest(regexp_split_to_array(v_norm, '[^a-z0-9]+')) t
   where length(t) >= 2 and t not in ('de', 'da', 'do', 'das', 'dos', 'dona', 'cliente');

  return (
    with base as (
      select c.id,
        case
          when assistente_normalizar(c.nome) like '%' || v_norm || '%' then 1
          when v_dig <> '' and c.telefone like '%' || v_dig || '%' then 1
          when cardinality(v_palavras) > 0 and not exists (
                 select 1 from unnest(v_palavras) t where not exists (
                   select 1 from unnest(regexp_split_to_array(assistente_normalizar(c.nome), '[^a-z0-9]+')) w
                    where w like t || '%')) then 2
          when cardinality(v_palavras) > 0 and not exists (
                 select 1 from unnest(v_palavras) t where not exists (
                   select 1 from unnest(regexp_split_to_array(assistente_normalizar(c.nome), '[^a-z0-9]+')) w
                    where length(w) >= 2
                      and (assistente_som_v2(w) like assistente_som_v2(t) || '%'
                           or (length(assistente_som_v2(t)) >= 5
                               and extensions.levenshtein(assistente_som_v2(w), assistente_som_v2(t)) <= 1)))) then 3
        end as nivel,
        left(assistente_normalizar(c.nome), 1) as letra
      from clientes_status c
      where c.empresa_id = p_empresa_id
    ), melhor as (select min(nivel) as n from base)
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select c.id as cliente_id, c.nome, c.telefone, c.status, f.etapa, c.ultima_visita, c.proximo_agendamento,
             f.pre_resumo, f.pre_tecnica_interesse, f.valor_orcado, f.data_proximo_passo, c.observacoes, c.aniversario, c.ia_pausada,
             (select jsonb_agg(jsonb_build_object('agendamento_id', a.id, 'quando', assistente_quando(a.inicio), 'servico', s.nome)
                               order by a.inicio)
                from agendamentos a left join servicos s on s.id = a.servico_id
               where a.cliente_id = c.id and a.status = 'agendado'
                 and (a.inicio at time zone 'America/Cuiaba')::date >= hoje_cuiaba()) as horarios_marcados,
             (b.nivel = 3) as nome_aproximado
        from clientes_status c
        join funil_clientes f on f.cliente_id = c.id
        join base b on b.id = c.id
        join melhor m on b.nivel = m.n
                      -- nome de uma palavra só ("Jaque"): as de som parecido vêm junto, com a mesma primeira letra
                      or (b.nivel = 3 and m.n < 3 and cardinality(v_palavras) = 1 and b.letra = left(v_norm, 1))
       where c.empresa_id = p_empresa_id
       order by b.nivel, c.ultima_mensagem desc nulls last limit 8) x);
end $function$;

grant execute on function public.assistente_som_v2(text) to service_role;
grant execute on function public.n8n_assistente_buscar_cliente_v3(uuid, text, text) to service_role;
