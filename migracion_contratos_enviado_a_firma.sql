-- =====================================================================
-- Seguimiento de la firma en Cincel: fecha de envío
--
-- Qué agrega:
--   Columna `enviado_a_firma_at` en `contratos` — se llena cuando ventas
--   marca "Enviado a Cincel" en el modal del contrato (Contratos ->
--   Pendientes de aprobación). Con ella se sabe en qué paso va cada
--   contrato: sin archivo -> "Listo para firma" -> "En Cincel" -> firmado
--   (se sube el PDF firmado y se aprueba).
--
-- La firma legal se hace en Cincel, no en la app. Las columnas `firmado`,
-- `firmado_at`, `firmado_ip` y `firma_url` ya existen (de la firma por liga
-- que se retiró); no se usan para contratos nuevos y no se borran.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.contratos add column if not exists enviado_a_firma_at timestamptz;
