-- Paso 7 del rol Ejecutiva de Ventas (León): Cotizaciones solo de León.
--
-- Antes veía las cotizaciones de TODOS los centros (las de fuera de León como
-- "Solo consulta", ver migracion_rol_ejecutiva_ventas_4.sql). Ahora solo ve
-- las de Puerta Bajío Piso 2, Piso 8 y Stadium, que son también las únicas
-- que puede crear. Aplica a las dos tablas de cotizaciones:
--   cotizaciones               (la lista de /cotizaciones, con su PPTX)
--   cotizaciones_comerciales   (la venta ligada a cada cotización)
-- Crear, aceptar y borrar no cambia (ya era solo León).
--
-- Usa public.centros_ejecutiva_ventas() de migracion_rol_ejecutiva_ventas_2.sql.
-- Es seguro volver a correrlo.

drop policy if exists "cotizaciones_ejecutiva_ventas_select" on public.cotizaciones;
create policy "cotizaciones_ejecutiva_ventas_select" on public.cotizaciones
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

drop policy if exists "cotizaciones_comerciales_ejecutiva_ventas_select" on public.cotizaciones_comerciales;
create policy "cotizaciones_comerciales_ejecutiva_ventas_select" on public.cotizaciones_comerciales
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- Comprobación: las dos deben decir "centros_ejecutiva_ventas" en qual.
select tablename, policyname, cmd, qual
from pg_policies
where policyname in ('cotizaciones_ejecutiva_ventas_select', 'cotizaciones_comerciales_ejecutiva_ventas_select');
