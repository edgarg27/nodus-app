-- =====================================================================
-- Cotizador: teléfono y correo de contacto (Datos comerciales)
--
-- Qué agrega:
--   Columnas `telefono_contesta` y `correo_contesta` en
--   `cotizaciones_comerciales` — teléfono y correo de quien solicita la
--   cotización cuando no hay un cliente con cuenta ligado (mismo caso que
--   `nombre_contesta_telefono`, que ya existía). Se llenan a mano en el
--   formulario de Cotizar, o automáticamente al elegir un prospecto ya
--   registrado en la pestaña Prospectos.
--
-- Aplica a los 4 tipos de espacio (Oficina privada, Coworking, Working
-- Desk y Sala de Juntas) porque todos comparten el mismo bloque de "Datos
-- comerciales" y la misma tabla `cotizaciones_comerciales`.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.cotizaciones_comerciales add column if not exists telefono_contesta text;
alter table public.cotizaciones_comerciales add column if not exists correo_contesta text;
