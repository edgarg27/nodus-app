-- =====================================================================
-- Migración: Decoraciones y Documentación del centro también para
-- "atencion_cliente" (cuenta servicioalcliente@nodusbc.mx)
--
-- Se suma a admin/superadmin (y a "diseno" en Documentación, ver
-- migracion_documentacion_diseno.sql). No se toca Eventos: esa pantalla
-- reutiliza "eventos_centro", que ya tiene una política amplia para
-- cualquier cuenta con sesión.
--
-- Corre esto DESPUÉS de migracion_atencion_clientes_modulos.sql,
-- migracion_documentacion_drive.sql y migracion_documentacion_diseno.sql.
-- Es seguro volver a correrlo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Decoraciones y festividades
-- ---------------------------------------------------------------------
drop policy if exists "decoraciones_staff_all" on public.decoraciones;
create policy "decoraciones_staff_all" on public.decoraciones
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'atencion_cliente')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'atencion_cliente')
    )
  );

drop policy if exists "decoraciones_storage_insert" on storage.objects;
create policy "decoraciones_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'decoraciones'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'atencion_cliente')
    )
  );

drop policy if exists "decoraciones_storage_delete" on storage.objects;
create policy "decoraciones_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'decoraciones'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'atencion_cliente')
    )
  );

-- ---------------------------------------------------------------------
-- Documentación del centro (carpetas, archivos y el bucket privado)
-- ---------------------------------------------------------------------
drop policy if exists "doc_carpetas_staff_all" on public.documentacion_centro_carpetas;
create policy "doc_carpetas_staff_all" on public.documentacion_centro_carpetas
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno', 'atencion_cliente')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno', 'atencion_cliente')
    )
  );

drop policy if exists "doc_archivos_staff_all" on public.documentacion_centro_archivos;
create policy "doc_archivos_staff_all" on public.documentacion_centro_archivos
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno', 'atencion_cliente')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno', 'atencion_cliente')
    )
  );

drop policy if exists "doc_centro_storage_select" on storage.objects;
create policy "doc_centro_storage_select" on storage.objects
  for select using (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno', 'atencion_cliente')
    )
  );

drop policy if exists "doc_centro_storage_insert" on storage.objects;
create policy "doc_centro_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno', 'atencion_cliente')
    )
  );

drop policy if exists "doc_centro_storage_delete" on storage.objects;
create policy "doc_centro_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin', 'diseno', 'atencion_cliente')
    )
  );
