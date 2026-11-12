-- =====================================================================
-- Precios de cotización (pantalla /precios-cotizacion).
--
-- Cuando algo falla en un centro (ej. un baño que tira agua), Operaciones
-- (la arquitecta) pide precio a 3 proveedores y sube aquí las 3 cotizaciones
-- lado a lado. La Gerente (Maribel) las compara y elige con quién se hace;
-- a la arquitecta le llega el aviso con la decisión.
--
--   * Operaciones: crea, edita y borra (todos los centros).
--   * Gerente y Superadmin: ven todas y eligen la opción (decisión).
--
-- Tablas: comparativos_proveedores (lo que se necesita) y
-- comparativo_opciones (cada cotización de proveedor).
-- Archivos (cotizaciones y fotos) en el bucket PRIVADO
-- "cotizaciones-proveedores"; la app los abre con enlace temporal.
-- Es seguro volver a correrlo.
-- Rollback: drop table public.comparativo_opciones; drop table
--   public.comparativos_proveedores; y borrar el bucket.
-- =====================================================================

begin;

create table if not exists public.comparativos_proveedores (
  id uuid primary key default gen_random_uuid(),
  centro text not null,
  oficina text,
  titulo text not null,
  descripcion text,
  urgencia text not null default 'verde' check (urgencia in ('verde', 'amarillo', 'rojo')),
  fotos_urls text[] not null default '{}',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'elegido')),
  opcion_elegida_id uuid,
  comentario_decision text,
  decidido_por_nombre text,
  decidido_at timestamptz,
  creado_por uuid references auth.users(id),
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.comparativo_opciones (
  id uuid primary key default gen_random_uuid(),
  comparativo_id uuid not null references public.comparativos_proveedores(id) on delete cascade,
  orden int not null default 1,
  proveedor_id uuid references public.proveedores(id) on delete set null,
  proveedor_nombre text not null,
  monto numeric(12, 2) not null,
  tiempo_entrega text,
  notas text,
  archivo_url text,
  created_at timestamptz not null default now()
);

create index if not exists comparativos_proveedores_centro_idx on public.comparativos_proveedores (centro, created_at desc);
create index if not exists comparativo_opciones_comparativo_idx on public.comparativo_opciones (comparativo_id, orden);

alter table public.comparativos_proveedores enable row level security;
alter table public.comparativo_opciones enable row level security;

-- ---------- Operaciones: todo ----------
drop policy if exists "comparativos_operaciones" on public.comparativos_proveedores;
create policy "comparativos_operaciones" on public.comparativos_proveedores
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones')
  with check (public.mi_rol()::text = 'operaciones');

drop policy if exists "comparativo_opciones_operaciones" on public.comparativo_opciones;
create policy "comparativo_opciones_operaciones" on public.comparativo_opciones
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones')
  with check (public.mi_rol()::text = 'operaciones');

-- ---------- Gerente y Superadmin: ven todo y deciden ----------
drop policy if exists "comparativos_gerencia_select" on public.comparativos_proveedores;
create policy "comparativos_gerencia_select" on public.comparativos_proveedores
  for select to authenticated
  using (public.mi_rol()::text in ('gerente', 'superadmin'));

drop policy if exists "comparativos_gerencia_update" on public.comparativos_proveedores;
create policy "comparativos_gerencia_update" on public.comparativos_proveedores
  for update to authenticated
  using (public.mi_rol()::text in ('gerente', 'superadmin'))
  with check (public.mi_rol()::text in ('gerente', 'superadmin'));

drop policy if exists "comparativo_opciones_gerencia_select" on public.comparativo_opciones;
create policy "comparativo_opciones_gerencia_select" on public.comparativo_opciones
  for select to authenticated
  using (public.mi_rol()::text in ('gerente', 'superadmin'));

-- ---------- Archivos: bucket privado ----------
insert into storage.buckets (id, name, public)
values ('cotizaciones-proveedores', 'cotizaciones-proveedores', false)
on conflict (id) do update set public = false;

drop policy if exists "cotizaciones_proveedores_storage_operaciones" on storage.objects;
create policy "cotizaciones_proveedores_storage_operaciones" on storage.objects
  for all to authenticated
  using (bucket_id = 'cotizaciones-proveedores' and public.mi_rol()::text = 'operaciones')
  with check (bucket_id = 'cotizaciones-proveedores' and public.mi_rol()::text = 'operaciones');

commit;

-- Comprobación: 5 políticas en las tablas (la del bucket va en storage.objects)
-- y el bucket en privado (public = false).
select tablename, policyname, cmd from pg_policies
where tablename in ('comparativos_proveedores', 'comparativo_opciones')
order by tablename, policyname;
select id, public from storage.buckets where id = 'cotizaciones-proveedores';
