-- Expediente de clientes: la Gerente de Ventas queda en SOLO CONSULTA.
--
-- Ve y abre los documentos que sube la admin (de todos los centros), pero ya
-- no puede subir, reemplazar, renombrar ni borrar. Antes tenía insert/update/
-- delete (migracion_rol_gerente_ventas.sql, que ya se corrigió para no
-- volver a darlos si se corre otra vez). Las políticas de lectura se quedan.
--
-- Se puede correr varias veces.
-- Rollback: volver a crear las políticas que aquí se borran (ver
-- migracion_rol_gerente_ventas.sql en la versión anterior).

drop policy if exists "expediente_archivos_gerente_ventas_insert" on public.expediente_archivos;
drop policy if exists "expediente_archivos_gerente_ventas_update" on public.expediente_archivos;
drop policy if exists "expediente_archivos_gerente_ventas_delete" on public.expediente_archivos;

drop policy if exists "expedientes_storage_gerente_ventas_insert" on storage.objects;
drop policy if exists "expedientes_storage_gerente_ventas_delete" on storage.objects;

-- Comprobación: debe salir solo la de select en cada tabla.
select schemaname, tablename, policyname, cmd
from pg_policies
where policyname like 'expediente%gerente_ventas%'
order by schemaname, tablename, policyname;
