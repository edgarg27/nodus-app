-- =====================================================================
-- Rol nuevo: Ejecutiva de Ventas (ejecutiva_ventas), para León.
--
-- Por ahora solo trabaja Prospectos, y solo de los centros de León:
-- Puerta Bajío Piso 2, Puerta Bajío Piso 8 y Stadium (los mismos que
-- CENTROS_POR_ROL en lib/roles.ts). Ve, registra, da seguimiento y borra
-- prospectos de esos centros; y como el seguimiento puede agendar un tour,
-- también maneja los tours de esos centros.
--
-- Las políticas se AGREGAN; no se toca ninguna de los demás roles.
-- Es seguro volver a correrlo.
--
-- SE CORRE EN DOS PASOS (Postgres no deja usar un valor nuevo del enum en la
-- misma ejecución en que se agrega): primero este archivo, SOLO; después
-- migracion_rol_ejecutiva_ventas_2.sql.
-- =====================================================================

-- 1. El rol.
alter type public.rol_nodus add value if not exists 'ejecutiva_ventas';
