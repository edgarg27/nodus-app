-- =====================================================================
-- Centros adicionales por persona (profiles.centros_extra).
--
-- Permite que una persona vea/edite, en pantallas limitadas a su centro, también
-- otros centros, SIN crear un rol nuevo. Caso: encargado de mantenimiento de León
-- (rol Operaciones, centro Stadium) que debe ver Mantenimiento y Proveedores de
-- los 3 centros de León (Stadium + Puerta Bajío Piso 2 y Piso 8).
--
-- Las pantallas de Mantenimiento y Proveedores YA muestran a Operaciones un
-- selector con todos los centros (incluidos los de León); lo único que lo limitaba
-- era la RLS. Aquí se amplía la RLS SOLO por persona:
--   centros_visibles() = el centro del usuario + sus centros_extra.
-- Quien no tenga centros_extra ve exactamente su propio centro, como siempre:
-- estas políticas son ADITIVAS (permisivas, se suman a las que ya existen) y solo
-- AMPLÍAN, nunca quitan. No se toca ninguna política de profiles (no afecta login).
--
-- Es seguro volver a correrlo.
-- =====================================================================

begin;

alter table public.profiles add column if not exists centros_extra text[];

-- Centros que puede ver el usuario actual: su centro + sus centros_extra (sin nulos ni repetidos).
-- SECURITY DEFINER para no recursar sobre las políticas de profiles (igual que mi_centro()).
create or replace function public.centros_visibles()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array(
    select distinct c
    from (
      select centro as c from public.profiles where id = auth.uid()
      union all
      select unnest(coalesce(centros_extra, '{}'::text[])) from public.profiles where id = auth.uid()
    ) s
    where c is not null
  ), '{}'::text[]);
$$;
revoke all on function public.centros_visibles() from public;
grant execute on function public.centros_visibles() to authenticated;

-- Operaciones puede ver/editar Proveedores y Mantenimiento de cualquiera de sus centros visibles.
drop policy if exists "proveedores_operaciones_centros_extra" on public.proveedores;
create policy "proveedores_operaciones_centros_extra" on public.proveedores
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones' and centro = any (public.centros_visibles()))
  with check (public.mi_rol()::text = 'operaciones' and centro = any (public.centros_visibles()));

drop policy if exists "mantenimientos_operaciones_centros_extra" on public.mantenimientos;
create policy "mantenimientos_operaciones_centros_extra" on public.mantenimientos
  for all to authenticated
  using (public.mi_rol()::text = 'operaciones' and centro = any (public.centros_visibles()))
  with check (public.mi_rol()::text = 'operaciones' and centro = any (public.centros_visibles()));

commit;

-- =====================================================================
-- Después de crear la cuenta de Edgar (rol Operaciones, centro Stadium), marcarle
-- los otros dos centros de León:
--   update public.profiles
--   set centros_extra = array['Puerta Bajío Piso 2', 'Puerta Bajío Piso 8']
--   where email = 'mantenimiento_leon@nodusbc.mx';
-- (Su centro Stadium + esos dos = los 3 centros de León.)
--
-- Para revertir TODO:
-- begin;
--   drop policy if exists "proveedores_operaciones_centros_extra" on public.proveedores;
--   drop policy if exists "mantenimientos_operaciones_centros_extra" on public.mantenimientos;
--   drop function if exists public.centros_visibles();
--   alter table public.profiles drop column if exists centros_extra;
-- commit;
-- =====================================================================
