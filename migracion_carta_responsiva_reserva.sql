-- =====================================================================
-- Carta responsiva de Sala de Juntas ligada a la reservación
--
-- Cuando llega la hora de una reservación de sala, Reservaciones avisa que
-- falta la carta responsiva (la sala se entrega en orden y se anota lo que
-- falte). La carta firmada queda ligada a su reservación para saber cuáles ya
-- tienen carta.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase,
-- ANTES de firmar la primera carta desde el aviso.
-- Rollback: alter table public.registros_sala_juntas drop column reservacion_id;
-- =====================================================================

alter table public.registros_sala_juntas
  add column if not exists reservacion_id uuid references public.reservaciones(id) on delete set null;

create index if not exists registros_sala_juntas_reservacion_idx
  on public.registros_sala_juntas (reservacion_id);
