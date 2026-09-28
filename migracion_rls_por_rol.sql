-- =====================================================================
-- RLS por rol de personal (primer lote): pagos, facturas, contratos, y el
-- hueco de "cualquier cuenta con sesión puede editar/borrar" en clientes,
-- encuestas, encuestas_envios y eventos_centro.
--
-- Hallazgo: la mayoría de las políticas de estas tablas solo comprueban
-- "no ser cliente" (o "estar autenticado"), no qué ROL de personal es. Con
-- sesión de cualquier cuenta de personal (Ventas, Diseño, Atención al
-- Cliente…) se podía, llamando directo a la API de Supabase (sin pasar por
-- la app):
--   - Leer y marcar como pagado cualquier pago de cualquier centro (pagos).
--   - Leer, dar de alta y editar cualquier factura (facturas).
--   - Leer y editar cualquier contrato de cualquier centro (contratos).
--   - Con una cuenta de CLIENTE (no solo personal): editar o borrar
--     cualquier fila de clientes, encuestas, encuestas_envios o
--     eventos_centro de cualquier centro (esas 4 tablas solo pedían
--     "tener sesión", sin distinguir cliente de personal).
--
-- Este lote deja fuera (quedan para un siguiente lote, con más pruebas):
-- profiles (la usan casi todas las pantallas de personal para ver nombre/
-- correo de un cliente; restringir por rol ahí rompería demasiadas
-- pantallas sin antes revisar cada una), mantenimientos, tickets, vouchers,
-- mapa_oficinas, prospectos, cotizaciones, cotizaciones_comerciales,
-- oficinas, gastos, proveedores, extensiones, registros_sala_juntas,
-- precios_cotizacion_sala_juntas (tienen políticas viejas de más
-- "cualquier personal del centro" junto con otras ya correctas: hay que
-- quitar las viejas sin romper las nuevas).
--
-- Roles por tabla (de las pantallas que ya las usan, ver
-- lib/permisosRutas.ts y lib/permisosApi.ts):
--   pagos     ver y marcar pagado: admin, gerente, cobranza (superadmin
--             siempre puede, sin importar el centro)
--   facturas  ver, dar de alta y editar: admin, gerente, cobranza
--   contratos ver: admin, gerente, ventas, operaciones, sistemas, cobranza
--             editar: admin, gerente, ventas, operaciones, sistemas
--             (cobranza solo consulta, no edita)
--
-- Es seguro volver a correrlo. Todo en una transacción: si algo falla, no
-- se aplica nada.
-- Rollback: recrear las políticas borradas (quedan comentadas al final de
-- cada bloque, con su condición original).
-- =====================================================================

begin;

-- ------------------------------------------------------------------- pagos
drop policy if exists "pagos_select_propio_o_staff" on public.pagos;
drop policy if exists "staff ve todos los pagos" on public.pagos;
drop policy if exists "pagos_update_staff" on public.pagos;
drop policy if exists "staff actualiza pagos" on public.pagos;

create policy "pagos_select_propio_o_rol" on public.pagos
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus]) and p.centro = pagos.centro)
        )
    )
  );

create policy "pagos_update_rol" on public.pagos
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus]) and p.centro = pagos.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus]) and p.centro = pagos.centro)
        )
    )
  );

-- ---------------------------------------------------------------- facturas
drop policy if exists "Ver facturas" on public.facturas;
drop policy if exists "cobranza_select_facturas" on public.facturas;
drop policy if exists "facturas_insert_staff" on public.facturas;
drop policy if exists "facturas_update_staff" on public.facturas;

create policy "facturas_select_propio_o_rol" on public.facturas
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus]) and p.centro = facturas.centro)
        )
    )
  );

create policy "facturas_insert_rol" on public.facturas
  for insert to authenticated
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus]) and p.centro = facturas.centro)
        )
    )
  );

create policy "facturas_update_rol" on public.facturas
  for update to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus]) and p.centro = facturas.centro)
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'cobranza'::rol_nodus]) and p.centro = facturas.centro)
        )
    )
  );

-- --------------------------------------------------------------- contratos
drop policy if exists "Admin gestiona contratos" on public.contratos;
drop policy if exists "Cliente ve su contrato" on public.contratos;
drop policy if exists "cliente ve su contrato" on public.contratos;
drop policy if exists "cobranza_select_contratos" on public.contratos;
drop policy if exists "staff administra contratos por centro" on public.contratos;

create policy "contratos_select_cliente" on public.contratos
  for select to authenticated
  using (user_id = auth.uid());

create policy "contratos_select_rol" on public.contratos
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (
            p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'ventas'::rol_nodus, 'operaciones'::rol_nodus, 'sistemas'::rol_nodus, 'cobranza'::rol_nodus])
            and p.centro = contratos.centro
          )
        )
    )
  );

create policy "contratos_escribe_rol" on public.contratos
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (
            p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'ventas'::rol_nodus, 'operaciones'::rol_nodus, 'sistemas'::rol_nodus])
            and p.centro = contratos.centro
          )
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.rol = 'superadmin'::rol_nodus
          or (
            p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'ventas'::rol_nodus, 'operaciones'::rol_nodus, 'sistemas'::rol_nodus])
            and p.centro = contratos.centro
          )
        )
    )
  );

