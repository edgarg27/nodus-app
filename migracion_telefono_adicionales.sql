-- Teléfono como adicional del catálogo, en todos los centros:
--   * "Teléfono (DID)": número propio, $100 al mes (se cobra junto con la renta).
--   * "Extensión telefónica": comunicación con recepción, gratis ($0).
-- Es idempotente: si el adicional ya existe en un centro, no lo duplica.

insert into adicionales_catalogo (centro, nombre, descripcion, costo_unitario, activo)
select c.centro, a.nombre, a.descripcion, a.costo_unitario, true
from (values
  ('Bosques'), ('Punto 45'), ('San Telmo'),
  ('Puerta Bajío Piso 2'), ('Puerta Bajío Piso 8'), ('Stadium'), ('ILEVA')
) as c(centro)
cross join (values
  ('Teléfono (DID)', 'Número telefónico propio (DID). Cargo mensual.', 100),
  ('Extensión telefónica', 'Extensión para comunicarse con recepción. Sin costo.', 0)
) as a(nombre, descripcion, costo_unitario)
where not exists (
  select 1 from adicionales_catalogo x
  where x.centro = c.centro and lower(x.nombre) = lower(a.nombre)
);
