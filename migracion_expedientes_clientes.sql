-- =====================================================================
-- Migración: Expediente de clientes (/expedientes)
--
-- Cada cliente tiene su expediente: los archivos que la administradora
-- tenga de él (contrato firmado, identificación, constancia fiscal,
-- comprobantes, etc.). No es una lista fija de documentos: se sube lo que
-- haya, con el nombre que se quiera.
--
-- Quién: admin (solo clientes de su centro), superadmin y gerente (todos).
-- El cliente NO ve su expediente.
--
-- Archivos en el bucket PRIVADO "expedientes-clientes", con la ruta
-- <cliente_id>/<archivo>; se abren con link firmado temporal.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de
-- Supabase, ANTES de usar la pantalla.
-- Rollback: drop table public.expediente_archivos; y borrar el bucket
--   "expedientes-clientes" desde Storage (primero vaciarlo).
-- =====================================================================

create table if not exists public.expediente_archivos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.profiles(id) on delete cascade,
  centro text not null,
  nombre text not null,
  nota text,
  archivo_path text not null,
  tipo_mime text,
  tamano_bytes bigint,
  subido_por uuid references auth.users(id),
  subido_por_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists expediente_archivos_cliente_idx on public.expediente_archivos (cliente_id, created_at desc);
create index if not exists expediente_archivos_centro_idx on public.expediente_archivos (centro);

alter table public.expediente_archivos enable row level security;

-- mi_rol() / mi_centro() son SECURITY DEFINER (ver
-- migracion_fix_recursion_profiles.sql): leen el perfil de quien pregunta
-- sin pasar por las políticas de profiles.
drop policy if exists "expediente_archivos_staff" on public.expediente_archivos;
create policy "expediente_archivos_staff" on public.expediente_archivos
  for all to authenticated
  using (
    public.mi_rol()::text in ('superadmin', 'gerente')
    or (public.mi_rol()::text = 'admin' and centro = public.mi_centro())
  )
  with check (
    public.mi_rol()::text in ('superadmin', 'gerente')
    or (public.mi_rol()::text = 'admin' and centro = public.mi_centro())
  );

-- Bucket privado
insert into storage.buckets (id, name, public)
values ('expedientes-clientes', 'expedientes-clientes', false)
on conflict (id) do update set public = false;

-- La primera carpeta de la ruta es el id del cliente: la admin solo toca
-- los archivos de clientes de su centro. (No se usa el nombre del centro
-- en la ruta porque lleva acentos, p. ej. "Puerta Bajío".)
drop policy if exists "expedientes_storage_select" on storage.objects;
create policy "expedientes_storage_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'expedientes-clientes'
    and (
      public.mi_rol()::text in ('superadmin', 'gerente')
      or (
        public.mi_rol()::text = 'admin'
        and exists (
          select 1 from public.profiles c
          where c.id::text = (storage.foldername(name))[1] and c.centro = public.mi_centro()
        )
      )
    )
  );

drop policy if exists "expedientes_storage_insert" on storage.objects;
create policy "expedientes_storage_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'expedientes-clientes'
    and (
      public.mi_rol()::text in ('superadmin', 'gerente')
      or (
        public.mi_rol()::text = 'admin'
        and exists (
          select 1 from public.profiles c
          where c.id::text = (storage.foldername(name))[1] and c.centro = public.mi_centro()
        )
      )
    )
  );

drop policy if exists "expedientes_storage_delete" on storage.objects;
create policy "expedientes_storage_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'expedientes-clientes'
    and (
      public.mi_rol()::text in ('superadmin', 'gerente')
      or (
        public.mi_rol()::text = 'admin'
        and exists (
          select 1 from public.profiles c
          where c.id::text = (storage.foldername(name))[1] and c.centro = public.mi_centro()
        )
      )
    )
  );
