-- Cuántas veces se envió por correo cada estado de cuenta (columna "Envíos" del historial). Es seguro correrlo más de una vez.
alter table public.facturas add column if not exists envios_estado integer not null default 0;
