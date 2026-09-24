-- =====================================================================
-- Migración: imágenes de los correos masivos (Correos)
--
-- Las imágenes que se adjuntan a un comunicado se suben a este bucket y el
-- correo las carga por su link. Tiene que ser PÚBLICO: el cliente abre el
-- correo desde su bandeja, sin sesión en la app, y no puede usar un link
-- firmado temporal (dejaría de verse la imagen al expirar).
--
-- Solo suben y borran los roles que usan Correos (admin, superadmin,
-- gerente). Leer es público, por eso no hace falta política de select.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase.
-- =====================================================================

insert into storage.buckets (id, name, public)
values ('comunicados', 'comunicados', true)
on conflict (id) do nothing;

drop policy if exists "comunicados_storage_insert" on storage.objects;
create policy "comunicados_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'comunicados'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'gerente')
    )
  );

drop policy if exists "comunicados_storage_delete" on storage.objects;
create policy "comunicados_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'comunicados'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'gerente')
    )
  );
