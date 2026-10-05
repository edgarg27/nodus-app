-- =====================================================================
-- Migración: cobros "Adicionales" (/adicionales)
--
-- El admin del centro puede cobrarle a un cliente cosas sueltas (una hora
-- extra de sala de juntas, copias, frituras…). Cada cobro es un registro de
-- `pagos` (pendiente, sin factura) como los de Cotizar, y se paga igual: con
-- tarjeta desde el estado de cuenta del cliente o marcado a mano en Pagos.
--
-- adicional_tipo: NULL = pago normal. Si trae valor ('sala_juntas', 'copias',
--   'botanas', 'otro') es un cobro adicional, y de ahí sale la clave del SAT
--   con la que se factura (ver TIPOS_COBRO_ADICIONAL en lib/adicionales.ts).
--   Un cobro adicional nunca reactiva una cuenta suspendida por falta de pago.
-- creado_por: quién lo cobró (auditoría).
--
-- No cambia RLS: hereda las políticas de pagos. Es seguro volver a correrlo.
-- Se corre a mano en el SQL Editor de Supabase, ANTES de subir el código.
-- Rollback: alter table public.pagos drop column adicional_tipo, drop column creado_por;
-- =====================================================================

alter table public.pagos
  add column if not exists adicional_tipo text,
  add column if not exists creado_por uuid references auth.users(id);

create index if not exists pagos_adicional_tipo_idx
  on public.pagos (centro, created_at desc)
  where adicional_tipo is not null;
