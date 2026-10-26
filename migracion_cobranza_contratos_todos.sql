-- Cobranza (Moni) ve el módulo Depósito en garantía de los tres centros.
--
-- La pantalla lee dos cosas: los pagos de depósito (pagos, que cobranza ya ve en
-- todos los centros por migracion_cobranza_todos_los_centros.sql) y los contratos
-- pre_aprobados con depósito capturado (contratos), que cobranza hasta ahora solo
-- veía de su propio centro (contratos_select_rol en migracion_rls_por_rol.sql).
--
-- Solo lectura: cobranza consulta contratos, no los edita.

drop policy if exists "contratos_cobranza_select_todos" on public.contratos;
create policy "contratos_cobranza_select_todos" on public.contratos
  for select to authenticated
  using (public.mi_rol()::text = 'cobranza');
