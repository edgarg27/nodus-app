-- =====================================================================
-- Reparaciones (pantalla /reparaciones).
--
-- La arquitecta (rol operaciones) le asigna una reparación a Mantenimiento
-- (rol mantenimiento, p. ej. Edgar en León). Él sube los avances con fotos en
-- un hilo de seguimiento (en lugar de WhatsApp) y la marca como terminada con
-- foto del resultado; la arquitecta la revisa y la cierra o se la regresa.
--
--   * Operaciones: crea, edita, borra, comenta y cierra (todas).
--   * Mantenimiento: solo las que tiene asignadas; las ve, cambia el estado
--     y escribe en el hilo.
--   * Gerente y Superadmin: solo consulta.
--   * El cliente NO ve nada de esto (su ticket sigue igual).
--
-- Tablas: reparaciones y reparacion_mensajes. Fotos en el bucket PRIVADO
-- "reparaciones"; la app las abre con enlace temporal.
-- Usa public.mi_rol() y el rol 'mantenimiento' (migracion_rol_mantenimiento.sql).
-- Es seguro volver a correrlo.
-- Rollback: drop table public.reparacion_mensajes; drop table public.reparaciones;
--   borrar la política "profiles_operaciones_ve_mantenimiento" y el bucket.
-- =====================================================================

begin;

create table if not exists public.reparaciones (
  id uuid primary key default gen_random_uuid(),
  centro text not null,
  oficina text,
  titulo text not null,
  descripcion text,
  urgencia text not null default 'verde' check (urgencia in ('verde', 'amarillo', 'rojo')),
  fecha_compromiso date,
  estado text not null default 'asignada' check (estado in ('asignada', 'en_proceso', 'terminada', 'cerrada')),
  asignado_a uuid not null references auth.users(id),
  asignado_nombre text,
  ticket_id uuid references public.tickets(id) on delete set null,
  fotos_urls text[] not null default '{}',
  creado_por uuid references auth.users(id),
  creado_por_nombre text,
  ultimo_avance_at timestamptz,
  terminada_at timestamptz,
  cerrada_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reparacion_mensajes (
  id uuid primary key default gen_random_uuid(),
  reparacion_id uuid not null references public.reparaciones(id) on delete cascade,
  autor_id uuid references auth.users(id) default auth.uid(),
  autor_nombre text,
  autor_rol text,
  -- mensaje | avance | inicio | terminada | regresada | cerrada
  tipo text not null default 'mensaje',
  mensaje text,
  fotos_urls text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists reparaciones_asignado_idx on public.reparaciones (asignado_a, estado);
create index if not exists reparaciones_centro_idx on public.reparaciones (centro, created_at desc);
create index if not exists reparacion_mensajes_reparacion_idx on public.reparacion_mensajes (reparacion_id, created_at);

alter table public.reparaciones enable row level security;
alter table public.reparacion_mensajes enable row level security;

-- ---------- Operaciones (la arquitecta): todo ----------
drop policy if exists "reparaciones_operaciones" on public.reparaciones;
create policy "reparaciones_operaciones" on public.reparaciones
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones')
  with check (public.mi_rol()::text = 'operaciones');

drop policy if exists "reparacion_mensajes_operaciones" on public.reparacion_mensajes;
create policy "reparacion_mensajes_operaciones" on public.reparacion_mensajes
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones')
  with check (public.mi_rol()::text = 'operaciones');

-- ---------- Mantenimiento: solo las suyas ----------
drop policy if exists "reparaciones_mantenimiento_select" on public.reparaciones;
create policy "reparaciones_mantenimiento_select" on public.reparaciones
  for select to authenticated
  using (public.mi_rol()::text = 'mantenimiento' and asignado_a = auth.uid());

-- Cambia el estado (en proceso / terminada) y la fecha del último avance;
-- no puede pasarla a otra persona.
drop policy if exists "reparaciones_mantenimiento_update" on public.reparaciones;
create policy "reparaciones_mantenimiento_update" on public.reparaciones
  for update to authenticated
  using (public.mi_rol()::text = 'mantenimiento' and asignado_a = auth.uid())
  with check (public.mi_rol()::text = 'mantenimiento' and asignado_a = auth.uid() and estado <> 'cerrada');

drop policy if exists "reparacion_mensajes_mantenimiento_select" on public.reparacion_mensajes;
create policy "reparacion_mensajes_mantenimiento_select" on public.reparacion_mensajes
  for select to authenticated
  using (
    public.mi_rol()::text = 'mantenimiento'
    and exists (select 1 from public.reparaciones r
                where r.id = reparacion_mensajes.reparacion_id and r.asignado_a = auth.uid())
  );

drop policy if exists "reparacion_mensajes_mantenimiento_insert" on public.reparacion_mensajes;
create policy "reparacion_mensajes_mantenimiento_insert" on public.reparacion_mensajes
  for insert to authenticated
  with check (
    public.mi_rol()::text = 'mantenimiento'
    and autor_id = auth.uid()
    and exists (select 1 from public.reparaciones r
                where r.id = reparacion_mensajes.reparacion_id and r.asignado_a = auth.uid())
  );

-- ---------- Gerente y Superadmin: solo consulta ----------
drop policy if exists "reparaciones_gerencia_select" on public.reparaciones;
create policy "reparaciones_gerencia_select" on public.reparaciones
  for select to authenticated
  using (public.mi_rol()::text in ('gerente', 'superadmin'));

drop policy if exists "reparacion_mensajes_gerencia_select" on public.reparacion_mensajes;
create policy "reparacion_mensajes_gerencia_select" on public.reparacion_mensajes
  for select to authenticated
  using (public.mi_rol()::text in ('gerente', 'superadmin'));

-- ---------- La arquitecta ve las cuentas de Mantenimiento (para asignarles) ----------
drop policy if exists "profiles_operaciones_ve_mantenimiento" on public.profiles;
create policy "profiles_operaciones_ve_mantenimiento" on public.profiles
  for select to authenticated
  using (public.mi_rol()::text = 'operaciones' and rol::text = 'mantenimiento');

-- ---------- Fotos: bucket privado ----------
insert into storage.buckets (id, name, public)
values ('reparaciones', 'reparaciones', false)
on conflict (id) do update set public = false;

drop policy if exists "reparaciones_storage" on storage.objects;
create policy "reparaciones_storage" on storage.objects
  for all to authenticated
  using (bucket_id = 'reparaciones' and public.mi_rol()::text in ('operaciones', 'mantenimiento'))
  with check (bucket_id = 'reparaciones' and public.mi_rol()::text in ('operaciones', 'mantenimiento'));

commit;

-- Comprobación: 8 políticas en las tablas de reparaciones, 1 en profiles
-- y el bucket en privado (public = false).
select tablename, policyname, cmd from pg_policies
where tablename in ('reparaciones', 'reparacion_mensajes')
   or policyname = 'profiles_operaciones_ve_mantenimiento'
order by tablename, policyname;
select id, public from storage.buckets where id = 'reparaciones';
