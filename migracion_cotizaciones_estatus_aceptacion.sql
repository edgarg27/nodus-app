-- =====================================================================
-- Aceptación de cotizaciones → contrato
--
-- Qué agrega:
--   Columnas nuevas en `cotizaciones` (los documentos PowerPoint/PDF que
--   se ven en /cotizaciones) para poder ligarlas con la venta real
--   (`cotizaciones_comerciales`, capturada en CotizarForm.tsx) y saber si
--   ya se aceptaron. Hoy esa tabla no sabe a qué venta pertenece ni si
--   alguien ya la aceptó — /api/cotizacion-aceptar usa estas columnas
--   para resolver los datos del cliente/precio/fechas al redactar el
--   contrato en .docx.
--
-- Corre esto UNA VEZ en el SQL Editor de Supabase.
-- =====================================================================

alter table public.cotizaciones add column if not exists estatus text not null default 'pendiente';
alter table public.cotizaciones add column if not exists cotizacion_comercial_id uuid references public.cotizaciones_comerciales(id);

create index if not exists cotizaciones_cotizacion_comercial_id_idx
  on public.cotizaciones (cotizacion_comercial_id);
