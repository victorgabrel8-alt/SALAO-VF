-- Motor único, etapa 5: a própria dona pede o cadastro da loja pelo app (página pública "Cadastrar minha loja").
-- Só soma: uma tabela nova e duas funções novas.
--
-- O pedido NÃO cria loja, não cria WhatsApp e não gasta nada: só grava uma linha. Quem cria a loja é a
-- agência, ao aprovar o pedido no painel (tela Lojas). Assim um formulário público não consegue criar
-- instância na Evolution nem ligar IA.
--
-- Contra abuso (a função é chamada sem login):
--   - no máximo 3 pedidos pendentes por WhatsApp e 3 por e-mail;
--   - no máximo 40 pedidos por dia no total;
--   - textos com tamanho limitado e conferidos.

create table if not exists motor_cadastros (
  id uuid primary key default gen_random_uuid(),
  criado_em timestamptz not null default now(),
  nome_loja text not null,
  ramo text not null check (ramo in ('unhas', 'megahair')),
  dona text not null,
  whatsapp text not null,        -- só números, com 55 e DDD
  cidade text not null default '',
  email text not null default '',
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'recusado')),
  empresa_id uuid references empresas(id) on delete set null,   -- a loja criada na aprovação
  resolvido_em timestamptz
);
create index if not exists motor_cadastros_status on motor_cadastros (status, criado_em desc);
alter table motor_cadastros enable row level security;   -- sem política: só o servidor (chave de serviço) lê
revoke all on motor_cadastros from anon, authenticated;

-- Página pública do app: grava o pedido. Devolve 'ok' ou um texto curto dizendo por que não gravou.
create or replace function pedir_cadastro(
  p_nome_loja text, p_ramo text, p_dona text, p_whatsapp text, p_cidade text default '', p_email text default ''
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text := btrim(coalesce(p_nome_loja, ''));
  v_dona text := btrim(coalesce(p_dona, ''));
  v_whats text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_cidade text := btrim(coalesce(p_cidade, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if p_ramo is null or p_ramo not in ('unhas', 'megahair') then return 'Escolha o ramo da loja.'; end if;
  if length(v_nome) < 3 or length(v_nome) > 80 then return 'Escreva o nome da loja.'; end if;
  if length(v_dona) < 2 or length(v_dona) > 40 then return 'Escreva o seu nome.'; end if;
  -- quem digitou só DDD + número ganha o 55
  if v_whats ~ '^\d{10,11}$' then v_whats := '55' || v_whats; end if;
  if v_whats !~ '^55\d{10,11}$' then return 'WhatsApp: escreva com DDD, por exemplo 66 99999-0000.'; end if;
  if length(v_cidade) > 60 then return 'Nome da cidade longo demais.'; end if;
  if v_email <> '' and (length(v_email) > 120 or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then return 'E-mail inválido.'; end if;

  if (select count(*) from motor_cadastros where status = 'pendente' and whatsapp = v_whats) >= 3
     or (v_email <> '' and (select count(*) from motor_cadastros where status = 'pendente' and email = v_email) >= 3) then
    return 'Já recebemos o seu pedido. Em breve entramos em contato.';
  end if;
  if (select count(*) from motor_cadastros where criado_em > now() - interval '1 day') >= 40 then
    return 'Muitos pedidos hoje. Tente de novo amanhã ou fale com a gente pelo WhatsApp.';
  end if;

  insert into motor_cadastros (nome_loja, ramo, dona, whatsapp, cidade, email)
  values (v_nome, p_ramo, v_dona, v_whats, v_cidade, v_email);
  return 'ok';
end;
$$;

-- Painel: marca o pedido como aprovado (com a loja criada) ou recusado. Só vale para pedido pendente.
create or replace function motor_resolver_cadastro(p_id uuid, p_status text, p_empresa_id uuid default null)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_status not in ('aprovado', 'recusado') then raise exception 'status inválido'; end if;
  update motor_cadastros
  set status = p_status, empresa_id = p_empresa_id, resolvido_em = now()
  where id = p_id and status = 'pendente';
  return found;
end;
$$;

revoke all on function pedir_cadastro(text, text, text, text, text, text) from public;
grant execute on function pedir_cadastro(text, text, text, text, text, text) to anon, authenticated, service_role;
revoke all on function motor_resolver_cadastro(uuid, text, uuid) from public, anon, authenticated;
grant execute on function motor_resolver_cadastro(uuid, text, uuid) to service_role;
