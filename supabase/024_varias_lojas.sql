-- =====================================================================
-- 024_varias_lojas.sql — aplicado no Supabase em 27/10/2026
-- Fase 1 do docs/PLANO-VARIAS-LOJAS.md: o banco preparado para várias lojas e nichos
-- (mega hair, estúdio de beleza, manicure). Só SOMA: nada muda para a Gleide.
--   - empresas: nicho, fuso, ativo, instancia_whatsapp (a instância da Evolution é como o n8n
--     vai descobrir de qual loja é a mensagem)
--   - servicos.categoria: categorias de manicure e estúdio de beleza
--   - servicos_modelo: serviços prontos por nicho (sem preço) para a loja nova começar
--   - criar_loja(...): cria loja, profissional, serviços do modelo e liga a dona, de uma vez
-- =====================================================================

alter table empresas
  add column if not exists nicho text not null default 'mega_hair'
    check (nicho in ('mega_hair', 'estudio_beleza', 'manicure')),
  add column if not exists fuso text not null default 'America/Cuiaba',
  add column if not exists ativo boolean not null default true,
  add column if not exists instancia_whatsapp text unique;

update empresas set instancia_whatsapp = 'salao-demo'
 where id = '00000000-0000-0000-0000-000000000001' and instancia_whatsapp is null;

alter table servicos drop constraint servicos_categoria_check;
alter table servicos add constraint servicos_categoria_check check (categoria in (
  'avaliacao', 'aplicacao', 'manutencao', 'quimica', 'tratamento', 'venda', 'outro',
  'unhas', 'alongamento', 'sobrancelha_cilios', 'estetica', 'depilacao', 'maquiagem'));

create table if not exists servicos_modelo (
  id           uuid primary key default gen_random_uuid(),
  nicho        text not null check (nicho in ('mega_hair', 'estudio_beleza', 'manicure')),
  categoria    text not null,
  nome         text not null,
  duracao_min  integer not null check (duracao_min > 0),
  dias_retorno integer check (dias_retorno > 0),
  linha        text,
  ordem        integer not null default 0,
  unique (nicho, nome)
);
alter table servicos_modelo enable row level security;
create policy servicos_modelo_select on servicos_modelo for select to authenticated using (true);
revoke all on servicos_modelo from anon;

insert into servicos_modelo (nicho, categoria, nome, duracao_min, dias_retorno, linha, ordem) values
  ('mega_hair', 'avaliacao', 'Avaliação', 30, null, null, 1),
  ('mega_hair', 'aplicacao', 'Aplicação de mega hair – mão de obra', 240, 60, 'Mega hair', 2),
  ('mega_hair', 'manutencao', 'Manutenção – mão de obra', 120, 60, 'Mega hair', 3),
  ('mega_hair', 'manutencao', 'Remoção de mega hair', 60, null, null, 4),
  ('manicure', 'unhas', 'Mão – esmaltação', 45, 10, 'Mão', 1),
  ('manicure', 'unhas', 'Pé – esmaltação', 45, 15, 'Pé', 2),
  ('manicure', 'unhas', 'Pé e mão', 90, 15, 'Pé e mão', 3),
  ('manicure', 'unhas', 'Esmaltação em gel', 60, 21, 'Gel', 4),
  ('manicure', 'unhas', 'Spa dos pés', 60, 30, null, 5),
  ('manicure', 'unhas', 'Remoção de gel', 30, null, null, 6),
  ('manicure', 'alongamento', 'Alongamento – gel ou fibra', 150, 21, 'Alongamento', 7),
  ('manicure', 'alongamento', 'Manutenção de alongamento', 120, 21, 'Alongamento', 8),
  ('manicure', 'alongamento', 'Banho de gel', 90, 21, 'Alongamento', 9),
  ('estudio_beleza', 'sobrancelha_cilios', 'Design de sobrancelha', 30, 15, 'Sobrancelha', 1),
  ('estudio_beleza', 'sobrancelha_cilios', 'Design com henna', 45, 15, 'Sobrancelha', 2),
  ('estudio_beleza', 'sobrancelha_cilios', 'Brow lamination', 60, 45, null, 3),
  ('estudio_beleza', 'sobrancelha_cilios', 'Lash lifting', 60, 45, null, 4),
  ('estudio_beleza', 'sobrancelha_cilios', 'Extensão de cílios', 120, 15, 'Cílios', 5),
  ('estudio_beleza', 'sobrancelha_cilios', 'Manutenção de cílios', 90, 15, 'Cílios', 6),
  ('estudio_beleza', 'depilacao', 'Depilação de buço', 15, 20, null, 7),
  ('estudio_beleza', 'estetica', 'Limpeza de pele', 90, 30, null, 8),
  ('estudio_beleza', 'maquiagem', 'Maquiagem social', 60, null, null, 9),
  ('estudio_beleza', 'unhas', 'Pé e mão', 90, 15, 'Pé e mão', 10)
on conflict (nicho, nome) do nothing;

-- Cria uma loja inteira. Só o service role (n8n / painel da agência pelo servidor) chama.
-- Serviços entram sem preço: a dona completa no app ("sem preço cadastrado" a IA não informa valor).
create or replace function criar_loja(p_nome text, p_nicho text, p_profissional text,
                                      p_dona_user_id uuid default null, p_fuso text default 'America/Cuiaba',
                                      p_instancia text default null, p_config jsonb default '{}'::jsonb)
returns uuid language plpgsql set search_path = public as $$
declare v_empresa uuid;
begin
  insert into empresas (nome, nicho, fuso, instancia_whatsapp, config)
  values (p_nome, p_nicho, p_fuso, p_instancia, p_config)
  returning id into v_empresa;
  insert into profissionais (empresa_id, nome) values (v_empresa, p_profissional);
  insert into servicos (empresa_id, nome, categoria, preco, duracao_min, dias_retorno, linha, a_partir_de, ativo)
  select v_empresa, m.nome, m.categoria, null, m.duracao_min, m.dias_retorno, m.linha, true, true
    from servicos_modelo m where m.nicho = p_nicho order by m.ordem;
  if p_dona_user_id is not null then
    insert into usuarios_empresa (user_id, empresa_id, papel) values (p_dona_user_id, v_empresa, 'dona');
  end if;
  return v_empresa;
end $$;
revoke all on function criar_loja(text, text, text, uuid, text, text, jsonb) from public, anon, authenticated;
