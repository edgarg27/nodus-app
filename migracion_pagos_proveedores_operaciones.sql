-- =====================================================================
-- Pagos a proveedores de Operaciones (la arquitecta).
--
-- Cada pago a proveedor es un renglón de "gastos" con tipo = 'operaciones':
-- así Contabilidad lo ve en su pantalla de Gastos y lo marca pagado, igual
-- que los gastos de las admins. Se agregan las columnas que lleva su Excel:
--   * oficina        → "OF" (ej. OF 18, P2 general, Baños)
--   * folio_factura  → folio o UUID de la factura
--   * subtotal       → "S/IVA"  (monto sigue siendo el NETO)
--   * fecha_factura  → fecha de la factura
-- (La especialidad va en "categoria" y la fecha de pago la pone Contabilidad.)
--
-- Permisos: Operaciones registra, ve, corrige y borra SUS pagos (tipo
-- 'operaciones') y sus proveedores en TODOS los centros, no solo en el de su
-- perfil. Ya pagados o marcados "no se paga" no se pueden cambiar (lo cuida
-- el trigger gastos_candado_revisado de migracion_rol_gastos.sql).
--
-- Solo agrega columnas y políticas; no toca las de los demás roles.
-- Es seguro volver a correrlo.
-- Rollback: borrar las 2 políticas "*_operaciones_todos" (las columnas
--   pueden quedarse, están vacías para los demás gastos).
-- =====================================================================

begin;

alter table public.gastos add column if not exists oficina text;
alter table public.gastos add column if not exists folio_factura text;
alter table public.gastos add column if not exists subtotal numeric(12, 2);
alter table public.gastos add column if not exists fecha_factura date;

-- ---------- Gastos de Operaciones en todos los centros ----------
drop policy if exists "gastos_operaciones_todos" on public.gastos;
create policy "gastos_operaciones_todos" on public.gastos
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones' and tipo = 'operaciones')
  with check (public.mi_rol()::text = 'operaciones' and tipo = 'operaciones');

-- ---------- Proveedores de Operaciones en todos los centros ----------
drop policy if exists "proveedores_operaciones_todos" on public.proveedores;
create policy "proveedores_operaciones_todos" on public.proveedores
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones' and tipo = 'operaciones')
  with check (public.mi_rol()::text = 'operaciones' and tipo = 'operaciones');

commit;

-- Comprobación: deben salir las 4 columnas y las 2 políticas.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'gastos'
  and column_name in ('oficina', 'folio_factura', 'subtotal', 'fecha_factura');

select tablename, policyname, cmd
from pg_policies
where policyname in ('gastos_operaciones_todos', 'proveedores_operaciones_todos');
