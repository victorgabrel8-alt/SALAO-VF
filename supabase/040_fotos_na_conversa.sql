-- 040: Fotos dentro da conversa do app (pedido do Victor, 12/11/2026).
-- Antes a conversa só mostrava "📷 Foto" + a descrição que o Gemini fez (ou "[mídia]" quando era a dona):
-- a foto em si não ficava guardada em lugar nenhum.
-- Agora o n8n guarda a foto que a cliente manda (e a que a dona manda pelo celular) no bucket privado
-- "midias", no caminho <empresa_id>/<wa_message_id>.<ext>, e escreve esse caminho em mensagens.midia.
-- O app lê a foto com link assinado (só quem é da empresa consegue).
-- Só soma: coluna nova sem valor (mensagem antiga fica como estava), bucket novo e regras de leitura novas.

alter table mensagens add column if not exists midia text;  -- caminho no bucket "midias" (null = sem foto guardada)
comment on column mensagens.midia is 'Foto da mensagem no Storage, bucket "midias": <empresa_id>/<wa_message_id>.<ext>. Gravado pelo n8n.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('midias', 'midias', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

-- quem é da empresa lê as fotos dela (a 1ª pasta do caminho é o id da empresa); o n8n grava com a service_role
drop policy if exists midias_select on storage.objects;
create policy midias_select on storage.objects for select to authenticated
  using (bucket_id = 'midias' and (storage.foldername(name))[1] in (select private.minhas_empresas()::text));

-- fotos do catálogo que a IA mandou: quem é da empresa dona da foto também consegue ver no app
drop policy if exists catalogo_fotos_select on storage.objects;
create policy catalogo_fotos_select on storage.objects for select to authenticated
  using (bucket_id = 'catalogo' and exists (
    select 1 from public.catalogo c where c.arquivo = storage.objects.name and c.empresa_id in (select private.minhas_empresas())));
