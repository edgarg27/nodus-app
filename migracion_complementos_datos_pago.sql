-- =====================================================================
-- Datos del pago en el complemento de pago.
--
--   numero_operacion  referencia bancaria (SPEI, voucher…); va también en el CFDI
--   notas             notas internas (no aparecen en el CFDI)
--   comprobante_url   comprobante de pago adjunto (bucket privado "facturas")
--
-- No cambia RLS. Es seguro volver a correrlo.
-- Hay que correrlo ANTES de desplegar.
-- Rollback: alter table public.complementos_pago drop column numero_operacion, drop column notas, drop column comprobante_url;
-- =====================================================================

alter table public.complementos_pago
  add column if not exists numero_operacion text,
  add column if not exists notas text,
  add column if not exists comprobante_url text;

-- Revisión: deben aparecer las tres columnas.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'complementos_pago'
  and column_name in ('numero_operacion', 'notas', 'comprobante_url')
order by column_name;
