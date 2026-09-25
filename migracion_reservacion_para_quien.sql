-- =====================================================================
-- Reservaciones: para quién se aparta el espacio
--
-- Desde el calendario del Panel de Centro, quien aparta un horario dice a qué
-- cliente se lo aparta o, si todavía no es cliente, a qué prospecto. Ese nombre
-- se ve en el calendario y en la lista de reservaciones.
--   para_nombre      nombre que se muestra (cliente, prospecto o invitado)
--   para_cliente_id  cuenta del cliente, si lo hay
--   prospecto_id     prospecto, si todavía no es cliente
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase,
-- ANTES de probar el calendario nuevo (sin las columnas, la lista de
-- reservaciones no carga).
-- Rollback: alter table public.reservaciones drop column para_nombre,
--   drop column para_cliente_id, drop column prospecto_id;
-- =====================================================================

alter table public.reservaciones add column if not exists para_nombre text;
alter table public.reservaciones add column if not exists para_cliente_id uuid references public.profiles(id) on delete set null;
alter table public.reservaciones add column if not exists prospecto_id uuid references public.prospectos(id) on delete set null;
