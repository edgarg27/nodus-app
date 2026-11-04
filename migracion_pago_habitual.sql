-- Cómo paga normalmente cada cliente (lo captura Facturación en Configuración fiscal → "Pago habitual"):
-- método (PUE o PPD) y forma de pago del SAT (03 transferencia, 01 efectivo, 04 tarjeta…). Lo usan Integrar por
-- lote, el cuadro Facturar del estado de cuenta y "Pagado" en Cobranza para proponerlo. Vacío = como hasta hoy.
-- Es seguro volver a correrlo.
alter table public.profiles add column if not exists metodo_pago_habitual text;
alter table public.profiles add column if not exists forma_pago_habitual text;
alter table public.profiles drop constraint if exists profiles_metodo_pago_habitual_check;
alter table public.profiles add constraint profiles_metodo_pago_habitual_check
  check (metodo_pago_habitual is null or metodo_pago_habitual in ('PUE', 'PPD'));

-- Comprobación: deben salir las dos columnas.
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name in ('metodo_pago_habitual', 'forma_pago_habitual');
