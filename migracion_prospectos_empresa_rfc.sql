-- =====================================================================
-- Prospectos: empresa, RFC y día de pago
--
-- Qué agrega:
--   Columnas `empresa`, `rfc` y `dia_pago` en `prospectos` — los mismos
--   datos que ya se piden al dar de alta un cliente en /alta-cliente.
--   Capturarlos desde que el prospecto se registra evita volver a
--   preguntarlos si más adelante se convierte en cliente: tanto el
--   buscador de prospectos en /alta-cliente como el botón "👤 Nuevo
--   cliente" de la pestaña Prospectos ahora los pasan automáticamente.
--
-- No se necesita nada más de este lado: `nombre`, `telefono` y `email` ya
-- existían en `prospectos`.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.prospectos add column if not exists empresa text;
alter table public.prospectos add column if not exists rfc text;
alter table public.prospectos add column if not exists dia_pago integer;
