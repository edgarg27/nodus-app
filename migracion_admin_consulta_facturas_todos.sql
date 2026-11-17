-- =====================================================================
-- Admin de centro: puede CONSULTAR (solo lectura) facturas, pagos y
-- complementos de pago de CUALQUIER centro, no solo el suyo.
--
-- Modificar (timbrar, cancelar, borrar, integrar) sigue siendo SOLO de su
-- propio centro: eso lo cuidan las políticas de escritura (insert/update/
-- delete que exigen p.centro = <tabla>.centro) y los candados de las rutas
-- (/api/facturas/cancelar, borrar, facturar). Aquí SOLO se amplía la LECTURA.
--
-- Políticas ADITIVAS (permisivas, se suman a las que ya hay): solo amplían,
-- nunca quitan. No se toca ninguna política de profiles (no afecta login) ni
-- las de escritura.
--
-- Es seguro volver a correrlo.
-- =====================================================================

begin;

drop policy if exists "facturas_admin_consulta_todos" on public.facturas;
create policy "facturas_admin_consulta_todos" on public.facturas
  for select to authenticated
  using (public.mi_rol()::text = 'admin');

drop policy if exists "pagos_admin_consulta_todos" on public.pagos;
create policy "pagos_admin_consulta_todos" on public.pagos
  for select to authenticated
  using (public.mi_rol()::text = 'admin');

drop policy if exists "complementos_admin_consulta_todos" on public.complementos_pago;
create policy "complementos_admin_consulta_todos" on public.complementos_pago
  for select to authenticated
  using (public.mi_rol()::text = 'admin');

drop policy if exists "comp_fact_admin_consulta_todos" on public.complemento_pago_facturas;
create policy "comp_fact_admin_consulta_todos" on public.complemento_pago_facturas
  for select to authenticated
  using (public.mi_rol()::text = 'admin');

commit;

-- Para revertir:
-- begin;
--   drop policy if exists "facturas_admin_consulta_todos" on public.facturas;
--   drop policy if exists "pagos_admin_consulta_todos" on public.pagos;
--   drop policy if exists "complementos_admin_consulta_todos" on public.complementos_pago;
--   drop policy if exists "comp_fact_admin_consulta_todos" on public.complemento_pago_facturas;
-- commit;
