-- =====================================================================
-- Contratos por pasos (administradora -> ventas -> Cincel -> firmado)
--
-- Pasos:
--   1. La administradora descarga el machote y lo modifica.
--   2. Sube la versión modificada (ya mandada al cliente para que revise).
--      Cada archivo queda en `contrato_versiones`; la última es la vigente.
--   3. Cuando el cliente confirma, "Subir a firma" -> enviado_a_ventas_at.
--   4. Ventas ve la última versión en su panel, la sube a Cincel y deja un
--      mensaje para la administradora -> enviado_a_firma_at + mensaje_ventas
--      (enviado_a_firma_at ya existía: ahora significa "ventas ya lo subió
--      a Cincel").
--   5. Llega al correo de la administradora el contrato firmado por ambas
--      partes y lo sube -> archivo_firmado_url. Esa versión también pasa a
--      archivo_url, que es la que ven el cliente, ventas y la administradora.
--   6. La administradora aprueba el contrato (paso que ya existía).
--
-- Rol nuevo: `ventas` (profiles.rol es texto libre, no hay que tocar nada
-- más en la base; se crea desde Usuarios).
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase.
-- Rollback: alter table public.contratos drop column enviado_a_ventas_at,
--   drop column mensaje_ventas, drop column archivo_firmado_url,
--   drop column archivo_firmado_at;
-- =====================================================================

alter table public.contratos add column if not exists enviado_a_ventas_at timestamptz;
alter table public.contratos add column if not exists mensaje_ventas text;
alter table public.contratos add column if not exists archivo_firmado_url text;
alter table public.contratos add column if not exists archivo_firmado_at timestamptz;
