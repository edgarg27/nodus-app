-- =====================================================================
-- Planes de Coworking para Punto 45 y San Telmo: copia de los de Bosques
-- (CoNova, CoStar, CoPlatino y 30 Horas), con los mismos precios, horas de
-- sala de juntas incluidas y bolsa de horas. Los precios de coworking son
-- iguales en todos los centros (lista "Precios Coworking 2026").
--
-- Solo agrega los que falten: si un centro ya tiene un plan con ese mismo
-- nombre, no lo duplica ni lo cambia. Es seguro volver a correrlo.
-- =====================================================================

insert into public.paquetes (
  centro, nombre, precio, descripcion, incluye_horas_sala_juntas, tipo_espacio,
  precio_hora, precio_dia, precio_semana, precio_mes, horas_bolsa, bloquea_reasignacion
)
select
  destino.centro, p.nombre, p.precio, p.descripcion, p.incluye_horas_sala_juntas, p.tipo_espacio,
  p.precio_hora, p.precio_dia, p.precio_semana, p.precio_mes, p.horas_bolsa, p.bloquea_reasignacion
from public.paquetes p
cross join (values ('Punto 45'), ('San Telmo')) as destino(centro)
where p.centro = 'Bosques'
  and p.tipo_espacio = 'Coworking'
  and not exists (
    select 1 from public.paquetes ya
    where ya.centro = destino.centro and ya.nombre = p.nombre
  );

-- Revisión: los planes de Coworking de los tres centros.
select centro, nombre, precio_mes, incluye_horas_sala_juntas, horas_bolsa
from public.paquetes
where tipo_espacio = 'Coworking' and centro in ('Bosques', 'Punto 45', 'San Telmo')
order by nombre, centro;
