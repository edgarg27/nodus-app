-- =====================================================================
-- PASO 1 de 2 — corre ESTO PRIMERO, solo, y dale "Run".
--
-- Tu columna profiles.rol no es texto libre, es un tipo enum de Postgres
-- llamado "rol_nodus" — por eso salió el error 22P02 (invalid input
-- value for enum rol_nodus) al intentar usar "atencion_cliente": ese
-- valor todavía no existe dentro del enum, hay que agregarlo antes de
-- poder usarlo en cualquier política o fila.
--
-- Postgres no deja agregar un valor a un enum Y usarlo en la misma
-- transacción/consulta — por eso este script va SEPARADO. Corre este
-- archivo primero (solo él), espera a que diga "Success", y hasta
-- entonces corre migracion_quejas_logros.sql.
-- =====================================================================

alter type public.rol_nodus add value if not exists 'atencion_cliente';
alter type public.rol_nodus add value if not exists 'diseno';
