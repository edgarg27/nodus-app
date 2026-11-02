-- =====================================================================
-- Domicilio fiscal del cliente (Constancia de Situación Fiscal)
--
-- Lo captura la administradora o Finanzas en Nuevo cliente, en el detalle del
-- cliente y en Configuración fiscal. Es para consulta: el CFDI 4.0 solo lleva
-- el código postal del receptor (`cp_fiscal`, que ya existía).
--
-- Es seguro volver a correrlo. Se corre a mano en el SQL Editor de Supabase,
-- ANTES de desplegar la pantalla nueva: Configuración fiscal y Facturación
-- leen estas columnas y sin ellas no listan a los clientes.
-- Rollback: quitar las columnas con `alter table public.profiles drop column`.
-- =====================================================================

alter table public.profiles add column if not exists dom_tipo_vialidad text;
alter table public.profiles add column if not exists dom_vialidad text;
alter table public.profiles add column if not exists dom_num_exterior text;
alter table public.profiles add column if not exists dom_num_interior text;
alter table public.profiles add column if not exists dom_colonia text;
alter table public.profiles add column if not exists dom_localidad text;
alter table public.profiles add column if not exists dom_municipio text;
alter table public.profiles add column if not exists dom_entidad text;
alter table public.profiles add column if not exists dom_entre_calle text;
alter table public.profiles add column if not exists dom_y_calle text;

-- Comprobación: deben salir las 10 columnas.
select column_name
from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name like 'dom\_%'
order by column_name;
