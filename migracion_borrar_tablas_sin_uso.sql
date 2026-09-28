-- =====================================================================
-- Borra 6 tablas que el código no usa en ningún lado (ninguna pantalla las
-- lee ni las escribe) — revisado uno por uno con búsqueda en todo el
-- proyecto antes de escribir este archivo.
--
--   planes, plan_reglas             catálogo de precios viejo (Platino
--                                    Semanal, Premium Semanal…), reemplazado
--                                    por "paquetes", que es lo que usan hoy
--                                    todas las pantallas. TIENEN DATOS
--                                    reales (35 y 37 filas) que se pierden
--                                    para siempre al correr esto.
--   eventos_rp, conexiones_rp       de un módulo de eventos que ya no existe
--                                    en la app. eventos_rp tiene 1 fila de
--                                    prueba ("Presentacion Nodus"); conexiones_rp
--                                    está vacía.
--   documentacion_centro_secciones  se creó para Documentación del Centro
--                                    pero la pantalla final solo usa carpetas
--                                    y archivos, nunca llegó a usar
--                                    "secciones". Vacía.
--   comunidad_clientes              sin ningún uso encontrado. Vacía.
--
-- plan_reglas se borra antes que planes porque tiene una llave foránea
-- (plan_reglas.plan_id -> planes.id).
--
-- Esto es IRREVERSIBLE: no hay "deshacer" para las filas de planes/
-- plan_reglas — si algo sale mal, se restaura desde un respaldo de
-- Supabase, no con SQL. El usuario confirmó borrarlas (28 sep 2026).
-- =====================================================================

begin;

drop table if exists public.plan_reglas cascade;
drop table if exists public.planes cascade;
drop table if exists public.eventos_rp cascade;
drop table if exists public.conexiones_rp cascade;
drop table if exists public.documentacion_centro_secciones cascade;
drop table if exists public.comunidad_clientes cascade;

commit;
