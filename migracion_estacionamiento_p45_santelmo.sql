-- Adicional "Estacionamiento" para Punto 45 y San Telmo: copia del de Bosques (mismo nombre,
-- descripción y costo). Solo agrega si el centro no lo tiene. Es seguro volver a correrlo.
insert into public.adicionales_catalogo (centro, nombre, descripcion, costo_unitario, activo)
select destino.centro, b.nombre, b.descripcion, b.costo_unitario, b.activo
from public.adicionales_catalogo b
cross join (values ('Punto 45'), ('San Telmo')) as destino(centro)
where b.centro = 'Bosques'
  and b.nombre = 'Estacionamiento'
  and not exists (
    select 1 from public.adicionales_catalogo x
    where x.centro = destino.centro and x.nombre = b.nombre
  );

select centro, nombre, costo_unitario
from public.adicionales_catalogo
where centro in ('Bosques', 'Punto 45', 'San Telmo')
order by nombre, centro;
