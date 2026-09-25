-- =====================================================================
-- Horas Cowork: registro de llegada y cobro de horas
--
-- Qué agrega a `reservaciones`:
--   asistencia      'llego' | 'no_llego' | null. Lo registra recepción.
--   horas_cobradas  horas que ya se descontaron del banco del contrato.
--                   Se llena al registrar la llegada (recepción puede
--                   ajustarlas), al marcar "No asistió" o cuando el cliente
--                   cancela con menos de 2 horas de anticipación.
--   llegada_at      cuándo se registró la llegada.
--
-- Reglas que aplica el trigger (no dependen del navegador):
--   1. Un cliente NO puede tocar asistencia, horas_cobradas ni llegada_at,
--      y lo único que puede hacer con el estado de su reservación es
--      cancelarla. Solo el staff puede registrar llegadas.
--   2. Si el cliente cancela una reservación CONFIRMADA de Coworking o
--      Sala de Capacitación con menos de 2 horas de anticipación, sus horas
--      se cobran (horas_cobradas = lo que duraba). Con 2 horas o más, las
--      horas se devuelven. La hora se toma en America/Mexico_City.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase.
-- Rollback: drop trigger reservaciones_reglas_horas on public.reservaciones;
--           drop function public.reservaciones_reglas_horas();
-- =====================================================================

alter table public.reservaciones add column if not exists asistencia text;
alter table public.reservaciones add column if not exists horas_cobradas numeric(4,1);
alter table public.reservaciones add column if not exists llegada_at timestamptz;

alter table public.reservaciones drop constraint if exists reservaciones_asistencia_check;
alter table public.reservaciones
  add constraint reservaciones_asistencia_check
  check (asistencia is null or asistencia in ('llego', 'no_llego'));

alter table public.reservaciones drop constraint if exists reservaciones_horas_cobradas_check;
alter table public.reservaciones
  add constraint reservaciones_horas_cobradas_check
  check (horas_cobradas is null or horas_cobradas >= 0);

create or replace function public.reservaciones_reglas_horas()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inicio timestamptz;
  v_horas numeric;
begin
  -- Staff, service role y SQL Editor pasan sin restricción.
  if auth.uid() is null or public.es_staff() then
    return new;
  end if;

  if new.asistencia is distinct from old.asistencia
     or new.horas_cobradas is distinct from old.horas_cobradas
     or new.llegada_at is distinct from old.llegada_at then
    raise exception 'Solo el personal puede registrar la asistencia y las horas cobradas.';
  end if;

  if new.estado is distinct from old.estado and new.estado <> 'cancelada' then
    raise exception 'Una reservación solo se puede cancelar desde tu cuenta.';
  end if;

  if new.estado = 'cancelada'
     and old.estado = 'confirmada'
     and (new.espacio like 'Coworking%' or new.espacio like 'Sala de Capacitación%')
     and new.hora_inicio is not null and new.hora_fin is not null then
    v_inicio := (new.fecha::date + new.hora_inicio::time) at time zone 'America/Mexico_City';
    if v_inicio - now() < interval '2 hours' then
      v_horas := extract(epoch from (new.hora_fin::time - new.hora_inicio::time)) / 3600;
      new.horas_cobradas := round(v_horas, 1);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists reservaciones_reglas_horas on public.reservaciones;
create trigger reservaciones_reglas_horas
  before update on public.reservaciones
  for each row execute function public.reservaciones_reglas_horas();
