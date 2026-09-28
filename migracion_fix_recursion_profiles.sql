-- =====================================================================
-- URGENTE: corrige "infinite recursion detected in policy for relation
-- profiles" introducida por migracion_rls_lote2.sql.
--
-- Causa: la política nueva de profiles ("profiles_select_propio_o_centro")
-- se autoconsulta — su condición hace un SELECT sobre la propia tabla
-- profiles, y esa consulta interna vuelve a disparar la misma política, y
-- así sin fin. Todas las demás tablas del lote 2 (y varias de antes) también
-- consultan profiles para saber el rol de quien pregunta, así que con
-- profiles rota, TODAS esas tablas empezaron a fallar con error 500 — para
-- cualquier rol, incluido admin. No es que estén "más cerradas": están
-- devolviendo error en vez de datos.
--
-- Arreglo: como ya hacía la política original (es_staff()), el rol y el
-- centro del usuario actual se piden a través de una función
-- SECURITY DEFINER (que no vuelve a pasar por las políticas de la tabla), en
-- vez de un SELECT normal sobre profiles. mi_rol() ya existe (se usa en
-- varias políticas de antes); aquí se agrega su equivalente para el centro.
--
-- Solo toca profiles: en cuanto su política deje de autoconsultarse, las
-- demás tablas (que consultan profiles desde AFUERA, no desde sí mismas)
-- vuelven a funcionar solas, sin tocarlas.
--
-- Es seguro volver a correrlo.
-- =====================================================================

begin;

create or replace function public.mi_centro()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select centro from public.profiles where id = auth.uid();
$$;
revoke all on function public.mi_centro() from public;
grant execute on function public.mi_centro() to authenticated;

drop policy if exists "profiles_select_propio_o_centro" on public.profiles;

create policy "profiles_select_propio_o_centro" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or (es_staff() and (mi_rol() = any (array['superadmin', 'sistemas']) or mi_centro() = profiles.centro))
  );

commit;
