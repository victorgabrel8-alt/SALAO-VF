-- 043: a assistente acha a cliente mesmo com o nome escrito ou falado diferente do cadastro.
--
-- Antes (supabase/013) a busca só achava se o texto inteiro fosse um pedaço idêntico do nome:
-- "Roseli Sousa" não achava "Roseli de Souza" e o áudio "Leitiane" não achava "Leidyane" (12/11/2026).
-- Agora, em três níveis, e só desce de nível quando o de cima não achou ninguém:
--   1. como antes: pedaço do nome igual, ou pedaço do telefone
--   2. cada palavra da busca é o começo de alguma palavra do nome (ignora "de", "da", "dos"…), em qualquer ordem
--   3. cada palavra soa como alguma palavra do nome (s/z, i/y, d/t, c/k, letra dobrada, h mudo) ou difere em 1 letra;
--      nesse caso a linha vem com nome_aproximado = true, para a assistente dizer o nome que achou.
--
-- Função NOVA (v2): a antiga continua existindo para os fluxos que ainda a chamam. Só mudança que soma.

create extension if not exists fuzzystrmatch with schema extensions;

-- "Leidyane" e "Leitiane" viram "leitiane"; "Souza" e "Sousa" viram "sousa"
create or replace function assistente_som(p_texto text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
    translate(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        public.assistente_normalizar(p_texto),
        'ph', 'f', 'g'), 'ch|sh', 'x', 'g'), 'g([ei])', 'j\1', 'g'), 'c([ei])', 's\1', 'g'),
      'ywzkqdh', 'ivscct'),
    '(.)\1+', '\1', 'g')
$$;

create or replace function n8n_assistente_buscar_cliente_v2(p_empresa_id uuid, p_pedido_por text, p_busca text)
returns jsonb language plpgsql stable set search_path = public as $$
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
                      and (assistente_som(w) like assistente_som(t) || '%'
                           or (length(assistente_som(t)) >= 5
                               and extensions.levenshtein(assistente_som(w), assistente_som(t)) <= 1)))) then 3
        end as nivel
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
       where c.empresa_id = p_empresa_id
       order by c.ultima_mensagem desc nulls last limit 8) x);
end $$;

revoke all on function n8n_assistente_buscar_cliente_v2(uuid, text, text) from public, anon, authenticated;
grant execute on function n8n_assistente_buscar_cliente_v2(uuid, text, text) to service_role;
