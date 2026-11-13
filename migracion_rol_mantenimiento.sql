-- =====================================================================
-- Rol nuevo: Mantenimiento (mantenimiento), para León.
--
-- Hace lo mismo que Operaciones (la arquitecta) en tickets de mantenimiento,
-- Mtto. y Proveedores (pagos a proveedores), pero SOLO en los centros de León:
-- Puerta Bajío Piso 2, Puerta Bajío Piso 8 y Stadium (los mismos que
-- CENTROS_POR_ROL en lib/roles.ts).
--
-- SE CORRE EN DOS PASOS (Postgres no deja usar un valor nuevo del enum en la
-- misma ejecución en que se agrega): primero este archivo, SOLO; después
-- migracion_rol_mantenimiento_2.sql.
-- Es seguro volver a correrlo.
-- =====================================================================

alter type public.rol_nodus add value if not exists 'mantenimiento';
