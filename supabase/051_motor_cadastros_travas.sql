-- Motor único: travas mais fortes no pedido público de cadastro (revisão do 050).
-- Só soma: uma coluna nova e a função pedir_cadastro regravada (mesma assinatura).
--
-- O que muda:
--   - limite por endereço de internet (IP): 3 pedidos por dia. Antes só havia o teto geral de 40 por dia, e um
--     script com 40 números inventados fechava o cadastro para todo mundo;
--   - o teto geral sobe para 200 por dia e fica só como rede de segurança;
--   - trava para chamadas ao mesmo tempo (os limites eram furados por pedidos simultâneos);
--   - só algarismos comuns no WhatsApp (o banco aceitava dígitos de outros alfabetos);
--   - nome da loja, nome da dona e cidade sem quebra de linha, caractere de controle ou invisível: esses textos
--     vão para o prompt da IA e para mensagens de WhatsApp.

alter table motor_cadastros add column if not exists ip text not null default '';

create or replace function pedir_cadastro(
  p_nome_loja text, p_ramo text, p_dona text, p_whatsapp text, p_cidade text default '', p_email text default ''
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  -- caracteres de controle, espaços invisíveis e marcas de direção de texto
  c_ruim constant text := '[\u0001-\u001f\u007f ​-‏‪-‮⁠⁦-⁩﻿]';
  v_nome text := regexp_replace(coalesce(p_nome_loja, ''), '^\s+|\s+$', '', 'g');
  v_dona text := regexp_replace(coalesce(p_dona, ''), '^\s+|\s+$', '', 'g');
  v_cidade text := regexp_replace(coalesce(p_cidade, ''), '^\s+|\s+$', '', 'g');
  v_email text := lower(regexp_replace(coalesce(p_email, ''), '^\s+|\s+$', '', 'g'));
  v_whats text := regexp_replace(coalesce(p_whatsapp, ''), '[^0-9]', '', 'g');
  v_cab json;
  v_ip text := '';
begin
  if p_ramo is null or p_ramo not in ('unhas', 'megahair') then return 'Escolha o ramo da loja.'; end if;
  if v_nome ~ c_ruim or v_dona ~ c_ruim or v_cidade ~ c_ruim or v_email ~ c_ruim then return 'Use só letras e números comuns nos campos.'; end if;
  if length(v_nome) < 3 or length(v_nome) > 80 then return 'Escreva o nome da loja.'; end if;
  if length(v_dona) < 2 or length(v_dona) > 40 then return 'Escreva o seu nome.'; end if;
  -- quem digitou só DDD + número ganha o 55
  if v_whats ~ '^[0-9]{10,11}$' then v_whats := '55' || v_whats; end if;
  if v_whats !~ '^55[1-9][0-9]{9,10}$' then return 'WhatsApp: escreva com DDD, por exemplo 66 99999-0000.'; end if;
  if length(v_cidade) > 60 then return 'Nome da cidade longo demais.'; end if;
  if v_email <> '' and (length(v_email) > 120 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then return 'E-mail inválido.'; end if;

  -- de onde veio o pedido (o Supabase põe os cabeçalhos da chamada em request.headers)
  begin
    v_cab := nullif(current_setting('request.headers', true), '')::json;
    v_ip := btrim(coalesce(v_cab->>'cf-connecting-ip', split_part(coalesce(v_cab->>'x-forwarded-for', ''), ',', 1), ''));
  exception when others then
    v_ip := '';
  end;
  v_ip := left(v_ip, 60);

  -- um pedido de cada vez: sem isso, chamadas ao mesmo tempo passavam dos limites
  perform pg_advisory_xact_lock(hashtext('pedir_cadastro'));

  if v_ip <> '' and (select count(*) from motor_cadastros where ip = v_ip and criado_em > now() - interval '1 day') >= 3 then
    return 'Já recebemos pedidos deste aparelho hoje. Se precisar, fale com a gente pelo WhatsApp.';
  end if;
  if (select count(*) from motor_cadastros where status = 'pendente' and whatsapp = v_whats) >= 3
     or (v_email <> '' and (select count(*) from motor_cadastros where status = 'pendente' and email = v_email) >= 3) then
    return 'Já recebemos o seu pedido. Em breve entramos em contato.';
  end if;
  if (select count(*) from motor_cadastros where criado_em > now() - interval '1 day') >= 200 then
    return 'Muitos pedidos hoje. Tente de novo amanhã ou fale com a gente pelo WhatsApp.';
  end if;

  insert into motor_cadastros (nome_loja, ramo, dona, whatsapp, cidade, email, ip)
  values (v_nome, p_ramo, v_dona, v_whats, v_cidade, v_email, v_ip);
  return 'ok';
end;
$$;

revoke all on function pedir_cadastro(text, text, text, text, text, text) from public;
grant execute on function pedir_cadastro(text, text, text, text, text, text) to anon, authenticated, service_role;
