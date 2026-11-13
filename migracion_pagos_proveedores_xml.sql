-- =====================================================================
-- Pagos a proveedores: el XML de la factura.
--
-- Además del PDF (factura_url), la arquitecta adjunta el XML del CFDI al
-- registrar el pago, para mandarle a Contabilidad los dos juntos (la
-- descarga .zip los incluye). El archivo va al mismo bucket privado
-- "comprobantes" que el PDF.
-- Es seguro volver a correrlo.
-- Rollback: alter table public.gastos drop column factura_xml_url;
-- =====================================================================

alter table public.gastos add column if not exists factura_xml_url text;

-- Comprobación: debe salir la columna.
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'gastos' and column_name = 'factura_xml_url';
