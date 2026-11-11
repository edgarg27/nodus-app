-- =====================================================================
-- Promoción: el último mes del contrato no se cobra ("mes de cortesía").
--
-- Marca por contrato (solo algunos la tienen). Cuando está activa, el cobro
-- diario NO genera la renta del último mes del contrato: el mes de su
-- fecha_vencimiento (ej. contrato que termina en abril → abril es gratis).
-- La regla es el ÚLTIMO mes, no el primero.
--
-- Es seguro volver a correrlo.
-- =====================================================================

alter table public.contratos add column if not exists ultimo_mes_gratis boolean not null default false;
