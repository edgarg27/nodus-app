-- =====================================================================
-- Migración: checklist de documentos requeridos en Expedientes
--
-- Agrega `tipo_documento` a expediente_archivos para poder ligar un
-- archivo a una casilla fija del checklist (Depósito en garantía, Mes de
-- renta + IVA, Identificación oficial, etc. — ver DOCUMENTOS_REQUERIDOS en
-- app/expedientes/page.tsx). NULL sigue siendo un documento libre, como
-- antes. No cambia RLS: hereda las políticas de la tabla.
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de
-- Supabase, ANTES de usar la pantalla.
-- Rollback: alter table public.expediente_archivos drop column tipo_documento;
-- =====================================================================

alter table public.expediente_archivos
  add column if not exists tipo_documento text;

-- Un cliente no puede tener dos archivos en la misma casilla del checklist
-- (se reemplaza, no se acumula) — NULL (documentos libres) sí se repite.
create unique index if not exists expediente_archivos_cliente_tipo_idx
  on public.expediente_archivos (cliente_id, tipo_documento)
  where tipo_documento is not null;
