-- =====================================================================
-- RFC capturado al cotizar
--
-- Qué agrega:
--   Columna `rfc` en `cotizaciones_comerciales`. Antes el RFC se pedía
--   hasta el botón "✓ Aceptar" de /cotizaciones (con un prompt()) — ahora
--   se captura junto con los demás datos comerciales en CotizarForm.tsx
--   (junto a razón social), y /api/cotizacion-aceptar lo lee de aquí en
--   vez de pedirlo en la petición. `contratos.rfc` (agregada en el
--   trabajo anterior) sigue guardándose igual, solo cambia de dónde sale
--   el valor.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.cotizaciones_comerciales add column if not exists rfc text;
