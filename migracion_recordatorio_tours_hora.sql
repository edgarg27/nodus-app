-- =====================================================================
-- Migración: recordatorio de tour una hora antes
--
-- Además del correo de un día antes (recordatorio_enviado), ahora se manda
-- otro una hora antes del tour. Esta columna marca que ya se envió, para
-- no mandarlo dos veces (el cron corre cada 10 minutos).
--
-- Es seguro volver a correr este archivo. Se corre a mano en el SQL
-- Editor de Supabase.
-- =====================================================================

alter table public.tours
  add column if not exists recordatorio_hora_enviado boolean not null default false;
