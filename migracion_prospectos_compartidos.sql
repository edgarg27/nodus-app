-- =====================================================================
-- Prospectos compartidos entre centros.
--
-- Antes: el personal de un centro (admin, operaciones, sistemas, ventas)
-- solo veía y trabajaba los prospectos de SU centro (prospectos.centro =
-- su perfil). La pantalla /prospectos ya pedía todos, pero la base los
-- filtraba, así que Punto 45 y San Telmo no veían los de Bosques.
--
-- Ahora:
--   - VER: todo el personal de esos roles ve los prospectos de todos los
--     centros (y su seguimiento), para que si a un centro se le pasa dar
--     seguimiento, otro lo haga.
--   - DAR SEGUIMIENTO: cambiar el estado del prospecto y registrar o
--     completar actividades, en cualquier centro.
--   - REGISTRAR y BORRAR prospectos: solo en su propio centro (como antes).
--
-- superadmin y gerente siguen pudiendo todo. Las políticas aparte de
-- gerente_ventas (migracion_rol_gerente_ventas.sql) no se tocan.
--
-- Es seguro volver a correrlo.
-- =====================================================================

-- ------------------------------------------------------------ prospectos
drop policy if exists "prospectos_select_rol" on public.prospectos;
drop policy if exists "prospectos_escribe_rol" on public.prospectos;
drop policy if exists "prospectos_insert_rol" on public.prospectos;
drop policy if exists "prospectos_update_rol" on public.prospectos;
drop policy if exists "prospectos_delete_rol" on public.prospectos;

create policy "prospectos_select_rol" on public.prospectos
  for select to authenticated
  using (
    public.mi_rol()::text in ('superadmin', 'gerente', 'admin', 'sistemas', 'operaciones', 'ventas')
  );

create policy "prospectos_insert_rol" on public.prospectos
  for insert to authenticated
  with check (
    public.mi_rol()::text in ('superadmin', 'gerente')
    or (public.mi_rol()::text in ('admin', 'sistemas', 'operaciones') and centro = public.mi_centro())
  );

create policy "prospectos_update_rol" on public.prospectos
  for update to authenticated
  using (public.mi_rol()::text in ('superadmin', 'gerente', 'admin', 'sistemas', 'operaciones'))
  with check (public.mi_rol()::text in ('superadmin', 'gerente', 'admin', 'sistemas', 'operaciones'));

create policy "prospectos_delete_rol" on public.prospectos
  for delete to authenticated
  using (
    public.mi_rol()::text in ('superadmin', 'gerente')
    or (public.mi_rol()::text in ('admin', 'sistemas', 'operaciones') and centro = public.mi_centro())
  );

-- ------------------------------------------------ prospecto_actividades
-- Ver: ya hereda de prospectos (la política de select pide que el
-- prospecto sea visible), no cambia.

drop policy if exists "prospecto_actividades_insert" on public.prospecto_actividades;
create policy "prospecto_actividades_insert" on public.prospecto_actividades
  for insert to authenticated
  with check (
    public.mi_rol()::text in ('superadmin', 'gerente', 'admin', 'sistemas', 'operaciones')
    and exists (select 1 from public.prospectos pr where pr.id = prospecto_actividades.prospecto_id)
  );

drop policy if exists "prospecto_actividades_update" on public.prospecto_actividades;
create policy "prospecto_actividades_update" on public.prospecto_actividades
  for update to authenticated
  using (
    public.mi_rol()::text in ('superadmin', 'gerente', 'admin', 'sistemas', 'operaciones')
    and exists (select 1 from public.prospectos pr where pr.id = prospecto_actividades.prospecto_id)
  )
  with check (
    public.mi_rol()::text in ('superadmin', 'gerente', 'admin', 'sistemas', 'operaciones')
    and exists (select 1 from public.prospectos pr where pr.id = prospecto_actividades.prospecto_id)
  );

-- Borrar una actividad pendiente: solo del propio centro (las completadas
-- quedan como historial, igual que antes).
drop policy if exists "prospecto_actividades_delete" on public.prospecto_actividades;
create policy "prospecto_actividades_delete" on public.prospecto_actividades
  for delete to authenticated
  using (
    not completada
    and exists (
      select 1 from public.prospectos pr
      where pr.id = prospecto_actividades.prospecto_id
        and (
          public.mi_rol()::text in ('superadmin', 'gerente')
          or (public.mi_rol()::text in ('admin', 'sistemas', 'operaciones') and pr.centro = public.mi_centro())
        )
    )
  );

-- ------------------------------------------------------------- profiles
-- "Registró: <nombre>" en cada prospecto y quién hizo cada actividad salen
-- del perfil de esa persona. Antes el personal solo leía perfiles de su
-- propio centro, así que en Punto 45 no salía quién registró un prospecto
-- de Bosques. Ahora el personal puede leer los perfiles del PERSONAL de
-- todos los centros (nunca los de clientes de otro centro: esos siguen con
-- la política de antes). mi_rol() es SECURITY DEFINER, sin recursión.
drop policy if exists "profiles_select_personal_entre_centros" on public.profiles;
create policy "profiles_select_personal_entre_centros" on public.profiles
  for select to authenticated
  using (
    rol <> 'cliente'::rol_nodus
    and public.mi_rol()::text <> 'cliente'
  );
