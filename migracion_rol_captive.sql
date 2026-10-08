-- =====================================================================
-- Migración: rol "Captive" (captive)
--
-- Misma vista que el rol CEO (ver migracion_rol_ceo.sql): el Panel de
-- Dirección con los números de TODOS los centros, solo consulta. Además, en
-- "Espacios y contratos" ve el precio de lista de cada espacio disponible
-- (app/dashboard/PanelDireccion.tsx). Las pantallas que abre las limita
-- lib/permisosRutas.ts.
--
-- Cómo: una política de SOLO LECTURA (select) para captive en cada tabla de
-- public que tenga RLS activo. Sin insert, update ni delete en ninguna, y sin
-- tocar las políticas de otros roles (las permisivas se suman). Se excluyen
-- tablas con datos sensibles de pago. Se compara public.mi_rol()::text
-- contra el texto 'captive', para no usar el valor nuevo del enum en la
-- misma corrida en que se crea.
--
-- Al correrse, primero borra TODAS las políticas "*_captive_select" y las
-- vuelve a crear, así que una tabla nueva queda cubierta con solo volver a
-- correr el archivo.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de
-- Supabase, ANTES de asignar el rol a alguien.
-- Rollback: borrar las políticas "*_captive_select" y cambiar a esas cuentas
--   a otro rol. El valor del enum puede quedarse (no estorba).
-- =====================================================================

alter type public.rol_nodus add value if not exists 'captive';

do $$
declare
  -- Tokens de tarjetas de clientes: nadie fuera del cobro las necesita leer.
  excluidas constant text[] := array['tarjetas_guardadas'];
  pol record;
  t record;
begin
  for pol in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and policyname like '%\_captive\_select'
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
      t.tabla || '_captive_select', t.tabla, 'captive'
    );
  end loop;
end $$;
