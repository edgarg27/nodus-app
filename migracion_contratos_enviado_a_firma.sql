-- =====================================================================
-- Flujo de firma por liga: fecha de envío a firma
--
-- Qué agrega:
--   Columna `enviado_a_firma_at` en `contratos` — se llena cuando la
--   admin manda el contrato por correo con la liga para firmar (ver
--   app/api/contratos/enviar-a-firma/route.ts). Las columnas para
--   registrar la firma en sí (`firmado`, `firmado_at`, `firmado_ip`,
--   `firma_url`) ya existían en la tabla sin usarse — ahora sí se usan:
--   se llenan cuando el cliente da clic en "Firmo y acepto" en la página
--   pública /firmar-contrato/[id] (ver app/api/contratos/firmar/route.ts).
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.contratos add column if not exists enviado_a_firma_at timestamptz;
