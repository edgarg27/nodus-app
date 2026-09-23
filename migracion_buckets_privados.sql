-- Marca como PRIVADOS los buckets con documentos y fotos de clientes.
--
-- NO correr hasta que el código con /api/archivos/firmar esté desplegado y
-- probado: desde ese momento todos los archivos se abren con links firmados
-- que genera el servidor (comprobando que el usuario puede verlos: el staff
-- cualquiera, el cliente solo los ligados a sus propios registros). Con el
-- bucket privado dejan de servir las URLs públicas guardadas en la base, así
-- que cualquier link viejo ya compartido (correo, chat) deja de abrir.
--
-- No hacen falta políticas nuevas en storage.objects: el servidor firma con la
-- service role y la subida de archivos sigue usando las políticas de insert
-- que ya existen. No incluye logros, banners-promocionales, mapa-oficinas ni
-- decoraciones (imágenes de marketing/planos que se muestran a propósito), ni
-- documentacion-centro y plantillas-documentos (ya son privados).
--
-- Rollback (vuelve a públicos):
--   update storage.buckets set public = true where id in (...los mismos...);

update storage.buckets
set public = false
where id in (
  'contratos',
  'comprobantes',
  'facturas',
  'Facturas',
  'cotizaciones',
  'responsivas-equipo',
  'tickets',
  'mantenimientos',
  'sala-juntas'
);

-- Verificación: los 9 deben salir con public = false.
select id, public from storage.buckets order by id;
