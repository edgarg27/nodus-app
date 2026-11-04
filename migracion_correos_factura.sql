-- Correos adicionales del cliente para sus facturas y estados de cuenta (opcionales; lib/correosFactura.ts).
-- La factura siempre va al correo de su cuenta y, además, a estos. Es seguro volver a correrlo.
alter table public.profiles add column if not exists correos_factura text[];

-- Comprobación: debe salir 1.
select count(*) as columna_correos_factura
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'correos_factura';
