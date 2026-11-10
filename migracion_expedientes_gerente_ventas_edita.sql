-- =====================================================================
-- Expediente de clientes: quién ve y quién modifica.
--
--   * Admin de cada centro: ve y modifica los de su centro (ya lo tenía:
--     migracion_expedientes_clientes.sql, no se toca aquí).
--   * Gerente de Ventas: ve y MODIFICA los de todos los centros (sube,
--     reemplaza, renombra y borra). Antes estaba en solo consulta
--     (migracion_expedientes_gerente_ventas_consulta.sql).
--   * Cobranza (la contadora): solo VE los de todos los centros.
--
-- También vuelve a crear las políticas de lectura de Gerente de Ventas y de
-- Cobranza, por si en producción no se habían corrido: sin ellas no ven
-- los documentos que sube la admin.
--
-- Solo agrega políticas para esos dos roles; no toca las de los demás.
-- Se puede correr varias veces.
-- Rollback: correr migracion_expedientes_gerente_ventas_consulta.sql
--   (le quita a la Gerente de Ventas subir y borrar).
-- =====================================================================

begin;

-- ---------- Tabla expediente_archivos ----------
drop policy if exists "expediente_archivos_gerente_ventas_select" on public.expediente_archivos;
create policy "expediente_archivos_gerente_ventas_select" on public.expediente_archivos
  for select to authenticated
  using (public.mi_rol()::text = 'gerente_ventas');

drop policy if exists "expediente_archivos_gerente_ventas_insert" on public.expediente_archivos;
create policy "expediente_archivos_gerente_ventas_insert" on public.expediente_archivos
  for insert to authenticated
  with check (public.mi_rol()::text = 'gerente_ventas');

drop policy if exists "expediente_archivos_gerente_ventas_update" on public.expediente_archivos;
create policy "expediente_archivos_gerente_ventas_update" on public.expediente_archivos
  for update to authenticated
  using (public.mi_rol()::text = 'gerente_ventas')
  with check (public.mi_rol()::text = 'gerente_ventas');

drop policy if exists "expediente_archivos_gerente_ventas_delete" on public.expediente_archivos;
create policy "expediente_archivos_gerente_ventas_delete" on public.expediente_archivos
  for delete to authenticated
  using (public.mi_rol()::text = 'gerente_ventas');

drop policy if exists "expediente_archivos_cobranza_select" on public.expediente_archivos;
create policy "expediente_archivos_cobranza_select" on public.expediente_archivos
  for select to authenticated
  using (public.mi_rol()::text = 'cobranza');

-- ---------- Archivos (bucket privado "expedientes-clientes") ----------
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

drop policy if exists "expedientes_storage_cobranza_select" on storage.objects;
create policy "expedientes_storage_cobranza_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'expedientes-clientes' and public.mi_rol()::text = 'cobranza');

commit;

-- Comprobación: Gerente de Ventas con select/insert/update/delete (tabla) y
-- select/insert/delete (archivos); Cobranza solo select en las dos.
select schemaname, tablename, policyname, cmd
from pg_policies
where policyname like 'expediente%gerente_ventas%' or policyname like 'expediente%cobranza%'
order by schemaname, tablename, policyname;
