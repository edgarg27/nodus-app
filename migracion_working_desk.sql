-- =====================================================================
-- Agrega "Working Desk" como tipo válido en el flujo de invitados
-- (/agendar-invitado) y en Day Pass.
--
-- Working Desk ya existía como concepto en el resto del sistema
-- (profiles.tipo_oficina, tours, cotizador) pero faltaba en estas dos
-- tablas públicas. No se crea tabla de inventario nueva: se agenda como
-- un renglón más del calendario admin (igual que Coworking hoy).
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.solicitudes_invitados drop constraint if exists solicitudes_invitados_tipo_check;
alter table public.solicitudes_invitados add constraint solicitudes_invitados_tipo_check
  check (tipo in (
    'sala_juntas', 'coworking', 'oficina_privada', 'working_desk',
    'day_pass_coworking', 'day_pass_oficina_privada', 'day_pass_working_desk'
  ));

alter table public.day_passes drop constraint if exists day_passes_tipo_check;
alter table public.day_passes add constraint day_passes_tipo_check
  check (tipo in ('coworking', 'oficina_privada', 'working_desk'));
