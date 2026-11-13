-- =====================================================================
-- Datos de pago de los proveedores (banco, titular, CLABE, cuenta y RFC).
--
-- Se capturan al registrar el proveedor (o después, con "Datos de pago" en su
-- tarjeta) y Contabilidad los ve en cada gasto por pagar para hacer la
-- transferencia sin pedirlos.
--
-- No cambia permisos: quien ya podía ver o editar un proveedor ve y edita
-- también sus datos de pago (y Contabilidad ya podía leer proveedores:
-- migracion_rol_gastos.sql).
-- Es seguro volver a correrlo.
-- Rollback: quitar las 5 columnas (se pierden los datos de pago capturados).
-- =====================================================================

begin;

alter table public.proveedores add column if not exists banco text;
alter table public.proveedores add column if not exists titular_cuenta text;
alter table public.proveedores add column if not exists clabe text;
alter table public.proveedores add column if not exists numero_cuenta text;
alter table public.proveedores add column if not exists rfc text;

commit;

-- Comprobación: deben salir las 5 columnas.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'proveedores'
  and column_name in ('banco', 'titular_cuenta', 'clabe', 'numero_cuenta', 'rfc');
