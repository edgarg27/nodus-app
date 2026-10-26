-- Paso 4 del rol Ejecutiva de Ventas (León): Cotizar, Cotizaciones y Contratos.
--
--   Cotizar        cotiza solo en León (lee planes, adicionales y precios de León).
--   Cotizaciones   ve las de todos los centros; crea, cambia y borra solo las de León.
--   Contratos      ve solo los de León, de solo consulta (sin escribir).
--
-- Las políticas se AGREGAN; no se toca ninguna de los demás roles. Usa
-- public.centros_ejecutiva_ventas() de migracion_rol_ejecutiva_ventas_2.sql.
-- Es seguro volver a correrlo.

-- ------------------------------------------------------------- contratos
drop policy if exists "contratos_ejecutiva_ventas_select" on public.contratos;
create policy "contratos_ejecutiva_ventas_select" on public.contratos
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- Clientes de León (nombre, empresa y correo en sus contratos y en Cotizar).
drop policy if exists "profiles_ejecutiva_ventas_clientes" on public.profiles;
create policy "profiles_ejecutiva_ventas_clientes" on public.profiles
  for select to authenticated
  using (
    public.mi_rol()::text = 'ejecutiva_ventas'
    and rol = 'cliente'::public.rol_nodus
    and centro = any (public.centros_ejecutiva_ventas())
  );

-- ---------------------------------------------------------- cotizaciones
drop policy if exists "cotizaciones_ejecutiva_ventas_select" on public.cotizaciones;
create policy "cotizaciones_ejecutiva_ventas_select" on public.cotizaciones
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas');

drop policy if exists "cotizaciones_ejecutiva_ventas_escribe" on public.cotizaciones;
create policy "cotizaciones_ejecutiva_ventas_escribe" on public.cotizaciones
  for all to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()))
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- ------------------------------------------------ cotizaciones_comerciales
drop policy if exists "cotizaciones_comerciales_ejecutiva_ventas_select" on public.cotizaciones_comerciales;
create policy "cotizaciones_comerciales_ejecutiva_ventas_select" on public.cotizaciones_comerciales
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas');

drop policy if exists "cotizaciones_comerciales_ejecutiva_ventas_insert" on public.cotizaciones_comerciales;
create policy "cotizaciones_comerciales_ejecutiva_ventas_insert" on public.cotizaciones_comerciales
  for insert to authenticated
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

drop policy if exists "cotizaciones_comerciales_ejecutiva_ventas_update" on public.cotizaciones_comerciales;
create policy "cotizaciones_comerciales_ejecutiva_ventas_update" on public.cotizaciones_comerciales
  for update to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()))
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- ------------------------------------------- catálogos que lee Cotizar (León)
drop policy if exists "paquetes_ejecutiva_ventas_select" on public.paquetes;
create policy "paquetes_ejecutiva_ventas_select" on public.paquetes
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

drop policy if exists "adicionales_catalogo_ejecutiva_ventas_select" on public.adicionales_catalogo;
create policy "adicionales_catalogo_ejecutiva_ventas_select" on public.adicionales_catalogo
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

drop policy if exists "precios_cotizacion_sala_ejecutiva_ventas_select" on public.precios_cotizacion_sala_juntas;
create policy "precios_cotizacion_sala_ejecutiva_ventas_select" on public.precios_cotizacion_sala_juntas
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));
