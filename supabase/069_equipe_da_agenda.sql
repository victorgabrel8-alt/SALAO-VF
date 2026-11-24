-- =====================================================================
-- 069 - Equipe da agenda: preferência por profissional, no cadastro (pedido do Victor, 23/11/2026)
--
-- Caso: Studio Caroline Ferreira. A Duda (funcionária nova) atende junto com a Caroline e precisa receber mais
-- clientes. Até aqui a Duda estava escrita no loja.json ("segunda_profissional") e o cálculo de horários da IA só
-- sabia lidar com duas pessoas, com os nomes fixos. Outra loja com equipe, ou uma terceira profissional, pedia
-- mexer no código.
--
-- Agora a equipe vem do cadastro (tabela profissionais), para qualquer loja e qualquer número de profissionais:
--   - profissionais.preferencia: quanto maior, antes a IA oferece os horários dela para cliente NOVA. Todas com 0
--     (o padrão) = sem preferência, como sempre.
--   - profissionais.apelidos: outros jeitos de a cliente chamar ("eduarda" para a Duda), sem acento e minúsculo.
--   - n8n_equipe_da_agenda(empresa, telefone): a equipe ativa na ordem do cadastro (a primeira é a dona: horário
--     sem profissional é dela) e com quem foi o último horário desta cliente (cliente de uma profissional continua
--     com ela; a preferência vale só para quem ainda não tem profissional).
-- Só soma: duas colunas com valor padrão e uma função nova. Loja de uma profissional só não muda nada.
-- =====================================================================

alter table profissionais add column if not exists preferencia smallint not null default 0;
alter table profissionais add column if not exists apelidos text[] not null default '{}';

comment on column profissionais.preferencia is 'Quanto maior, antes a IA oferece os horários dela para cliente nova (0 = sem preferência)';
comment on column profissionais.apelidos is 'Outros jeitos de a cliente chamar a profissional, sem acento e em minúsculas';

create or replace function n8n_equipe_da_agenda(p_empresa_id uuid, p_telefone text)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_tel       text := telefone_com9(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'));
  v_principal uuid;
  v_dela      uuid;
  v_tem       boolean := false;
begin
  select p.id into v_principal from profissionais p
   where p.empresa_id = p_empresa_id and p.ativo order by p.criado_em, p.id limit 1;

  -- o último horário dela que valeu (marcado ou feito); sem profissional gravado = com a dona
  if v_tel <> '' then
    select true, coalesce(a.profissional_id, v_principal) into v_tem, v_dela
      from agendamentos a join clientes c on c.id = a.cliente_id
     where a.empresa_id = p_empresa_id and a.status in ('agendado', 'realizado')
       and c.empresa_id = p_empresa_id
       and c.telefone in (v_tel, regexp_replace(v_tel, '^(55[0-9]{2})9([0-9]{8})$', '\1\2'))
     order by a.inicio desc limit 1;
  end if;
  -- profissional que saiu da equipe não segura a cliente
  if v_dela is not null and not exists (
    select 1 from profissionais p where p.id = v_dela and p.empresa_id = p_empresa_id and p.ativo) then
    v_dela := null;
  end if;

  return jsonb_build_object(
    'profissionais', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'nome', p.nome, 'preferencia', p.preferencia, 'apelidos', to_jsonb(p.apelidos))
                       order by p.criado_em, p.id)
        from profissionais p where p.empresa_id = p_empresa_id and p.ativo), '[]'::jsonb),
    'da_cliente', case when coalesce(v_tem, false) then v_dela end);
end $$;

revoke all on function n8n_equipe_da_agenda(uuid, text) from public, anon, authenticated;
grant execute on function n8n_equipe_da_agenda(uuid, text) to service_role;

-- Dados do Studio Caroline Ferreira: a Duda é a preferida para cliente nova; os apelidos valem como começo do nome
-- ("carolzinha", "dudinha"). Sem isto todas ficam com 0 e a IA não dá preferência a ninguém.
update profissionais set preferencia = 1, apelidos = '{eduarda,dud}'
 where id = '195862b8-efdc-4087-a653-083fdf7e0c35' and empresa_id = '26a5d3eb-e8e4-4ed8-b206-095095292fdd';
update profissionais set apelidos = '{carol,karol}'
 where id = 'bcc300c7-a83f-4c8c-81a7-0f50c65bf5dc' and empresa_id = '26a5d3eb-e8e4-4ed8-b206-095095292fdd';
