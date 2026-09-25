-- =====================================================================
-- Datos fiscales del cliente (para el contrato y para facturarle)
--
-- Se piden al ACEPTAR la cotización (Cotizaciones -> Aceptar), no al
-- cotizar. Quedan en la venta, en el contrato y, si el cliente ya tiene cuenta
-- o se le da de alta después, en su perfil. `rfc` ya existía en las tres tablas.
--   nombre_fiscal    nombre o razón social tal como aparece en la Constancia
--                    de Situación Fiscal
--   regimen_fiscal   clave SAT del régimen (601, 612, 626…)
--   cp_fiscal        código postal del domicilio fiscal (5 dígitos)
--   uso_cfdi         clave SAT del uso de la factura (G03 por defecto)
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase,
-- ANTES de aceptar una cotización con la pantalla nueva.
-- =====================================================================

alter table public.cotizaciones_comerciales add column if not exists nombre_fiscal text;
alter table public.cotizaciones_comerciales add column if not exists regimen_fiscal text;
alter table public.cotizaciones_comerciales add column if not exists cp_fiscal text;
alter table public.cotizaciones_comerciales add column if not exists uso_cfdi text;

alter table public.contratos add column if not exists nombre_fiscal text;
alter table public.contratos add column if not exists regimen_fiscal text;
alter table public.contratos add column if not exists cp_fiscal text;
alter table public.contratos add column if not exists uso_cfdi text;

alter table public.profiles add column if not exists nombre_fiscal text;
alter table public.profiles add column if not exists regimen_fiscal text;
alter table public.profiles add column if not exists cp_fiscal text;
alter table public.profiles add column if not exists uso_cfdi text;