-- ------------------------------------------------------- "cualquier sesión
-- puede editar/borrar todo" en 4 tablas del módulo Experiencia del Cliente:
-- se deja el SELECT abierto (como ya estaba: lo leen pantallas de cliente
-- como el calendario y "mis encuestas") y se restringe INSERT/UPDATE/DELETE
-- a los roles que de verdad los editan (ver app/experiencia-cliente).
drop policy if exists "Autenticados administran clientes" on public.clientes;
create policy "clientes_select_autenticados" on public.clientes
  for select to authenticated using (true);
create policy "clientes_escribe_rol" on public.clientes
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'superadmin'::rol_nodus, 'cobranza'::rol_nodus, 'atencion_cliente'::rol_nodus, 'diseno'::rol_nodus, 'ventas'::rol_nodus])))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'superadmin'::rol_nodus, 'cobranza'::rol_nodus, 'atencion_cliente'::rol_nodus, 'diseno'::rol_nodus, 'ventas'::rol_nodus])));

drop policy if exists "Autenticados administran encuestas" on public.encuestas;
create policy "encuestas_select_autenticados" on public.encuestas
  for select to authenticated using (true);
create policy "encuestas_escribe_rol" on public.encuestas
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'superadmin'::rol_nodus, 'cobranza'::rol_nodus, 'atencion_cliente'::rol_nodus, 'diseno'::rol_nodus, 'ventas'::rol_nodus])))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'superadmin'::rol_nodus, 'cobranza'::rol_nodus, 'atencion_cliente'::rol_nodus, 'diseno'::rol_nodus, 'ventas'::rol_nodus])));

drop policy if exists "Autenticados administran encuestas_envios" on public.encuestas_envios;
create policy "encuestas_envios_select_autenticados" on public.encuestas_envios
  for select to authenticated using (true);
create policy "encuestas_envios_escribe_rol" on public.encuestas_envios
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'superadmin'::rol_nodus, 'cobranza'::rol_nodus, 'atencion_cliente'::rol_nodus, 'diseno'::rol_nodus, 'ventas'::rol_nodus])))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'superadmin'::rol_nodus, 'cobranza'::rol_nodus, 'atencion_cliente'::rol_nodus, 'diseno'::rol_nodus, 'ventas'::rol_nodus])));

drop policy if exists "Autenticados administran eventos_centro" on public.eventos_centro;
create policy "eventos_centro_select_autenticados" on public.eventos_centro
  for select to authenticated using (true);
create policy "eventos_centro_escribe_rol" on public.eventos_centro
  for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'superadmin'::rol_nodus, 'cobranza'::rol_nodus, 'atencion_cliente'::rol_nodus, 'diseno'::rol_nodus, 'ventas'::rol_nodus])))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.rol = any (array['admin'::rol_nodus, 'gerente'::rol_nodus, 'superadmin'::rol_nodus, 'cobranza'::rol_nodus, 'atencion_cliente'::rol_nodus, 'diseno'::rol_nodus, 'ventas'::rol_nodus])));

commit;

-- =====================================================================
-- Rollback si algo se rompe (recrea las políticas tal como estaban):
--
-- begin;
-- drop policy if exists "pagos_select_propio_o_rol" on public.pagos;
-- drop policy if exists "pagos_update_rol" on public.pagos;
-- create policy "pagos_select_propio_o_staff" on public.pagos for select to authenticated using ((user_id = auth.uid()) OR es_staff());
-- create policy "pagos_update_staff" on public.pagos for update to authenticated using (es_staff()) with check (es_staff());
--
-- drop policy if exists "facturas_select_propio_o_rol" on public.facturas;
-- drop policy if exists "facturas_insert_rol" on public.facturas;
-- drop policy if exists "facturas_update_rol" on public.facturas;
-- create policy "Ver facturas" on public.facturas for select to public using ((auth.uid() = user_id) OR ((select profiles.rol from profiles where profiles.id = auth.uid()) = ANY (ARRAY['sistemas'::rol_nodus,'admin'::rol_nodus,'pagos'::rol_nodus,'cobranza'::rol_nodus])));
-- create policy "facturas_insert_staff" on public.facturas for insert to authenticated with check (es_staff());
-- create policy "facturas_update_staff" on public.facturas for update to authenticated using (es_staff()) with check (es_staff());
--
-- drop policy if exists "contratos_select_cliente" on public.contratos;
-- drop policy if exists "contratos_select_rol" on public.contratos;
-- drop policy if exists "contratos_escribe_rol" on public.contratos;
-- create policy "cliente ve su contrato" on public.contratos for select to public using (user_id = auth.uid());
-- create policy "staff administra contratos por centro" on public.contratos for all to public
--   using (exists (select 1 from profiles p where p.id = auth.uid() and p.rol <> 'cliente'::rol_nodus and (p.rol = any (array['superadmin'::rol_nodus,'sistemas'::rol_nodus]) or p.centro = contratos.centro)))
--   with check (exists (select 1 from profiles p where p.id = auth.uid() and p.rol <> 'cliente'::rol_nodus and (p.rol = any (array['superadmin'::rol_nodus,'sistemas'::rol_nodus]) or p.centro = contratos.centro)));
--
-- drop policy if exists "clientes_select_autenticados" on public.clientes;
-- drop policy if exists "clientes_escribe_rol" on public.clientes;
-- create policy "Autenticados administran clientes" on public.clientes for all to public using (auth.role() = 'authenticated'::text) with check (auth.role() = 'authenticated'::text);
-- (mismo patrón para encuestas, encuestas_envios, eventos_centro)
-- commit;
-- =====================================================================
