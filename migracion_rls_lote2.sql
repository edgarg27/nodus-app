-- =====================================================================
-- RLS por rol de personal (segundo lote): profiles y las 13 tablas que
-- quedaron pendientes del primer lote (migracion_rls_por_rol.sql).
--
-- Mismo patrón que el lote 1: la mayoría de estas tablas tenían una política
-- "cualquier personal, mismo centro" (a veces varias encimadas, algunas ya
-- correctas y otras no) — con sesión de cualquier rol de personal (Ventas,
-- Diseño, Atención al Cliente…) se podía leer o editar directo por la API de
-- Supabase información que no le tocaba a ese rol: gastos, proveedores,
-- prospectos, cotizaciones, registros de sala de juntas, extensiones de
-- teléfono, precios internos…
--
-- profiles es aparte: casi toda pantalla de personal necesita leer el
-- nombre/correo de ALGÚN cliente (para tickets, paquetería, mapa de
-- oficinas…), así que restringir por ROL ahí rompería demasiadas pantallas.
-- Lo único que se acota es que sea del MISMO CENTRO (como ya pasa en casi
-- todas las demás tablas) — sistemas y superadmin siguen viendo cualquier
-- centro. No se toca profiles_select del propio usuario ni update/insert.
--
-- oficinas: además de la política de "cualquier rol" para escribir, tenía
-- una segunda política de LECTURA abierta literalmente a cualquiera, sin
-- sesión ("Todos ven oficinas", rol "public"). Se deja solo a quien tiene
-- sesión (no se restringe más porque hoy se usa para mostrar oficinas
-- disponibles al cotizar/reservar).
--
-- Roles por tabla (de las pantallas que ya las usan, ver
-- lib/permisosRutas.ts, lib/permisosApi.ts y el mapeo hecho a mano de qué
-- pantalla usa qué tabla):
--   mantenimientos, tickets     admin, gerente, sistemas, operaciones
--     (+ atencion_cliente en tickets, por Paquetería)
--   vouchers                   admin, gerente, sistemas, operaciones,
--                               atencion_cliente (igual que lib/permisosApi.ts)
--   mapa_oficinas (escribir)   admin, gerente, sistemas, operaciones,
--                               atencion_cliente, ventas
--   prospectos, cotizaciones_comerciales (leer)
--                               admin, gerente, sistemas, operaciones, ventas
--   prospectos, cotizaciones_comerciales (escribir), cotizaciones
--                               admin, gerente (+ sistemas, operaciones en
--                               prospectos y cotizaciones_comerciales)
--   oficinas (escribir)        admin, gerente, sistemas, operaciones,
--                               atencion_cliente, ventas
--   gastos, proveedores        admin, gerente, cobranza, sistemas, operaciones
--   extensiones, registros_sala_juntas
--                               ver arriba, caso por caso
--   precios_cotizacion_sala_juntas (escribir)
--                               admin, gerente, sistemas
--
-- Es seguro volver a correrlo. Todo en una transacción.
-- =====================================================================

begin;

-- --------------------------------------------------------------- profiles
drop policy if exists "profiles_select_propio_o_staff" on public.profiles;
drop policy if exists "cobranza_select_profiles" on public.profiles;

create policy "profiles_select_propio_o_centro" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.rol <> 'cliente'::rol_nodus
        and (p.rol = any (array['superadmin'::rol_nodus, 'sistemas'::rol_nodus]) or p.centro = profiles.centro)
    )
  );

-- ----------------------------------------------------------- mantenimientos
drop policy if exists "acceso a mantenimientos por centro" on public.mantenimientos;

create policy "mantenimientos_admin_centro" on public.mantenimientos
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'admin'::rol_nodus and p.centro = mantenimientos.centro))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = 'admin'::rol_nodus and p.centro = mantenimientos.centro));

create policy "roles_globales_delete_mantenimientos" on public.mantenimientos
  for delete to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = any (array['sistemas'::rol_nodus, 'superadmin'::rol_nodus, 'gerente'::rol_nodus, 'operaciones'::rol_nodus])));

-- ---------------------------------------------------------------- tickets
drop policy if exists "staff actualiza tickets por centro" on public.tickets;
drop policy if exists "staff ve tickets por centro" on public.tickets;
drop policy if exists "tickets_select_propio_o_staff" on public.tickets;
drop policy if exists "tickets_update_staff" on public.tickets;

create policy "tickets_select_propio_o_rol" on public.tickets
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus, 'atencion_cliente'::rol_nodus]) and p.centro = tickets.centro)
        )
    )
  );

