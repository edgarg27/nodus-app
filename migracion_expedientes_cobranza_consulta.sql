-- Expediente de clientes: Cobranza (la contadora) en SOLO CONSULTA, como la Gerente de Ventas
-- (migracion_expedientes_gerente_ventas_consulta.sql): ve y abre los documentos de todos los centros (factura en
-- todos), pero no sube, reemplaza, renombra ni borra.
--
-- Se puede correr varias veces.
-- Rollback: drop policy de las dos políticas de abajo.

drop policy if exists "expediente_archivos_cobranza_select" on public.expediente_archivos;
create policy "expediente_archivos_cobranza_select" on public.expediente_archivos
  for select to authenticated
  using (public.mi_rol()::text = 'cobranza');

drop policy if exists "expedientes_storage_cobranza_select" on storage.objects;
create policy "expedientes_storage_cobranza_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'expedientes-clientes' and public.mi_rol()::text = 'cobranza');

-- Comprobación: deben salir las dos, solo de select.
select schemaname, tablename, policyname, cmd
from pg_policies
where policyname like 'expedient%cobranza%'
order by schemaname, tablename, policyname;
