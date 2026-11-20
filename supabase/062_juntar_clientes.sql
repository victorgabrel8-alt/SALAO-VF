-- 062: juntar cadastros repetidos da mesma cliente (o mesmo número com e sem o 9).
-- Problema (relatório da IA, "Cliente com dois cadastros"): a mesma cliente aparece duas vezes na loja, uma com o
-- número 55 + DDD + 9 + 8 dígitos e outra sem o 9 (às vezes com nomes diferentes). A IA acha um cadastro e o
-- horário ou a conversa estão no outro.
-- Regra: é dado de cliente, o sistema NÃO junta sozinho. A dona confere cada par no app (Configurações >
-- Cadastros repetidos) e toca em "Juntar".
--
--   clientes_duplicadas(empresa): os pares da loja (mesmo número tirando o 9 depois do DDD), com nome, telefone,
--     horários, mensagens, última mensagem e último horário de cada lado. Lê com o login de quem chama
--     (security invoker): o RLS de clientes, agendamentos e mensagens já deixa só a loja da pessoa.
--   juntar_clientes(empresa, fica, sai): só a dona da loja (usuarios_empresa.papel = 'dona'). Numa transação:
--     1. confere que as duas são da loja e que os números batem sem o 9;
--     2. se as duas têm avaliação em aberto (pendente/pensando), não junta: só pode haver uma aberta por cliente
--        e o sistema não escolhe qual fecha;
--     3. passa TUDO que aponta para a que sai para a que fica: toda coluna com chave estrangeira para clientes,
--        lida do próprio banco (agendamentos, mensagens, contatos, avaliacoes, registros_ia, retomadas,
--        retornos_combinados, ia_mudancas_agenda, ligacoes, vouchers e o que vier depois). Nenhuma dessas tem
--        chave única com cliente_id além da avaliação aberta (passo 2); wa_message_id e o código do voucher
--        não mudam;
--     4. junta os dados: nome (o da que fica; vazio = o da que sai), observações das duas (sem perder texto) +
--        uma linha "Cadastro juntado em ...: veio de <nome> (<telefone>)", etiquetas das duas ("excluída" e a
--        origem valem as da que fica; a origem da que sai só entra se a que fica não tem), aniversário e
--        profissional preferida (o que estiver preenchido), a pausa da IA que vai mais longe e o resumo da IA mais
--        novo;
--     5. APAGA a linha da que sai. Nada mais aponta para ela (passo 3), então o "on delete cascade" não leva nada.
--        Por que apagar e não marcar: o telefone é único por loja e só aceita número de verdade; para a que fica
--        ter o número com o 9, a que sai precisa largar o número. Uma cliente marcada com o número ainda lá
--        continuaria aparecendo para a IA na busca com e sem o 9 (049), que é o problema que se quer resolver.
--        O que ela tinha fica na observação da que fica e volta inteiro na resposta da função;
--     6. a que fica termina com o número COM o 9 (é o que chega do WhatsApp, ver 049).
-- Só soma: duas funções novas; nenhuma tabela muda. Nada da Gleide muda, a não ser que a Gleide use a tela.

create or replace function clientes_duplicadas(p_empresa_id uuid)
returns table (
  com9_id uuid, com9_nome text, com9_telefone text, com9_horarios integer, com9_mensagens integer,
  com9_ultima_mensagem timestamptz, com9_ultimo_horario timestamptz, com9_excluida boolean,
  sem9_id uuid, sem9_nome text, sem9_telefone text, sem9_horarios integer, sem9_mensagens integer,
  sem9_ultima_mensagem timestamptz, sem9_ultimo_horario timestamptz, sem9_excluida boolean
)
language sql stable security invoker set search_path = public as $$
  select a.id, a.nome, a.telefone, ha.n, ma.n, ma.ultima, ha.ultimo, 'sistema:excluida' = any (a.etiquetas),
         b.id, b.nome, b.telefone, hb.n, mb.n, mb.ultima, hb.ultimo, 'sistema:excluida' = any (b.etiquetas)
    from clientes a
    join clientes b
      on b.empresa_id = a.empresa_id
     and b.telefone ~ '^55[0-9]{2}[6-9][0-9]{7}$'
     and a.telefone = left(b.telefone, 4) || '9' || substr(b.telefone, 5)
    cross join lateral (select count(*)::int n, max(g.inicio) ultimo from agendamentos g where g.cliente_id = a.id) ha
    cross join lateral (select count(*)::int n, max(g.inicio) ultimo from agendamentos g where g.cliente_id = b.id) hb
    cross join lateral (select count(*)::int n, max(m.criado_em) ultima from mensagens m where m.cliente_id = a.id) ma
    cross join lateral (select count(*)::int n, max(m.criado_em) ultima from mensagens m where m.cliente_id = b.id) mb
   where a.empresa_id = p_empresa_id
     and p_empresa_id in (select private.minhas_empresas())
   order by greatest(ma.ultima, mb.ultima, ha.ultimo, hb.ultimo) desc nulls last, a.telefone
$$;

