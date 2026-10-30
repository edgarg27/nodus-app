-- Paso 6 del rol Ejecutiva de Ventas (León): Soporte (reportar como cliente).
--
-- Su tarjeta "Tickets" abre /soporte, la misma pantalla del cliente. Ahí:
--   1) crea el reporte en public.tickets (a su nombre, en un centro de León),
--   2) sube las fotos al bucket "tickets",
--   3) deja el aviso para Sistemas/Mantenimiento en public.notificaciones.
-- Las políticas de INSERT de esas tablas no están en las migraciones del repo
-- (se hicieron en Supabase), así que aquí se AGREGAN unas solo para este rol;
-- si ya existía otra que lo permitía, no pasa nada (las políticas se suman).
-- Ver sus propios reportes y las respuestas ya lo permiten las políticas
-- actuales (user_id = auth.uid()).
--
-- Usa public.centros_ejecutiva_ventas() de migracion_rol_ejecutiva_ventas_2.sql.
-- Es seguro volver a correrlo.

-- 1) Reportes: solo a su nombre y en León.
drop policy if exists "tickets_ejecutiva_ventas_insert" on public.tickets;
create policy "tickets_ejecutiva_ventas_insert" on public.tickets
  for insert to authenticated
  with check (
    public.mi_rol()::text = 'ejecutiva_ventas'
    and user_id = auth.uid()
    and centro = any (public.centros_ejecutiva_ventas())
  );

-- 2) Fotos del reporte (bucket "tickets").
drop policy if exists "tickets_storage_ejecutiva_ventas_insert" on storage.objects;
create policy "tickets_storage_ejecutiva_ventas_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tickets' and public.mi_rol()::text = 'ejecutiva_ventas');

-- 3) Aviso (campanita) para el área que atiende el reporte.
drop policy if exists "notificaciones_ejecutiva_ventas_insert" on public.notificaciones;
create policy "notificaciones_ejecutiva_ventas_insert" on public.notificaciones
  for insert to authenticated
  with check (
    public.mi_rol()::text = 'ejecutiva_ventas'
    and centro = any (public.centros_ejecutiva_ventas())
  );

-- Comprobación: deben salir las 3.
select schemaname, tablename, policyname, cmd
from pg_policies
where policyname like '%ejecutiva_ventas_insert'
  and tablename in ('tickets', 'notificaciones', 'objects')
order by tablename;
