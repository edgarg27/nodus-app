-- Fecha del último envío por correo al cliente del PDF y XML de la factura timbrada (lib/envioCfdi.ts).
-- Sirve para ver en Facturas timbradas cuáles ya se mandaron. Es seguro volver a correrlo.
alter table public.facturas add column if not exists cfdi_enviado_at timestamptz;

-- Comprobación: debe salir 1.
select count(*) as columna_cfdi_enviado
from information_schema.columns
where table_schema = 'public' and table_name = 'facturas' and column_name = 'cfdi_enviado_at';
