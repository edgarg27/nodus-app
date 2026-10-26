-- Paso 3 del rol Ejecutiva de Ventas (León).
--
-- Ahora VE los prospectos de todos los centros (y su seguimiento), pero solo
-- puede modificar los de León: registrar, cambiar estado, dar seguimiento,
-- agendar tours y borrar siguen limitados a Puerta Bajío Piso 2, Piso 8 y
-- Stadium (políticas de migracion_rol_ejecutiva_ventas_2.sql, sin cambio).
-- Es seguro volver a correrlo.

drop policy if exists "prospectos_ejecutiva_ventas_select" on public.prospectos;
create policy "prospectos_ejecutiva_ventas_select" on public.prospectos
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas');
