-- Precio de la hora extra de sala de juntas (cuando un cliente se pasa de las horas que incluye
-- su plan) para Punto 45 y San Telmo: $150, igual que Bosques. Sin esta fila la app ya cobra
-- $150 por defecto; aquí queda registrado para poder cambiarlo por centro.
-- Solo agrega si el centro no tiene precio. Es seguro volver a correrlo.
insert into public.precios_sala_juntas (centro, precio_hora)
select c.centro, 150
from (values ('Punto 45'), ('San Telmo')) as c(centro)
where not exists (select 1 from public.precios_sala_juntas p where p.centro = c.centro);

select centro, precio_hora from public.precios_sala_juntas order by centro;
