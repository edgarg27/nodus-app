-- Paso 5 del rol Ejecutiva de Ventas (León): Sala de Juntas, Documentación del
-- centro y Expediente de clientes. Todo limitado a los centros de León.
--
-- Lo demás de sus módulos nuevos ya lo permite la base sin cambios:
--   Tours (migracion_rol_ejecutiva_ventas_2.sql), Calendario de Eventos (lectura
--   para cualquier cuenta), Tickets (cualquier cuenta levanta y ve sus reportes)
--   y reservar sala (reservaciones).
--
-- Las políticas se AGREGAN; no se toca ninguna de los demás roles.
-- Es seguro volver a correrlo.

-- ------------------------------------------------- Sala de Juntas: cartas responsivas
drop policy if exists "registros_sala_juntas_ejecutiva_ventas" on public.registros_sala_juntas;
create policy "registros_sala_juntas_ejecutiva_ventas" on public.registros_sala_juntas
  for all to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()))
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- ------------------------------------------------- Documentación del centro
drop policy if exists "doc_carpetas_ejecutiva_ventas" on public.documentacion_centro_carpetas;
create policy "doc_carpetas_ejecutiva_ventas" on public.documentacion_centro_carpetas
  for all to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()))
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

drop policy if exists "doc_archivos_ejecutiva_ventas" on public.documentacion_centro_archivos;
create policy "doc_archivos_ejecutiva_ventas" on public.documentacion_centro_archivos
  for all to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()))
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- Archivos del bucket: la ruta no lleva el centro, así que se permite el bucket
-- completo (igual que a los demás roles); la pantalla solo le lista los de León,
-- porque las tablas de arriba solo le dejan ver esos.
drop policy if exists "doc_centro_storage_ejecutiva_ventas_select" on storage.objects;
create policy "doc_centro_storage_ejecutiva_ventas_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'documentacion-centro' and public.mi_rol()::text = 'ejecutiva_ventas');

drop policy if exists "doc_centro_storage_ejecutiva_ventas_insert" on storage.objects;
create policy "doc_centro_storage_ejecutiva_ventas_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentacion-centro' and public.mi_rol()::text = 'ejecutiva_ventas');

drop policy if exists "doc_centro_storage_ejecutiva_ventas_delete" on storage.objects;
create policy "doc_centro_storage_ejecutiva_ventas_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentacion-centro' and public.mi_rol()::text = 'ejecutiva_ventas');

-- ------------------------------------------------- Expediente de clientes
drop policy if exists "expediente_archivos_ejecutiva_ventas" on public.expediente_archivos;
create policy "expediente_archivos_ejecutiva_ventas" on public.expediente_archivos
  for all to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()))
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- La primera carpeta de la ruta es el id del cliente (ver migracion_expedientes_clientes.sql).
drop policy if exists "expedientes_storage_ejecutiva_ventas" on storage.objects;
create policy "expedientes_storage_ejecutiva_ventas" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'expedientes-clientes'
    and public.mi_rol()::text = 'ejecutiva_ventas'
    and exists (
      select 1 from public.profiles c
      where c.id::text = (storage.foldername(name))[1] and c.centro = any (public.centros_ejecutiva_ventas())
    )
  )
  with check (
    bucket_id = 'expedientes-clientes'
    and public.mi_rol()::text = 'ejecutiva_ventas'
    and exists (
      select 1 from public.profiles c
      where c.id::text = (storage.foldername(name))[1] and c.centro = any (public.centros_ejecutiva_ventas())
    )
  );
