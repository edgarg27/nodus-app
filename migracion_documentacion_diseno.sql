-- =====================================================================
-- Migración: Documentación del centro también para el rol "diseno"
--
-- La persona de Diseño Gráfico ahora también puede subir/actualizar la
-- documentación del centro (el mismo Drive que ya usan admin/superadmin
-- en /documentacion-centro), por si llega a cambiar. Solo se toca ese
-- módulo — Decoraciones y Eventos se quedan igual, solo admin/superadmin.
--
-- Corre esto DESPUÉS de migracion_atencion_clientes_modulos.sql y
-- migracion_documentacion_drive.sql. Es seguro volver a correrlo.
-- =====================================================================

-- Carpetas del Drive
drop policy if exists "doc_carpetas_staff_all" on public.documentacion_centro_carpetas;
create policy "doc_carpetas_staff_all" on public.documentacion_centro_carpetas
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno')
    )
  );

-- Archivos (metadatos)
drop policy if exists "doc_archivos_staff_all" on public.documentacion_centro_archivos;
create policy "doc_archivos_staff_all" on public.documentacion_centro_archivos
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno')
    )
  );

-- Storage del bucket privado "documentacion-centro" (leer/subir/borrar)
drop policy if exists "doc_centro_storage_select" on storage.objects;
create policy "doc_centro_storage_select" on storage.objects
  for select using (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno')
    )
  );

drop policy if exists "doc_centro_storage_insert" on storage.objects;
create policy "doc_centro_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno')
    )
  );

drop policy if exists "doc_centro_storage_delete" on storage.objects;
create policy "doc_centro_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno')
    )
  );
