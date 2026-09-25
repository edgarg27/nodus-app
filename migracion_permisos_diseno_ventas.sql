-- =====================================================================
-- Permisos: Diseño marca días sin servicio y Ventas manda correos masivos
--
-- 1) Diseño puede agregar y quitar "Días sin servicio" (cuándo no abre un
--    centro) en Experiencia de Cliente -> Eventos. Antes solo admin,
--    superadmin y gerente.
-- 2) Ventas usa el módulo Correos, así que también puede subir y borrar las
--    imágenes de los comunicados. Sin esto marcaba "new row violates
--    row-level security policy" al adjuntar una imagen.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase.
-- Rollback: volver a crear las políticas con los roles anteriores
-- (migracion_dias_centro.sql y migracion_comunicados_imagenes.sql).
-- =====================================================================

drop policy if exists "dias_centro_staff_write" on public.dias_centro;
create policy "dias_centro_staff_write" on public.dias_centro
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'gerente', 'diseno')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'gerente', 'diseno')
    )
  );

drop policy if exists "comunicados_storage_insert" on storage.objects;
create policy "comunicados_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'comunicados'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'gerente', 'ventas')
    )
  );

drop policy if exists "comunicados_storage_delete" on storage.objects;
create policy "comunicados_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'comunicados'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'gerente', 'ventas')
    )
  );
