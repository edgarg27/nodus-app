-- =====================================================================
-- Paso 2 del rol Mantenimiento (León). Correr DESPUÉS de
-- migracion_rol_mantenimiento.sql. Es seguro volver a correrlo.
--
-- Todo queda limitado a los centros de public.centros_mantenimiento():
--   * tickets: ve y cambia el estatus (la pantalla solo muestra los de
--     mantenimiento) y comenta.
--   * mantenimientos (Mtto.): todo.
--   * gastos y proveedores de Operaciones (Pagos a proveedores, Desglose,
--     Proveedores): todo. Los pagos llegan a Contabilidad como los de la arqui.
--   * avisos (campanita): ve y manda los de sus centros.
--   * archivos de tickets, mantenimientos y comprobantes.
-- Las políticas se AGREGAN; no se toca ninguna de los demás roles.
-- Rollback: borrar las políticas que terminan en "_mantenimiento_leon" y la
--   función centros_mantenimiento().
-- =====================================================================

create or replace function public.centros_mantenimiento()
returns text[]
language sql
immutable
as $$
  select array['Puerta Bajío Piso 2', 'Puerta Bajío Piso 8', 'Stadium']::text[]
$$;

-- ---------------------------------------------------------------- tickets
drop policy if exists "tickets_select_mantenimiento_leon" on public.tickets;
create policy "tickets_select_mantenimiento_leon" on public.tickets
  for select to authenticated
  using (public.mi_rol()::text = 'mantenimiento' and centro = any (public.centros_mantenimiento()));

drop policy if exists "tickets_update_mantenimiento_leon" on public.tickets;
create policy "tickets_update_mantenimiento_leon" on public.tickets
  for update to authenticated
  using (public.mi_rol()::text = 'mantenimiento' and centro = any (public.centros_mantenimiento()))
  with check (public.mi_rol()::text = 'mantenimiento' and centro = any (public.centros_mantenimiento()));

-- ------------------------------------------------------ ticket_comentarios
drop policy if exists "ticket_comentarios_select_mantenimiento_leon" on public.ticket_comentarios;
create policy "ticket_comentarios_select_mantenimiento_leon" on public.ticket_comentarios
  for select to authenticated
  using (
    public.mi_rol()::text = 'mantenimiento'
    and exists (select 1 from public.tickets t
                where t.id = ticket_comentarios.ticket_id and t.centro = any (public.centros_mantenimiento()))
  );

drop policy if exists "ticket_comentarios_insert_mantenimiento_leon" on public.ticket_comentarios;
create policy "ticket_comentarios_insert_mantenimiento_leon" on public.ticket_comentarios
  for insert to authenticated
  with check (
    public.mi_rol()::text = 'mantenimiento'
    and exists (select 1 from public.tickets t
                where t.id = ticket_comentarios.ticket_id and t.centro = any (public.centros_mantenimiento()))
  );

-- ----------------------------------------------------------- mantenimientos
drop policy if exists "mantenimientos_mantenimiento_leon" on public.mantenimientos;
create policy "mantenimientos_mantenimiento_leon" on public.mantenimientos
  for all to authenticated
  using (public.mi_rol()::text = 'mantenimiento' and centro = any (public.centros_mantenimiento()))
  with check (public.mi_rol()::text = 'mantenimiento' and centro = any (public.centros_mantenimiento()));

-- ---------------------------------------- gastos y proveedores (Operaciones)
drop policy if exists "gastos_mantenimiento_leon" on public.gastos;
create policy "gastos_mantenimiento_leon" on public.gastos
  for all to authenticated
  using (public.mi_rol()::text = 'mantenimiento' and tipo = 'operaciones' and centro = any (public.centros_mantenimiento()))
  with check (public.mi_rol()::text = 'mantenimiento' and tipo = 'operaciones' and centro = any (public.centros_mantenimiento()));

drop policy if exists "proveedores_mantenimiento_leon" on public.proveedores;
create policy "proveedores_mantenimiento_leon" on public.proveedores
  for all to authenticated
  using (public.mi_rol()::text = 'mantenimiento' and tipo = 'operaciones' and centro = any (public.centros_mantenimiento()))
  with check (public.mi_rol()::text = 'mantenimiento' and tipo = 'operaciones' and centro = any (public.centros_mantenimiento()));

-- ---------------------------------------------------------- notificaciones
drop policy if exists "notificaciones_select_mantenimiento_leon" on public.notificaciones;
create policy "notificaciones_select_mantenimiento_leon" on public.notificaciones
  for select to authenticated
  using (public.mi_rol()::text = 'mantenimiento' and centro = any (public.centros_mantenimiento()));

drop policy if exists "notificaciones_insert_mantenimiento_leon" on public.notificaciones;
create policy "notificaciones_insert_mantenimiento_leon" on public.notificaciones
  for insert to authenticated
  with check (public.mi_rol()::text = 'mantenimiento' and centro = any (public.centros_mantenimiento()));

-- ---------------------------------------------------------------- archivos
drop policy if exists "storage_mantenimiento_leon" on storage.objects;
create policy "storage_mantenimiento_leon" on storage.objects
  for all to authenticated
  using (bucket_id in ('tickets', 'mantenimientos', 'comprobantes') and public.mi_rol()::text = 'mantenimiento')
  with check (bucket_id in ('tickets', 'mantenimientos', 'comprobantes') and public.mi_rol()::text = 'mantenimiento');

-- ---------------------------------------- perfil de mantenimiento_leon@nodusbc.mx
-- La cuenta de acceso ya existe; aquí se le pone su perfil.
insert into public.profiles (id, email, nombre, rol, centro)
select u.id, u.email, 'Edgar Peña', 'mantenimiento'::public.rol_nodus, 'Puerta Bajío Piso 2'
from auth.users u
where u.email = 'mantenimiento_leon@nodusbc.mx'
on conflict (id) do update
  set nombre = excluded.nombre,
      rol = excluded.rol,
      centro = excluded.centro;

-- Comprobación: 10 políticas (9 en tablas + 1 en storage.objects) y el perfil.
select tablename, policyname, cmd from pg_policies
where policyname like '%mantenimiento_leon'
order by tablename, policyname;
select email, nombre, rol, centro from public.profiles
where email = 'mantenimiento_leon@nodusbc.mx';
