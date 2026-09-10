-- =====================================================================
-- RFC del cliente en el contrato
--
-- Qué agrega:
--   Columna `rfc` en `contratos`. Se captura al aceptar la cotización
--   (justo antes de generar el .docx del contrato, ver
--   app/api/cotizacion-aceptar/route.ts) para que el contrato ya salga
--   con el RFC real en vez del placeholder "COLOCAR RFC". Queda guardado
--   en el contrato para que /alta-cliente lo use como valor inicial al
--   crear la cuenta del cliente (profiles.rfc), sin tener que volver a
--   preguntarlo.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.contratos add column if not exists rfc text;
