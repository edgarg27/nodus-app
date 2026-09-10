-- =====================================================================
-- Cotizaciones comerciales: prospecto ligado y tipo de persona
--
-- Qué agrega:
--   Columnas `prospecto_id` y `tipo_persona` en `cotizaciones_comerciales`.
--
--   `prospecto_id` liga la cotización con el prospecto del que nació (ver
--   botón "🧾 Cotizar" en la pestaña Prospectos) — permite que /prospectos
--   detecte cuándo un prospecto ya tiene cotización y pase su estado a
--   "en_seguimiento" automáticamente.
--
--   `tipo_persona` ("fisica" / "moral") captura con qué tipo de persona se
--   está cotizando — dato que hoy no existe en ningún punto del flujo de
--   cotizar.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.cotizaciones_comerciales add column if not exists prospecto_id uuid references public.prospectos(id);
alter table public.cotizaciones_comerciales add column if not exists tipo_persona text;
