-- =====================================================================
-- San Telmo: planes de oficina y espacios, igual que Bosques y Punto 45.
--
-- Planes (precio mensual sin IVA, horas de sala de juntas incluidas):
--   Nova $7,455 (6 h) · Nova Plus $8,480 (6 h) · Star $9,458 (8 h)
--   Star Plus $10,682 (8 h) · Platino $15,244 (10 h) · Premium $20,029 (12 h)
--   Premium especial $38,562 (15 h)
--   Las horas de Nova Plus y Star Plus son las de su plan base (pendiente de confirmar).
--
-- Oficinas (del plano de San Telmo; cada una toma el precio de su plan por su color):
--   Nova: 1, 9, 12 · Nova Plus: 10, 11, 16, 17, 18 · Star: 3, 4 · Star Plus: 7, 14
--   Platino: 6, 8, 13, 15 · Premium: 2A, 2B · Premium especial: 5
--   19: Cotización especial (precio al cotizar).
-- Coworking: 50 lugares (misma numeración que Bosques), con el lugar "A" ubicado
-- sobre la zona de coworking del plano para que aparezca en el Mapa de oficinas.
--
-- Todo entra como "disponible": la administradora marca lo rentado al dar de alta
-- a cada cliente. Solo agrega lo que falte: es seguro volver a correrlo.
-- =====================================================================

-- ----------------------------------------------------------- 1) Planes
insert into public.paquetes (
  centro, nombre, precio, descripcion, incluye_horas_sala_juntas, tipo_espacio,
  precio_hora, precio_dia, precio_semana, precio_mes, horas_bolsa, bloquea_reasignacion
)
select 'San Telmo', p.nombre, p.precio, null, p.horas, 'Oficina Privada', null, null, null, p.precio, 0, false
from (values
  ('Nova',             7455,  6),
  ('Nova Plus',        8480,  6),
  ('Star',             9458,  8),
  ('Star Plus',        10682, 8),
  ('Platino',          15244, 10),
  ('Premium',          20029, 12),
  ('Premium especial', 38562, 15)
) as p(nombre, precio, horas)
where not exists (
  select 1 from public.paquetes ya where ya.centro = 'San Telmo' and ya.nombre = p.nombre
);

-- ------------------------------------------------------- 2) Oficinas
insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id)
select o.numero, 'Oficina Privada', 'disponible', 'Aguascalientes', 'San Telmo', null, o.notas,
  (select id from public.paquetes p where p.centro = 'San Telmo' and p.nombre = o.plan)
from (values
  ('1',  'Nova',             '10.93 m²'),
  ('2A', 'Premium',          '20.03 m²'),
  ('2B', 'Premium',          '20.03 m²'),
  ('3',  'Star',             '10.53 m²'),
  ('4',  'Star',             '13.11 m²'),
  ('5',  'Premium especial', '26.92 m²'),
  ('6',  'Platino',          '21.92 m²'),
  ('7',  'Star Plus',        '16.10 m²'),
  ('8',  'Platino',          '18.84 m²'),
  ('9',  'Nova',             '9.31 m²'),
  ('10', 'Nova Plus',        '9.85 m²'),
  ('11', 'Nova Plus',        '9.84 m²'),
  ('12', 'Nova',             '9.30 m²'),
  ('13', 'Platino',          '17.85 m²'),
  ('14', 'Star Plus',        '15.37 m²'),
  ('15', 'Platino',          '17.78 m²'),
  ('16', 'Nova Plus',        '9.17 m²'),
  ('17', 'Nova Plus',        '9.24 m²'),
  ('18', 'Nova Plus',        '9.28 m²'),
  ('19', null,               'Cotización especial (zona gris del plano)')
) as o(numero, plan, notas)
where not exists (
  select 1 from public.oficinas ya
  where ya.centro = 'San Telmo' and ya.tipo = 'Oficina Privada' and ya.numero = o.numero
);

-- ------------------------------------- 3) Coworking: 50 lugares (A ... MB)
insert into public.oficinas (numero, tipo, estado, ciudad, centro, precio, notas, paquete_default_id)
select b.numero, 'Coworking', 'disponible', 'Aguascalientes', 'San Telmo', 0, null, null
from public.oficinas b
where b.centro = 'Bosques' and b.tipo = 'Coworking'
  and not exists (
    select 1 from public.oficinas ya
    where ya.centro = 'San Telmo' and ya.tipo = 'Coworking' and ya.numero = b.numero
  );

-- El lugar "A" sobre la zona de coworking del plano (en % del plano), para que
-- el coworking aparezca en el Mapa de oficinas como en Bosques.
update public.oficinas
set mapa_x = 47.7, mapa_y = 36.2
where centro = 'San Telmo' and tipo = 'Coworking' and numero = 'A' and mapa_x is null;

-- ------------------------------------------------------------ Revisión
select tipo, count(*) as espacios from public.oficinas
where centro = 'San Telmo' group by tipo order by tipo;
