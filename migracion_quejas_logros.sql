-- =====================================================================
-- PASO 2 de 2 — Migración: Quejas y Sugerencias (rol "Atención al
-- Cliente") + Logros (rol "Diseño", banners en el carrusel de todos
-- los clientes)
--
-- IMPORTANTE — el orden correcto es:
--   1. Corre PRIMERO migracion_roles_enum.sql (solo, esperando a que
--      diga "Success") — agrega "atencion_cliente" y "diseno" al enum
--      de roles. Sin ese paso, este script falla con el mismo error
--      22P02 que ya viste.
--   2. Corre este archivo completo.
--   3. Hasta ahora, crea las dos cuentas de staff nuevas desde
--      /usuarios (Gestión de Usuarios) con rol "Atención al Cliente" y
--      "Diseño" — si las creas antes del paso 1, te va a dar el mismo
--      error 22P02 al guardar el perfil.
--
-- Es seguro volver a correr este archivo si algo falla a medias (usa
-- "if not exists" / "drop policy if exists" en todos lados).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Quejas y Sugerencias
-- ---------------------------------------------------------------------
create table if not exists public.quejas_sugerencias (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  cliente_nombre text,
  empresa text,
  centro text,
  tipo text not null default 'queja', -- 'queja' | 'sugerencia'
  mensaje text not null,
  fotos_urls text[],
  estado text not null default 'pendiente', -- 'pendiente' | 'en_revision' | 'resuelta'
  respuesta text,
  atendido_por uuid references auth.users(id),
  atendido_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists quejas_sugerencias_user_id_idx on public.quejas_sugerencias (user_id);

alter table public.quejas_sugerencias enable row level security;

-- El cliente ve solo las suyas.
drop policy if exists "quejas_select_propias" on public.quejas_sugerencias;
create policy "quejas_select_propias" on public.quejas_sugerencias
  for select using (user_id = auth.uid());

-- Atención al Cliente (y superadmin/gerente, que ven todo) las ve todas.
drop policy if exists "quejas_select_staff" on public.quejas_sugerencias;
create policy "quejas_select_staff" on public.quejas_sugerencias
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol in ('atencion_cliente', 'superadmin', 'gerente')
    )
  );

-- Solo un cliente puede crear una queja/sugerencia, y solo a su propio nombre.
drop policy if exists "quejas_insert_cliente" on public.quejas_sugerencias;
create policy "quejas_insert_cliente" on public.quejas_sugerencias
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'cliente')
  );

-- Solo Atención al Cliente (o superadmin/gerente) puede responder / cambiar estado.
drop policy if exists "quejas_update_staff" on public.quejas_sugerencias;
create policy "quejas_update_staff" on public.quejas_sugerencias
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol in ('atencion_cliente', 'superadmin', 'gerente')
    )
  );

-- ---------------------------------------------------------------------
-- 2) Logros — el cliente comparte el logro como texto; Diseño lo revisa
--    y sube el banner ya trabajado, que aparece en el carrusel de TODOS
--    los clientes en cuanto queda en estado "publicado".
-- ---------------------------------------------------------------------
create table if not exists public.logros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  cliente_nombre text,
  empresa text,
  centro text,
  titulo text not null,
  descripcion text,
  estado text not null default 'pendiente', -- 'pendiente' | 'en_diseno' | 'publicado'
  banner_url text,
  trabajado_por uuid references auth.users(id),
  trabajado_por_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists logros_user_id_idx on public.logros (user_id);
create index if not exists logros_estado_idx on public.logros (estado);

alter table public.logros enable row level security;

-- El cliente ve los suyos.
drop policy if exists "logros_select_propios" on public.logros;
create policy "logros_select_propios" on public.logros
  for select using (user_id = auth.uid());

-- Cualquier cuenta con sesión (staff o cliente) puede ver los YA
-- PUBLICADOS — es lo que alimenta el carrusel de banners de todos los
-- clientes del dashboard, no solo el de la empresa que lo compartió.
drop policy if exists "logros_select_publicados" on public.logros;
create policy "logros_select_publicados" on public.logros
  for select using (estado = 'publicado');

-- Diseño (y superadmin/gerente) ve todos, en cualquier estado.
drop policy if exists "logros_select_staff" on public.logros;
create policy "logros_select_staff" on public.logros
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

-- Solo un cliente puede compartir un logro, y solo a su propio nombre.
drop policy if exists "logros_insert_cliente" on public.logros;
create policy "logros_insert_cliente" on public.logros
  for insert with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'cliente')
  );

-- Solo Diseño (o superadmin/gerente) puede subir/actualizar el banner y
-- cambiar el estado.
drop policy if exists "logros_update_staff" on public.logros;
create policy "logros_update_staff" on public.logros
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

-- ---------------------------------------------------------------------
-- 3) Storage: bucket "logros" para los banners que sube Diseño
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('logros', 'logros', true)
on conflict (id) do nothing;

drop policy if exists "logros_storage_insert_diseno" on storage.objects;
create policy "logros_storage_insert_diseno" on storage.objects
  for insert with check (
    bucket_id = 'logros'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );

drop policy if exists "logros_storage_update_diseno" on storage.objects;
create policy "logros_storage_update_diseno" on storage.objects
  for update using (
    bucket_id = 'logros'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol in ('diseno', 'superadmin', 'gerente')
    )
  );
-- El bucket es público, así que cualquiera puede LEER las imágenes por
-- su URL pública (necesario para que el carrusel se vea en todos los
-- dashboards de cliente) sin necesitar una política de select aparte.

-- ---------------------------------------------------------------------
-- Nota: las fotos que adjunta el cliente en Quejas y Sugerencias usan el
-- bucket "tickets" que ya existe (el mismo de Soporte), así que no hace
-- falta crear ni configurar nada extra para esas.
-- =====================================================================
