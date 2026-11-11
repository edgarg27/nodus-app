-- =====================================================================
-- Notas internas por cliente.
--
-- Un campo libre para que el personal anote situaciones especiales del cliente
-- (ej. "mes gratis por promoción", "contrato 6 meses y el último no se cobra"),
-- visible al registrar al cliente, al editarlo y en Cobranza, para identificarlos.
-- Es solo interno: el cliente NO lo ve.
--
-- Es seguro volver a correrlo.
-- =====================================================================

alter table public.profiles add column if not exists notas text;
