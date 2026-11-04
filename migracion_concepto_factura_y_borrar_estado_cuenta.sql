-- =====================================================================
-- 1) profiles.concepto_factura: el concepto predefinido de las facturas del
--    cliente (lo escribe Finanzas en Configuración fiscal). La app le cambia
--    el mes y el año al del periodo de cada factura (lib/conceptoFactura.ts).
--    Vacío = el concepto que arma el sistema.
--
-- 2) borrar_estado_de_cuenta(id): borra una integración que todavía no se
--    timbra ni se cobra (Estados de cuenta > casilla > Borrar). Todo va junto:
--    - No borra si ya está timbrada, pagada o cancelada, si tiene un pago
--      registrado o un cargo en línea, o si la generó el cobro diario.
--    - Los pagos que ya existían antes del estado de cuenta (adicionales que se
--      ligaron al integrar) vuelven a quedar sin factura, para integrarlos otra vez.
--    - Las líneas que se crearon con él (renta, penalización, adicionales a mano)
--      se borran, y la renta del mes vuelve a salir en Previa.
--    Devuelve 'ok' o el motivo por el que no se borró.
--
-- Es seguro volver a correrlo.
-- =====================================================================

alter table public.profiles add column if not exists concepto_factura text;

create or replace function public.borrar_estado_de_cuenta(p_factura uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  f record;
begin
  select id, folio, estado, uuid_cfdi, facturapi_id, created_at into f
  from public.facturas where id = p_factura for update;
  if not found then return 'no_existe'; end if;
  if f.uuid_cfdi is not null or f.facturapi_id is not null then return 'timbrada'; end if;
  if f.estado in ('pagada', 'cancelada') then return 'pagada'; end if;
  if f.folio ~ '^FAC-[0-9]{6}-' or exists (select 1 from public.cargos_periodo where factura_id = p_factura and origen = 'cron') then
    return 'cobro_diario';
  end if;
  if exists (select 1 from public.pagos where factura_id = p_factura and (estado = 'pagado' or openpay_charge_id is not null)) then
    return 'con_pago';
  end if;

  delete from public.cargos_periodo where factura_id = p_factura;
  update public.pagos set factura_id = null where factura_id = p_factura and created_at < f.created_at;
  delete from public.pagos where factura_id = p_factura;
  delete from public.facturas where id = p_factura;
  return 'ok';
end;
$$;

revoke all on function public.borrar_estado_de_cuenta(uuid) from public, anon, authenticated;
grant execute on function public.borrar_estado_de_cuenta(uuid) to service_role;

-- Comprobación: debe salir la columna y la función.
select
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'concepto_factura') as columna_concepto,
  (select count(*) from pg_proc where proname = 'borrar_estado_de_cuenta') as funcion_borrar;
