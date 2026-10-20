-- =====================================================================
-- Punto 45: planes de oficina y espacios (oficinas, aulas, Working Desk y
-- coworking), igual que los tiene Bosques.
--
-- Planes (precio mensual sin IVA, horas de sala de juntas incluidas):
--   Nova $8,480 (6 h) · Star $11,370 (8 h) · Platino $17,119 (10 h)
--   Premium Plus $20,655 (13 h) · Premium especial $35,000 (15 h)
--   Working Desk $3,225 (8 h)
--
-- Espacios (del plano de Punto 45; cada oficina toma el precio de su plan):
--   Zona A: oficinas 1 a 20. Las de "Cotización especial" (8, 9, 10, 13-14
--     y 17-18) no llevan plan: su precio se pone al cotizar.
--   Zona B: aulas 1 a 10 con su propio precio (All inclusive). En notas van
--     los m² y los otros dos precios (Semi adecuado y Sin servicios ni
--     mobiliario). El aula 9 es el comedor: queda dada de alta solo por si
--     algún día se renta.
--   Working Desk 1 a 6 y 50 lugares de Coworking (misma numeración que Bosques).
--
-- Todo entra como "disponible": la administradora marca lo rentado al dar de alta
-- a cada cliente. Solo agrega lo que falte: es seguro volver a correrlo.
-- =====================================================================

-- ----------------------------------------------------------- 1) Planes
insert into public.paquetes (
  centro, nombre, precio, descripcion, incluye_horas_sala_juntas, tipo_espacio,
  precio_hora, precio_dia, precio_semana, precio_mes, horas_bolsa, bloquea_reasignacion
)
select 'Punto 45', p.nombre, p.precio, null, p.horas, p.tipo, null, null, null, p.precio, 0, false
from (values
  ('Nova',             8480,  6, 'Oficina Privada'),
  ('Star',             11370, 8, 'Oficina Privada'),
  ('Platino',          17119, 10, 'Oficina Privada'),
  ('Premium Plus',     20655, 13, 'Oficina Privada'),
  ('Premium especial', 35000, 15, 'Oficina Privada'),
  ('Working Desk',     3225,  8, 'Working Desk')
) as p(nombre, precio, horas, tipo)
where not exists (
  select 1 from public.paquetes ya where ya.centro = 'Punto 45' and ya.nombre = p.nombre
);

-- ------------------------------------------- 2) Oficinas de la Zona A
insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id)
select o.numero, 'Oficina Privada', 'disponible', 'Aguascalientes', 'Punto 45', null, o.notas,
  (select id from public.paquetes p where p.centro = 'Punto 45' and p.nombre = o.plan)
from (values
  ('1',     'Platino',          'Zona A · 15.80 m²'),
  ('2',     'Platino',          'Zona A · 16.25 m²'),
  ('3',     'Star',             'Zona A · 11.18 m²'),
  ('4',     'Premium especial', 'Zona A · 20.32 m²'),
  ('5',     'Star',             'Zona A · 10.12 m²'),
  ('6',     'Star',             'Zona A · 10.12 m²'),
  ('7',     'Star',             'Zona A · 12.37 m²'),
  ('8',     null,               'Zona A · 117.5 m² · Cotización especial'),
  ('9',     null,               'Zona A · 30 m² · Cotización especial'),
  ('10',    null,               'Zona A · 30 m² · Cotización especial'),
  ('11',    'Premium Plus',     'Zona A · 18.72 m²'),
  ('12',    'Premium Plus',     'Zona A · 18.72 m²'),
  ('13-14', null,               'Zona A · 37.2 m² · Cotización especial'),
  ('15',    'Nova',             'Zona A · 8.66 m²'),
  ('16',    'Nova',             'Zona A · 8.66 m²'),
  ('17-18', null,               'Zona A · 41 m² · Cotización especial'),
  ('19',    'Nova',             'Zona A · 9.5 m²'),
  ('20',    'Nova',             'Zona A · 9.5 m²')
) as o(numero, plan, notas)
where not exists (
  select 1 from public.oficinas ya
  where ya.centro = 'Punto 45' and ya.tipo = 'Oficina Privada' and ya.numero = o.numero
);

