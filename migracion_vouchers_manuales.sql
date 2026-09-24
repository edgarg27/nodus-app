-- =====================================================================
-- Migración: Vouchers manuales (para quien sea, sin cliente)
--
-- Desde el módulo Vouchers se puede generar un voucher "por si acaso"
-- para una visita, un proveedor o alguien de paso, sin ligarlo a un
-- cliente. Se guarda sin user_id y con el nombre en "para". Lo inserta
-- el servidor (/api/voucher-manual, con Service Role) después de revisar
-- el rol, así que no hace falta tocar las políticas de inserción.
--
-- Es seguro volver a correr este archivo. Se corre a mano en el SQL
-- Editor de Supabase.
-- =====================================================================

alter table public.vouchers alter column user_id drop not null;

alter table public.vouchers add column if not exists para text;
