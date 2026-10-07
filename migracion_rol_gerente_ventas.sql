-- =====================================================================
-- Migración: rol "Gerente de Ventas" (gerente_ventas)
--
-- Rol con alcance en TODOS los centros:
--   Ventas y clientes: Prospectos (con su seguimiento), Cotizar,
--     Cotizaciones, Contratos, Nuevo cliente, Baja de cliente.
--   Cobros y finanzas: Cobranza, Pagos, Facturas, Adicionales, Depósito en
--     garantía, Ingresos por Centro.
--   Servicios y administración: Tours, Planes, Calendario de eventos,
--     Correos, Resumen (solo lectura) y Expediente de clientes.
--   Pestaña "Clientes" del panel: ver y editar cuentas de cliente.
-- No ve Sala de juntas, Mapa de oficinas, Usuarios, Reportes, Tickets ni el
-- resto de la operación del centro (las pantallas las limita
-- lib/permisosRutas.ts; aquí van los datos).
--
-- Cómo: se AGREGAN políticas solo para gerente_ventas; no se toca ninguna
-- política existente de otros roles. En Postgres las políticas permisivas
-- se suman (basta con que una lo permita). Se compara
-- public.mi_rol()::text (SECURITY DEFINER, ver
-- migracion_fix_recursion_profiles.sql) contra el texto 'gerente_ventas',
-- para no usar el valor nuevo del enum en la misma corrida en que se crea.
--
-- Al correrse, primero borra TODAS las políticas "*_gerente_ventas_*" y
-- luego crea las de la lista de abajo: si se le quita una tabla a la lista,
-- volver a correr el archivo le quita ese acceso. Si una tabla no existe en
-- esta base, se salta.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de
-- Supabase, ANTES de asignar el rol a alguien.
-- Rollback: borrar las políticas "*_gerente_ventas_*" y cambiar a esas
--   cuentas a otro rol. El valor del enum puede quedarse (no estorba).
-- =====================================================================

alter type public.rol_nodus add value if not exists 'gerente_ventas';

do $$
declare
  -- tabla → comandos que se le dan a gerente_ventas
  permisos constant jsonb := '{
    "prospectos":                     ["select", "insert", "update", "delete"],
    "prospecto_actividades":          ["select", "insert", "update"],
    "tours":                          ["select", "insert", "update", "delete"],
    "cotizaciones_comerciales":       ["select", "insert", "update"],
    "cotizaciones":                   ["select", "insert", "update"],
    "contratos":                      ["select", "insert", "update"],
    "contrato_adicionales":           ["select", "insert", "update"],
    "contrato_cambios":               ["select", "insert"],
    "contrato_versiones":             ["select", "insert", "update"],
    "pagos":                          ["select", "insert", "update"],
    "facturas":                       ["select", "insert", "update"],
    "comprobantes":                   ["select", "update"],
    "oficinas":                       ["select", "update"],
    "notificaciones":                 ["select", "insert"],
    "profiles":                       ["select"],
    "paquetes":                       ["select", "insert", "update", "delete"],
    "coffee_break_paquetes":          ["select", "insert", "update", "delete"],
    "expediente_archivos":            ["select", "insert", "update", "delete"],
    "vouchers":                       ["select", "delete"],
    "clientes":                       ["select", "insert", "delete"],
    "encuestas":                      ["select", "insert", "delete"],
    "eventos_centro":                 ["select", "insert", "delete"],
    "encuestas_envios":               ["select"],
    "dias_centro":                    ["select"],
    "adicionales_catalogo":           ["select"],
    "precios_cotizacion_sala_juntas": ["select"],
    "reservaciones":                  ["select"],
    "gastos":                         ["select"],
    "proveedores":                    ["select"],
    "centros_internet":               ["select"],
    "day_passes":                     ["select"],
    "extensiones":                    ["select"],
    "precios_sala_juntas":            ["select"],
    "registros_sala_juntas":          ["select"],
    "solicitudes_cliente":            ["select"],
    "solicitudes_invitados":          ["select"],
    "tickets":                        ["select"],
    "visitas_cliente":                ["select"]
  }';
  es_gv constant text := $q$public.mi_rol()::text = 'gerente_ventas'$q$;
  pol record;
  tabla text;
  cmd text;
  nombre text;
begin
  -- 1) Quitar las políticas de gerente_ventas de corridas anteriores.
  for pol in
    select tablename, policyname from pg_policies
    where schemaname = 'public' and policyname like '%\_gerente\_ventas\_%'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;

  -- 2) Crear las de la lista.
  for tabla in select jsonb_object_keys(permisos) loop
    if to_regclass('public.' || tabla) is null then
      raise notice 'Se salta %, no existe en esta base', tabla;
      continue;
    end if;
    for cmd in select jsonb_array_elements_text(permisos -> tabla) loop
      nombre := tabla || '_gerente_ventas_' || cmd;
      if cmd = 'select' then
        execute format('create policy %I on public.%I for select to authenticated using (%s)', nombre, tabla, es_gv);
      elsif cmd = 'insert' then
        execute format('create policy %I on public.%I for insert to authenticated with check (%s)', nombre, tabla, es_gv);
      elsif cmd = 'update' then
        execute format('create policy %I on public.%I for update to authenticated using (%s) with check (%s)', nombre, tabla, es_gv, es_gv);
      elsif cmd = 'delete' then
        execute format('create policy %I on public.%I for delete to authenticated using (%s)', nombre, tabla, es_gv);
      end if;
    end loop;
  end loop;

  -- 3) Seguimiento: igual que los demás roles, solo se borran actividades
  -- pendientes (las completadas quedan como historial).
  if to_regclass('public.prospecto_actividades') is not null then
    create policy "prospecto_actividades_gerente_ventas_delete" on public.prospecto_actividades
      for delete to authenticated
      using (public.mi_rol()::text = 'gerente_ventas' and not completada);
  end if;

  -- 4) Pestaña "Clientes" del panel: editar datos solo de cuentas de cliente
  -- (nunca de personal, ni cambiarse de rol a sí misma).
  create policy "profiles_gerente_ventas_update" on public.profiles
    for update to authenticated
    using (public.mi_rol()::text = 'gerente_ventas' and rol::text = 'cliente')
    with check (public.mi_rol()::text = 'gerente_ventas' and rol::text = 'cliente');
end $$;

-- 5) Archivos del Expediente de clientes (bucket privado, ver
-- migracion_expedientes_clientes.sql): ver, subir y borrar de todos los centros.
drop policy if exists "expedientes_storage_gerente_ventas_select" on storage.objects;
create policy "expedientes_storage_gerente_ventas_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'expedientes-clientes' and public.mi_rol()::text = 'gerente_ventas');

drop policy if exists "expedientes_storage_gerente_ventas_insert" on storage.objects;
create policy "expedientes_storage_gerente_ventas_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'expedientes-clientes' and public.mi_rol()::text = 'gerente_ventas');

drop policy if exists "expedientes_storage_gerente_ventas_delete" on storage.objects;
create policy "expedientes_storage_gerente_ventas_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'expedientes-clientes' and public.mi_rol()::text = 'gerente_ventas');
