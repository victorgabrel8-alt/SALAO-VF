-- =====================================================================
-- 049 - Mesmo número com e sem o 9 é a mesma cliente (pedido do Victor, 18/11/2026)
--
-- Caso: Maria Cecilia (Caroline, DDD 93). A assistente cadastrou a cliente com o 9 e, no mesmo minuto, marcou o
-- horário num SEGUNDO cadastro sem o 9. A resposta dela ao lembrete caiu no cadastro com o 9, a IA não achou o
-- horário e disse que não havia nada marcado. Causa: n8n_assistente_marcar_horario (v1 e v2) e _c procuravam a
-- cliente pelo número exato; n8n_assistente_cadastrar_cliente já tratava as duas formas.
--
-- O que muda:
--   - função nova telefone_com9(text): celular brasileiro de 12 dígitos (55 + DDD + 8 dígitos começando em 6-9)
--     ganha o 9; o resto volta igual;
--   - marcar_horario (v1 e v2): guarda o número com o 9 e acha a cliente nas duas formas (prefere a com o 9);
--   - marcar_horario_c: acha a cliente nas duas formas;
--   - dados: cadastros sem o 9 que NÃO têm par com o 9 passam para a forma com o 9 (é a que chega do WhatsApp).
-- As funções são trocadas por substituição de texto, com conferência: se o texto antigo não estiver lá, nada muda.
-- =====================================================================

create or replace function public.telefone_com9(p text) returns text
language sql immutable set search_path = public as $$
  select case when p ~ '^55[0-9]{2}[6-9][0-9]{7}$' then left(p, 4) || '9' || substr(p, 5) else p end
$$;

do $mig$
declare
  f record; def text; novo text;
  busca_v text := 'select * into v_cliente from clientes where empresa_id = p_empresa_id and telefone = v_tel;';
  busca_v_novo text := 'v_tel := telefone_com9(v_tel);' || chr(10) ||
    '    select * into v_cliente from clientes where empresa_id = p_empresa_id' || chr(10) ||
    '       and telefone in (v_tel, regexp_replace(v_tel, ''^(55[0-9]{2})9([0-9]{8})$'', ''\1\2''))' || chr(10) ||
    '     order by telefone = v_tel desc limit 1; -- 049: com e sem o 9';
  busca_c text := 'select id into v_cli from clientes where empresa_id = p_empresa_id and telefone = v_tel;';
  busca_c_novo text := 'v_tel := telefone_com9(v_tel);' || chr(10) ||
    '    select id into v_cli from clientes where empresa_id = p_empresa_id' || chr(10) ||
    '       and telefone in (v_tel, regexp_replace(v_tel, ''^(55[0-9]{2})9([0-9]{8})$'', ''\1\2''))' || chr(10) ||
    '     order by telefone = v_tel desc limit 1; -- 049: com e sem o 9';
begin
  for f in select p.oid, p.proname from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('n8n_assistente_marcar_horario', 'n8n_assistente_marcar_horario_v2', 'n8n_assistente_marcar_horario_c') loop
    def := pg_get_functiondef(f.oid);
    if position('-- 049: com e sem o 9' in def) > 0 then continue; end if;   -- já aplicado
    if f.proname = 'n8n_assistente_marcar_horario_c' then
      if position(busca_c in def) = 0 then raise exception '049: texto de busca mudou em %', f.proname; end if;
      novo := replace(def, busca_c, busca_c_novo);
    else
      if position(busca_v in def) = 0 then raise exception '049: texto de busca mudou em %', f.proname; end if;
      novo := replace(def, busca_v, busca_v_novo);
    end if;
    execute novo;
  end loop;
end $mig$;

-- cadastros sem o 9 e sem par com o 9: passam para a forma com o 9
update clientes c set telefone = telefone_com9(c.telefone)
 where c.telefone ~ '^55[0-9]{2}[6-9][0-9]{7}$'
   and not exists (select 1 from clientes d where d.empresa_id = c.empresa_id and d.telefone = telefone_com9(c.telefone));
