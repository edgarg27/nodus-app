-- =====================================================================
-- Migración: Documentación del centro como "Drive" (carpetas libres)
--
-- Corre esto DESPUÉS de migracion_atencion_clientes_modulos.sql (ahí se
-- crea documentacion_centro_archivos y el bucket privado
-- "documentacion-centro").
--
-- Agrega carpetas (con subcarpetas) por centro y liga cada archivo a una
-- carpeta (carpeta_id null = raíz del centro). Los archivos que ya se
-- hubieran subido se quedan en la raíz.
--
-- Es seguro volver a correr este archivo. Se corre a mano en el SQL
-- Editor de Supabase.
-- =====================================================================

create table if not exists public.documentacion_centro_carpetas (
  id uuid primary key default gen_random_uuid(),
  centro text not null,
  nombre text not null,
  -- null = carpeta en la raíz; si se borra la carpeta padre, se borran
  -- también las subcarpetas (la app limpia antes los archivos de Storage).
  carpeta_padre_id uuid references public.documentacion_centro_carpetas(id) on delete cascade,
  creado_por uuid references auth.users(id),
  creado_por_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists doc_centro_carpetas_centro_idx on public.documentacion_centro_carpetas (centro, carpeta_padre_id);

alter table public.documentacion_centro_carpetas enable row level security;

drop policy if exists "doc_carpetas_staff_all" on public.documentacion_centro_carpetas;
create policy "doc_carpetas_staff_all" on public.documentacion_centro_carpetas
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin')
    )
  );

-- Cada archivo vive en una carpeta (o en la raíz si es null). Si se borra la
-- carpeta, se borran los registros de sus archivos.
alter table public.documentacion_centro_archivos
  add column if not exists carpeta_id uuid references public.documentacion_centro_carpetas(id) on delete cascade;

create index if not exists doc_centro_archivos_carpeta_idx on public.documentacion_centro_archivos (carpeta_id);
