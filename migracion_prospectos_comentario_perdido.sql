-- =====================================================================
-- Prospectos: motivo al marcar como "Perdido"
--
-- Qué agrega:
--   1) Columna `comentario_perdido` en `prospectos` — el motivo que se
--      captura cuando un admin cambia el estado de un prospecto a
--      "Perdido" (por qué se perdió o por qué ya no se le dio
--      seguimiento). Se limpia (vuelve a null) si el prospecto se mueve
--      a cualquier otro estado.
--
-- No hace falta nada más de este lado: no se necesita RLS adicional,
-- las mismas policies que ya permiten actualizar `prospectos` cubren
-- esta columna.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.prospectos add column if not exists comentario_perdido text;