create or replace function juntar_clientes(p_empresa_id uuid, p_fica uuid, p_sai uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f        clientes%rowtype;
  s        clientes%rowtype;
  v_tel9   text;
  r        record;
  v_n      integer;
  v_mov    jsonb := '{}'::jsonb;
  v_nota   text;
  v_obs    text;
  v_etq    text[];
begin
  if auth.uid() is null then
    raise exception 'É preciso entrar no app para juntar cadastros.';
  end if;
  if not exists (select 1 from public.usuarios_empresa u
                  where u.user_id = auth.uid() and u.empresa_id = p_empresa_id and u.papel = 'dona') then
    raise exception 'Só a dona do salão pode juntar cadastros.';
  end if;
  if p_fica is null or p_sai is null or p_fica = p_sai then
    raise exception 'Escolha dois cadastros diferentes.';
  end if;

  -- trava as duas linhas até o fim (ninguém grava nelas no meio da junção)
  select * into f from clientes where id = p_fica and empresa_id = p_empresa_id for update;
  if not found then raise exception 'Cadastro que fica não é deste salão.'; end if;
  select * into s from clientes where id = p_sai and empresa_id = p_empresa_id for update;
  if not found then raise exception 'Cadastro que sai não é deste salão.'; end if;

  -- mesmo número tirando o 9 depois do DDD: um tem o 9 e o outro não
  v_tel9 := case when f.telefone ~ '^55[0-9]{2}9[0-9]{8}$' and s.telefone = left(f.telefone, 4) || substr(f.telefone, 6)
                   and s.telefone ~ '^55[0-9]{2}[6-9][0-9]{7}$' then f.telefone
                 when s.telefone ~ '^55[0-9]{2}9[0-9]{8}$' and f.telefone = left(s.telefone, 4) || substr(s.telefone, 6)
                   and f.telefone ~ '^55[0-9]{2}[6-9][0-9]{7}$' then s.telefone
            end;
  if v_tel9 is null then
    raise exception 'Os telefones não são do mesmo número (com e sem o 9). Não juntei.';
  end if;

  -- só pode haver uma avaliação aberta por cliente (uq_aval_aberta): o sistema não escolhe qual fecha
  if to_regclass('public.avaliacoes') is not null
     and exists (select 1 from avaliacoes where cliente_id = p_fica and resultado in ('pendente', 'pensando'))
     and exists (select 1 from avaliacoes where cliente_id = p_sai and resultado in ('pendente', 'pensando')) then
    raise exception 'As duas têm avaliação em aberto. Resolva uma delas antes de juntar.';
  end if;

  -- passa tudo que aponta para a que sai (toda chave estrangeira para clientes, lida do banco)
  for r in
    select c.conrelid::regclass as tabela, a.attname as coluna
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.confrelid = 'public.clientes'::regclass and array_length(c.conkey, 1) = 1
     order by c.conrelid::regclass::text, a.attname
  loop
    execute format('update %s set %I = $1 where %I = $2', r.tabela, r.coluna, r.coluna) using p_fica, p_sai;
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_mov := v_mov || jsonb_build_object(r.tabela::text || '.' || r.coluna, v_n);
    end if;
  end loop;

  -- junta os dados (nada de texto se perde)
  v_nota := format('Cadastro juntado em %s: veio de %s (%s).',
                   to_char(now() at time zone 'America/Cuiaba', 'DD/MM/YYYY'),
                   coalesce(nullif(btrim(s.nome), ''), 'sem nome'), s.telefone);
  v_obs := concat_ws(E'\n',
                     nullif(btrim(f.observacoes), ''),
                     case when nullif(btrim(s.observacoes), '') is not null
                           and btrim(s.observacoes) is distinct from btrim(f.observacoes) then btrim(s.observacoes) end,
                     v_nota);
  -- etiquetas das duas; "excluída" e origem valem as da que fica (a origem da que sai só entra se a que fica não tem)
  select coalesce(array_agg(e order by o), '{}') into v_etq
    from (select e, min(o) o
            from unnest(f.etiquetas || array(
                   select x from unnest(s.etiquetas) x
                    where x <> 'sistema:excluida'
                      and not (x like 'origem:%' and exists (select 1 from unnest(f.etiquetas) y where y like 'origem:%'))))
                 with ordinality t(e, o)
           group by e) x;

  -- a que sai larga o número (e mais nada aponta para ela): apaga
  delete from clientes where id = p_sai;

  update clientes
     set telefone                  = v_tel9,
         nome                      = coalesce(nullif(btrim(f.nome), ''), nullif(btrim(s.nome), '')),
         observacoes               = v_obs,
         etiquetas                 = v_etq,
         aniversario               = coalesce(f.aniversario, s.aniversario),
         profissional_preferida_id = coalesce(f.profissional_preferida_id, s.profissional_preferida_id),
         ia_pausada_ate            = case when s.ia_pausada_ate > coalesce(f.ia_pausada_ate, '-infinity') then s.ia_pausada_ate else f.ia_pausada_ate end,
         motivo_pausa              = case when s.ia_pausada_ate > coalesce(f.ia_pausada_ate, '-infinity') then s.motivo_pausa else f.motivo_pausa end,
         resumo_ia                 = case when f.resumo_ia is null or s.resumo_ia_em > coalesce(f.resumo_ia_em, '-infinity')
                                          then coalesce(s.resumo_ia, f.resumo_ia) else f.resumo_ia end,
         resumo_ia_em              = case when f.resumo_ia is null or s.resumo_ia_em > coalesce(f.resumo_ia_em, '-infinity')
                                          then coalesce(s.resumo_ia_em, f.resumo_ia_em) else f.resumo_ia_em end
   where id = p_fica;

  return jsonb_build_object('ok', true, 'fica', p_fica, 'telefone', v_tel9, 'movidos', v_mov, 'saiu', to_jsonb(s));
end $$;

revoke all on function clientes_duplicadas(uuid) from public;
revoke all on function juntar_clientes(uuid, uuid, uuid) from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function clientes_duplicadas(uuid) from anon';
    execute 'revoke all on function juntar_clientes(uuid, uuid, uuid) from anon';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function clientes_duplicadas(uuid) to authenticated';
    execute 'grant execute on function juntar_clientes(uuid, uuid, uuid) to authenticated';
  end if;
end $$;
