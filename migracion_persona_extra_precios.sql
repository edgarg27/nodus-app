-- Precios de "Persona extra" parejos en Bosques, Punto 45 y San Telmo (sin IVA, como los demás
-- adicionales del catálogo):
--   - Persona extra (Oficina): $500 (Punto 45 y San Telmo estaban en $0).
--   - Persona extra (Coworking): $600, solo para CoStar y CoPlatino, máximo 3 personas extra por
--     paquete (lista "Precios Coworking 2026"). La app no filtra por plan: la regla queda escrita en
--     la descripción, que es lo que ven al elegir el adicional.
-- Es seguro volver a correrlo.
update public.adicionales_catalogo
set costo_unitario = 500
where nombre = 'Persona extra (Oficina)'
  and centro in ('Bosques', 'Punto 45', 'San Telmo');

update public.adicionales_catalogo
set costo_unitario = 600,
    descripcion = 'Persona adicional en coworking: solo CoStar y CoPlatino, máximo 3 por paquete. Precio más IVA.'
where nombre = 'Persona extra (Coworking)'
  and centro in ('Bosques', 'Punto 45', 'San Telmo');

select centro, nombre, costo_unitario, descripcion
from public.adicionales_catalogo
where nombre like 'Persona extra%' and centro in ('Bosques', 'Punto 45', 'San Telmo')
order by nombre, centro;
