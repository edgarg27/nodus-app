-- =====================================================================
-- Renovación de contrato
--
-- Qué agrega:
--   Columna `renovacion` en `cotizaciones_comerciales`. CotizarForm.tsx
--   agrega la casilla "¿Es renovación de un contrato existente?" — solo
--   cuando está marcada se pide y se guarda el "% de incremento" (antes
--   se pedía siempre, sin importar si era cliente nuevo o renovación).
--   Guardarlo en su propia columna permite filtrar/reportar renovaciones
--   más adelante, no solo inferirlo de si porcentaje_incremento es
--   distinto de null.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.cotizaciones_comerciales add column if not exists renovacion boolean not null default false;
