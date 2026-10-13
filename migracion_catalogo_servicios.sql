-- =====================================================================
-- Catálogo de servicios y adicionales (con precio).
--
-- Antes la lista de servicios (copias, coworking, sala de juntas…) y sus claves
-- del SAT estaba fija en el código. Ahora vive aquí, para que ventasit@nodusbc.mx
-- y finanzas@nodusbc.mx (y el superadmin) puedan cambiar los precios y agregar o
-- quitar servicios desde la pantalla "Servicios y precios". Las demás personas
-- solo los eligen (en Adicionales y en Nueva factura).
--
--   clave           identificador interno (no cambia)
--   etiqueta        nombre que se ve
--   concepto        texto sugerido para el concepto del cobro
--   sat_prod_serv   clave de producto o servicio del SAT (8 dígitos)
--   sat_unidad      clave de unidad del SAT (E48 servicio, H87 pieza…)
--   precio          precio sugerido con IVA (vacío = se captura a mano)
--   activo          false = "quitado": ya no se ofrece, pero los cobros viejos lo conservan
--
-- Solo el servidor (service role) escribe. Leer: todo el personal (no clientes).
-- Es seguro volver a correrlo; no pisa precios ya capturados.
-- Rollback: drop table catalogo_servicios;
-- =====================================================================

create table if not exists public.catalogo_servicios (
  clave text primary key check (clave ~ '^[a-z0-9_]{2,40}$'),
  etiqueta text not null check (char_length(etiqueta) between 2 and 80),
  concepto text not null default '' check (char_length(concepto) <= 120),
  sat_prod_serv text not null check (sat_prod_serv ~ '^[0-9]{8}$'),
  sat_unidad text not null check (sat_unidad ~ '^[A-Z0-9]{2,3}$'),
  precio numeric(12, 2) check (precio is null or precio >= 0),
  activo boolean not null default true,
  orden integer not null default 100,
  actualizado_por uuid references auth.users(id) on delete set null,
  actualizado_en timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.catalogo_servicios enable row level security;

drop policy if exists "catalogo_servicios_ver_personal" on public.catalogo_servicios;
create policy "catalogo_servicios_ver_personal" on public.catalogo_servicios
  for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol::text <> 'cliente')
  );

-- Servicios actuales (listado de claves del SAT del área de facturación).
insert into public.catalogo_servicios (clave, etiqueta, concepto, sat_prod_serv, sat_unidad, orden) values
  ('acabados_remodelacion', 'Acabados interiores y remodelación', 'Acabados interiores y remodelación', '72153600', 'E48', 10),
  ('alimentos', 'Alimentos', 'Alimentos', '90101700', 'E48', 20),
  ('coffee_break', 'Coffee break', 'Coffee break', '90101700', 'E48', 30),
  ('copias', 'Copias', 'Copias', '82121700', 'H87', 40),
  ('duplicado_llaves', 'Duplicado de llaves', 'Duplicado de llaves', '72101505', 'H87', 50),
  ('estacionamiento', 'Estacionamiento', 'Estacionamiento', '95121644', 'E48', 60),
  ('impresiones', 'Impresiones', 'Impresiones', '82121500', 'H87', 70),
  ('internet', 'Internet', 'Internet', '81112100', 'E48', 80),
  ('mantenimiento', 'Mantenimiento', 'Mantenimiento', '72102900', 'E48', 90),
  ('paqueteria', 'Paquetería', 'Paquetería', '78102205', 'E48', 100),
  ('penalizacion_mora', 'Penalización por mora', 'Penalización por mora', '84101702', 'E48', 110),
  ('renta_oficina_privada', 'Renta de oficina privada', 'Renta de oficina privada', '80131502', 'E48', 120),
  ('coworking', 'Coworking', 'Coworking', '80161504', 'E48', 130),
  ('reparacion_oficinas', 'Reparación y renovación de oficinas', 'Reparación y renovación de oficinas', '72121103', 'E48', 140),
  ('sala_juntas', 'Sala de juntas', 'Hora extra de sala de juntas', '90111603', 'E48', 150),
  ('tarjeta_acceso', 'Tarjeta de acceso', 'Tarjeta de acceso', '46171619', 'H87', 160),
  ('telefonia', 'Telefonía', 'Telefonía', '83111501', 'E48', 170),
  ('otro', 'Otro', '', '01010101', 'E48', 999)
on conflict (clave) do nothing;

-- Revisión: la tabla con RLS activa, su política y los servicios cargados (deben ser 18).
select c.relname as tabla, c.relrowsecurity as rls_activa
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'catalogo_servicios';

select policyname, cmd from pg_policies where schemaname = 'public' and tablename = 'catalogo_servicios';

select count(*) as servicios from public.catalogo_servicios;
