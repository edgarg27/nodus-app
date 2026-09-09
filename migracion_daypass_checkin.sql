-- =====================================================================
-- Check-in de Day Pass + control de "un solo uso por persona"
--
-- Qué agrega a la tabla `day_passes` que ya existe:
--   - telefono, email: se guardan al generar el pase (antes solo se
--     usaban para mandar el correo, no se guardaban). Sirven para
--     identificar si esta persona ya usó un Day Pass antes.
--   - usado, usado_en, aceptado_por, aceptado_por_nombre: se llenan
--     cuando el staff acepta al invitado en sitio (pantalla de
--     check-in, no en cuanto se genera el pase).
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase (después de haber
-- corrido ya migracion_invitados_daypass.sql).
-- =====================================================================

alter table public.day_passes add column if not exists telefono text;
alter table public.day_passes add column if not exists email text;
alter table public.day_passes add column if not exists usado boolean not null default false;
alter table public.day_passes add column if not exists usado_en timestamptz;
alter table public.day_passes add column if not exists aceptado_por uuid references public.profiles(id) on delete set null;
alter table public.day_passes add column if not exists aceptado_por_nombre text;

-- Índices para buscar rápido si esta persona (por teléfono, correo o
-- nombre) ya tiene un Day Pass usado anteriormente.
create index if not exists day_passes_telefono_idx on public.day_passes (telefono);
create index if not exists day_passes_email_lower_idx on public.day_passes (lower(email));
create index if not exists day_passes_nombre_lower_idx on public.day_passes (lower(nombre));

-- No se necesitan políticas de RLS nuevas: la política existente
-- "day_passes_staff_all" (cualquier rol que no sea "cliente") ya cubre
-- leer, actualizar y crear estos pases, incluyendo marcar "usado".
