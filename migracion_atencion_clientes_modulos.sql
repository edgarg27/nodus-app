-- =====================================================================
-- Migración: módulos de Atención a clientes
--   1) Decoraciones y festividades (panel admin)
--   2) Documentación del centro (secciones de texto + archivos)
--
-- El calendario de eventos del cliente NO necesita nada aquí: reutiliza la
-- tabla "eventos_centro" que ya existe (la que el staff llena en
-- Experiencia del cliente → Eventos).
--
-- Por ahora decoraciones y documentación las administra solo "admin" y
-- "superadmin" — cuando se
-- quiera abrir a otros roles basta con cambiar la lista en las políticas
-- de abajo (busca: rol in ('admin', 'superadmin')).
--
-- Es seguro volver a correr este archivo (usa "if not exists" /
-- "drop policy if exists" en todos lados). Se corre a mano en el SQL
-- Editor de Supabase.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Decoraciones y festividades
-- ---------------------------------------------------------------------
create table if not exists public.decoraciones (
  id uuid primary key default gen_random_uuid(),
  centro text not null,
  festividad text not null,
  fecha_colocacion date,
  fecha_retiro date,
  descripcion text,
  fotos_urls text[] not null default '{}',
  creado_por uuid references auth.users(id),
  creado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists decoraciones_centro_idx on public.decoraciones (centro);

alter table public.decoraciones enable row level security;

drop policy if exists "decoraciones_staff_all" on public.decoraciones;
create policy "decoraciones_staff_all" on public.decoraciones
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

-- ---------------------------------------------------------------------
-- 2) Documentación del centro
-- ---------------------------------------------------------------------
-- 2a) Secciones de texto (la información que pasa Cynthia: quién atiende,
--     qué ofrece el centro, etc.). Una fila por sección y por centro.
create table if not exists public.documentacion_centro_secciones (
  id uuid primary key default gen_random_uuid(),
  centro text not null,
  titulo text not null,
  contenido text,
  orden int not null default 0,
  actualizado_por uuid references auth.users(id),
  actualizado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doc_centro_secciones_centro_idx on public.documentacion_centro_secciones (centro, orden);

alter table public.documentacion_centro_secciones enable row level security;

drop policy if exists "doc_secciones_staff_all" on public.documentacion_centro_secciones;
create policy "doc_secciones_staff_all" on public.documentacion_centro_secciones
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

-- 2b) Archivos adjuntos (especificaciones, planos, etc.)
create table if not exists public.documentacion_centro_archivos (
  id uuid primary key default gen_random_uuid(),
  centro text not null,
  nombre text not null,
  descripcion text,
  archivo_path text not null,
  tipo_mime text,
  tamano_bytes bigint,
  subido_por uuid references auth.users(id),
  subido_por_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists doc_centro_archivos_centro_idx on public.documentacion_centro_archivos (centro, created_at desc);

alter table public.documentacion_centro_archivos enable row level security;

drop policy if exists "doc_archivos_staff_all" on public.documentacion_centro_archivos;
create policy "doc_archivos_staff_all" on public.documentacion_centro_archivos
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

-- ---------------------------------------------------------------------
-- 3) Storage
-- ---------------------------------------------------------------------
-- 3a) "decoraciones": fotos de referencia. Público (solo son fotos de
--     decoración, se leen por URL pública igual que "logros").
insert into storage.buckets (id, name, public)
values ('decoraciones', 'decoraciones', true)
on conflict (id) do nothing;

drop policy if exists "decoraciones_storage_insert" on storage.objects;
create policy "decoraciones_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'decoraciones'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin')
    )
  );

drop policy if exists "decoraciones_storage_delete" on storage.objects;
create policy "decoraciones_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'decoraciones'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin')
    )
  );

-- 3b) "documentacion-centro": archivos internos del centro. PRIVADO — la
--     app abre los archivos con un link firmado temporal, no público.
insert into storage.buckets (id, name, public)
values ('documentacion-centro', 'documentacion-centro', false)
on conflict (id) do nothing;

drop policy if exists "doc_centro_storage_select" on storage.objects;
create policy "doc_centro_storage_select" on storage.objects
  for select using (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin')
    )
  );

drop policy if exists "doc_centro_storage_insert" on storage.objects;
create policy "doc_centro_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin')
    )
  );

drop policy if exists "doc_centro_storage_delete" on storage.objects;
create policy "doc_centro_storage_delete" on storage.objects
  for delete using (
    bucket_id = 'documentacion-centro'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('admin', 'superadmin')
    )
  );
-- =====================================================================
