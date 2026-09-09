-- =====================================================================
-- Evita traslapes de horario para la misma sala/espacio en el mismo
-- centro A NIVEL DE BASE DE DATOS (no solo en el navegador).
--
-- Problema que resuelve: el checkeo de "¿está ocupado?" en
-- reservaciones/page.tsx y CentroPanel.tsx solo vive en el frontend.
-- Si dos personas reservan el mismo horario casi al mismo tiempo, las
-- dos peticiones pueden pasar esa validación antes de que la primera
-- termine de guardarse, y terminan dos reservaciones traslapadas para
-- el mismo espacio. Este script agrega una restricción de exclusión de
-- Postgres que hace imposible ese traslape, sin importar cuántas
-- pestañas/usuarios reserven al mismo tiempo.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
--
-- ⚠️ Antes de correrlo: si ya existen reservaciones traslapadas en la
-- tabla (datos de prueba, etc.), el paso 6 va a fallar con un error de
-- "conflicting key value" — en ese caso hay que limpiar/cancelar esas
-- filas primero (poniendo estado a 'cancelada' o corrigiendo el
-- horario) y volver a correr el script.
--
-- NOTA sobre los intentos anteriores: las primeras dos versiones de
-- este script usaban una columna GENERATED ALWAYS ... STORED para
-- calcular el rango de horario, y fallaban con:
--   ERROR 42P17: generation expression is not immutable
-- Postgres exige que una columna generada use solo funciones
-- "immutable". El sospechoso obvio era el cast `::date`/`::time`
-- (son "stable"), así que el 2do intento cambió a `to_date(...)` +
-- `make_time(...)` pensando que esas sí eran immutable — pero
-- `to_date`/`to_timestamp` (las funciones que parsean texto con un
-- formato) también están marcadas como "stable" en Postgres, aunque
-- el formato se dé explícito, porque su documentación depende en
-- teoría de la configuración regional de la sesión. Por eso el mismo
-- error volvió a aparecer.
--
-- La solución de raíz: dejar de depender de una columna GENERATED (que
-- obliga a usar solo funciones immutable) y en su lugar usar un
-- TRIGGER (before insert/update) que calcule el rango de horario en
-- una columna normal. Un trigger en PL/pgSQL no tiene esa restricción,
-- así que puede usar cualquier función sin importar su volatilidad.
-- =====================================================================

-- 1) Extensión necesaria para poder comparar columnas de texto (=) junto
--    con un rango (&&) dentro de una misma restricción de exclusión.
create extension if not exists btree_gist;

-- 2) Si ya existían la restricción/columna de un intento anterior, las
--    quitamos primero para poder recrearlas limpias.
alter table public.reservaciones
  drop constraint if exists reservaciones_no_traslape;

alter table public.reservaciones
  drop column if exists rango_horario;

-- 3) Columna normal (NO generada) donde el trigger va a guardar el
--    rango de tiempo real de cada reservación.
alter table public.reservaciones
  add column rango_horario tsrange;

-- 4) Función del trigger: arma el rango a partir de fecha + hora_inicio
--    / hora_fin (guardadas como texto). `make_date`/`make_time` son
--    funciones normales de Postgres para construir fecha/hora a partir
--    de números — aquí no importa si son immutable o no, porque un
--    trigger no tiene esa restricción.
create or replace function public.calcular_rango_horario_reservacion()
returns trigger
language plpgsql
as $$
begin
  new.rango_horario := tsrange(
    make_date(
      split_part(new.fecha, '-', 1)::int,
      split_part(new.fecha, '-', 2)::int,
      split_part(new.fecha, '-', 3)::int
    ) + make_time(
      split_part(new.hora_inicio, ':', 1)::int,
      split_part(new.hora_inicio, ':', 2)::int,
      0
    ),
    make_date(
      split_part(new.fecha, '-', 1)::int,
      split_part(new.fecha, '-', 2)::int,
      split_part(new.fecha, '-', 3)::int
    ) + make_time(
      split_part(new.hora_fin, ':', 1)::int,
      split_part(new.hora_fin, ':', 2)::int,
      0
    ),
    '[)'
  );
  return new;
end;
$$;

-- 5) El trigger: corre antes de cada insert/update y recalcula
--    rango_horario automáticamente — no hay que tocar ningún insert
--    existente en el código de la app.
drop trigger if exists trg_calcular_rango_horario on public.reservaciones;

create trigger trg_calcular_rango_horario
  before insert or update on public.reservaciones
  for each row
  execute function public.calcular_rango_horario_reservacion();

-- 6) Backfill: recalcula rango_horario para las reservaciones que ya
--    existían antes de este script (el trigger solo dispara en filas
--    nuevas o modificadas de aquí en adelante, así que esto llena las
--    que ya estaban). El valor de la derecha no importa: el trigger
--    ignora lo que le mandes y recalcula todo desde fecha/hora_inicio/
--    hora_fin.
update public.reservaciones set rango_horario = rango_horario;

-- 7) La restricción: mismo espacio + mismo centro + rango de horario que
--    se traslapa + estado "vivo" (pendiente o confirmada) => Postgres
--    rechaza el segundo insert/update con el código de error 23P01.
--    Las canceladas/rechazadas no cuentan, así que ese mismo horario se
--    puede volver a reservar después de una cancelación.
alter table public.reservaciones
  add constraint reservaciones_no_traslape
  exclude using gist (
    espacio with =,
    centro with =,
    rango_horario with &&
  )
  where (estado in ('pendiente', 'confirmada'));

-- =====================================================================
-- El código de la app (reservaciones/page.tsx, CentroPanel.tsx y
-- CotizarForm.tsx) ya está preparado para detectar el código de error
-- 23P01 y mostrar un mensaje amigable ("Ese horario ya fue tomado por
-- alguien más") en vez del error crudo de Postgres.
-- =====================================================================
