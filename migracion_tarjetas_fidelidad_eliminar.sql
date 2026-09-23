-- Permite al staff eliminar una tarjeta de fidelidad desde el tab Fidelidad
-- del Panel de Centro (sus sellos se borran en cascada). Hasta ahora la tabla
-- solo tenía políticas de insert, select y update, así que un delete no
-- borraba nada. Requiere public.es_staff() de migracion_cerrar_politicas_rls_abiertas.sql.
--
-- Rollback: drop policy "tarjetas_fidelidad_staff_delete" on public.tarjetas_fidelidad;

drop policy if exists "tarjetas_fidelidad_staff_delete" on public.tarjetas_fidelidad;
create policy "tarjetas_fidelidad_staff_delete"
  on public.tarjetas_fidelidad
  for delete
  to authenticated
  using (public.es_staff());
