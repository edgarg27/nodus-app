-- =====================================================================
-- Hace privados los buckets de Storage que guardan documentos personales o de
-- dinero: contratos, comprobantes, facturas, cotizaciones, responsivas de
-- equipo, fotos de tickets/quejas/paquetería, mantenimientos y sala de juntas.
--
-- Hoy son públicos: cualquiera con el enlace exacto de un archivo puede
-- abrirlo sin iniciar sesión, aunque la pantalla donde se ve sí pida login.
-- La app YA abre estos archivos con un enlace firmado y temporal que pide el
-- servidor (`/api/archivos/firmar`, ver lib/storage.ts, BotonArchivo e
-- ImagenPrivada) y comprueba quién puede verlo: el personal cualquiera, un
-- cliente solo los suyos. Volverlos privados solo cierra el atajo de abrir el
-- archivo directo sin pasar por esa comprobación.
--
-- Probado antes de este cambio: con el bucket "mantenimientos" ya puesto en
-- privado, en el navegador con sesión de personal, un mantenimiento nuevo con
-- archivo se guardó bien y "Ver archivo" lo abrió sin problema — las subidas y
-- las lecturas no dependen de que el bucket sea público, dependen de las
-- políticas de la tabla storage.objects, que ya están puestas.
--
-- Quedan público a propósito (no son documentos personales ni de dinero):
-- logros, decoraciones, banners-promocionales, comunicados (imágenes de
-- correos masivos), mapa-oficinas.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase.
-- Si algo se ve raro después de correrlo, se revierte con:
--   update storage.buckets set public = true
--   where name in ('contratos','comprobantes','facturas','Facturas','cotizaciones','responsivas-equipo','tickets','mantenimientos','sala-juntas');
-- =====================================================================

update storage.buckets set public = false
where name in ('contratos', 'comprobantes', 'facturas', 'Facturas', 'cotizaciones', 'responsivas-equipo', 'tickets', 'mantenimientos', 'sala-juntas');

-- Verificación: todos deben salir en "false" (mantenimientos ya estaba en
-- false porque se probó antes de escribir esta migración).
--   select name, public from storage.buckets
--   where name in ('contratos','comprobantes','facturas','Facturas','cotizaciones','responsivas-equipo','tickets','mantenimientos','sala-juntas')
--   order by name;