create policy "tickets_update_rol" on public.tickets
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus, 'atencion_cliente'::rol_nodus]) and p.centro = tickets.centro)
        )
    )
  );

-- ---------------------------------------------------------------- vouchers
drop policy if exists "staff borra vouchers" on public.vouchers;
drop policy if exists "staff crea vouchers" on public.vouchers;
drop policy if exists "staff ve todos los vouchers" on public.vouchers;

create policy "vouchers_rol" on public.vouchers
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = any (array['superadmin'::rol_nodus, 'sistemas'::rol_nodus])
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'operaciones'::rol_nodus, 'atencion_cliente'::rol_nodus]) and p.centro = vouchers.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = any (array['superadmin'::rol_nodus, 'sistemas'::rol_nodus])
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'operaciones'::rol_nodus, 'atencion_cliente'::rol_nodus]) and p.centro = vouchers.centro)
        )
    )
  );

-- ------------------------------------------------------------ mapa_oficinas
drop policy if exists "acceso a mapa oficinas por centro" on public.mapa_oficinas;
drop policy if exists "mapa_oficinas_insert_operaciones" on public.mapa_oficinas;
drop policy if exists "mapa_oficinas_update_operaciones" on public.mapa_oficinas;

create policy "mapa_oficinas_escribe_rol" on public.mapa_oficinas
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = any (array['superadmin'::rol_nodus, 'sistemas'::rol_nodus])
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'operaciones'::rol_nodus, 'atencion_cliente'::rol_nodus, 'ventas'::rol_nodus]) and p.centro = mapa_oficinas.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = any (array['superadmin'::rol_nodus, 'sistemas'::rol_nodus])
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'operaciones'::rol_nodus, 'atencion_cliente'::rol_nodus, 'ventas'::rol_nodus]) and p.centro = mapa_oficinas.centro)
        )
    )
  );

-- --------------------------------------------------------------- prospectos
drop policy if exists "acceso a prospectos por centro" on public.prospectos;

create policy "prospectos_select_rol" on public.prospectos
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus, 'ventas'::rol_nodus]) and p.centro = prospectos.centro)
        )
    )
  );

create policy "prospectos_escribe_rol" on public.prospectos
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = prospectos.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = prospectos.centro)
        )
    )
  );

-- ------------------------------------------------------------- cotizaciones
drop policy if exists "acceso a cotizaciones por centro" on public.cotizaciones;

create policy "cotizaciones_rol" on public.cotizaciones
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.rol = 'superadmin'::rol_nodus or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus]) and p.centro = cotizaciones.centro))))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and (p.rol = 'superadmin'::rol_nodus or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus]) and p.centro = cotizaciones.centro))));

-- ----------------------------------------------------- cotizaciones_comerciales
drop policy if exists "cotizaciones_comerciales_insert_staff" on public.cotizaciones_comerciales;
drop policy if exists "cotizaciones_comerciales_select_staff" on public.cotizaciones_comerciales;
drop policy if exists "cotizaciones_comerciales_update_staff" on public.cotizaciones_comerciales;

create policy "cotizaciones_comerciales_select_rol" on public.cotizaciones_comerciales
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus, 'ventas'::rol_nodus]) and p.centro = cotizaciones_comerciales.centro)
        )
    )
  );

create policy "cotizaciones_comerciales_insert_rol" on public.cotizaciones_comerciales
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = cotizaciones_comerciales.centro)
        )
    )
  );

create policy "cotizaciones_comerciales_update_rol" on public.cotizaciones_comerciales
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = cotizaciones_comerciales.centro)
        )
    )
  );

-- ----------------------------------------------------------------- oficinas
drop policy if exists "Admin gestiona oficinas por centro" on public.oficinas;
drop policy if exists "Todos ven oficinas" on public.oficinas;

create policy "oficinas_select_autenticados" on public.oficinas
  for select to authenticated using (true);

create policy "oficinas_escribe_rol" on public.oficinas
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = any (array['superadmin'::rol_nodus, 'sistemas'::rol_nodus])
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'operaciones'::rol_nodus, 'atencion_cliente'::rol_nodus, 'ventas'::rol_nodus]) and p.centro = oficinas.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = any (array['superadmin'::rol_nodus, 'sistemas'::rol_nodus])
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'operaciones'::rol_nodus, 'atencion_cliente'::rol_nodus, 'ventas'::rol_nodus]) and p.centro = oficinas.centro)
        )
    )
  );

