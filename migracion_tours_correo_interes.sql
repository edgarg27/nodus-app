-- =====================================================================
-- Tours: correo, tipo de espacio de interés y control de recordatorio
--
-- Qué agrega:
--   Columnas nuevas en `tours` para poder mandar correo de confirmación
--   al agendar y un recordatorio automático un día antes:
--   - correo: para poder contactar al prospecto por correo.
--   - tipo_espacio_interes: qué tipo de espacio le interesó (Coworking,
--     Oficina Privada, Working Desk, Sala de Juntas) — así el admin ve de
--     un vistazo con qué expectativa llega, sin tener que preguntar de
--     nuevo el día del tour.
--   - recordatorio_enviado: evita mandar el recordatorio dos veces si el
--     cron corre más de una vez el mismo día.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.tours add column if not exists correo text;
alter table public.tours add column if not exists tipo_espacio_interes text;
alter table public.tours add column if not exists recordatorio_enviado boolean not null default false;
