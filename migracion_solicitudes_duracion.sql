-- =====================================================================
-- Agrega duración (hora / día / semana) a las solicitudes de invitados
-- (/agendar-invitado), para que los eventuales sin contrato puedan pedir
-- no solo un horario puntual sino también "todo el día" o "toda la
-- semana" (ej. un working desk por una semana).
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.solicitudes_invitados
  add column if not exists duracion_tipo text not null default 'hora'
    check (duracion_tipo in ('hora', 'dia', 'semana'));

alter table public.solicitudes_invitados
  add column if not exists fecha_fin_deseada text; -- 'YYYY-MM-DD', solo se llena cuando duracion_tipo = 'semana'

-- Backfill: los Day Pass ya existentes siempre fueron "de un día completo".
update public.solicitudes_invitados set duracion_tipo = 'dia'
  where tipo in ('day_pass_coworking', 'day_pass_oficina_privada', 'day_pass_working_desk');
