-- =====================================================================
-- Coworking de Bosques: agrega C1 y C2 (compartidos, sin límite de
-- empresas), igual que C3 a C11. Requiere haber corrido antes
-- migracion_coworking_compartido_bosques.sql (columna "compartida").
-- Es seguro volver a correrlo: no duplica lugares.
-- =====================================================================

begin;

insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id, compartida)
select n.numero, 'Coworking', 'disponible', 'Aguascalientes', 'Bosques', 0, null, null, true
from (values ('C1'), ('C2')) as n(numero)
where not exists (
  select 1 from public.oficinas ya
  where ya.centro = 'Bosques' and ya.tipo = 'Coworking' and ya.numero = n.numero
);
update public.oficinas set compartida = true
where centro = 'Bosques' and tipo = 'Coworking' and numero in ('C1','C2');

commit;

-- Comprobación: deben salir C1 a C11, todos con compartida = true.
select numero, compartida, estado
from public.oficinas
where centro = 'Bosques' and tipo = 'Coworking'
order by length(numero), numero;
