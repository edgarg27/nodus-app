-- =====================================================================
-- Migración: forma de pago (por adelantado / mes a mes)
--
--   'adelantado' → se cobra todo el periodo al aprobar el contrato
--                  (Coworking siempre; Oficina Privada si el cliente elige).
--   'mensual'    → solo Oficina Privada: se cobra un mes y luego cada mes
--                  del día 1 al 10; si no paga a tiempo, en la siguiente
--                  factura se le cobra un recargo del 3%.
--   null         → contratos anteriores a esta migración: el cron de
--                  facturación los sigue tratando exactamente como hasta hoy.
--
-- Corre esto ANTES de desplegar el código nuevo (el cron de facturación
-- lee contratos.forma_pago).
--
-- Es seguro volver a correr este archivo. Se corre a mano en el SQL Editor
-- de Supabase.
-- =====================================================================

alter table public.cotizaciones_comerciales
  add column if not exists forma_pago text
  check (forma_pago in ('adelantado', 'mensual'));

alter table public.contratos
  add column if not exists forma_pago text
  check (forma_pago in ('adelantado', 'mensual'));