-- ------------------------------------------------------------------- gastos
drop policy if exists "acceso a gastos por centro" on public.gastos;
drop policy if exists "gastos_insert_staff" on public.gastos;
drop policy if exists "gastos_select_staff" on public.gastos;
drop policy if exists "roles_globales_delete_gastos" on public.gastos;
drop policy if exists "roles_globales_insert_gastos" on public.gastos;
drop policy if exists "roles_globales_select_gastos" on public.gastos;

create policy "gastos_select_rol" on public.gastos
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = gastos.centro)
        )
    )
  );

create policy "gastos_escribe_rol" on public.gastos
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = gastos.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = gastos.centro)
        )
    )
  );

-- -------------------------------------------------------------- proveedores
drop policy if exists "acceso a proveedores por centro" on public.proveedores;
drop policy if exists "proveedores_insert_staff" on public.proveedores;
drop policy if exists "proveedores_select_staff" on public.proveedores;
drop policy if exists "roles_globales_delete_proveedores" on public.proveedores;
drop policy if exists "roles_globales_insert_proveedores" on public.proveedores;
drop policy if exists "roles_globales_select_proveedores" on public.proveedores;

create policy "proveedores_select_rol" on public.proveedores
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = proveedores.centro)
        )
    )
  );

create policy "proveedores_escribe_rol" on public.proveedores
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = proveedores.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = proveedores.centro)
        )
    )
  );

-- ------------------------------------------------------------- extensiones
drop policy if exists "acceso a extensiones por centro" on public.extensiones;

create policy "extensiones_select_rol" on public.extensiones
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = extensiones.centro)
        )
    )
  );

create policy "extensiones_escribe_rol" on public.extensiones
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = extensiones.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = extensiones.centro)
        )
    )
  );

-- ---------------------------------------------------------- registros_sala_juntas
drop policy if exists "acceso a registros sala de juntas por centro" on public.registros_sala_juntas;

create policy "registros_sala_juntas_select_rol" on public.registros_sala_juntas
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'ventas'::rol_nodus, 'sistemas'::rol_nodus, 'operaciones'::rol_nodus]) and p.centro = registros_sala_juntas.centro)
        )
    )
  );

create policy "registros_sala_juntas_escribe_rol" on public.registros_sala_juntas
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'ventas'::rol_nodus]) and p.centro = registros_sala_juntas.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'ventas'::rol_nodus]) and p.centro = registros_sala_juntas.centro)
        )
    )
  );

-- --------------------------------------------------- precios_cotizacion_sala_juntas
drop policy if exists "precios_cotizacion_sala_juntas_staff_all" on public.precios_cotizacion_sala_juntas;
drop policy if exists "precios_cotizacion_sala_juntas_write" on public.precios_cotizacion_sala_juntas;

create policy "precios_cotizacion_sala_juntas_write_rol" on public.precios_cotizacion_sala_juntas
  for all to authenticated
  using (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = any (array['admin'::rol_nodus, 'sistemas'::rol_nodus, 'superadmin'::rol_nodus, 'gerente'::rol_nodus])))
  with check (exists (select 1 from public.profiles where profiles.id = auth.uid() and profiles.rol = any (array['admin'::rol_nodus, 'sistemas'::rol_nodus, 'superadmin'::rol_nodus, 'gerente'::rol_nodus])));
-- (precios_cotizacion_sala_juntas_select, que deja ver el precio a cualquier
-- autenticado, se queda igual: lo necesita el cliente al cotizar.)

commit;

-- =====================================================================
-- Rollback si algo se rompe: recrea la política ancha original de esa tabla
-- (vuelve exactamente a como estaba antes de este archivo) y borra la(s)
-- nueva(s). Ejemplo con mantenimientos — para las demás tablas es el mismo
-- patrón, dime cuál y te paso su rollback exacto (tengo guardado el texto
-- original de cada política que se borró aquí).
--
-- begin;
-- drop policy if exists "mantenimientos_admin_centro" on public.mantenimientos;
-- drop policy if exists "roles_globales_delete_mantenimientos" on public.mantenimientos;
-- create policy "acceso a mantenimientos por centro" on public.mantenimientos for all to public
--   using (exists (select 1 from profiles p where p.id = auth.uid() and p.rol <> 'cliente'::rol_nodus and (p.rol = any (array['superadmin'::rol_nodus,'sistemas'::rol_nodus]) or p.centro = mantenimientos.centro)))
--   with check (exists (select 1 from profiles p where p.id = auth.uid() and p.rol <> 'cliente'::rol_nodus and (p.rol = any (array['superadmin'::rol_nodus,'sistemas'::rol_nodus]) or p.centro = mantenimientos.centro)));
-- commit;
-- =====================================================================
