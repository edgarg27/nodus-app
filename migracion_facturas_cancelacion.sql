-- =====================================================================
-- Cancelación de facturas (CFDI) emitidas con Facturapi.
--
-- Agrega a `facturas` lo necesario para cancelar un CFDI ante el SAT y
-- seguir su estatus:
--   facturapi_id               id de la factura en Facturapi (para cancelarla)
--   cancelacion_estatus        null = vigente · en_proceso (esperando que el
--                              cliente acepte) · cancelada · rechazada
--   cancelacion_motivo         clave SAT: 01, 02, 03 o 04
--   cancelacion_sustituta_uuid UUID de la factura que la sustituye (motivo 01)
--   cancelacion_solicitada_en  cuándo se pidió
--   cancelacion_solicitada_por quién la pidió
--
-- No cambia `estado` (pendiente / parcial / pagada / vencida): una factura
-- cancelada conserva su cobro; lo que pierde es el CFDI vigente.
--
-- Es seguro volver a correrlo. Hay que correrlo ANTES de desplegar.
-- =====================================================================

alter table public.facturas
  add column if not exists facturapi_id text,
  add column if not exists cancelacion_estatus text,
  add column if not exists cancelacion_motivo text,
  add column if not exists cancelacion_sustituta_uuid text,
  add column if not exists cancelacion_solicitada_en timestamptz,
  add column if not exists cancelacion_solicitada_por uuid references auth.users(id) on delete set null;

alter table public.facturas drop constraint if exists facturas_cancelacion_estatus_check;
alter table public.facturas
  add constraint facturas_cancelacion_estatus_check
  check (cancelacion_estatus is null or cancelacion_estatus in ('en_proceso', 'cancelada', 'rechazada'));

alter table public.facturas drop constraint if exists facturas_cancelacion_motivo_check;
alter table public.facturas
  add constraint facturas_cancelacion_motivo_check
  check (cancelacion_motivo is null or cancelacion_motivo in ('01', '02', '03', '04'));

create index if not exists facturas_cancelacion_estatus_idx
  on public.facturas (cancelacion_estatus)
  where cancelacion_estatus is not null;

-- Revisión: las columnas nuevas deben aparecer aquí.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'facturas'
  and (column_name like 'cancelacion%' or column_name = 'facturapi_id')
order by column_name;
