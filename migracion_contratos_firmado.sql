-- =====================================================================
-- Confirmación de firma en contratos
--
-- Qué agrega:
--   Columna `firmado` en `contratos`. Hoy "Aprobar" solo exige que exista
--   un archivo cargado (`archivo_url`), no que alguien confirme que es la
--   versión firmada. Con esta columna, /contratos y ContratoModal.tsx
--   exigen también la casilla "Confirmo que el documento cargado es la
--   versión firmada" antes de habilitar el botón "✓ Aprobar".
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.contratos add column if not exists firmado boolean not null default false;
