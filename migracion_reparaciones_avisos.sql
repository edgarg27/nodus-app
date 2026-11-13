-- =====================================================================
-- Reparaciones: la campanita de la arquitecta.
--
-- Los avisos de reparaciones ("Edgar subió un avance…") se guardan con el
-- centro de la reparación (p. ej. Puerta Bajío Piso 2). La arquitecta tiene
-- su perfil en otro centro, así que la base no se los dejaba leer y su
-- campanita no los mostraba. Esta política le deja leer SOLO los avisos de
-- reparaciones, de cualquier centro.
--
-- (Mantenimiento ya los lee: notificaciones_select_mantenimiento_leon en
-- migracion_rol_mantenimiento_2.sql.)
-- Es seguro volver a correrlo.
-- Rollback: drop policy "notificaciones_reparaciones_operaciones" on public.notificaciones;
-- =====================================================================

drop policy if exists "notificaciones_reparaciones_operaciones" on public.notificaciones;
create policy "notificaciones_reparaciones_operaciones" on public.notificaciones
  for select to authenticated
  using (public.mi_rol()::text = 'operaciones' and tipo like 'reparacion\_%');

-- Comprobación: deben salir las políticas de lectura de notificaciones,
-- entre ellas la nueva y la de Mantenimiento.
select policyname, cmd, permissive from pg_policies
where tablename = 'notificaciones'
order by cmd, policyname;
