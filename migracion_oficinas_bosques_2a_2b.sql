-- =====================================================================
-- Bosques: la oficina 2 la van a compartir 3 empresas, así que se agregan
-- la "2A" y la "2B" (la "2" se queda como está) para que cada empresa
-- tenga su propia oficina y su propio contrato.
--
-- Se copian de la oficina 2: tipo, ciudad, precio, notas y paquete
-- (Premium). Entran como "disponible" y sin pin en el mapa: en Mapa de
-- oficinas > Editar se arrastran desde la bandeja hasta su lugar.
-- Igual que San Telmo, que ya tiene 2A y 2B.
-- Solo agrega lo que falte: es seguro volver a correrlo.
-- =====================================================================

insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id)
select n.numero, o.tipo, 'disponible', o.ciudad, o.centro, o.precio, o.notas, o.paquete_default_id
from public.oficinas o
cross join (values ('2A'), ('2B')) as n(numero)
where o.centro = 'Bosques'
  and o.numero = '2'
  and o.tipo = 'Oficina Privada'
  and not exists (
    select 1 from public.oficinas ya
    where ya.centro = 'Bosques' and ya.numero = n.numero and ya.tipo = o.tipo
  );

-- Comprobación: deben salir la 2, la 2A y la 2B, con el mismo paquete.
select o.numero, o.tipo, o.estado, o.precio, p.nombre as paquete
from public.oficinas o
left join public.paquetes p on p.id = o.paquete_default_id
where o.centro = 'Bosques' and o.numero in ('2', '2A', '2B')
order by o.numero;
