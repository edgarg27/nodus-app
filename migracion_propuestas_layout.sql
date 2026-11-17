-- =====================================================================
-- Propuesta de layout (pantalla /propuestas-layout).
--
-- Cuando van a rentar una oficina y el cliente tiene pensado un diseño,
-- Operaciones (la arquitecta) sube aquí la propuesta de layout. La admin del
-- centro la ve y la descarga para enseñársela al cliente. Si al cliente le
-- gusta, la arquitecta la marca "aprobada" y sube ahí mismo la cotización del
-- layout, que la admin también ve y descarga.
--
--   * Operaciones: crea, edita y borra (todos los centros).
--   * Admin: solo ve las de su centro (sin editar).
--   * Gerente y Superadmin: ven todas (sin editar).
--
-- Los archivos van en el bucket PRIVADO "propuestas-layout"; la app los abre
-- con enlace temporal (/api/archivos/firmar).
-- Es seguro volver a correrlo.
-- Rollback: drop table public.propuestas_layout; y borrar el bucket
--   "propuestas-layout" (se pierden las propuestas y sus archivos).
-- =====================================================================

begin;

create table if not exists public.propuestas_layout (
  id uuid primary key default gen_random_uuid(),
  centro text not null,
  oficina text,
  cliente text not null,
  descripcion text,
  estado text not null default 'propuesta' check (estado in ('propuesta', 'aprobada', 'descartada')),
  layout_urls text[] not null default '{}',
  cotizacion_url text,
  cotizacion_monto numeric(12, 2),
  creado_por uuid references auth.users(id),
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  aprobada_at timestamptz,
  cotizacion_at timestamptz
);

create index if not exists propuestas_layout_centro_idx on public.propuestas_layout (centro, created_at desc);

alter table public.propuestas_layout enable row level security;

drop policy if exists "propuestas_layout_operaciones" on public.propuestas_layout;
create policy "propuestas_layout_operaciones" on public.propuestas_layout
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones')
  with check (public.mi_rol()::text = 'operaciones');

drop policy if exists "propuestas_layout_admin_select" on public.propuestas_layout;
create policy "propuestas_layout_admin_select" on public.propuestas_layout
  for select to authenticated
  using (public.mi_rol()::text = 'admin' and centro = public.mi_centro());

drop policy if exists "propuestas_layout_gerencia_select" on public.propuestas_layout;
create policy "propuestas_layout_gerencia_select" on public.propuestas_layout
  for select to authenticated
  using (public.mi_rol()::text in ('superadmin', 'gerente'));

-- ---------- Archivos: bucket privado ----------
insert into storage.buckets (id, name, public)
values ('propuestas-layout', 'propuestas-layout', false)
on conflict (id) do update set public = false;

drop policy if exists "propuestas_layout_storage_operaciones" on storage.objects;
create policy "propuestas_layout_storage_operaciones" on storage.objects
  for all to authenticated
  using (bucket_id = 'propuestas-layout' and public.mi_rol()::text = 'operaciones')
  with check (bucket_id = 'propuestas-layout' and public.mi_rol()::text = 'operaciones');

commit;

-- Comprobación: la tabla con sus 3 políticas, y el bucket en privado (public = false).
select policyname, cmd from pg_policies where tablename = 'propuestas_layout' order by policyname;
select id, public from storage.buckets where id = 'propuestas-layout';
