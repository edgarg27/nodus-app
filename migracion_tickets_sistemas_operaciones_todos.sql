-- =====================================================================
-- Sistemas y Operaciones (mantenimiento) atienden los reportes (tickets)
-- de TODOS los centros.
--
-- La app ya los trata así: /tickets les muestra los de todos los centros
-- agrupados por centro, la campana les avisa de cualquier centro y el
-- correo les llega igual. Pero la política de la base (migracion_rls_lote2
-- "tickets_select_propio_o_rol" / "tickets_update_rol") les pedía
-- p.centro = tickets.centro: un reporte de Punto 45 o San Telmo no le
-- aparecía a Operaciones (perfil de Bosques) ni a Sistemas (sin centro).
-- Los comentarios de tickets ya eran de todos los centros para ellos.
--
-- Se AGREGAN políticas (las existentes no se tocan; se suman).
-- Es seguro volver a correrlo.
-- =====================================================================

drop policy if exists "tickets_sistemas_operaciones_select_todos" on public.tickets;
create policy "tickets_sistemas_operaciones_select_todos" on public.tickets
  for select to authenticated
  using (public.mi_rol()::text in ('sistemas', 'operaciones'));

drop policy if exists "tickets_sistemas_operaciones_update_todos" on public.tickets;
create policy "tickets_sistemas_operaciones_update_todos" on public.tickets
  for update to authenticated
  using (public.mi_rol()::text in ('sistemas', 'operaciones'))
  with check (public.mi_rol()::text in ('sistemas', 'operaciones'));
