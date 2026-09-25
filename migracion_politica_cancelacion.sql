-- =====================================================================
-- Política de cancelación y reembolsos: qué versión aceptó el cliente al pagar.
--
--   politica_version       versión del texto que aceptó (lib/politicaCancelacion.ts)
--   politica_aceptada_at   cuándo la aceptó
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase.
-- Si no se corre, los pagos siguen funcionando (solo no queda el registro).
-- =====================================================================

alter table public.pagos add column if not exists politica_version text;
alter table public.pagos add column if not exists politica_aceptada_at timestamptz;
