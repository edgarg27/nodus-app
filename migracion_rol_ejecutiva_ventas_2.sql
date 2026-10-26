-- Paso 2 del rol Ejecutiva de Ventas (León). Correr DESPUÉS de
-- migracion_rol_ejecutiva_ventas.sql. Es seguro volver a correrlo.

-- 2. Centros de León del rol.
create or replace function public.centros_ejecutiva_ventas()
returns text[]
language sql
immutable
as $$
  select array['Puerta Bajío Piso 2', 'Puerta Bajío Piso 8', 'Stadium']::text[]
$$;

-- ------------------------------------------------------------ prospectos
drop policy if exists "prospectos_ejecutiva_ventas_select" on public.prospectos;
create policy "prospectos_ejecutiva_ventas_select" on public.prospectos
  for select to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

drop policy if exists "prospectos_ejecutiva_ventas_insert" on public.prospectos;
create policy "prospectos_ejecutiva_ventas_insert" on public.prospectos
  for insert to authenticated
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

drop policy if exists "prospectos_ejecutiva_ventas_update" on public.prospectos;
create policy "prospectos_ejecutiva_ventas_update" on public.prospectos
  for update to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()))
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

drop policy if exists "prospectos_ejecutiva_ventas_delete" on public.prospectos;
create policy "prospectos_ejecutiva_ventas_delete" on public.prospectos
  for delete to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- ------------------------------------------------ prospecto_actividades
-- Ver ya hereda de prospectos. Escribir: solo actividades de prospectos de León.
drop policy if exists "prospecto_actividades_ejecutiva_ventas_insert" on public.prospecto_actividades;
create policy "prospecto_actividades_ejecutiva_ventas_insert" on public.prospecto_actividades
  for insert to authenticated
  with check (
    public.mi_rol()::text = 'ejecutiva_ventas'
    and exists (select 1 from public.prospectos pr
                where pr.id = prospecto_actividades.prospecto_id and pr.centro = any (public.centros_ejecutiva_ventas()))
  );

drop policy if exists "prospecto_actividades_ejecutiva_ventas_update" on public.prospecto_actividades;
create policy "prospecto_actividades_ejecutiva_ventas_update" on public.prospecto_actividades
  for update to authenticated
  using (
    public.mi_rol()::text = 'ejecutiva_ventas'
    and exists (select 1 from public.prospectos pr
                where pr.id = prospecto_actividades.prospecto_id and pr.centro = any (public.centros_ejecutiva_ventas()))
  )
  with check (
    public.mi_rol()::text = 'ejecutiva_ventas'
    and exists (select 1 from public.prospectos pr
                where pr.id = prospecto_actividades.prospecto_id and pr.centro = any (public.centros_ejecutiva_ventas()))
  );

drop policy if exists "prospecto_actividades_ejecutiva_ventas_delete" on public.prospecto_actividades;
create policy "prospecto_actividades_ejecutiva_ventas_delete" on public.prospecto_actividades
  for delete to authenticated
  using (
    not completada
    and public.mi_rol()::text = 'ejecutiva_ventas'
    and exists (select 1 from public.prospectos pr
                where pr.id = prospecto_actividades.prospecto_id and pr.centro = any (public.centros_ejecutiva_ventas()))
  );

-- ------------------------------------------------------------------ tours
-- El seguimiento de tipo "Tour" crea, cambia o borra el tour ligado.
drop policy if exists "tours_ejecutiva_ventas" on public.tours;
create policy "tours_ejecutiva_ventas" on public.tours
  for all to authenticated
  using (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()))
  with check (public.mi_rol()::text = 'ejecutiva_ventas' and centro = any (public.centros_ejecutiva_ventas()));

-- -------------------------------------------- perfil de ventasleon@nodusbc.mx
-- La cuenta de acceso ya existe; le faltaba su perfil. El nombre se puede
-- cambiar después en Usuarios.
insert into public.profiles (id, email, nombre, rol, centro)
select u.id, u.email, 'Ejecutiva de Ventas León', 'ejecutiva_ventas'::public.rol_nodus, 'Puerta Bajío Piso 2'
from auth.users u
where u.email = 'ventasleon@nodusbc.mx'
on conflict (id) do update
  set rol = excluded.rol,
      centro = excluded.centro;
