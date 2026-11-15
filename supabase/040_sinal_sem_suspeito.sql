-- 040: o sinal por Pix não recusa mais comprovante só porque a leitura da foto achou "suspeito".
-- 12/11 (Giovana, Caroline): comprovante verdadeiro do Mercado Pago veio marcado como suspeito duas vezes e a IA
-- passou para a Caroline. Quem lê a imagem não distingue print normal de editado; valor, quem recebeu, data,
-- situação e código repetido continuam conferidos. A marca fica guardada em sinal_comprovante.leitura_suspeita.
-- E o mesmo Pix lido com uma letra diferente no código conta como já usado (o começo do código não muda).
-- Só muda a função n8n_sinal_conferir (mesma assinatura); loja sem sinal_pix.ativo (a Gleide) não passa por ela.

create or replace function n8n_sinal_conferir(p_empresa_id uuid, p_telefone text, p_agora timestamptz default now())
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_cfg      jsonb;
  v_sinal    numeric;
  v_cliente  uuid;
  v_msg      record;
  v_txt      text;
  v_valor_s  text;
  v_valor    numeric;
  v_data     date;
  v_situacao text;
  v_receb    text;
  v_chave    text;
  v_id       text;
  v_pagador  text;
  v_codigo   text;
  v_nomes    text[];
  v_nome     text;
  v_bate     boolean := false;
  v_hoje     date := (p_agora at time zone 'America/Cuiaba')::date;
  v_achou    boolean := false;
  v_motivo   text;
begin
  select config->'loja'->'sinal_pix' into v_cfg from empresas where id = p_empresa_id;
  if v_cfg is null or coalesce((v_cfg->>'ativo')::boolean, false) is false then
    return jsonb_build_object('exige', false, 'ok', true);
  end if;
  v_sinal := nullif(v_cfg->>'valor', '')::numeric;

  select id into v_cliente from clientes where empresa_id = p_empresa_id and telefone = p_telefone;
  if v_cliente is null then
    return jsonb_build_object('exige', true, 'ok', false, 'motivo', 'sem_comprovante');
  end if;

  -- comprovantes das últimas 48 h, do mais novo para o mais velho; vale o primeiro que ainda não reservou nada
  for v_msg in
    select id, conteudo from mensagens
    where empresa_id = p_empresa_id and cliente_id = v_cliente and direcao = 'entrada' and tipo = 'imagem'
      and criado_em > p_agora - interval '48 hours' and conteudo ilike '%COMPROVANTE PIX%'
    order by criado_em desc
  loop
    v_txt := v_msg.conteudo;
    v_valor_s  := trim(substring(v_txt from '(?i)valor:\s*([^|]*)'));
    v_situacao := sinal_normalizar(substring(v_txt from '(?i)situa[cç][aã]o:\s*([^|]*)'));
    v_receb    := trim(substring(v_txt from '(?i)recebedor:\s*([^|]*)'));
    v_chave    := trim(substring(v_txt from '(?i)chave:\s*([^|]*)'));
    v_id       := regexp_replace(coalesce(substring(v_txt from '(?i)\|\s*id:\s*([A-Za-z0-9-]+)'), ''), '[^A-Za-z0-9]', '', 'g');
    v_pagador  := trim(substring(v_txt from '(?i)pagador:\s*([^|]*)'));
    begin
      v_data := to_date(substring(v_txt from '(?i)data:\s*(\d{2}/\d{2}/\d{4})'), 'DD/MM/YYYY');
    exception when others then v_data := null;
    end;
    -- "1.020,50" -> 1020.50; "20,00" -> 20.00; "20.00" -> 20.00
    v_valor_s := regexp_replace(coalesce(v_valor_s, ''), '[^0-9,.]', '', 'g');
    if position(',' in v_valor_s) > 0 then v_valor_s := replace(replace(v_valor_s, '.', ''), ',', '.'); end if;
    begin v_valor := nullif(v_valor_s, '')::numeric; exception when others then v_valor := null; end;

    v_codigo := case when length(v_id) >= 10 then upper(v_id)
      else 'SEM-ID-' || md5(coalesce(v_valor::text, '') || '|' || coalesce(v_data::text, '') || '|' ||
        sinal_normalizar(v_receb) || '|' || sinal_normalizar(v_pagador)) end;
    -- já usado: mesmo código, ou o mesmo Pix lido com uma letra diferente no fim (Giovana, 12/11: "…B1I" e
    -- "…B1l" na mesma foto mandada duas vezes). O começo do código do Pix (E + banco + data e hora até o minuto,
    -- 21 letras) não muda; o resto é que a leitura erra.
    if exists (select 1 from agendamentos where empresa_id = p_empresa_id and (sinal_codigo = v_codigo
         or (v_codigo ~ '^E\d{20}' and sinal_codigo ~ '^E\d{20}' and left(sinal_codigo, 21) = left(v_codigo, 21)))) then
      continue;
    end if;
    v_achou := true;
    exit;
  end loop;

  if not v_achou then
    return jsonb_build_object('exige', true, 'ok', false,
      'motivo', case when v_txt is null then 'sem_comprovante' else 'ja_usado' end, 'valor_sinal', v_sinal);
  end if;

  -- quem recebeu: todas as palavras de um dos nomes aceitos aparecem no recebedor, ou a chave bate
  v_nomes := case jsonb_typeof(v_cfg->'nome_recebedor')
    when 'array' then array(select jsonb_array_elements_text(v_cfg->'nome_recebedor'))
    else array[coalesce(v_cfg->>'nome_recebedor', '')] end;
  foreach v_nome in array v_nomes loop
    if sinal_normalizar(v_nome) <> '' and not exists (
      select 1 from unnest(string_to_array(sinal_normalizar(v_nome), ' ')) w
      where length(w) > 2 and position(w in sinal_normalizar(v_receb)) = 0
    ) then v_bate := true; end if;
  end loop;
  if not v_bate and length(sinal_normalizar(v_cfg->>'chave')) >= 6
     and position(sinal_normalizar(v_cfg->>'chave') in sinal_normalizar(v_chave)) > 0 then
    v_bate := true;
  end if;

  v_motivo := case
    when v_situacao ~ '(agend|pend|process|cancel|devolv|estorn|nao conclu)' then 'situacao'
    when v_valor is null then 'ilegivel'
    when v_sinal is not null and v_valor < v_sinal then 'valor'
    when not v_bate then 'recebedor'
    when v_data is null or v_data < v_hoje - 2 or v_data > v_hoje + 1 then 'data'
    else null end;

  return jsonb_build_object(
    'exige', true, 'ok', v_motivo is null, 'motivo', v_motivo,
    'valor_sinal', v_sinal, 'valor_pago', v_valor, 'codigo', v_codigo, 'mensagem_id', v_msg.id,
    'comprovante', jsonb_build_object('valor', v_valor, 'data', v_data, 'situacao', v_situacao,
      'recebedor', v_receb, 'chave', v_chave, 'id', v_id, 'pagador', v_pagador, 'mensagem_id', v_msg.id,
      'leitura_suspeita', v_txt ~* '\|\s*suspeito:\s*sim'));
end $$;

revoke all on function n8n_sinal_conferir(uuid, text, timestamptz) from public, anon, authenticated;
