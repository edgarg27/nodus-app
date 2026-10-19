-- =====================================================================
-- Cobranza (finanzas) trabaja con TODOS los centros.
--
-- En la pantalla de Cobranza ya veía todos los centros (sus APIs la tratan
-- como rol global), pero en Facturación quedaba fija al centro de su
-- perfil (Bosques): las políticas de facturas, pagos y complementos de
-- pago le pedían p.centro = <centro de la fila>, y solo leía perfiles de
-- clientes de su propio centro. Con Punto 45 y San Telmo eso ya no sirve.
--
-- Aquí se AGREGAN políticas para cobranza sin filtro de centro (las
-- políticas existentes no se tocan; en Postgres las políticas se suman).
-- El código (ROLES_GLOBALES de Facturación) ya incluye "cobranza".
--
-- Es seguro volver a correrlo.
-- =====================================================================

-- facturas: ver, crear y actualizar de cualquier centro (borrar no, como hoy).
drop policy if exists "facturas_cobranza_select_todos" on public.facturas;
create policy "facturas_cobranza_select_todos" on public.facturas
  for select to authenticated
  using (public.mi_rol()::text = 'cobranza');

drop policy if exists "facturas_cobranza_insert_todos" on public.facturas;
create policy "facturas_cobranza_insert_todos" on public.facturas
  for insert to authenticated
  with check (public.mi_rol()::text = 'cobranza');

drop policy if exists "facturas_cobranza_update_todos" on public.facturas;
create policy "facturas_cobranza_update_todos" on public.facturas
  for update to authenticated
  using (public.mi_rol()::text = 'cobranza')
  with check (public.mi_rol()::text = 'cobranza');

-- pagos: ver y actualizar de cualquier centro (como hoy en su centro).
drop policy if exists "pagos_cobranza_select_todos" on public.pagos;
create policy "pagos_cobranza_select_todos" on public.pagos
  for select to authenticated
  using (public.mi_rol()::text = 'cobranza');

drop policy if exists "pagos_cobranza_update_todos" on public.pagos;
create policy "pagos_cobranza_update_todos" on public.pagos
  for update to authenticated
  using (public.mi_rol()::text = 'cobranza')
  with check (public.mi_rol()::text = 'cobranza');

-- complementos de pago: ver de cualquier centro (complemento_pago_facturas
-- hereda de esta tabla).
drop policy if exists "complementos_pago_cobranza_todos" on public.complementos_pago;
create policy "complementos_pago_cobranza_todos" on public.complementos_pago
  for select to authenticated
  using (public.mi_rol()::text = 'cobranza');

-- perfiles de clientes de cualquier centro (nombre, RFC, datos fiscales),
-- para facturarles. mi_rol() es SECURITY DEFINER, sin recursión.
drop policy if exists "profiles_cobranza_clientes_todos" on public.profiles;
create policy "profiles_cobranza_clientes_todos" on public.profiles
  for select to authenticated
  using (public.mi_rol()::text = 'cobranza' and rol = 'cliente'::rol_nodus);
