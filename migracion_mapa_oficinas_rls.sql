-- =====================================================================
-- Migración: Mapa de Oficinas — solo Operaciones puede subir/reemplazar
-- layouts por centro; el resto de las cuentas de staff solo puede verlos.
--
-- La pantalla (/mapa-oficinas) ya oculta el botón de subir a quien no
-- sea Operaciones, pero eso es solo de interfaz — cualquiera con su
-- sesión podría llamar a Supabase directo. Este script lo refuerza a
-- nivel de base de datos, que es lo que de verdad protege.
--
-- Cómo correrlo: Supabase → tu proyecto → SQL Editor → pega todo esto →
-- Run. Es seguro volver a correrlo (usa "drop policy if exists" en
-- todos lados).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Tabla mapa_oficinas
-- ---------------------------------------------------------------------
alter table public.mapa_oficinas enable row level security;

-- Cualquier cuenta de staff (no cliente) puede VER el layout de
-- cualquier centro — ya lo comparte la app entre roles.
drop policy if exists "mapa_oficinas_select_staff" on public.mapa_oficinas;
create policy "mapa_oficinas_select_staff" on public.mapa_oficinas
  for select using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol <> 'cliente'
    )
  );

-- Solo Operaciones puede registrar un layout nuevo.
drop policy if exists "mapa_oficinas_insert_operaciones" on public.mapa_oficinas;
create policy "mapa_oficinas_insert_operaciones" on public.mapa_oficinas
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol = 'operaciones'
    )
  );

-- Solo Operaciones puede reemplazar/actualizar uno existente (el botón
-- "Reemplazar" usa upsert, que internamente hace update si ya existe).
drop policy if exists "mapa_oficinas_update_operaciones" on public.mapa_oficinas;
create policy "mapa_oficinas_update_operaciones" on public.mapa_oficinas
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol = 'operaciones'
    )
  );

-- ---------------------------------------------------------------------
-- 2) Storage: bucket "mapa-oficinas" (imágenes de layout + DWG)
-- ---------------------------------------------------------------------

-- Cualquier cuenta de staff puede leer los archivos (por si el bucket
-- no es público / no usaras la URL pública directamente).
drop policy if exists "mapa_oficinas_storage_select_staff" on storage.objects;
create policy "mapa_oficinas_storage_select_staff" on storage.objects
  for select using (
    bucket_id = 'mapa-oficinas'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol <> 'cliente'
    )
  );

-- Solo Operaciones puede subir archivos a este bucket.
drop policy if exists "mapa_oficinas_storage_insert_operaciones" on storage.objects;
create policy "mapa_oficinas_storage_insert_operaciones" on storage.objects
  for insert with check (
    bucket_id = 'mapa-oficinas'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol = 'operaciones'
    )
  );

-- Solo Operaciones puede reemplazar un archivo existente (upsert: true).
drop policy if exists "mapa_oficinas_storage_update_operaciones" on storage.objects;
create policy "mapa_oficinas_storage_update_operaciones" on storage.objects
  for update using (
    bucket_id = 'mapa-oficinas'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.rol = 'operaciones'
    )
  );
-- =====================================================================
