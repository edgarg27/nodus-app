-- =====================================================================
-- Migración: rol "CEO" (ceo)
--
-- Para la dirección general: ve los números de TODOS los centros en el
-- Panel de Dirección (app/dashboard/PanelDireccion.tsx) y NO puede modificar
-- nada. Las pantallas que abre las limita lib/permisosRutas.ts.
--
-- Cómo: se agrega una política de SOLO LECTURA (select) para ceo en cada
-- tabla de public que tenga RLS activo. No se le da insert, update ni delete
-- en ninguna, y no se toca ninguna política de otros roles (las permisivas
-- se suman). Se excluyen tablas con datos sensibles de pago.
-- Se compara public.mi_rol()::text (SECURITY DEFINER, ver
-- migracion_fix_recursion_profiles.sql) contra el texto 'ceo', para no usar
-- el valor nuevo del enum en la misma corrida en que se crea.
--
-- Al correrse, primero borra TODAS las políticas "*_ceo_select" (y las
-- "*_direccion_select" de una versión anterior de este rol) y luego crea las
-- de ceo, así que una tabla nueva queda cubierta con solo volver a correrlo.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de
-- Supabase, ANTES de asignar el rol a alguien.
-- Rollback: borrar las políticas "*_ceo_select" y cambiar a esas cuentas a
--   otro rol. El valor del enum puede quedarse (no estorba).
-- =====================================================================

alter type public.rol_nodus add value if not exists 'ceo';

do $$
declare
  -- Tokens de tarjetas de clientes: nadie fuera del cobro las necesita leer.
  excluidas constant text[] := array['tarjetas_guardadas'];
  pol record;
  t record;
begin
  for pol in
    select tablename, policyname from pg_policies
    where schemaname = 'public'
      and (policyname like '%\_ceo\_select' or policyname like '%\_direccion\_select')
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;

  for t in
    select c.relname as tabla
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      and c.relname <> all (excluidas)
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.mi_rol()::text = %L)',
      t.tabla || '_ceo_select', t.tabla, 'ceo'
    );
  end loop;
end $$;
