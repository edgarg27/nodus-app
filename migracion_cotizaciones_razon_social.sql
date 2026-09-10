-- =====================================================================
-- Razón social para persona moral
--
-- Qué agrega:
--   Columna `razon_social` en `cotizaciones_comerciales`. Los contratos
--   reales de persona moral (NBC) piden la razón social de la empresa Y
--   el nombre del representante legal por separado — hasta ahora
--   `nombre_contesta_telefono` solo guardaba un nombre. Con persona
--   moral, `nombre_contesta_telefono` pasa a representar al
--   representante legal y `razon_social` a la empresa.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.cotizaciones_comerciales add column if not exists razon_social text;
