-- =====================================================================
-- Clave del SAT por cobro: facturas.adicional_tipo
--
-- Un cobro libre (Facturas > + Nueva factura) o un cobro suelto que se factura
-- antes de pagarse (adicional, depósito…) puede llevar su propio tipo de
-- servicio: 'sala_juntas', 'copias', 'botanas' u 'otro' (ver
-- TIPOS_COBRO_ADICIONAL en lib/adicionales.ts), de donde sale la clave del SAT
-- con la que se timbra. NULL = renta de espacio (la de siempre).
--
-- No cambia RLS. Es seguro volver a correrlo.
-- Hay que correrlo ANTES de desplegar.
-- Rollback: alter table public.facturas drop column adicional_tipo;
-- =====================================================================

alter table public.facturas
  add column if not exists adicional_tipo text;

-- Revisión: debe aparecer la columna.
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'facturas' and column_name = 'adicional_tipo';
