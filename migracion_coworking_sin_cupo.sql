-- Horas Cowork sin cupo: el espacio compartido "Coworking" (Bosques: lugares C3–C11) lo pueden apartar varios
-- clientes a la misma hora. La regla que impide traslapes (migracion_no_traslape_reservaciones.sql) sigue para todos
-- los demás espacios (salas de juntas, sala de capacitación…). Que un mismo cliente no se aparte dos veces la misma
-- hora lo revisa la pantalla.
-- Es seguro volver a correrlo.

alter table public.reservaciones
  drop constraint if exists reservaciones_no_traslape;

alter table public.reservaciones
  add constraint reservaciones_no_traslape
  exclude using gist (
    espacio with =,
    centro with =,
    rango_horario with &&
  )
  where (estado in ('pendiente', 'confirmada') and espacio <> 'Coworking');

-- Comprobación: debe salir la restricción con la condición nueva.
select conname, pg_get_constraintdef(oid) from pg_constraint where conname = 'reservaciones_no_traslape';
