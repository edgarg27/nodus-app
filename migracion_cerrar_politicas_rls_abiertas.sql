-- Cierra políticas RLS abiertas a "public" (incluye anon = cualquiera en
-- internet con la anon key, que viaja en el JS del navegador).
--
-- Hallazgo: pagos, facturas, profiles, reservaciones y tickets tenían
-- políticas "Admin can ..." con roles {public} y USING (true): sin iniciar
-- sesión se podía leer todo, marcar pagos como pagados o insertar facturas.
--
-- Se crean primero las políticas nuevas y después se borran las viejas,
-- todo en una transacción. Si algo falla, no se aplica nada.
-- Rollback: recrear las políticas borradas (nombres al final de cada bloque).

begin;

-- Helper: ¿el usuario actual es staff (cualquier rol distinto de cliente)?
-- SECURITY DEFINER para poder leer profiles sin caer en recursión de RLS.
create or replace function public.es_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.rol <> 'cliente'
  );
$$;
revoke all on function public.es_staff() from public;
grant execute on function public.es_staff() to authenticated;

-- ---------------------------------------------------------------- profiles
drop policy if exists "profiles_select_propio_o_staff" on public.profiles;
create policy "profiles_select_propio_o_staff" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.es_staff());
drop policy if exists "Admin can view all profiles" on public.profiles;

-- ------------------------------------------------------------------- pagos
drop policy if exists "pagos_select_propio_o_staff" on public.pagos;
create policy "pagos_select_propio_o_staff" on public.pagos
  for select to authenticated
  using (user_id = auth.uid() or public.es_staff());
drop policy if exists "pagos_update_staff" on public.pagos;
create policy "pagos_update_staff" on public.pagos
  for update to authenticated
  using (public.es_staff()) with check (public.es_staff());
drop policy if exists "Admin can view all pagos" on public.pagos;
drop policy if exists "Admin can update all pagos" on public.pagos;

-- ---------------------------------------------------------------- facturas
drop policy if exists "facturas_insert_staff" on public.facturas;
create policy "facturas_insert_staff" on public.facturas
  for insert to authenticated
  with check (public.es_staff());
drop policy if exists "facturas_update_staff" on public.facturas;
create policy "facturas_update_staff" on public.facturas
  for update to authenticated
  using (public.es_staff()) with check (public.es_staff());
drop policy if exists "Admin can insert facturas" on public.facturas;
drop policy if exists "Admin can update facturas" on public.facturas;

-- ------------------------------------------------------------- reservaciones
-- /reservaciones lee las reservas de TODOS para pintar los horarios
-- ocupados, así que el SELECT sigue abierto, pero solo a usuarios con
-- sesión (antes: cualquiera). Pendiente a futuro: exponer solo
-- espacio/fecha/hora vía vista o RPC en vez de la fila completa.
drop policy if exists "reservaciones_select_autenticados" on public.reservaciones;
create policy "reservaciones_select_autenticados" on public.reservaciones
  for select to authenticated
  using (true);
-- El cliente cancela las suyas; staff actualiza cualquiera.
drop policy if exists "reservaciones_update_propio_o_staff" on public.reservaciones;
create policy "reservaciones_update_propio_o_staff" on public.reservaciones
  for update to authenticated
  using (user_id = auth.uid() or public.es_staff())
  with check (user_id = auth.uid() or public.es_staff());
drop policy if exists "Admin can view all reservaciones" on public.reservaciones;
drop policy if exists "Admin can update all reservaciones" on public.reservaciones;

-- ----------------------------------------------------------------- tickets
drop policy if exists "tickets_select_propio_o_staff" on public.tickets;
create policy "tickets_select_propio_o_staff" on public.tickets
  for select to authenticated
  using (user_id = auth.uid() or public.es_staff());
drop policy if exists "tickets_update_staff" on public.tickets;
create policy "tickets_update_staff" on public.tickets
  for update to authenticated
  using (public.es_staff()) with check (public.es_staff());
drop policy if exists "Admin can view all tickets" on public.tickets;
drop policy if exists "Admin can update all tickets" on public.tickets;

-- ------------------------------------------- tablas de staff editables por
-- cualquier usuario con sesión (incluidos clientes): se limitan a staff.
drop policy if exists "coffee_break_update_staff" on public.coffee_break_paquetes;
create policy "coffee_break_update_staff" on public.coffee_break_paquetes
  for update to authenticated
  using (public.es_staff()) with check (public.es_staff());
drop policy if exists "Usuarios autenticados pueden editar coffee break" on public.coffee_break_paquetes;

drop policy if exists "comunidad_clientes_escritura_staff" on public.comunidad_clientes;
create policy "comunidad_clientes_escritura_staff" on public.comunidad_clientes
  for all to authenticated
  using (public.es_staff()) with check (public.es_staff());
drop policy if exists "Personal autenticado puede editar comunidad" on public.comunidad_clientes;

drop policy if exists "conexiones_rp_escritura_staff" on public.conexiones_rp;
create policy "conexiones_rp_escritura_staff" on public.conexiones_rp
  for all to authenticated
  using (public.es_staff()) with check (public.es_staff());
drop policy if exists "Personal autenticado puede borrar conexiones" on public.conexiones_rp;
drop policy if exists "Personal autenticado puede crear conexiones" on public.conexiones_rp;

drop policy if exists "eventos_rp_escritura_staff" on public.eventos_rp;
create policy "eventos_rp_escritura_staff" on public.eventos_rp
  for all to authenticated
  using (public.es_staff()) with check (public.es_staff());
drop policy if exists "Personal autenticado puede borrar eventos" on public.eventos_rp;
drop policy if exists "Personal autenticado puede crear eventos" on public.eventos_rp;
drop policy if exists "Personal autenticado puede actualizar eventos" on public.eventos_rp;

commit;

-- Verificación: no debe quedar ninguna política true abierta a public/anon
-- salvo oficinas (select), solicitudes_invitados y tarjetas_fidelidad
-- (insert público, intencional):
--   select tablename, policyname, cmd, roles from pg_policies
--   where schemaname = 'public' and roles::text like '%public%'
--     and (qual = 'true' or with_check = 'true');