-- ---------------------------------------------- 3) Aulas de la Zona B
insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id)
select a.numero, 'Oficina Privada', a.estado, 'Aguascalientes', 'Punto 45', a.precio, a.notas, null
from (values
  ('Aula 1',  'disponible', 77604, 'Zona B · 64.67 m² · Semi adecuado $64,670 · Sin servicios ni mobiliario $54,969.50'),
  ('Aula 2',  'disponible', 77604, 'Zona B · 64.67 m² · Semi adecuado $64,670 · Sin servicios ni mobiliario $54,969.50'),
  ('Aula 3',  'disponible', 77604, 'Zona B · 64.67 m² · Semi adecuado $64,670 · Sin servicios ni mobiliario $54,969.50'),
  ('Aula 4',  'disponible', 66732, 'Zona B · 55.61 m² · Semi adecuado $55,610 · Sin servicios ni mobiliario $47,268.50'),
  ('Aula 5',  'disponible',    63576, 'Zona B · 52.98 m² · Semi adecuado $52,980 · Sin servicios ni mobiliario $45,033'),
  ('Aula 6',  'disponible',    78348, 'Zona B · 65.29 m² · Semi adecuado $65,290 · Sin servicios ni mobiliario $55,496.50'),
  ('Aula 7',  'disponible',    72240, 'Zona B · 60.2 m² · Semi adecuado $60,200 · Sin servicios ni mobiliario $51,170'),
  ('Aula 8',  'disponible', 17496, 'Zona B · 14.58 m² · Semi adecuado $14,580 · Sin servicios ni mobiliario $12,393'),
  ('Aula 9',  'disponible', 121308, 'Zona B · Comedor · 101.09 m² · Solo en caso especial (nunca se ha rentado) · Semi adecuado $101,090 · Sin servicios ni mobiliario $85,926.50'),
  ('Aula 10', 'disponible', 23184, 'Zona B · Site · 19.32 m² · Semi adecuado $19,320 · Sin servicios ni mobiliario $16,422')
) as a(numero, estado, precio, notas)
where not exists (
  select 1 from public.oficinas ya
  where ya.centro = 'Punto 45' and ya.tipo = 'Oficina Privada' and ya.numero = a.numero
);

-- -------------------------------------------------- 4) Working Desk 1-6
insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id)
select n::text, 'Working Desk', 'disponible', 'Aguascalientes', 'Punto 45', null, 'Zona A · Working Desk',
  (select id from public.paquetes p where p.centro = 'Punto 45' and p.nombre = 'Working Desk')
from generate_series(1, 6) as n
where not exists (
  select 1 from public.oficinas ya
  where ya.centro = 'Punto 45' and ya.tipo = 'Working Desk' and ya.numero = n::text
);

-- ------------------------------------- 5) Coworking: 50 lugares (A ... MB)
insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id)
select b.numero, 'Coworking', 'disponible', 'Aguascalientes', 'Punto 45', 0, null, null
from public.oficinas b
where b.centro = 'Bosques' and b.tipo = 'Coworking'
  and not exists (
    select 1 from public.oficinas ya
    where ya.centro = 'Punto 45' and ya.tipo = 'Coworking' and ya.numero = b.numero
  );

-- El lugar "A" sobre la zona de coworking del plano (en % del plano), para que
-- el coworking aparezca en el Mapa de oficinas como en Bosques.
update public.oficinas
set mapa_x = 72, mapa_y = 27.7
where centro = 'Punto 45' and tipo = 'Coworking' and numero = 'A' and mapa_x is null;

-- ------------------------------------------------------------ Revisión
select tipo, count(*) as espacios,
       count(*) filter (where estado = 'ocupada') as ocupados
from public.oficinas where centro = 'Punto 45'
group by tipo order by tipo;
